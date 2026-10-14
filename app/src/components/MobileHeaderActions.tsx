"use client";

import Link from "next/link";
import { Gift, Trophy } from "lucide-react";
import { usePathname } from "next/navigation";

function isRouteActive(pathname: string | null, route: string) {
  return pathname === route || pathname?.startsWith(`${route}/`);
}

export default function MobileHeaderActions({
  className = "",
}: {
  className?: string;
}) {
  const pathname = usePathname();
  const leaderboardActive = isRouteActive(pathname, "/leaderboard");
  const referralsActive = isRouteActive(pathname, "/referrals");

  return (
    <nav
      aria-label="Quick links"
      className={`pointer-events-auto flex shrink-0 justify-self-end items-center gap-1 ${className}`}
    >
      <Link
        href="/leaderboard"
        aria-label="Leaderboard"
        aria-current={leaderboardActive ? "page" : undefined}
        className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green ${
          leaderboardActive
            ? "border-pump-green/45 bg-pump-green/10 text-pump-green"
            : "border-white/10 bg-black/45 text-gray-300 hover:border-white/20 hover:text-white"
        }`}
      >
        <Trophy className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
      </Link>

      <Link
        href="/referrals"
        aria-label="Referrals"
        aria-current={referralsActive ? "page" : undefined}
        className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green ${
          referralsActive
            ? "border-pump-green/55 bg-pump-green/15 text-pump-green"
            : "border-pump-green/20 bg-pump-green/[0.07] text-pump-green/80 hover:border-pump-green/35 hover:text-pump-green"
        }`}
      >
        <Gift className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
      </Link>
    </nav>
  );
}
