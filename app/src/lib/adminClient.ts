// app/src/lib/adminClient.ts
// Client-safe admin helpers. Uses the existing public env var
// NEXT_PUBLIC_ADMIN_WALLET (comma-separated allowlist supported).

export function getAdminWallet(): string {
  return String(process.env.NEXT_PUBLIC_ADMIN_WALLET || "").trim();
}

/** Parsed allowlist of admin wallet base58 addresses. */
export function getAdminWallets(): string[] {
  return String(process.env.NEXT_PUBLIC_ADMIN_WALLET || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * True when the given wallet is allowed to use official fixture picking.
 * Returns false for null/undefined (e.g. wallet still initializing).
 */
export function isOfficialFixtureAdmin(wallet?: string | null): boolean {
  if (!wallet) return false;
  return getAdminWallets().includes(wallet.trim());
}
