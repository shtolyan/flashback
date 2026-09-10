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

## Enabling token access on the migrated instance

Before switching the application, take a fresh PostgreSQL dump; do not re-import the retired SQLite snapshot. Build the new image, then run its operator CLI against the existing database with a private mounted `/keys` directory:

```sh
docker compose --env-file /opt/flashback/.env -p flashback -f deploy/compose.yaml run --rm --no-deps -v /opt/flashback/keys:/keys app npm run access -- import --file /keys/agent-token --name 'HexLive agents'
docker compose --env-file /opt/flashback/.env -p flashback -f deploy/compose.yaml run --rm --no-deps -v /opt/flashback/keys:/keys app npm run access -- import --file /keys/player-token --name 'HexLive player' --statuses created,in_progress,ready_for_test,fixed,rework
docker compose --env-file /opt/flashback/.env -p flashback -f deploy/compose.yaml run --rm --no-deps -v /opt/flashback/keys:/keys app npm run access -- bootstrap --output /keys/admin-token
```

Keep secret files mode 0600 and their directory 0700; never commit or print them. The first two commands retain existing imported keys on retry. Bootstrap refuses when an active administrator already exists. The production compose enables secure cookies and restricts browser Origin to the public HTTPS origin. New installations also require bootstrap; no anonymous fallback exists.

After `up -d --wait`, check public and legacy reads return 401 anonymously, agent reads/writes succeed with its key, forbidden `fixed` returns 403, and the browser retains an admin session. Use only disposable deployment fixtures. Existing game releases need the updated authenticated creation call; without it their new-report submission receives 401, although authenticated reads and updates continue working. Never reopen anonymous creation as a compatibility workaround.

Rollbacks must retain authentication. Do not roll back to a pre-auth image on a public route; retain maintenance mode while fixing forward. Database migrations are additive and preserve report IDs/revisions and all live data.
