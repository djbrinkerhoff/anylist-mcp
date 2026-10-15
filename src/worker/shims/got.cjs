// Minimal fetch-based stand-in for `got` v11, covering only what anylist-js uses:
//   got.extend({headers, prefixUrl, followRedirect, mutableDefaults, hooks})
//   client.extend(...), client.post(path, {body, headers})
//   the returned promise's .json()
//   hooks: beforeRequest(options), afterResponse(response, retryWithMergedOptions),
//          beforeError(error)
// Responses look like got's: {statusCode, headers, body, request: {options: {url}}}.
// Non-2xx/3xx statuses reject with an HTTPError carrying `.response`.

const {Buffer} = require('node:buffer');

class HTTPError extends Error {
	constructor(response) {
		super(`Response code ${response.statusCode}`);
		this.name = 'HTTPError';
		this.response = response;
	}
}

function mergeDefaults(base, extra = {}) {
	const hooks = {};
	for (const name of ['beforeRequest', 'afterResponse', 'beforeError']) {
		hooks[name] = [...(base.hooks?.[name] || []), ...(extra.hooks?.[name] || [])];
	}

	return {
		...base,
		...extra,
		headers: {...base.headers, ...extra.headers},
		hooks,
	};
}

function resolveUrl(prefixUrl, path) {
	if (!prefixUrl) {
		return new URL(path);
	}

	const prefix = prefixUrl.endsWith('/') ? prefixUrl : `${prefixUrl}/`;
	return new URL(path.replace(/^\//, ''), prefix);
}

async function send(options) {
	let {body} = options;
	const headers = {...options.headers};

	if (body && typeof body.getBuffer === 'function') {
		Object.assign(headers, body.getHeaders());
		body = body.getBuffer();
	}

	const response = await fetch(options.url, {
		method: options.method,
		headers,
		body,
		redirect: options.followRedirect === false ? 'manual' : 'follow',
	});

	const raw = Buffer.from(await response.arrayBuffer());
	let parsed = raw;
	// Error bodies stay text: AnyList answers auth failures with HTML, and
	// got raises HTTPError for them rather than a JSON parse error.
	if (options.responseType === 'json' && response.status < 400) {
		parsed = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : undefined;
	} else if (options.responseType !== 'buffer') {
		parsed = raw.toString('utf8');
	}

	return {
		statusCode: response.status,
		headers: Object.fromEntries(response.headers),
		body: parsed,
		rawBody: raw,
		request: {options},
	};
}

async function run(defaults, method, path, requestOptions, responseType) {
	const options = {
		method,
		url: resolveUrl(defaults.prefixUrl, path),
		headers: {...defaults.headers, ...requestOptions.headers},
		body: requestOptions.body,
		followRedirect: defaults.followRedirect,
		responseType: requestOptions.responseType || responseType || 'text',
	};

	const prepare = async opts => {
		for (const hook of defaults.hooks.beforeRequest) {
			// eslint-disable-next-line no-await-in-loop
			await hook(opts);
		}

		// .json() always wins, as it does in got
		if (responseType === 'json') {
			opts.responseType = 'json';
		}

		return opts;
	};

	let response = await send(await prepare(options));

	for (const hook of defaults.hooks.afterResponse) {
		// eslint-disable-next-line no-await-in-loop
		response = await hook(response, async merged => {
			const retryOptions = await prepare({
				...options,
				headers: {...options.headers, ...merged.headers},
			});
			retryOptions.headers = {...retryOptions.headers, ...merged.headers};
			return send(retryOptions);
		});
	}

	if (response.statusCode >= 400) {
		let error = new HTTPError(response);
		for (const hook of defaults.hooks.beforeError) {
			// eslint-disable-next-line no-await-in-loop
			error = await hook(error);
		}

		throw error;
	}

	return response;
}

function create(defaults) {
	const request = method => (path, requestOptions = {}) => {
		// Like got, start on a later tick so a synchronous .json() can set the
		// response type first. The request is sent exactly once.
		let responseType;
		const promise = Promise.resolve().then(() => run(defaults, method, path, requestOptions, responseType));
		promise.json = () => {
			responseType = 'json';
			return promise.then(r => r.body);
		};

		promise.buffer = () => promise.then(r => r.rawBody);
		promise.text = () => promise.then(r => r.rawBody.toString('utf8'));
		return promise;
	};

	return {
		defaults: {options: defaults},
		extend: (extra = {}) => create(mergeDefaults(defaults, extra)),
		get: request('GET'),
		post: request('POST'),
		put: request('PUT'),
		delete: request('DELETE'),
	};
}

const got = create(mergeDefaults({headers: {}}, {}));
got.HTTPError = HTTPError;

module.exports = got;
