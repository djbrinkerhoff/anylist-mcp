import { Buffer } from "node:buffer";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import AnyList from "../../anylist-js/lib/index.js";
import AnyListClient from "../anylist-client.js";

const KEY_PREFIX = "anylist-creds:";

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * AnyList that keeps its clientId + access/refresh tokens in KV instead of a
 * credentials file, so new MCP sessions reuse tokens rather than logging in
 * with the password every time. The blob is encrypted with the AnyList
 * password, the same way anylist-js encrypts its credentials file.
 */
class KvAnyList extends AnyList {
  constructor({ email, password, kv }) {
    super({ email, password, credentialsFile: null });
    this.kv = kv;
  }

  // Same format as anylist-js, but hands the cipher a Buffer: workerd's
  // node:crypto doesn't accept a bare string without an input encoding.
  _encryptCredentials(credentials, secret) {
    const key = createHash("sha256").update(String(secret)).digest("base64").slice(0, 32);
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", Buffer.from(key), iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(JSON.stringify(credentials), "utf8")), cipher.final()]);
    return JSON.stringify({ iv: iv.toString("hex"), cipher: encrypted.toString("hex") });
  }

  async _kvKey() {
    return KEY_PREFIX + await sha256Hex(this.email.trim().toLowerCase());
  }

  async _loadCredentials() {
    const stored = await this.kv.get(await this._kvKey());
    if (!stored) return;
    try {
      const credentials = this._decryptCredentials(stored, this.password);
      this.clientId = credentials.clientId;
      this.accessToken = credentials.accessToken;
      this.refreshToken = credentials.refreshToken;
    } catch {
      // Wrong password (changed since tokens were cached) or corrupt blob: start fresh.
    }
  }

  async _storeCredentials() {
    const credentials = {
      clientId: this.clientId,
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
    };
    try {
      await this.kv.put(await this._kvKey(), this._encryptCredentials(credentials, this.password));
    } catch (error) {
      console.error(`Failed to cache AnyList credentials: ${error.message}`);
    }
  }
}

/**
 * Log into AnyList and return the account's list names. Throws if the
 * credentials are rejected. Successful logins also warm the KV token cache.
 * @param {KVNamespace} kv
 * @param {{ email: string, password: string }} creds
 * @returns {Promise<string[]>}
 */
export async function verifyAnyListCredentials(kv, { email, password }) {
  const anylist = new KvAnyList({ email, password, kv });
  await anylist.login(false);
  const lists = await anylist.getLists();
  return lists.map(list => list.name);
}

/**
 * Build an AnyListClient suitable for Workers: KV-backed token cache, no WebSocket.
 * @param {KVNamespace} kv
 * @param {{ email: string, password: string, defaultList?: string | null }} creds
 */
export function createAnyListClient(kv, { email, password, defaultList }) {
  return new AnyListClient({
    username: email,
    password,
    defaultListName: defaultList || null,
    connectWebSocket: false,
    createAnyList: ({ email, password }) => new KvAnyList({ email, password, kv }),
  });
}
