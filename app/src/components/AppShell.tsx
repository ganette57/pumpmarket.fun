"use client";

import { usePathname } from "next/navigation";
import Header from "@/components/Header";
import MobileNav from "@/components/MobileNav";
import MobileTopBar from "@/components/MobileTopBar";
import SiteFooter from "@/components/SiteFooter";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isSearch = pathname?.startsWith("/search") || pathname?.startsWith("/explorer");
  const isTrade = pathname?.startsWith("/trade/");
  // Only the /live feed page controls its own mobile header (MobileTabs);
  // /live/[id] detail pages still use MobileTopBar.
  const isLiveFeed = pathname === "/live";
  // Home feed is fullscreen immersive — no mobile top bar, no padding
  const isHomeFeed = pathname === "/";

  return (
    <div className={isTrade ? "md:h-screen md:flex md:flex-col md:overflow-hidden" : ""}>
      {/* Desktop header */}
      <div className="hidden md:block flex-shrink-0">
        <Header />
      </div>

      {/* Mobile header — hidden on /live and home feed (mobile feed has its own overlay) */}
      {!isLiveFeed && !isHomeFeed && (
        <div className="md:hidden">
          <MobileTopBar showSearch={!!isSearch} />
        </div>
      )}

      {/* Main content */}
      <main
        className={
          isHomeFeed
            ? "h-[100dvh] overflow-hidden md:h-auto md:overflow-visible md:min-h-screen md:pb-0"
            : isTrade
            ? "flex-1 min-h-0 overflow-hidden pb-32 md:pb-0"
            : isLiveFeed
            ? "h-[calc(100dvh-3.5rem)] overflow-hidden md:h-auto md:overflow-visible md:min-h-screen md:pb-0"
            : "min-h-screen pb-32 md:pb-0"
        }
      >
        {children}
      </main>

     {/* Footer desktop only - hidden on trade pages */}
{!isTrade && <div className="hidden md:block"><SiteFooter /></div>}

      {/* Bottom nav mobile */}
      <MobileNav />
    </div>
  );
}
