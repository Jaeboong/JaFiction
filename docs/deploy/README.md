# Jasojeon — Hosted Deploy Runbook (Stage B)

Stage A (this repo commit) produced the Docker artefacts. Stage B is the steps
the operator runs on the OCI host once the domain and Google OAuth client are
in hand.

Target: OCI Ubuntu 22.04 ARM64, 17 GB RAM, Docker 28.x + Compose v2, domain
`자소전.com` (punycode `xn--2t1b49b33i.com`).

---

## 0. Stage A → Stage B checklist

- [ ] Domain `자소전.com` purchased
- [ ] DNS `A` record → OCI server public IP (both the Hangul and the punycode form resolve, because DNS stores punycode only)
- [ ] OCI ingress rules allow TCP 80 + 443 from 0.0.0.0/0
- [ ] certbot cert issued for `xn--2t1b49b33i.com`
- [ ] `nginx/conf.d/jasojeon.conf` `:443` block uncommented + HTTP redirect enabled
- [ ] Google OAuth client registered with punycode redirect URI
- [ ] `.env.production` populated with real secrets, `chmod 600`
- [ ] Smoke 1: login flow (`/api/auth/google` → cookie → `/api/me`)
- [ ] Smoke 2: runner pairing + `start_run` + event stream on the web UI
- [ ] Backup cron for `jasojeon_pg_data` volume

---

## 1. Bootstrap the host

```bash
ssh ubuntu@<server-ip>

# Repo layout matches the project root deploy tree.
git clone <repo-url> /home/ubuntu/jasojeon
cd /home/ubuntu/jasojeon
git checkout feat/hosted-migration   # or main after merge
```

## 2. Configure secrets

```bash
cp .env.production.example .env.production
nano .env.production
# fill COOKIE_SECRET (openssl rand -hex 32)
# fill POSTGRES_PASSWORD (openssl rand -hex 24)
# leave GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET blank for now — the OAuth
# routes will 500 until these are set, but /healthz and the static bundle work.

chmod 600 .env.production
```

## 3. First boot (HTTP only, no TLS yet)

Nginx serves plain HTTP in this phase so you can smoke-test before certbot
issues a cert.

```bash
docker compose --env-file .env.production up -d --build
docker compose ps
docker compose logs -f backend  # Ctrl+C to detach
```

Internal smoke:

```bash
curl -s http://localhost/healthz
# -> {"ok":true,...}
```

If `/healthz` is green, postgres and redis are up and the backend successfully
applied drizzle migrations.

## 4. DNS + TLS

Once the `A` record resolves to the server:

```bash
# Make sure the webroot exists on the host — the nginx container bind-mounts it.
sudo mkdir -p /var/www/certbot

# Issue the cert. Use the punycode hostname (certbot does not accept IDN).
sudo certbot certonly --webroot -w /var/www/certbot \
  -d xn--2t1b49b33i.com
```

Then edit `nginx/conf.d/jasojeon.conf`:

1. Uncomment the entire `server { listen 443 ssl; ... }` block at the bottom.
2. Inside the HTTP `server { listen 80; ... }` block, comment out the
   `location /`, `/api/`, `/ws/events`, `/runner/ws`, `/healthz` blocks and add
   a `return 301 https://$host$request_uri;` right after the
   `.well-known/acme-challenge` location.

Reload:

```bash
docker compose exec nginx nginx -t
docker compose exec nginx nginx -s reload
```

Renewal: host certbot runs on a systemd timer by default. Because the nginx
container reads `/etc/letsencrypt` read-only via bind mount, the renewed cert
appears inside the container automatically; trigger a reload with:

```bash
sudo certbot renew --deploy-hook "docker compose -f /home/ubuntu/jasojeon/docker-compose.yml exec nginx nginx -s reload"
```

## 5. Google OAuth

1. Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0 Client ID (Web application).
2. Authorised JavaScript origin: `https://xn--2t1b49b33i.com`.
3. Authorised redirect URI: `https://xn--2t1b49b33i.com/api/auth/google/callback` (**punycode**, not Hangul — Google rejects IDN in this field).
4. Paste the generated ID + secret into `.env.production`.
5. Reload env into running containers:

```bash
docker compose --env-file .env.production up -d
# No rebuild needed — env var changes propagate on container recreate.
```

## 6. Smoke tests

1. Browser: open `https://자소전.com` (the browser converts to punycode before DNS).
2. Click login → Google consent screen → redirected back with `jf_sid` cookie set.
3. `curl -s --cookie "jf_sid=..." https://xn--2t1b49b33i.com/api/me` returns the user.
4. Runner (on a separate local machine): run the pairing flow, get a device token.
5. From the web UI, start a review run and confirm `run_event` messages stream over `/ws/events`.

## 7. Operations

**Logs**

```bash
docker compose logs -f backend
docker compose logs -f nginx
```

**Status**

```bash
docker compose ps
docker compose exec backend node -e "console.log('ok')"
```

**Update**

```bash
cd /home/ubuntu/jasojeon
git pull
docker compose --env-file .env.production up -d --build
```

**Backup (postgres volume)**

```bash
# Snapshot the volume contents to a dated tarball.
docker run --rm \
  -v jasojeon_pg_data:/src:ro \
  -v /home/ubuntu/backups:/dst \
  alpine tar czf /dst/pg-$(date +%F).tar.gz -C /src .
```

Schedule with cron:

```
0 3 * * * docker run --rm -v jasojeon_pg_data:/src:ro -v /home/ubuntu/backups:/dst alpine tar czf /dst/pg-$(date +\%F).tar.gz -C /src .
```

**Restore**

```bash
docker compose stop backend
docker run --rm -v jasojeon_pg_data:/dst -v /home/ubuntu/backups:/src alpine \
  sh -c "rm -rf /dst/* && tar xzf /src/pg-YYYY-MM-DD.tar.gz -C /dst"
docker compose start backend
```

---

## Notes

- The host's existing `nginx` package is untouched. The containerized nginx
  owns ports 80/443 because the host package is not running.
- Only the nginx container publishes ports. Postgres, Redis, and the backend
  are reachable only via the compose default network.
- Migrations run automatically on every backend container start
  (`docker-entrypoint.sh` calls `drizzle-kit migrate`). Zero-downtime migration
  is **not** a goal of this deploy — Compose restarts the backend in-place.
