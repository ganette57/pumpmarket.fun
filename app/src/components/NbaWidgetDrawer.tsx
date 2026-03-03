"use client";

import { useEffect, useRef, useState } from "react";

interface NbaWidgetDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  gameId: string; // TheSportsDB event ID — resolved to API-NBA ID via server route
  isMobile?: boolean;
}

const WIDGET_SCRIPT_SRC = "https://widgets.api-sports.io/2.0.3/widget.js";

interface WidgetConfig {
  apiKey: string;
  gameId: string; // Resolved API-NBA game ID
  host: string;
}

export default function NbaWidgetDrawer({
  isOpen,
  onClose,
  gameId,
  isMobile = false,
}: NbaWidgetDrawerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch widget config (resolved API-NBA game ID + API key) from server
  useEffect(() => {
    if (!isOpen || !gameId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setConfig(null);

    fetch(`/api/sports/widget-config?event_id=${encodeURIComponent(gameId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Config fetch failed (${res.status})`);
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        if (!data.apiKey || !data.gameId) {
          throw new Error("Invalid config response");
        }
        setConfig(data);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error("[NbaWidgetDrawer] config error:", err);
        setError("Could not load match stats. Try again later.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, gameId]);

  // Inject the widget once we have the config
  useEffect(() => {
    if (!isOpen || !config) return;
    if (!containerRef.current) return;

    // Create the widget div inside our container
    const widgetDiv = document.createElement("div");
    widgetDiv.id = "wg-api-basketball-game";
    widgetDiv.setAttribute("data-host", config.host);
    widgetDiv.setAttribute("data-key", config.apiKey);
    widgetDiv.setAttribute("data-id", config.gameId);
    widgetDiv.setAttribute("data-theme", "dark");
    widgetDiv.setAttribute("data-show-errors", "true");

    containerRef.current.innerHTML = "";
    containerRef.current.appendChild(widgetDiv);

    const existingScript = document.querySelector(
      `script[src="${WIDGET_SCRIPT_SRC}"]`,
    ) as HTMLScriptElement | null;

    const isLocalhost =
      typeof window !== "undefined" && window.location.hostname === "localhost";
    if (isLocalhost) {
      console.debug("[NbaWidgetDrawer] widget init", {
        gameId: config.gameId,
        host: config.host,
        hasScript: !!existingScript,
      });
    }

    if (!existingScript) {
      const script = document.createElement("script");
      script.src = WIDGET_SCRIPT_SRC;
      script.async = true;
      document.body.appendChild(script);
    } else {
      // Let existing widget runtime pick up the newly recreated container.
      setTimeout(() => {
        if (typeof window !== "undefined") window.dispatchEvent(new Event("resize"));
      }, 0);
    }

    return () => {
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, [isOpen, config]);

  if (!isOpen) return null;

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

        {/* Loading / Error / Widget */}
        {loading && (
          <div className="flex items-center justify-center p-8 text-gray-400 text-sm">
            <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Loading match stats...
          </div>
        )}

        {error && (
          <div className="p-6 text-center text-red-400 text-sm">{error}</div>
        )}

        {/* Widget container */}
        <div ref={containerRef} className="p-4 min-h-[400px]" />
      </div>
    </div>
  );
}
