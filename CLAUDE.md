# CLAUDE.md

## Build & Test

```bash
npm run build    # bundles src/ into dist/server.js
npm test         # runs vitest
```

## Deploy to Pi

After committing and pushing:

```bash
ssh pi "cd /home/kgraehl/code/simple-app-update-server && git pull && npm run build && systemctl --user restart simple-app-update-server"
```

The service runs as a systemd user unit (`simple-app-update-server.service`). Caddy reverse-proxies to `127.0.0.1:3101`.

**Important:** `git pull` alone is not enough — you must run `npm run build` before restarting, since the service runs from `dist/server.js`.
