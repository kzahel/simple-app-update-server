# simple-app-update-server

A lightweight update server that serves version checks and auto-update responses for [JSTorrent](https://jstorrent.com) and [200 OK](https://ok200.app) (Tauri desktop apps), as well as other products with simple version-check needs.

## How it works

The server polls GitHub Releases for configured products and caches the results. Clients check for updates via HTTP and receive either a `204 No Content` (up to date) or a JSON payload with the new version, release notes, and download URLs.

Two update protocols are supported:

- **Tauri updater** (`/tauri/:target/:arch/:currentVersion`) — returns the platform-specific binary URL and signature expected by Tauri's built-in updater.
- **Simple version check** (`/version` or `/version/:currentVersion`) — returns version + release notes JSON, suitable for any app.

Products are routed by hostname (e.g. `updates.jstorrent.com`, `updates.ok200.app`), so a single instance serves multiple apps.

## Endpoints

| Route | Description |
|---|---|
| `GET /health` | Health check (`{ "ok": true }`) |
| `GET /tauri/:target/:arch/:version` | Tauri update check (204 or update JSON) |
| `GET /version` | Latest version info |
| `GET /version/:currentVersion` | Version check with analytics (204 or update JSON) |
| `GET /stats` | Per-product analytics dashboard |

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3100` | Server listen port |
| `GITHUB_TOKEN` | _(none)_ | GitHub token for API requests (recommended to avoid rate limits) |
| `LOG_DIR` | `./logs` | Directory for analytics logs and caches |
| `DEFAULT_PRODUCT` | _(none)_ | Fallback product ID when hostname doesn't match |

## Development

```bash
npm install
npm run dev       # start with tsx (auto-reloads)
npm test          # run tests
npm run check     # lint + typecheck + test
```

## Production

```bash
npm run build     # bundle with esbuild
npm start         # run bundled server
```

## Deployment with Caddy

Caddy is recommended as a reverse proxy — it handles TLS automatically and can protect the `/stats` endpoint with basic auth.

Generate a password hash:

```bash
caddy hash-password --plaintext 'your-password'
```

Example Caddyfile serving both products with `/stats` behind basic auth:

```caddyfile
(update-server) {
	reverse_proxy localhost:3100

	handle /stats {
		basicauth {
			admin $2a$14$... # output from caddy hash-password
		}
		reverse_proxy localhost:3100
	}
}

updates.jstorrent.com {
	import update-server
}

updates.ok200.app {
	import update-server
}
```

Caddy will automatically provision TLS certificates for both hostnames via Let's Encrypt. The update check endpoints (`/tauri/*`, `/version/*`) remain unauthenticated so apps can check freely, while `/stats` requires a login.
