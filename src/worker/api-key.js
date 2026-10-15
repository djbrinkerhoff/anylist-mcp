// Optional static API key for agents that can't do the OAuth browser flow
// (scripts, CI, headless agents). Enabled only when these secrets are set:
//   MCP_API_KEY       — the bearer token clients send (at least 32 characters)
//   ANYLIST_EMAIL     — AnyList account the key acts as
//   ANYLIST_PASSWORD
//   ANYLIST_DEFAULT_LIST (optional)
// Clients send `Authorization: Bearer <MCP_API_KEY>` to /mcp (or /mcp/sse).

const MIN_KEY_LENGTH = 32;

async function sha256(text) {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
}

/** Constant-time comparison of two strings (hash first so lengths match). */
async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(ha, hb);
}

/** `resolveExternalToken` callback for OAuthProvider. */
export async function resolveApiKey({ token, request, env }) {
  const key = env.MCP_API_KEY;
  if (!key || key.length < MIN_KEY_LENGTH || !env.ANYLIST_EMAIL || !env.ANYLIST_PASSWORD) {
    return null;
  }
  if (!(await safeEqual(token, key))) return null;

  return {
    props: {
      email: env.ANYLIST_EMAIL,
      password: env.ANYLIST_PASSWORD,
      defaultList: env.ANYLIST_DEFAULT_LIST || null,
    },
    audience: `${new URL(request.url).origin}/mcp`,
  };
}
