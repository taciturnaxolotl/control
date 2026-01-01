# Control Panel Spec

A simple admin dashboard for managing Caddy toggles, protected by Indiko OAuth.

## Overview

- **Domain**: `control.dunkirk.sh`
- **Auth**: Indiko OAuth 2.0 with PKCE
- **Runtime**: Bun + Hono
- **Purpose**: Toggle feature flags that control Caddy behavior via marker files

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  control.d.sh   │────▶│   Indiko OAuth  │────▶│   Passkey Auth  │
└────────┬────────┘     └─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐     ┌─────────────────┐
│  Toggle API     │────▶│  Marker Files   │
│  POST /flags/*  │     │  /var/lib/...   │
└─────────────────┘     └─────────────────┘
         │
         ▼
┌─────────────────┐
│  Caddy checks   │
│  file existence │
└─────────────────┘
```

## Authentication Flow

1. User visits `control.dunkirk.sh`
2. If no session, redirect to Indiko OAuth authorize endpoint
3. User authenticates with passkey via Indiko
4. Indiko redirects back with auth code
5. Control exchanges code for access token
6. Store session in cookie (signed, httpOnly)
7. Optionally: check user role for admin access

### OAuth Configuration

```
Client ID:        https://control.dunkirk.sh/
Redirect URI:     https://control.dunkirk.sh/auth/callback
Scopes:           profile email
Auth endpoint:    https://indiko.dunkirk.sh/auth/authorize
Token endpoint:   https://indiko.dunkirk.sh/auth/token
```

For role-based access control, pre-register the client with Indiko admin to get a client secret and define allowed roles (e.g., `admin`).

## Environment Variables

```bash
# OAuth
INDIKO_URL=https://indiko.dunkirk.sh
CLIENT_ID=https://control.dunkirk.sh/
CLIENT_SECRET=<from-indiko-admin>  # if pre-registered
REDIRECT_URI=https://control.dunkirk.sh/auth/callback

# Session
SESSION_SECRET=<random-32-bytes>

# Flags directory (where marker files live)
FLAGS_DIR=/var/lib/caddy/flags

# Optional: restrict to specific role
REQUIRED_ROLE=admin
```

## API Endpoints

### Auth

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Dashboard UI (requires auth) |
| `/auth/login` | GET | Redirect to Indiko OAuth |
| `/auth/callback` | GET | OAuth callback, exchange code for token |
| `/auth/logout` | POST | Clear session |

### Flags

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/flags` | GET | List all flags and their status |
| `/api/flags/:name` | GET | Get single flag status |
| `/api/flags/:name` | PUT | Set flag (body: `{ enabled: true/false }`) |
| `/api/flags/:name` | DELETE | Remove flag (same as enabled: false) |

## Flag Definitions

Flags are defined in a config file or hardcoded. Each flag maps to a marker file path.

```typescript
const FLAGS = {
  "block-map-sse": {
    name: "Block Map SSE",
    description: "Disable Server-Sent Events on map.dunkirk.sh",
    file: "block-map-sse",
    service: "map.dunkirk.sh"
  },
  // Add more flags as needed
} as const;
```

When enabled, the app touches the file: `${FLAGS_DIR}/${flag.file}`
When disabled, the app removes the file.

## UI

Simple, minimal dashboard matching your style (Space Grotesk, dark theme).

### Dashboard View

```
┌──────────────────────────────────────────────────────────┐
│  CONTROL PANEL                            [user] logout  │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  map.dunkirk.sh                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Block SSE Endpoint                     [  OFF  ]  │  │
│  │  Disable /sse Server-Sent Events                   │  │
│  └────────────────────────────────────────────────────┘  │
│                                                          │
│  (more services/flags can be added here)                 │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

Toggle switches use a simple on/off design. Changes take effect immediately (Caddy checks file existence on each request).

## File Structure

```
control/
├── src/
│   ├── index.ts          # Hono app entrypoint
│   ├── auth.ts           # OAuth flow + session management
│   ├── flags.ts          # Flag toggle logic
│   ├── middleware.ts     # Auth middleware, role check
│   └── ui.ts             # HTML templates
├── package.json
├── tsconfig.json
└── README.md
```

## Implementation Notes

### PKCE Flow

```typescript
import { createHash, randomBytes } from "crypto";

function generatePKCE() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}
```

### Session Cookie

Use signed cookies with `hono/cookie`:

```typescript
import { setCookie, getCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";

// After successful OAuth:
const session = await sign({ 
  sub: user.me,
  name: user.profile.name,
  role: user.role,
  exp: Math.floor(Date.now() / 1000) + 86400 * 7  // 7 days
}, SESSION_SECRET);

setCookie(c, "session", session, {
  httpOnly: true,
  secure: true,
  sameSite: "Lax",
  path: "/",
  maxAge: 86400 * 7
});
```

### Flag Toggle

```typescript
import { exists, unlink } from "fs/promises";
import { join } from "path";

const FLAGS_DIR = process.env.FLAGS_DIR || "/var/lib/caddy/flags";

async function setFlag(name: string, enabled: boolean) {
  const path = join(FLAGS_DIR, name);
  if (enabled) {
    await Bun.write(path, "");  // touch file
  } else {
    if (await exists(path)) {
      await unlink(path);
    }
  }
}

async function getFlag(name: string): Promise<boolean> {
  return exists(join(FLAGS_DIR, name));
}
```

## Caddy Integration

### map.dunkirk.sh config update

```nix
virtualHosts."map.dunkirk.sh" = {
  extraConfig = ''
    tls {
      dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }
    
    # Check for SSE block flag
    @sse_blocked {
      path /sse
      file /var/lib/caddy/flags/block-map-sse
    }
    respond @sse_blocked "SSE temporarily disabled" 503
    
    header {
      Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
    }
    reverse_proxy localhost:8084 {
      header_up X-Forwarded-Proto {scheme}
      header_up X-Forwarded-For {remote}
    }
  '';
};
```

### Flags directory setup

```nix
systemd.tmpfiles.rules = [
  "d /var/lib/caddy/flags 0755 caddy caddy -"
];
```

### Control service needs write access

The control service user needs to write to the flags directory:

```nix
users.users.control.extraGroups = [ "caddy" ];
# Or use ACLs / tmpfiles with proper permissions
```

## NixOS Service Module

```nix
# modules/nixos/services/control.nix
let
  mkService = import ../../lib/mkService.nix;
in
mkService {
  name = "control";
  description = "Control Panel - Admin dashboard for Caddy toggles";
  defaultPort = 3010;
  runtime = "bun";
  entryPoint = "src/index.ts";

  extraConfig = cfg: {
    atelier.services.control.environment = {
      INDIKO_URL = "https://indiko.dunkirk.sh";
      CLIENT_ID = "https://${cfg.domain}/";
      REDIRECT_URI = "https://${cfg.domain}/auth/callback";
      FLAGS_DIR = "/var/lib/caddy/flags";
    };

    # Ensure flags directory exists with correct permissions
    systemd.tmpfiles.rules = [
      "d /var/lib/caddy/flags 0775 caddy caddy -"
    ];

    # Give control user access to flags directory
    users.users.control.extraGroups = [ "caddy" ];
  };
}
```

## Security Considerations

1. **OAuth PKCE**: Always use PKCE, never store tokens in localStorage
2. **Session cookies**: httpOnly, secure, sameSite=Lax
3. **Role checking**: If `REQUIRED_ROLE` is set, verify user has that role
4. **CSRF**: Use sameSite cookies, optionally add CSRF tokens for mutations
5. **Flag validation**: Only allow toggling pre-defined flags, never arbitrary file paths

## Future Extensions

- Add more flag types (rate limit thresholds, maintenance mode)
- Service status dashboard (systemd status via D-Bus)
- Caddy config viewer (read-only)
- Audit log of flag changes
- Webhook notifications on toggle
