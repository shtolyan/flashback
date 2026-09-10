# Singapore deployment

Host: `hexlive-server` / `62.146.235.120`. Public URL: https://flashback.62-146-235-120.sslip.io.

Build the web bundle with `npm ci && npm run build:web`, commit the source, then package `git archive HEAD` together with `apps/client/dist`. Do not package `.env`, local data, backups or `node_modules`.

Releases live at `/opt/flashback/releases/<commit>`; `/opt/flashback/current` selects the active release. `/opt/flashback/.env` contains the generated PostgreSQL password and `FLASHBACK_RELEASE` image tag. The database volume is `flashback_pgdata`, outside release directories.

```sh
cd /opt/flashback/current
docker compose --env-file /opt/flashback/.env -p flashback -f deploy/compose.yaml build app
docker compose --env-file /opt/flashback/.env -p flashback -f deploy/compose.yaml up -d --wait
```

Only Caddy is public. The application binds `127.0.0.1:4310`; PostgreSQL has no published port. Merge the site from `deploy/Caddyfile` into `/etc/caddy/Caddyfile`, validate it, then reload Caddy. Existing HexLive game and asset routes must remain intact.

Before a cutover, back up both databases and the original Caddyfile. Temporarily reject writes to the old `/api/bugs/v1/*` and old `/admin/bugs*` UI, capture all reports and patches with `scripts/capture-hexlive.py`, and import into an empty PostgreSQL database. Compare every field before switching the old API route to the new HTTPS upstream. Never replace a nonempty database or restore the old writable tracker after new writes without reconciling the data first.

The legacy API is proxied, not redirected, so methods, request bodies, revisions and old Bearer headers remain compatible. Old admin pages redirect to Flashback; stale form POSTs must return an explicit error instead of writing the retired SQLite database.
