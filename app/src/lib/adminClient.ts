// app/src/lib/adminClient.ts
export function getAdminWallet(): string {
    return String(process.env.NEXT_PUBLIC_ADMIN_WALLET || "").trim();
  }