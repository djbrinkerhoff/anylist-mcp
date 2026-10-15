import { verifyAnyListCredentials } from "./anylist.js";

// Default handler for OAuthProvider: everything that isn't the protected MCP API
// or an endpoint the provider implements itself (token, register, metadata).
//
// Identity is the AnyList account. /authorize asks for AnyList credentials,
// checks them against AnyList and ALLOWED_EMAILS, then stores them in the
// grant's props, which the provider keeps encrypted with key material derived
// from the issued token. There is no separate user database.

const SCOPES = ["mcp"];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/authorize") {
      if (request.method === "GET") return showAuthorize(request, env);
      if (request.method === "POST") return submitAuthorize(request, env);
      return new Response("Method not allowed", { status: 405 });
    }

    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    if (url.pathname === "/" && request.method === "GET") {
      return html(landingPage(url.origin));
    }

    return new Response("Not found", { status: 404 });
  },
};

export function allowedEmails(env) {
  return new Set(
    (env.ALLOWED_EMAILS || "")
      .split(/[\s,]+/)
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

async function showAuthorize(request, env) {
  let authRequest;
  try {
    authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  } catch (error) {
    return html(messagePage("Invalid authorization request", error.message), 400);
  }

  const consent = await env.OAUTH_PROVIDER.describeConsent(authRequest);
  const { handle, headers } = await env.OAUTH_PROVIDER.beginConsent(authRequest);
  return html(authorizePage({ handle, consent, action: `${new URL(request.url).origin}/authorize` }), 200, headers);
}

async function submitAuthorize(request, env) {
  const form = await request.formData();
  const handle = String(form.get("handle") || "");
  const consent = {
    clientName: String(form.get("client_name") || ""),
    redirectHost: String(form.get("redirect_host") || ""),
    redirectIsLoopback: form.get("redirect_is_loopback") === "1",
  };

  if (form.get("action") === "deny") {
    try {
      const { redirectTo, headers } = await env.OAUTH_PROVIDER.denyConsent(request, handle);
      return redirect(redirectTo, headers);
    } catch (error) {
      return html(messagePage("Authorization expired", error.message), 400);
    }
  }

  const email = String(form.get("email") || "").trim();
  const password = String(form.get("password") || "");
  const defaultList = String(form.get("default_list") || "").trim() || null;
  const action = `${new URL(request.url).origin}/authorize`;
  const retry = error => {
    console.log(`[authorize] rejected: ${error}`);
    return html(authorizePage({ handle, consent, action, email, defaultList, error }), 400);
  };

  if (!email || !password) return retry("AnyList email and password are required.");

  const allowed = allowedEmails(env);
  if (allowed.size === 0) {
    return retry("This server has no ALLOWED_EMAILS configured, so nobody can sign in yet.");
  }
  if (!allowed.has(email.toLowerCase())) {
    return retry("This AnyList account is not allowed on this server.");
  }

  let listNames;
  try {
    listNames = await verifyAnyListCredentials(env.OAUTH_KV, { email, password });
  } catch (error) {
    const status = error.response?.statusCode;
    return retry(status === 400 || status === 401
      ? "AnyList rejected that email or password."
      : `Could not reach AnyList: ${error.message}`);
  }

  if (defaultList && !listNames.includes(defaultList)) {
    return retry(`List "${defaultList}" not found. Your lists: ${listNames.join(", ") || "(none)"}`);
  }

  let approved;
  try {
    approved = await env.OAUTH_PROVIDER.approveConsent(request, handle, { scope: SCOPES });
  } catch (error) {
    console.log(`[authorize] consent handle rejected: ${error.message}`);
    return html(messagePage("Authorization expired", error.message), 400);
  }

  const client = await env.OAUTH_PROVIDER.lookupClient(approved.request.clientId);
  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: approved.request,
    // Opaque ID: it appears inside authorization codes and tokens, and some clients
    // reject codes containing percent-encoded characters.
    userId: await userIdFor(email),
    metadata: { clientName: client?.clientName || approved.request.clientId },
    scope: SCOPES,
    props: { email, password, defaultList },
  });

  console.log(`[authorize] approved for client ${approved.request.clientId}, redirecting to ${new URL(redirectTo).host}`);
  return redirect(redirectTo, approved.headers);
}

async function userIdFor(email) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  return [...new Uint8Array(digest)].slice(0, 16).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Rendering ────────────────────────────────────────────────────────────────

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function html(body, status = 200, headers = undefined) {
  const h = new Headers(headers);
  h.set("content-type", "text/html; charset=utf-8");
  h.set("cache-control", "no-store");
  return new Response(body, { status, headers: h });
}

function redirect(location, headers = undefined) {
  const h = new Headers(headers);
  h.set("location", location);
  return new Response(null, { status: 302, headers: h });
}

const STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, sans-serif; background: #f5f5f5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 16px; }
  .card { background: #fff; border-radius: 10px; box-shadow: 0 2px 16px rgba(0,0,0,.08); padding: 2rem; width: 100%; max-width: 440px; }
  h1 { font-size: 1.3rem; margin: 0 0 .5rem; color: #111; }
  p.subtitle { color: #555; font-size: .9rem; margin: 0 0 1.25rem; line-height: 1.45; }
  label { display: block; font-size: .85rem; font-weight: 600; margin-bottom: .3rem; color: #333; }
  input[type=email], input[type=password], input[type=text] { width: 100%; padding: .6rem .8rem; border: 1px solid #ccc; border-radius: 6px; font-size: 1rem; margin-bottom: 1rem; }
  input:focus { outline: none; border-color: #4f7df3; box-shadow: 0 0 0 2px rgba(79,125,243,.2); }
  .optional { font-weight: 400; color: #888; font-size: .8rem; }
  .actions { display: flex; gap: .5rem; }
  .btn { flex: 1; padding: .7rem; border: none; border-radius: 6px; font-size: 1rem; font-weight: 600; cursor: pointer; }
  .btn-primary { background: #4f7df3; color: #fff; }
  .btn-primary:hover { background: #3a68e0; }
  .btn-secondary { background: #eee; color: #333; flex: 0 0 auto; padding: .7rem 1.1rem; }
  .error { background: #fff0f0; border: 1px solid #f5c0c0; color: #c00; border-radius: 6px; padding: .6rem .8rem; margin-bottom: 1rem; font-size: .9rem; }
  .warn { background: #fffbea; border: 1px solid #f0dc8c; color: #7a5b00; border-radius: 6px; padding: .6rem .8rem; margin-bottom: 1rem; font-size: .85rem; }
  .client { background: #f3f6fe; border-radius: 6px; padding: .6rem .8rem; margin-bottom: 1.25rem; font-size: .9rem; color: #333; }
  .note { font-size: .8rem; color: #888; margin-top: -.6rem; margin-bottom: 1rem; }
  .logo { text-align: center; font-size: 2rem; margin-bottom: .5rem; }
  code { background: #f0f0f0; padding: .1rem .35rem; border-radius: 4px; font-size: .85rem; word-break: break-all; }
`;

function page(title, inner) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — AnyList MCP</title>
  <style>${STYLES}</style>
</head>
<body>
  <div class="card">
    <div class="logo">🛒</div>
    ${inner}
  </div>
</body>
</html>`;
}

function authorizePage({ handle, consent, action, email = "", defaultList = "", error = "" }) {
  return page("Connect AnyList", `
    <h1>Connect AnyList</h1>
    <div class="client">
      <strong>${escapeHtml(consent.clientName || "An MCP client")}</strong> wants access to your AnyList lists, recipes, and meal plan.
      It will be sent to <code>${escapeHtml(consent.redirectHost)}</code>.
    </div>
    ${consent.redirectIsLoopback ? `<div class="warn">This client redirects to your own computer (localhost). Only continue if you just started this connection.</div>` : ""}
    ${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
    <form method="POST" action="${escapeHtml(action)}">
      <input type="hidden" name="handle" value="${escapeHtml(handle)}">
      <input type="hidden" name="client_name" value="${escapeHtml(consent.clientName)}">
      <input type="hidden" name="redirect_host" value="${escapeHtml(consent.redirectHost)}">
      <input type="hidden" name="redirect_is_loopback" value="${consent.redirectIsLoopback ? "1" : "0"}">

      <label for="email">AnyList email</label>
      <input type="email" id="email" name="email" required autocomplete="username" value="${escapeHtml(email)}">

      <label for="password">AnyList password</label>
      <input type="password" id="password" name="password" required autocomplete="current-password">

      <label for="default-list">Default list <span class="optional">(optional)</span></label>
      <input type="text" id="default-list" name="default_list" placeholder="e.g. Groceries" autocomplete="off" value="${escapeHtml(defaultList)}">
      <p class="note">Shopping tools use this list when none is specified. Must match the name in AnyList exactly.</p>

      <div class="actions">
        <button type="submit" name="action" value="deny" class="btn btn-secondary" formnovalidate>Cancel</button>
        <button type="submit" name="action" value="approve" class="btn btn-primary">Connect</button>
      </div>
    </form>
  `);
}

function messagePage(title, message) {
  return page(title, `<h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(message)}</p>`);
}

function landingPage(origin) {
  return page("AnyList MCP", `
    <h1>AnyList MCP server</h1>
    <p class="subtitle">Add this server to your MCP client (Claude, Cursor, etc.). You'll be asked to sign in with your AnyList account.</p>
    <label>Streamable HTTP</label>
    <p><code>${escapeHtml(origin)}/mcp</code></p>
    <label>SSE (legacy clients)</label>
    <p><code>${escapeHtml(origin)}/mcp/sse</code></p>
  `);
}
