import { createHash, randomBytes } from "crypto";
import { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";

const INDIKO_URL = process.env.INDIKO_URL || "https://indiko.dunkirk.sh";
const ORIGIN = process.env.ORIGIN || "http://localhost:3010";
const CLIENT_ID = process.env.CLIENT_ID || `${ORIGIN}/`;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || `${ORIGIN}/auth/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || "development-secret-change-me";
const REQUIRED_ROLE = process.env.REQUIRED_ROLE;
const IS_DEV = process.env.NODE_ENV !== "production";

export interface SessionPayload {
  sub: string;
  name: string;
  role?: string;
  exp: number;
  [key: string]: unknown;
}

export interface PKCEChallenge {
  verifier: string;
  challenge: string;
}

export function generatePKCE(): PKCEChallenge {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function generateState(): string {
  return randomBytes(16).toString("base64url");
}

export function getAuthorizationUrl(pkce: PKCEChallenge, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: "profile email",
    state,
    code_challenge: pkce.challenge,
    code_challenge_method: "S256",
  });
  return `${INDIKO_URL}/auth/authorize?${params.toString()}`;
}



export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  me: string;
  profile: {
    name?: string;
    email?: string;
    photo?: string;
    url?: string;
  };
  scope: string;
  iss: string;
  role?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  verifier: string
): Promise<TokenResponse> {
  const body: Record<string, string> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: CLIENT_ID,
    code_verifier: verifier,
  };

  if (CLIENT_SECRET) {
    body.client_secret = CLIENT_SECRET;
  }

  const response = await fetch(`${INDIKO_URL}/auth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }

  return response.json();
}

export async function createSessionFromToken(
  c: Context,
  tokenResponse: TokenResponse
): Promise<void> {
  const payload: SessionPayload = {
    sub: tokenResponse.me,
    name: tokenResponse.profile.name || tokenResponse.me,
    role: tokenResponse.role,
    exp: Math.floor(Date.now() / 1000) + 86400 * 7,
  };

  const token = await sign(payload, SESSION_SECRET);

  setCookie(c, "session", token, {
    httpOnly: true,
    secure: !IS_DEV,
    sameSite: "Lax",
    path: "/",
    maxAge: 86400 * 7,
  });
}

export async function getSession(c: Context): Promise<SessionPayload | null> {
  const token = getCookie(c, "session");
  if (!token) return null;

  try {
    const payload = await verify(token, SESSION_SECRET);
    if (typeof payload.exp === "number" && payload.exp < Date.now() / 1000) {
      return null;
    }
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

export function clearSession(c: Context): void {
  deleteCookie(c, "session", { path: "/" });
}

export function checkRole(session: SessionPayload): boolean {
  if (!REQUIRED_ROLE) return true;
  return session.role === REQUIRED_ROLE;
}

export function storePKCE(c: Context, pkce: PKCEChallenge, state: string): void {
  setCookie(c, "pkce_verifier", pkce.verifier, {
    httpOnly: true,
    secure: !IS_DEV,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
  setCookie(c, "oauth_state", state, {
    httpOnly: true,
    secure: !IS_DEV,
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
  });
}

export function getPKCE(c: Context): { verifier: string | undefined; state: string | undefined } {
  return {
    verifier: getCookie(c, "pkce_verifier"),
    state: getCookie(c, "oauth_state"),
  };
}

export function clearPKCE(c: Context): void {
  deleteCookie(c, "pkce_verifier", { path: "/" });
  deleteCookie(c, "oauth_state", { path: "/" });
}
