// Minimal stand-in for the `form-data` npm package, used by anylist-js.
// Produces the same multipart encoding form-data does for the values anylist-js
// sends: strings become plain fields, binary values (protobuf buffers) become
// fields with `Content-Type: application/octet-stream` and no filename.
// The browser FormData global can't do that — appending a Blob adds a filename.

const {Buffer} = require('node:buffer');

const CRLF = '\r\n';

function toBuffer(value) {
	if (Buffer.isBuffer(value)) {
		return value;
	}

	if (value instanceof ArrayBuffer) {
		return Buffer.from(new Uint8Array(value));
	}

	if (ArrayBuffer.isView(value)) {
		return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
	}

	// Protobuf.js 5 / ByteBuffer instances
	if (value && typeof value.toBuffer === 'function') {
		return toBuffer(value.toBuffer());
	}

	return null;
}

class FormData {
	constructor() {
		const random = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, '0')).join('');
		this._boundary = `--------------------------${random}`;
		this._parts = [];
	}

	append(name, value) {
		this._parts.push([name, value]);
	}

	getBoundary() {
		return this._boundary;
	}

	getHeaders(userHeaders = {}) {
		return {
			'content-type': `multipart/form-data; boundary=${this._boundary}`,
			...userHeaders,
		};
	}

	getBuffer() {
		const chunks = [];
		for (const [name, value] of this._parts) {
			const binary = toBuffer(value);
			let header = `--${this._boundary}${CRLF}Content-Disposition: form-data; name="${name}"${CRLF}`;
			if (binary) {
				header += `Content-Type: application/octet-stream${CRLF}`;
			}

			header += CRLF;
			chunks.push(Buffer.from(header), binary || Buffer.from(String(value)), Buffer.from(CRLF));
		}

		chunks.push(Buffer.from(`--${this._boundary}--${CRLF}`));
		return Buffer.concat(chunks);
	}
}

module.exports = FormData;
