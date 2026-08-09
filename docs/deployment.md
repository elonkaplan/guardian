# Deploying Guardian

Ubuntu host, Docker, host nginx terminating TLS via certbot.

**Ports on this deployment** — 3000 is taken by something else on the box:

| | Host port | Container |
| --- | --- | --- |
| Frontend | `127.0.0.1:3001` | nginx :80 |
| Backend | `127.0.0.1:3030` | Nest :3000 |
| Postgres | not published | :5432 |

Both bind to **loopback only**. Docker writes its own iptables rules and bypasses
ufw entirely, so a bare `3030:3000` would be reachable from the internet with the
firewall shut. Host nginx reaches them over loopback; nothing else can.

---

## ⚠️ Before you start: CORS is hardcoded

`api/src/main.ts` allows exactly these origins:

```ts
origin: ['https://guardian.clone.solutions', 'http://localhost:5173']
```

**If this deployment uses a different domain, that is a code change**, not config.
Without it every browser request fails while `curl` works perfectly — a genuinely
confusing hour. Edit it before you build.

---

## 1. Host setup

```bash
apt update && apt upgrade -y
apt install -y git curl ca-certificates ufw nginx certbot python3-certbot-nginx
curl -fsSL https://get.docker.com | sh
systemctl enable --now nginx

# Swap first if this box has 4 GB or less — the frontend build can OOM, and it
# presents as a corrupted npm install rather than a memory problem.
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# ⚠️ Allow 22 BEFORE enabling, or you lock yourself out permanently.
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```

**DNS**: A records for both names → this server's IPv4, before certbot runs. It
validates over HTTP and fails if the names don't resolve.

## 2. Code and secrets

```bash
mkdir -p /opt && cd /opt
git clone <repo-url> guardian
```

From your laptop — never through the repo:

```bash
scp .env root@<server-ip>:/opt/guardian/.env
ssh root@<server-ip> 'chmod 600 /opt/guardian/.env'
```

`.env` needs all 23 keys. `DEPLOYER_PRIVATE_KEY` should be **left out** — the API
never reads it, and it is the key that can grant and revoke roles on the escrow.
Verify what the schema demands:

```bash
diff <(grep -oE '^  [A-Z_]+:' /opt/guardian/api/src/config/env.schema.ts | tr -d ' :' | sort) \
     <(grep -oE '^[A-Z_]+=' /opt/guardian/.env | tr -d '=' | sort)
```

`PORT` and `NODE_ENV` showing as missing is fine — both have defaults. Anything else
fails startup with the variable named.

## 3. Backend → 3030

```bash
cd /opt/guardian/api
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

The api row must read **`127.0.0.1:3030->3000/tcp`**. If it shows a bare `3000/tcp`
with no mapping, your Compose predates 2.24 and ignored the `!override` tag — edit
`ports` in `docker-compose.yml` directly instead.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f api
# wait for: Guardian API listening on port 3000
curl -s localhost:3030/health
```

Migrations run before the API starts and block it if they fail, by design.

## 4. Frontend → 3001

```bash
cd /opt/guardian/ui
VITE_API_URL=https://api.guardian.clone.solutions \
  docker compose -f docker-compose.prod.yml up -d --build

curl -sI localhost:3001 | head -1                       # 200
curl -sI localhost:3001/orders/abc | head -1            # 200 → SPA fallback
docker exec guardian-ui sh -c 'grep -ro "https://api\.guardian[^\"]*" /usr/share/nginx/html/assets/*.js | head -1'
```

**If that last command prints nothing, stop.** `VITE_API_URL` is compiled into the
bundle at build time — an empty value produces a frontend that calls the wrong host,
and nothing at build or runtime says so.

Use `docker-compose.prod.yml` only. The plain `docker-compose.yml` runs the Vite dev
server with `./src` mounted.

## 5. Host nginx

```bash
cat > /etc/nginx/sites-available/guardian <<'EOF'
server {
    listen 80;
    server_name guardian.clone.solutions;

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name api.guardian.clone.solutions;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Guardian's audit is asynchronous, so nothing should approach the 60s
        # default — this is insurance, not a requirement.
        proxy_read_timeout 120s;
    }
}
EOF

ln -sf /etc/nginx/sites-available/guardian /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

nginx -t && systemctl reload nginx
```

Write it as **plain HTTP first** — certbot rewrites these blocks to add TLS. Giving
it `listen 443` up front leaves it nothing to edit.

`nginx -t` before every reload: a bad config fails the test and the reload never
runs, so the current config keeps serving.

## 6. Certificates

```bash
dig +short guardian.clone.solutions
dig +short api.guardian.clone.solutions

certbot --nginx -d guardian.clone.solutions -d api.guardian.clone.solutions \
        --agree-tos -m you@example.com --redirect --non-interactive
```

`--redirect` adds the HTTP→HTTPS rewrite. Renewal is scheduled automatically.

**If it says "could not find a matching server block"**, a `server_name` doesn't match
the `-d` argument exactly. Fix the name, reload, then:

```bash
certbot install --cert-name guardian.clone.solutions
```

Use `install`, not a second `certbot --nginx` — the certificate is already issued, and
re-running burns one of Let's Encrypt's five duplicate certificates per week.

## 7. Seed and verify

```bash
curl -s  https://api.guardian.clone.solutions/health
curl -sI https://api.guardian.clone.solutions/docs | head -1     # 200, not 401
curl -X POST https://api.guardian.clone.solutions/demo/seed
curl -s  https://api.guardian.clone.solutions/agents | head -c 300   # three listings
```

The seed **mints three agents on-chain** from the operator key. Idempotent when the
definitions match; on a mismatch it publishes new versions rather than duplicating.

Then in a browser: connect a wallet, add funds, buy once. Watch the network tab on the
first authenticated call — a CORS error means the origin list in `main.ts` doesn't
include this deployment's domain.

## Redeploying

```bash
cd /opt/guardian && git pull

cd api && docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build

cd ../ui && VITE_API_URL=https://api.guardian.clone.solutions \
  docker compose -f docker-compose.prod.yml up -d --build
```

**API first, UI second** when a change spans both: an old UI against a new API
degrades gracefully; a new UI against an old API renders fields that aren't there yet.

Hard-refresh the browser afterwards — `index.html` is served `no-cache` so the entry
point updates, but an already-open tab holds the old bundle.

## Before you share the link

Three wallets need funding, and the third is the one everyone forgets:

| Wallet | Needs | Why |
| --- | --- | --- |
| Funder | test USDC | the only source of money in the system; every top-up draws on it |
| Operator | MON | signs every deal, delivery and release |
| **Guardian** | **MON** | signs `resolve` — without it, verdicts never settle, and everything looks fine until the first dispute |

```bash
export ETH_RPC_URL=https://testnet-rpc.monad.xyz
cast balance $OPERATOR_ADDRESS
cast call $USDC_ADDRESS "balanceOf(address)(uint256)" $FUNDER_ADDRESS
```

`REVIEW_WINDOW_SECONDS=30` and `SWEEPER_INTERVAL_MS=3000` are demo tuning. If they
revert to production defaults the countdown becomes unwatchable — check they survived
the `.env` copy.
