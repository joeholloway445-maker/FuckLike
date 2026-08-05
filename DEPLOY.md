# FuckLike — Go Live (Hostinger KVM4)

You already pay for the server. This gets the real system running on it.

## What this gives you

- HDV backend (HOPE / APEX / KNOLL gateway) running on your KVM4
- FuckLike web app (create companions, chat, gallery, settings)
- Everything under your control
- Haptics stay opt-in / off by default

---

## 1. SSH into your KVM4

```bash
ssh root@YOUR_VPS_IP
```

(Use the IP from Hostinger hPanel)

---

## 2. One-time server setup

```bash
apt-get update && apt-get -y upgrade
apt-get install -y git curl ca-certificates

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# Optional but recommended: Caddy for HTTPS
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update && apt-get install -y caddy
```

---

## 3. Get the HDV backend running

```bash
cd /opt
git clone https://github.com/joeholloway445-maker/HDV_Foundation.git
cd HDV_Foundation

cp .env.example .env
# Edit .env and set at least:
#   PORT=8787
#   HDV_API_KEY=some-long-random-string
#   HDV_CORS_ORIGIN=https://fucklike.ai,https://www.fucklike.ai,https://app.fucklike.ai

npm ci
npm run gateway
```

Leave this running (or install the systemd service from `deploy/hdv-gateway.service`).

Test:

```bash
curl http://127.0.0.1:8787/v1/health
```

---

## 4. Put the FuckLike website on the server

```bash
mkdir -p /var/www/fucklike
# From this repo:
#   git clone https://github.com/joeholloway445-maker/FuckLike.git
#   cp -r FuckLike/web/* /var/www/fucklike/
```

---

## 5. Point the domain + HTTPS (Caddy)

Edit `/etc/caddy/Caddyfile`:

```
api.fucklike.ai {
    reverse_proxy 127.0.0.1:8787
}

fucklike.ai, www.fucklike.ai {
    root * /var/www/fucklike
    file_server
    try_files {path} /index.html
}
```

Then:

```bash
systemctl reload caddy
```

Make sure DNS A records for `fucklike.ai` and `api.fucklike.ai` point at your VPS IP first.

---

## 6. Result

- https://fucklike.ai → FuckLike companion app (create, chat, gallery, settings)
- https://api.fucklike.ai → your HDV backend

Chat will still use local replies until `API_BASE` is set in `web/app.js` to `https://api.fucklike.ai`.

---

## Ownership

- Server: yours
- Backend code: yours
- Frontend: yours
- Models: start with local/free (Ollama) or Colab when you need GPU
- Hardware features: opt-in only
