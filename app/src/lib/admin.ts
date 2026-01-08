// app/src/lib/admin.ts
import crypto from "crypto";

const COOKIE_NAME = "admin_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

export function getAdminWallet(): string {
  // Public env (OK to compare on server too)
  return String(process.env.NEXT_PUBLIC_ADMIN_WALLET || "").trim();
}

export function getAdminPassword(): string {
  // Server-only
  return String(process.env.ADMIN_PASSWORD || "").trim();
}

function getSessionSecret(): string {
  const s = String(process.env.ADMIN_SESSION_SECRET || "").trim();
  if (!s) throw new Error("Missing env: ADMIN_SESSION_SECRET");
  return s;
}

function hmac(input: string) {
  return crypto.createHmac("sha256", getSessionSecret()).update(input).digest("hex");
}

export function makeSessionToken(wallet: string): string {
  const w = String(wallet || "").trim();
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${w}.${ts}`;
  const sig = hmac(payload);
  return `${payload}.${sig}`;
}

function parseCookie(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join("=") || "");
  }
  return out;
}

function verifySessionToken(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [wallet, tsStr, sig] = parts;
  const ts = Number(tsStr);
  if (!wallet || !Number.isFinite(ts) || !sig) return null;

  // Expiration
  const now = Math.floor(Date.now() / 1000);
  if (now - ts > SESSION_MAX_AGE_SEC) return null;

  const payload = `${wallet}.${ts}`;
  const expected = hmac(payload);

  // timing-safe compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;

  return wallet;
}

export async function isAdminRequest(req: Request): Promise<boolean> {
  const cookies = parseCookie(req.headers.get("cookie"));
  const token = cookies[COOKIE_NAME] || null;

  const walletFromToken = verifySessionToken(token);
  if (!walletFromToken) return false;

  const adminWallet = getAdminWallet();
  if (!adminWallet) throw new Error("Missing env: NEXT_PUBLIC_ADMIN_WALLET");

  return walletFromToken === adminWallet;
}