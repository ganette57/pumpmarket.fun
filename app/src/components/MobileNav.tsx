"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function Icon({
  children,
  active,
}: {
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <div
      className={`h-6 w-6 ${
        active ? "text-[#61ff9a]" : "text-gray-400"
      }`}
    >
      {children}
    </div>
  );
}

function Item({
  href,
  active,
  icon,
}: {
  href: string;
  active: boolean;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex h-10 w-10 items-center justify-center rounded-xl"
    >
      <Icon active={active}>{icon}</Icon>
    </Link>
  );
}

export default function MobileNav() {
  const pathname = usePathname();
  const isActive = (p: string) =>
    pathname === p || pathname?.startsWith(p + "/");

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-gray-800 bg-black/90 backdrop-blur">
      <div className="mx-auto max-w-md px-4 py-2 flex items-center justify-between">
        {/* Home */}
        <Item
          href="/"
          active={isActive("/")}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 10.5L12 3l9 7.5" />
              <path d="M5 9.5V21h14V9.5" />
            </svg>
          }
        />

        {/* Search */}
        <Item
          href="/search"
          active={isActive("/search")}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
          }
        />

        {/* Create (center action) */}
        <Link
          href="/create"
          className="-mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#61ff9a] text-black shadow"
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

        {/* Dashboard / profile */}
        <Item
          href="/dashboard"
          active={isActive("/dashboard")}
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21c0-4 4-7 8-7s8 3 8 7" />
            </svg>
          }
        />
      </div>
    </div>
  );
}