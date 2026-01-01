import { Hono } from "hono";
import { apiAuthMiddleware } from "./middleware";
import {
  generatePKCE,
  generateState,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  createSessionFromToken,
  clearSession,
  getSession,
  checkRole,
  storePKCE,
  getPKCE,
  clearPKCE,
} from "./auth";
import {
  getAllFlagsStatus,
  getFlagStatus,
  setFlag,
  getFlagDefinition,
  shouldBlock,
  getRedactions,
} from "./flags";

import homepage from "../public/index.html";

const ORIGIN = process.env.ORIGIN || "http://localhost:3010";
const CLIENT_ID = process.env.CLIENT_ID || `${ORIGIN}/`;
const REDIRECT_URI = process.env.REDIRECT_URI || `${ORIGIN}/auth/callback`;

const app = new Hono();

app.get("/client-metadata.json", (c) => {
  return c.json({
    client_id: CLIENT_ID,
    client_name: "Control Panel",
    logo_uri:
      "https://hc-cdn.hel1.your-objectstorage.com/s/v3/d19f900e04238dcd_control.png",
    redirect_uris: [REDIRECT_URI],
  });
});

app.get("/health", (c) => {
  return c.json({ status: "ok" });
});

// Kill-check endpoint for Caddy to call before proxying protected routes
// Returns 200 to allow, 503 to block
// No auth required - this is called by Caddy internally
app.get("/kill-check", (c) => {
  const host = c.req.header("X-Orig-Host") || c.req.header("Host") || "";
  const path = c.req.header("X-Orig-Path") || "/";

  if (shouldBlock(host, path)) {
    return c.text("Temporarily disabled", 503);
  }

  return c.text("OK", 200);
});

// Proxy JSON endpoint and redact configured fields
app.get("/proxy/*", async (c) => {
  const host = c.req.header("X-Orig-Host") || c.req.header("Host") || "";
  const origPath = c.req.header("X-Orig-Path") || "";
  const backendUrl = c.req.header("X-Backend-Url");
  
  if (!backendUrl) {
    return c.text("Missing X-Backend-Url header", 400);
  }

  const res = await fetch(backendUrl);
  if (!res.ok) {
    return c.text("Backend error", res.status);
  }

  const data = await res.json();

  // Redact fields based on config
  const fieldsToRedact = getRedactions(host, origPath);
  for (const field of fieldsToRedact) {
    if (field in data) {
      if (Array.isArray(data[field])) {
        data[field] = [];
      } else if (typeof data[field] === "object" && data[field] !== null) {
        data[field] = {};
      } else {
        delete data[field];
      }
    }
  }

  return c.json(data);
});

app.get("/auth/login", (c) => {
  const pkce = generatePKCE();
  const state = generateState();
  storePKCE(c, pkce, state);
  return c.redirect(getAuthorizationUrl(pkce, state));
});

app.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const returnedState = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.text(`OAuth error: ${error}`, 400);
  }

  if (!code) {
    return c.text("Missing authorization code", 400);
  }

  const { verifier, state } = getPKCE(c);
  clearPKCE(c);

  if (!verifier || !state) {
    return c.text("Missing PKCE verifier or state", 400);
  }

  if (state !== returnedState) {
    return c.text("State mismatch", 400);
  }

  try {
    const tokenResponse = await exchangeCodeForTokens(code, verifier);
    await createSessionFromToken(c, tokenResponse);
    return c.redirect("/");
  } catch (err) {
    console.error("OAuth callback error:", err);
    return c.text("Authentication failed", 500);
  }
});

app.post("/auth/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});

const api = new Hono();

api.get("/session", async (c) => {
  const session = await getSession(c);
  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  if (!checkRole(session)) {
    return c.json({ error: "Forbidden: insufficient permissions" }, 403);
  }
  return c.json({ name: session.name, sub: session.sub });
});

api.use("/flags/*", apiAuthMiddleware);
api.use("/flags", apiAuthMiddleware);

api.get("/flags", (c) => {
  const flags = getAllFlagsStatus();
  return c.json(flags);
});

api.get("/flags/:name", (c) => {
  const name = c.req.param("name");
  const definition = getFlagDefinition(name);

  if (!definition) {
    return c.json({ error: "Unknown flag" }, 404);
  }

  const enabled = getFlagStatus(name);
  return c.json({
    id: name,
    name: definition.flag.name,
    description: definition.flag.description,
    service: definition.serviceId,
    enabled,
  });
});

api.put("/flags/:name", async (c) => {
  const name = c.req.param("name");
  const definition = getFlagDefinition(name);

  if (!definition) {
    return c.json({ error: "Unknown flag" }, 404);
  }

  const body = await c.req.json<{ enabled: boolean }>();
  if (typeof body.enabled !== "boolean") {
    return c.json({ error: "Invalid body: enabled must be boolean" }, 400);
  }

  setFlag(name, body.enabled);
  return c.json({ id: name, enabled: body.enabled });
});

api.delete("/flags/:name", (c) => {
  const name = c.req.param("name");
  const definition = getFlagDefinition(name);

  if (!definition) {
    return c.json({ error: "Unknown flag" }, 404);
  }

  setFlag(name, false);
  return c.json({ id: name, enabled: false });
});

app.route("/api", api);

const port = parseInt(process.env.PORT || "3010", 10);
const isDev = process.env.NODE_ENV !== "production";

Bun.serve({
  port,
  development: isDev,
  routes: {
    "/": homepage,
  },
  fetch: app.fetch,
});

console.log(`Control panel running on http://localhost:${port}`);
