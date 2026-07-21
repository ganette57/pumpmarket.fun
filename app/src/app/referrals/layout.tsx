import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Referrals — FunMarket",
  description: "Invite traders and earn rewards from eligible activity.",
};

export default function ReferralsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
