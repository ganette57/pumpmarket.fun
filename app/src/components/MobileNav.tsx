"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Search } from "lucide-react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { usePrivyIdentity } from "@/components/privy/PrivyIdentityProvider";

const MOBILE_HOME_RETAP_EVENT = "home-feed:retap";

function Icon({
  children,
  active,
}: {
  children: React.ReactNode;
  active: boolean;
}) {
  return <div className={`h-6 w-6 ${active ? "text-[#61ff9a]" : "text-gray-400"}`}>{children}</div>;
}

function Item({
  href,
  active,
  icon,
  label,
  onClick,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green"
    >
      <Icon active={active}>{icon}</Icon>
    </Link>
  );
}

export default function MobileNav() {
  const pathname = usePathname();
  const { connected, publicKey } = useFunMarketWallet();
  const privy = usePrivyIdentity();

  const isActive = (p: string) => pathname === p || pathname?.startsWith(p + "/");

  // Logged out this used to point at /dashboard, which renders nothing but
  // "Connect wallet to view your dashboard." — a tab that looks like it
  // failed. Keep the href for middle-click/SEO, but intercept the tap and
  // send the user into the same Privy login the rest of the app uses.
  const profileHref =
    connected && publicKey ? `/profile/${publicKey.toBase58()}` : "/dashboard";
  const needsSignIn = !(connected && publicKey) && privy.configured;
  const profileActive =
    connected && publicKey
      ? isActive(`/profile/${publicKey.toBase58()}`)
      : isActive("/dashboard");

  const handleHomeTap = (e: React.MouseEvent) => {
    // Retap on home tab: notify home feed to scroll-to-top + refresh.
    if (isActive("/")) {
      e.preventDefault();
      window.dispatchEvent(new Event(MOBILE_HOME_RETAP_EVENT));
    }
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 box-content h-14 border-t border-gray-800 bg-black/90 pb-[env(safe-area-inset-bottom,0px)] backdrop-blur md:hidden">
      <nav aria-label="Primary" className="mx-auto grid h-14 max-w-md grid-cols-5 items-center px-4">
        {/* Home */}
        <Item
          href="/"
          label="Home"
          active={isActive("/")}
          onClick={handleHomeTap}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10.5L12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
            </svg>
          }
        />

        {/* Search — opens the existing full mobile search experience. */}
        <Item
          href="/search"
          label="Search"
          active={isActive("/search")}
          icon={
            <Search className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
          }
        />

        {/* Create (center action) */}
        <Link
          href="/create"
          aria-label="Create"
          className="mx-auto -mt-1 flex h-11 w-11 items-center justify-center rounded-2xl bg-[#61ff9a] text-black shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            className="h-7 w-7"
          >
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </Link>

        {/* Live / streaming */}
        <Item
          href="/live"
          label="Live"
          active={isActive("/live")}
          icon={
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="2" />
              <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
              <path d="M7.76 7.76a6 6 0 0 0 0 8.48" />
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
              <path d="M4.93 4.93a10 10 0 0 0 0 14.14" />
            </svg>
          }
        />

        {/* Public profile (falls back to /dashboard when not connected) */}
        <Item
          href={profileHref}
          label="Profile"
          active={profileActive}
          onClick={
            needsSignIn
              ? (e: React.MouseEvent) => {
                  e.preventDefault();
                  privy.loginWithGoogle();
                }
              : undefined
          }
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          }
        />
      </nav>
    </div>
  );
}
