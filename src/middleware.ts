import { Context, Next } from "hono";
import { getSession, checkRole, SessionPayload } from "./auth";

declare module "hono" {
  interface ContextVariableMap {
    session: SessionPayload;
  }
}

export async function authMiddleware(c: Context, next: Next) {
  const session = await getSession(c);

  if (!session) {
    return c.redirect("/auth/login");
  }

  if (!checkRole(session)) {
    return c.text("Forbidden: insufficient permissions", 403);
  }

  c.set("session", session);
  await next();
}

export async function apiAuthMiddleware(c: Context, next: Next) {
  const session = await getSession(c);

  if (!session) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (!checkRole(session)) {
    return c.json({ error: "Forbidden" }, 403);
  }

  c.set("session", session);
  await next();
}
