"use client";

import { useEffect, useRef, useState } from "react";
import { Activity, MessageCircle, MoreHorizontal } from "lucide-react";
import styles from "./MobileMarketToolbar.module.css";

// Prefer provider short names; otherwise keep a compact, recognizable team fragment.
export function mobileMarketLabel(title: string, meta?: Record<string, unknown> | null) {
  const sport = String(meta?.sport || "").toLowerCase();
  const compactTeam = (side: "home" | "away") => {
    const short = meta?.[`${side}_short_name`];
    if (typeof short === "string" && short.trim()) return short.trim();
    const full = meta?.[`${side}_team`];
    if (typeof full !== "string") return "";
    const words = full.trim().split(/\s+/);
    if (/american_football|baseball|basketball|nba|nfl|mlb/.test(sport) && words.length > 1) return words.slice(1).join(" ");
    return full.length > 13 ? words[0] : full;
  };
  const home = compactTeam("home"), away = compactTeam("away");
  return home && away ? `${home} vs ${away}` : title.split(/\s*[:—]\s*|\s+-\s+/)[0];
}

type Action = "discussion" | "activity" | "rules" | "resolution";
export default function MobileMarketToolbar({ label, active, onOpen }: {
  label: string; active: string | null; onOpen: (action: Action) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRoot = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (event: PointerEvent) => {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [menuOpen]);
  const button = "flex h-full min-w-0 items-center justify-center rounded-full transition duration-150 active:scale-95 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-pump-green/50";
  return (
    <nav ref={menuRoot} aria-label="Market information" className={`${styles.glass} relative mt-4 grid h-14 shrink-0 grid-cols-[52px_52px_minmax(0,1fr)_52px] items-center rounded-full border px-2 text-white/80`}>
      <span aria-hidden="true" className="pointer-events-none absolute bottom-[13px] left-[60px] top-[13px] w-px bg-white/[0.12]" />
      {(["discussion", "activity"] as const).map(action => {
        const Icon = action === "discussion" ? MessageCircle : Activity;
        return <button key={action} type="button" aria-label={action === "discussion" ? "Discussion" : "Activity"} title={action === "discussion" ? "Discussion" : "Activity"} aria-haspopup="dialog" aria-expanded={active === action} onClick={() => onOpen(action)} className={`${button} ${active === action ? "text-pump-green" : "hover:text-white"}`}>
          <Icon size={22} strokeWidth={1.6} aria-hidden="true" />
        </button>;
      })}
      <span title={label} className="pointer-events-none truncate border-l border-white/[0.12] px-4 text-center text-[12px] font-medium leading-7 text-white/90">{label}</span>
      <button type="button" aria-label="More market information" title="More" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)} className={`${button} border-l border-white/[0.12] ${active === "rules" || active === "resolution" ? "text-pump-green" : "hover:text-white"}`}>
        <MoreHorizontal size={22} strokeWidth={1.6} aria-hidden="true" />
      </button>
      {menuOpen && <div role="group" aria-label="More market information" className="absolute bottom-full right-0 mb-2 w-44 rounded-2xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-lg backdrop-blur-xl">
        {(["rules", "resolution"] as const).map(action => <button type="button" key={action} onClick={() => { setMenuOpen(false); onOpen(action); }} className="block w-full rounded-xl px-3 py-3 text-left text-sm capitalize hover:bg-white/5">{action}</button>)}
      </div>}
    </nav>
  );
}
