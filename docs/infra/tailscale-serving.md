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
| Tailnet guest (another device on the tailnet) | Read-only access to GET routes. Write routes are protected by identity headers — see the write-auth design below. |
| Local process on the laptop | Trusted. The machine is a single-user device; `localhost` bypass for automation is deliberate — see write-auth design. |
| Caddy stripping identity headers | Not a risk: the current Caddyfile `header {}` block only removes `Server` and sets two response headers; it does not touch request headers forwarded from Tailscale. |

### Identity-header topology

Tailscale Serve injects the following headers into every proxied request before
forwarding to the local backend:

- `Tailscale-User-Login` — the Tailscale account email of the originating device
- `Tailscale-User-Name` — display name
- `Tailscale-User-Profile-Pic` — profile image URL

These headers are present on all requests that arrive via the Tailscale serve proxy.
Requests that arrive directly at the Caddy port (`localhost:8080`) do **not** carry
these headers.

---

## Write-auth design (implemented in #16 / #26 follow-up)

> **This section describes the intended enforcement. The middleware is not yet
> implemented — it lands with issue #16.**

### Requirement

- **GET** routes: open to all tailnet members (read-only).
- **POST / PATCH / DELETE** routes: restricted to `klein.shaked@gmail.com`.
- **Localhost bypass**: requests arriving directly on `127.0.0.1:<port>` (no
  `Tailscale-User-Login` header) are trusted as local automation (e.g., a future
  Telegram bot). This bypass is acceptable because the laptop is a single-user machine;
  no other processes are expected to POST to the fitness server.

### Enforcement logic (pseudocode)

```
if request.method in [POST, PATCH, DELETE, PUT]:
    user_login = request.headers.get("Tailscale-User-Login")
    if user_login is None:
        # No header → request came via localhost; allow (bot bypass)
        pass
    elif user_login != "klein.shaked@gmail.com":
        return 403 Forbidden
```

### Why this is safe

- Tailscale injects `Tailscale-User-Login` server-side; clients cannot spoof it.
- Requests that skip the Tailscale proxy (localhost) carry no header — the bypass is
  explicit, scoped to the local machine, and not reachable from outside.
- Non-tailnet requests never reach the server.

### Verification (once implemented)

```bash
# tailnet GET → 200
curl -s -o /dev/null -w "%{http_code}" https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/api/status

# POST without identity header (simulating tailnet guest who somehow injected no header)
curl -s -o /dev/null -w "%{http_code}" -X POST https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/api/log

# POST as Shaked (from his own device the header is injected automatically)
curl -s -o /dev/null -w "%{http_code}" -X POST https://shakeds-macbook-pro-2.tail0b783.ts.net/fitness/api/log \
  -H "Content-Type: application/json" -d '{}'
```

Expected: `200`, `403`, `200`.

---

## Future work

- **Root index page** (`/`): a tiny static page listing all served projects with links.
  This requires either a dedicated Caddy instance on a separate port (e.g. 8079) or
  extending one project's Caddyfile to handle both the root and its own prefix.
  Parked until a second project is actually added.
