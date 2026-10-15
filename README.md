# AnyList MCP server

An unofficial [MCP](https://modelcontextprotocol.io) server for [AnyList](https://www.anylist.com/): shopping lists, recipes, recipe collections and meal planning. Use it from Claude, Claude Code, Cursor, ChatGPT or any other MCP client.

This is a fork of [bobby060/anylist-mcp](https://github.com/bobby060/anylist-mcp). It adds:

- **Cloudflare Workers deployment.** The server runs on Cloudflare, so there's no machine to keep on and no database to manage. You sign in with your AnyList account, and agents connect over OAuth or with an API key.
- **Edits by ID.** You can target recipes and collections by ID. When a name matches more than one recipe or collection, the tools refuse and list the IDs instead of acting on the first match.
- **More collection and meal plan actions.** Add recipes to a collection or remove them, change meal plan entries, and see which recipe each entry links to.

## Tools

The server exposes five tools, each with several actions:

| Tool | What it does |
|---|---|
| `shopping` | List, add (one or many), check off, uncheck and delete items; favorites, recents and stores |
| `recipes` | List, search, view, create, update, rename and delete recipes; import from a URL or parse pasted text |
| `recipe_collections` | List, create and delete collections; add or remove recipes |
| `meal_plan` | List entries by date range, create, update and delete them; list meal labels |
| `health_check` | Check the AnyList connection and the default list |

[docs/tools.md](docs/tools.md) lists every action and parameter.

## Deploy to Cloudflare Workers

You need a Cloudflare account on the Workers Paid plan. Starting the AnyList client takes about 15–20 ms of CPU time, and the free plan stops requests at 10 ms.

```bash
git clone --recurse-submodules https://github.com/djbrinkerhoff/anylist-mcp.git
cd anylist-mcp && npm install
npx wrangler login
npx wrangler secret put ALLOWED_EMAILS     # AnyList emails allowed to sign in, comma-separated
npm run deploy:worker                      # deploys to https://anylist-mcp.<you>.workers.dev
```

To serve it on your own domain, deploy with `npx wrangler deploy --domain anylist.example.com`.

Then add `https://<your-worker>/mcp` as a remote MCP server in your client. For Claude Code:

```bash
claude mcp add --transport http anylist https://<your-worker>/mcp
```

The first connection opens a page where you sign in with your AnyList email and password. [docs/cloudflare-workers.md](docs/cloudflare-workers.md) covers how it works, connecting other clients, API keys for headless agents, local development and troubleshooting.

## Run locally (Claude Desktop or Claude Code)

The quickest option is the desktop extension. Download `anylist-mcp.mcpb` from the [releases page](../../releases). In Claude Desktop, open Settings, then Extensions, and drag the file in. It asks for your AnyList email, password and default list.

To run from source instead, you need Node.js 20 or later:

```bash
git clone --recurse-submodules https://github.com/djbrinkerhoff/anylist-mcp.git
cd anylist-mcp
make install
```

Then add the server to your MCP config:

```json
{
  "mcpServers": {
    "anylist": {
      "command": "node",
      "args": ["/absolute/path/to/anylist-mcp/src/server.js"],
      "env": {
        "ANYLIST_USERNAME": "you@example.com",
        "ANYLIST_PASSWORD": "yourpassword",
        "ANYLIST_LIST_NAME": "Groceries"
      }
    }
  }
}
```

## Self-host with Docker

To run the HTTP server on your own machine, use the Docker setup from upstream, which this repo still includes. It runs behind a Cloudflare Tunnel, keeps its own user accounts in SQLite, and can issue OAuth client credentials for clients like Home Assistant.

```bash
cp .env.http.example .env          # set SERVER_SECRET_KEY and SESSION_SECRET
mkdir -p config
cp allowed-emails.example.txt config/allowed-emails.txt   # add your email
make dev                           # starts the server and a temporary tunnel
```

See [docs/cloudflare-setup.md](docs/cloudflare-setup.md) for tunnel setup and [docs/home-assistant.md](docs/home-assistant.md) for Home Assistant.

## Development

```bash
make test                # unit tests, no credentials needed
make test-integration    # runs against a real AnyList account (needs .env)
make inspect             # opens the MCP inspector
npm run dev:worker       # runs the Worker locally at http://localhost:8787
```

New features and bug fixes need unit tests, plus integration tests for anything that calls the AnyList API. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License and credits

The code is under the ISC license. See [LICENSE](LICENSE).

The original server is [bobby060/anylist-mcp](https://github.com/bobby060/anylist-mcp). AnyList API access comes from a fork of [codetheweb/anylist](https://github.com/codetheweb/anylist). This project isn't affiliated with or endorsed by AnyList.
