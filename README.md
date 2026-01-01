# Control

![screenshot](https://hc-cdn.hel1.your-objectstorage.com/s/v3/f566255f04dab183_image.png)

This servers as the source of truth for whether stuff is enabled or not.

The canonical repo for this is hosted on tangled over at [`dunkirk.sh/con trol`](https://tangled.org/@dunkirk.sh/control)

## Quick Start

```bash
bun install
bun run dev
```

## Configuration

### Environment Variables

```bash
# Server
PORT=3010
ORIGIN=http://localhost:3010  # or https://control.dunkirk.sh in production
NODE_ENV=development          # set to "production" for prod

# OAuth (Indiko)
INDIKO_URL=https://indiko.dunkirk.sh
CLIENT_ID=https://control.dunkirk.sh/  # Must match Indiko client registration
CLIENT_SECRET=<from-indiko-admin>      # Required for role-based access

# Session
SESSION_SECRET=<random-32-bytes>

# Flags directory
FLAGS_DIR=/var/lib/caddy/flags

# Optional: restrict to specific role
REQUIRED_ROLE=admin
```

The `ORIGIN` is used to derive:

- `CLIENT_ID`: `${ORIGIN}/` (if not set explicitly)
- `REDIRECT_URI`: `${ORIGIN}/auth/callback`

### Indiko Client Setup

To use role-based access control, pre-register Control Panel as a client in Indiko:

1. Create a new client in Indiko admin
2. Set client ID to `https://control.dunkirk.sh/` (must match `CLIENT_ID` env)
3. Add `admin` to available roles
4. Copy the client secret to `CLIENT_SECRET`
5. Assign `admin` role to users who should access the control panel

Control Panel publishes OAuth client metadata at `/client-metadata.json` for Indiko auto-discovery.

### Flags Configuration

Edit `flags.json` to define services and their flags:

```json
{
  "services": {
    "map.dunkirk.sh": {
      "name": "Map",
      "flags": {
        "block-map-sse": {
          "name": "Block SSE Endpoint",
          "description": "Disable /sse Server-Sent Events"
        }
      }
    }
  }
}
```

Each flag creates a marker file at `${FLAGS_DIR}/${flag-id}` when enabled.

### Caddy Integration

Configure Caddy to check for marker files:

```
@sse_blocked {
  path /sse
  file /var/lib/caddy/flags/block-map-sse
}
respond @sse_blocked "SSE temporarily disabled" 503
```

## API

| Endpoint                | Method | Description                          |
| ----------------------- | ------ | ------------------------------------ |
| `/`                     | GET    | Dashboard UI                         |
| `/auth/login`           | GET    | Start OAuth flow                     |
| `/auth/callback`        | GET    | OAuth callback                       |
| `/auth/logout`          | POST   | Clear session                        |
| `/client-metadata.json` | GET    | OAuth client metadata for Indiko     |
| `/api/session`          | GET    | Get current user info                |
| `/api/flags`            | GET    | List all flags                       |
| `/api/flags/:name`      | GET    | Get flag status                      |
| `/api/flags/:name`      | PUT    | Set flag (`{ enabled: true/false }`) |
| `/api/flags/:name`      | DELETE | Disable flag                         |

<p align="center">
    <img src="https://raw.githubusercontent.com/taciturnaxolotl/carriage/main/.github/images/line-break.svg" />
</p>

<p align="center">
    <i><code>&copy 2025-present <a href="https://dunkirk.sh">Kieran Klukas</a></code></i>
</p>

<p align="center">
    <a href="https://tangled.org/dunkirk.sh/control/blob/main/LICENSE.md"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=License&message=O'Saasy&logoColor=d9e0ee&colorA=363a4f&colorB=b7bdf8"/></a>
</p>
