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

## First Signal / voice reports

Before packaging a release, run `python3 scripts/prepare-whisper.py` on a build machine with pip. It downloads Linux amd64 / Python 3.12 wheels using the pinned `apps/whisper/requirements.txt` and writes a SHA-256 manifest. Package the ignored `apps/whisper/wheels/` alongside the ignored web `dist`; neither belongs in Git. The worker image installs from this verified local wheelhouse, so a slow production PyPI mirror does not hold deployment open.

Whisper's model volume is `flashback_whisper_models`. The default model is `medium`; a preloaded CTranslate2 model directory can be selected with `WHISPER_MODEL=/models/medium`. The public app reaches `http://whisper:4320`; the worker publishes **no host port**. After app and worker builds, `docker compose ... up -d --wait` runs additive migrations and resumes interrupted recognition jobs. Take a fresh database backup first. Never replace the active database with a development/test database.

Provision the game capability once, using the operator CLI and a private output file:

```sh
npm run access -- reporter --project first-signal --name 'First Signal game reporter' --output /keys/first-signal-reporter
```

On each First Signal build machine store only that write-only game capability in `~/.config/first-signal/reporting.json` (mode 0600): `{"api":"https://flashback.62-146-235-120.sslip.io/api/bugs/v1","project":"first-signal","token":"<game-reporter-capability>"}`. Never copy agent/device or administrator tokens into a player build. The Unity build hook imports this local configuration into an ignored resource and adds the microphone permission description.

Rollback must retain the reporter restrictions: do not run an older pre-reporter access implementation while a game capability is active. Fix forward or revoke the game key first. Preserve the PostgreSQL/model volumes. Deployment checks may create and delete only their own explicitly named temporary fixture reports; they must not transition or delete player bugs.

### Dedicated New York worker

Production voice processing uses the New York VPS (`hexlive-nyc`), independently of the Singapore tracker/database. `deploy/first-signal-whisper.service` runs Python 3.12 in `/opt/first-signal-whisper/venv`, under the dedicated `firstsignal-voice` system user, bound to 127.0.0.1:4320. It has a 3 GiB memory limit, two CPU cores, a read-only system filesystem and write access only to its model cache. Install `apps/whisper/requirements.txt` into that venv; `/opt/first-signal-whisper/.env` holds `WHISPER_MODEL=medium`, `WHISPER_CACHE=/opt/first-signal-whisper/models`, `WHISPER_THREADS=2`, `WHISPER_HOST=127.0.0.1` and a generated `VOICE_SERVICE_TOKEN` (root-owned mode 0600).

Caddy terminates HTTPS at `https://firstsignal-voice.163-245-204-96.sslip.io` and proxies to 127.0.0.1:4320. Anonymous transcription is rejected; health reveals only readiness. Singapore's private `.env` sets this address as `WHISPER_URL` and holds the matching `WHISPER_TOKEN`. These are service credentials, distinct from game and device/agent keys, and must never be printed or committed. The `local-whisper` Compose profile remains available for an operator choosing a colocated worker; it is not started on the current Singapore deployment.
