# Tailscale Serving — Multi-Project Path Convention

**Status:** Active  
**Relates to:** [#26](https://github.com/agentic-yankiz/fitness-planner/issues/26)

## Overview

A single Tailscale node (`shakeds-macbook-pro-2.tail0b783.ts.net`) is the shared serving
host for all local projects. Each project owns a **path prefix** under that host.
The root path (`/`) is reserved for a future index page listing all served projects.

This is **tailnet-only** — Funnel is never enabled. The machine is not reachable from
the public internet.

---

## Current serve status

Captured 2026-07-07:

```text
https://shakeds-macbook-pro-2.tail0b783.ts.net (tailnet only)
|-- /fitness proxy http://127.0.0.1:8080/fitness
```

No Funnel entry is present. To verify at any time:

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
# or if tailscale is on PATH:
tailscale serve status
```

The output must say `(tailnet only)` — never `(Funnel)`.

---

## Path convention

| Path prefix | Project | Caddy port |
|-------------|---------|------------|
| `/fitness`  | fitness-planner (this repo) | 8080 |
| `/`         | *reserved — future index* | — |

Rules:
- **Each project owns exactly one path prefix**, lowercase, matching the repo name.
- Prefixes are exclusive — no project nests under another.
- The root `/` must not be claimed by any project; it stays for a shared index.
- **Backends bind loopback only.** Every project's local server (Caddy or otherwise)
  binds `127.0.0.1:<port>`, never `:<port>` (all interfaces). Tailscale serve proxies
  to `http://127.0.0.1:<port>`, so nothing else needs to reach the port. Binding all
  interfaces would expose the backend to the LAN, bypassing Tailscale entirely — and
  with it the identity headers the write-auth design depends on.

---

## How to add a new project

### 1. Register the Tailscale path

```bash
tailscale serve --yes --bg --https=443 --set-path=/<project> http://127.0.0.1:<port>/<project>
```

Replace `<project>` with the new project's path prefix and `<port>` with the local Caddy
port for that project (pick a free port, e.g. 8081, 8082, …).

### 2. Add a `handle_path` block to the project's Caddyfile

The existing fitness Caddyfile demonstrates the pattern:

```caddy
# Loopback-only bind — never `:<port>` (see path-convention rules)
127.0.0.1:<port> {

# Trailing-slash redirect
handle /<project> {
    redir * /<project>/ 301
}

# Serve the static build under the path prefix
handle_path /<project>/* {
    root * {$SITE_DIST}
    encode gzip
    file_server
}

# Catch-all: redirect bare host to the project root
handle {
    redir * /<project>/ 302
}

header {
    -Server
    X-Content-Type-Options nosniff
    Referrer-Policy no-referrer
}

}
```

> The `handle_path` directive strips the prefix before passing the request to
> `file_server`, so the build artefacts in `./dist` don't need to mirror the prefix.
> `BASE_PATH=/<project>` must be passed to the Vite/build step so asset URLs are
> rooted correctly.

### 3. Wire up the launchd service (macOS)

Follow the pattern in `site/bin/install-local-launchd.sh`. Set at minimum:

```xml
<key>FITNESS_SITE_BASE_PATH</key>  <!-- or equivalent env var -->
<string>/<project></string>
<key>FITNESS_SITE_PORT</key>
<string><port></string>
```

### 4. Verify

```bash
tailscale serve status
# confirm the new path appears under (tailnet only)
curl -L https://shakeds-macbook-pro-2.tail0b783.ts.net/<project>/
```

---

## Security posture

### Tailnet-only, never Funnel

`tailscale serve` exposes the site only to devices logged into the same Tailscale
account. `tailscale funnel` is never used — it would make the site reachable from the
public internet, which is explicitly out of scope.

**How to verify:** `tailscale serve status` output must say `(tailnet only)`.
If it ever shows `(Funnel)`, run:

```bash
tailscale funnel off
```

### Threat model

| Threat | Outcome |
|--------|---------|
| Non-tailnet attacker (public internet) | Unreachable. Tailscale does not expose the serve port to the internet without Funnel. |
| Same-LAN attacker (not on the tailnet) | Unreachable. The backend binds `127.0.0.1` only, so `laptop-lan-ip:<port>` refuses the connection — the only non-loopback path is the Tailscale proxy. |
| Tailnet guest (another device on the tailnet) | Read-only access to GET routes. Write routes are protected by identity headers — see the write-auth design below. |
| Local process on the laptop | Trusted. The machine is a single-user device; the loopback bypass for automation is deliberate — see write-auth design. |
| Caddy stripping identity headers | Not a risk: the current Caddyfile `header {}` block only removes `Server` and sets two response headers; it does not touch request headers forwarded from Tailscale. |

### Identity-header topology

Tailscale Serve injects the following headers into every proxied request before
forwarding to the local backend:

- `Tailscale-User-Login` — the Tailscale account email of the originating device
- `Tailscale-User-Name` — display name
- `Tailscale-User-Profile-Pic` — profile image URL

These headers are present on all requests that arrive via the Tailscale serve proxy.
Requests that arrive directly at the Caddy port (`127.0.0.1:8080`) do **not** carry
these headers — unless the local client sets them itself, which is why identity
alone is never sufficient (see the trust-model caveat below).

> **Trust-model caveat.** These identity headers are trustworthy **only** because the
> sole non-loopback path to the backend is the Tailscale serve proxy, which sets (and
> overwrites) them on every request it forwards. That in turn holds only because the
> backend binds `127.0.0.1`. If the bind is ever widened (e.g. back to `:<port>`),
> any LAN client could connect directly and send a forged `Tailscale-User-Login`
> header, and the entire trust model collapses. Do not "fix" the loopback bind.

---

## Write-auth design (implemented in #16 / #26 follow-up)

> **This section describes the intended enforcement. The middleware is not yet
> implemented — it lands with issue #16.**

### Requirement

- **GET** routes: open to all tailnet members (read-only).
- **POST / PATCH / DELETE** routes: restricted to `klein.shaked@gmail.com`.
- **Loopback bypass**: requests whose **`remote_addr` is loopback** (`127.0.0.1` /
  `::1`) **and** that carry **no** `Tailscale-User-Login` header are trusted as local
  automation (e.g., a future Telegram bot). Both conditions are required — an absent
  header alone is *not* proof of a local request. This bypass is acceptable because the
  laptop is a single-user machine; no other processes are expected to POST to the
  fitness server.

### Enforcement logic (pseudocode)

```
if request.method in [POST, PATCH, DELETE, PUT]:
    user_login = request.headers.get("Tailscale-User-Login")
    if user_login == "klein.shaked@gmail.com":
        pass  # authenticated tailnet owner (header set by the Tailscale proxy)
    elif user_login is None and is_loopback(request.remote_addr):
        pass  # local automation bypass: loopback source AND no identity header
    else:
        return 403 Forbidden  # wrong identity, or non-loopback without trusted header
```

Note: a missing header alone never grants access — the bypass requires the loopback
source check as well. (With the loopback-only bind, non-loopback sources other than
the Tailscale proxy cannot connect at all; the check is defence in depth.)

### Why this is safe

- The backend binds `127.0.0.1` only, so the **sole non-loopback path** to it is the
  Tailscale serve proxy. This is the load-bearing assumption (see the trust-model
  caveat above).
- The Tailscale proxy sets `Tailscale-User-Login` server-side on every request it
  forwards; tailnet clients cannot spoof or omit it on the proxied path.
- The loopback bypass requires **both** a loopback `remote_addr` and an absent header —
  a missing header alone never grants access.
- Non-tailnet and LAN requests never reach the server (connection refused).

### Verification (once implemented)

Note: any request Shaked sends through the ts.net URL from his own device gets his
identity header injected by the proxy, so a `403` **cannot** be demonstrated from his
own tailnet identity. The matrix below tests each property from the vantage point that
can actually observe it.

| # | Vantage point | Request | Expected | Property proven |
|---|---------------|---------|----------|-----------------|
| 1 | Shaked's device, via ts.net | `GET /fitness/api/status` | `200` | Tailnet read access works |
| 2 | Shaked's device, via ts.net | `POST /fitness/api/log` | `200` | Owner identity (`klein.shaked@gmail.com`) passes write auth |
| 3 | Laptop itself, loopback | `POST http://127.0.0.1:8080/fitness/api/log` (no header) | `200` | Loopback automation bypass works |
| 4 | Laptop itself, loopback | `POST http://127.0.0.1:8080/fitness/api/log` with `Tailscale-User-Login: other@example.com` | `403` | Wrong identity is rejected even from loopback (spoof attempt) |
| 5 | Any LAN device (not via Tailscale) | `curl http://<laptop-lan-ip>:8080/` | **connection refused** | Loopback-only bind holds — this failure *is* the passing test |
| 6 | Second tailnet identity (guest device), via ts.net | `POST /fitness/api/log` | `403` | Non-owner tailnet member cannot write (run when a guest identity is available) |

```bash
# 1 — tailnet GET
curl -s -o /dev/null -w "%{http_code}" https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/api/status

# 2 — tailnet POST as owner (header injected automatically by the proxy)
curl -s -o /dev/null -w "%{http_code}" -X POST https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/api/log \
  -H "Content-Type: application/json" -d '{}'

# 3 — loopback bypass (run on the laptop)
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8080/fitness/api/log \
  -H "Content-Type: application/json" -d '{}'

# 4 — spoofed identity from loopback → 403
curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8080/fitness/api/log \
  -H "Tailscale-User-Login: other@example.com" -H "Content-Type: application/json" -d '{}'

# 5 — LAN bind check (run from another device on the same LAN, NOT via Tailscale)
curl -s --max-time 5 http://<laptop-lan-ip>:8080/   # expect: connection refused / timeout
```

Test 5 can be run today (it verifies the Caddyfile bind, not the middleware).
Tests 1–4 and 6 apply once the #16 middleware lands.

---

## Future work

- **Root index page** (`/`): a tiny static page listing all served projects with links.
  This requires either a dedicated Caddy instance on a separate port (e.g. 8079) or
  extending one project's Caddyfile to handle both the root and its own prefix.
  Parked until a second project is actually added.
