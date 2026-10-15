# Cloudflare Workers Deployment

Run the MCP server directly on Cloudflare Workers: no Docker, no always-on machine, no database to manage. This is separate from the [Cloudflare Tunnel setup](cloudflare-setup.md), which fronts the Docker container.

## How it works

| Piece | Docker/Node server | Workers |
|---|---|---|
| HTTP + OAuth | Express, express-session, hand-rolled OAuth | [`@cloudflare/workers-oauth-provider`](https://github.com/cloudflare/workers-oauth-provider) (DCR, CIMD, PKCE, refresh tokens) |
| Storage | SQLite (`better-sqlite3`) | One KV namespace (`OAUTH_KV`) |
| User accounts | Local email/password or Google, then AnyList credentials | **Your AnyList account is the login.** No separate account. |
| MCP sessions | In-memory map | One Durable Object per session (`McpAgent`) |
| AnyList updates | Realtime WebSocket | Re-fetches lists when a session's data is more than 10s old |
| Tools | `src/tools/*` | Same code, unchanged |

When an MCP client connects, you see a **Connect AnyList** page. Enter your AnyList email, password and (optionally) a default list. The Worker checks them against AnyList and `ALLOWED_EMAILS`, then stores them in the OAuth grant's props. The provider encrypts props with key material derived from the issued token, so the stored grant is unreadable without a live token. AnyList's own access/refresh tokens are cached in KV, encrypted with your AnyList password, so new sessions don't log in with the password every time.

`anylist-js` runs unmodified. `wrangler.jsonc` aliases its Node-only dependencies (`got`, `form-data`, `ws`) to small fetch-based stand-ins in `src/worker/shims/`.

## Endpoints

| Path | Purpose |
|---|---|
| `/mcp` | MCP Streamable HTTP. **Use this one.** |
| `/mcp/sse` | Legacy SSE transport, for clients that only speak SSE |
| `/authorize` | Sign-in page |
| `/token`, `/register` | OAuth token and dynamic client registration |
| `/.well-known/oauth-*` | OAuth discovery metadata |
| `/health` | Health check |

## Deploy

Requires a Cloudflare account on the Workers Paid plan. On the free plan, requests fail with error 1102, because starting the AnyList client takes about 15–20 ms of CPU time and the free plan stops requests at 10 ms.

```bash
git clone --recurse-submodules https://github.com/djbrinkerhoff/anylist-mcp.git
cd anylist-mcp
npm install

npx wrangler login

# Who may sign in (your AnyList email; comma-separate several)
npx wrangler secret put ALLOWED_EMAILS

# First deploy creates the KV namespace automatically.
npm run deploy:worker
# → https://anylist-mcp.<your-subdomain>.workers.dev
```

### Custom domain (optional)

If the domain is on Cloudflare DNS:

```bash
npx wrangler deploy --domain anylist.example.com
```

Or set it permanently in `wrangler.jsonc`:

```jsonc
"routes": [{ "pattern": "anylist.example.com", "custom_domain": true }]
```

With routes configured, the workers.dev URL is turned off unless you also set `"workers_dev": true`. Tokens are issued per hostname, so if you serve both, connect each client through one of them consistently.

## Connect agents

### Claude (claude.ai, Desktop, mobile)

**Settings → Connectors → Add custom connector**, URL `https://<your-worker>/mcp`. You'll be sent to the Connect AnyList page.

### Claude Code

```bash
claude mcp add --transport http anylist https://<your-worker>/mcp
```

Then run `/mcp` inside Claude Code to authenticate.

### Other OAuth-capable clients (Cursor, VS Code, ChatGPT, etc.)

Add a remote MCP server with URL `https://<your-worker>/mcp`. Discovery, registration and sign-in are automatic.

### Headless agents (API key)

For scripts, CI, or agents that can't open a browser, enable a static API key. It acts as one AnyList account set via secrets:

```bash
openssl rand -hex 32 | npx wrangler secret put MCP_API_KEY   # keep a copy of the value
npx wrangler secret put ANYLIST_EMAIL
npx wrangler secret put ANYLIST_PASSWORD
npx wrangler secret put ANYLIST_DEFAULT_LIST                 # optional
```

Clients send `Authorization: Bearer <MCP_API_KEY>`:

```bash
claude mcp add --transport http anylist https://<your-worker>/mcp \
  --header "Authorization: Bearer $ANYLIST_MCP_KEY"
```

The key must be at least 32 characters. It is disabled unless `MCP_API_KEY`, `ANYLIST_EMAIL` and `ANYLIST_PASSWORD` are all set.

## Local development

```bash
cp .dev.vars.example .dev.vars   # set ALLOWED_EMAILS
npm run dev:worker               # http://localhost:8787
```

Watch production logs with `npx wrangler tail`.

## Troubleshooting

**"This AnyList account is not allowed on this server."** Add the email to `ALLOWED_EMAILS` (`npx wrangler secret put ALLOWED_EMAILS`). Secrets apply immediately, with no redeploy needed.

**Claude says authorization failed after signing in.** Cloudflare's Bot Fight Mode can block requests from Anthropic's servers on custom domains. See the [Tunnel troubleshooting notes](cloudflare-setup.md#troubleshooting). workers.dev URLs aren't affected.

**Changed your AnyList password.** Existing connections stop working. Reconnect each client to sign in again.

**Revoking access.** Disconnect the client, or rotate `MCP_API_KEY`. To revoke every OAuth grant at once, delete the KV namespace's `grant:*` and `token:*` keys (or the namespace itself).
