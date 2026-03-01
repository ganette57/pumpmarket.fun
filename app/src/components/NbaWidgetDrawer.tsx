"use client";

import { useEffect, useRef } from "react";

interface NbaWidgetDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string;
  isMobile?: boolean;
}

const WIDGET_SCRIPT_SRC = "https://widgets.api-sports.io/2.0.3/widget.js";

export default function NbaWidgetDrawer({
  isOpen,
  onClose,
  gameId,
  isMobile = false,
}: NbaWidgetDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptRef = useRef<HTMLScriptElement | null>(null);

  // Inject / cleanup the widget script + container when the drawer opens/closes.
  useEffect(() => {
    if (!isOpen || !gameId) return;

    const apiKey = process.env.NEXT_PUBLIC_APISPORTS_KEY || "";

    // Create the widget div inside our container
    const widgetDiv = document.createElement("div");
    widgetDiv.id = `wg-nba-game-${gameId}`;
    widgetDiv.setAttribute("data-host", "v2.nba.api-sports.io");
    widgetDiv.setAttribute("data-key", apiKey);
    widgetDiv.setAttribute("data-id", gameId);
    widgetDiv.setAttribute("data-theme", "dark");
    widgetDiv.setAttribute("data-show-errors", "true");

    if (containerRef.current) {
      containerRef.current.innerHTML = "";
      containerRef.current.appendChild(widgetDiv);
    }

    // Inject the widget script
    const script = document.createElement("script");
    script.src = WIDGET_SCRIPT_SRC;
    script.async = true;
    document.body.appendChild(script);
    scriptRef.current = script;

    return () => {
      // Cleanup
      if (scriptRef.current && document.body.contains(scriptRef.current)) {
        document.body.removeChild(scriptRef.current);
        scriptRef.current = null;
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [isOpen, gameId]);

  if (!isOpen) return null;

  // Mobile: full-screen drawer (same z-index pattern as TradingPanel mobile drawer)
  // Desktop: modal overlay
  return (
    <div className="fixed inset-0 z-[250] flex items-stretch justify-end">
      {/* Backdrop */}
      <button
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-label="Close stats"
      />

      {/* Drawer panel */}
      <div
        className={`relative z-10 bg-pump-dark border-l border-gray-800 shadow-2xl overflow-y-auto ${
          isMobile ? "w-full" : "w-full max-w-lg"
        }`}
      >
        {/* Header */}
        <div className="sticky top-0 z-20 flex items-center justify-between px-4 py-3 bg-pump-dark/95 backdrop-blur border-b border-gray-800">
          <h3 className="text-white font-bold text-sm">Match Stats</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition text-gray-300 hover:text-white"
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M1 1L13 13M13 1L1 13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Widget container */}
        <div ref={containerRef} className="p-4 min-h-[400px]" />
      </div>
    </div>
  );
}
