import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { registerAllTools } from "../tools/index.js";
import { createAnyListClient } from "./anylist.js";
import { resolveApiKey } from "./api-key.js";
import authHandler from "./auth-handler.js";
import pkg from "../../package.json";

// How long a session may serve list data from memory before re-fetching it.
// The Node server keeps lists fresh over AnyList's WebSocket; Workers poll instead.
const LIST_REFRESH_MS = 10_000;

/**
 * One Durable Object per MCP session. `this.props` is whatever the OAuth grant
 * (or API key) resolved to: { email, password, defaultList }.
 */
export class AnyListMCP extends McpAgent {
  // The SDK's default validator (Ajv) compiles schemas with `new Function`,
  // which Workers forbid; it's used to check elicitation responses.
  server = new McpServer(
    { name: "anylist-mcp-server", version: pkg.version },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() }
  );

  async init() {
    registerAllTools(this.server, () => this.getClient());
  }

  async getClient() {
    const { email, password, defaultList } = this.props || {};
    if (!email || !password) {
      throw new Error("This session has no AnyList credentials. Reconnect the MCP server to sign in again.");
    }

    // Props change when a client re-authorizes into an existing session.
    const identity = `${email}\n${password}`;
    if (this._client && this._clientIdentity !== identity) this._client = null;

    if (!this._client) {
      this._client = createAnyListClient(this.env.OAUTH_KV, { email, password, defaultList });
      this._clientIdentity = identity;
      this._refreshedAt = Date.now();
    } else if (Date.now() - this._refreshedAt > LIST_REFRESH_MS) {
      await this._client.refresh();
      this._refreshedAt = Date.now();
    }
    return this._client;
  }
}

// OAuth tokens are bound to one protected resource, matched by path prefix, so the
// legacy SSE transport lives under it at /mcp/sse and one token works for both.
// The resource has to be an absolute URL, so build one provider per hostname we're
// served on (e.g. the workers.dev URL and a custom domain).
const providers = new Map();

function getProvider(origin) {
  let provider = providers.get(origin);
  if (!provider) {
    provider = new OAuthProvider({
      apiHandlers: {
        "/mcp": AnyListMCP.serve("/mcp", { binding: "MCP_OBJECT" }),
        "/mcp/sse": AnyListMCP.serveSSE("/mcp/sse", { binding: "MCP_OBJECT" }),
      },
      defaultHandler: authHandler,
      authorizeEndpoint: "/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: ["mcp"],
      resourceMetadata: { resource: `${origin}/mcp`, resource_name: "AnyList MCP" },
      resolveExternalToken: resolveApiKey,
    });
    providers.set(origin, provider);
  }
  return provider;
}

export default {
  fetch(request, env, ctx) {
    return getProvider(new URL(request.url).origin).fetch(request, env, ctx);
  },
};
