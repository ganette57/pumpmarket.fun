// src/app/live/page.tsx
"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  listLiveSessions,
  subscribeLiveSessionsList,
  type LiveSession,
} from "@/lib/liveSessions";

type FeedTab = "live" | "feed";

function LiveBadge() {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold uppercase tracking-wide">
      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
      Live
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "live") return <LiveBadge />;

  const map: Record<string, { bg: string; text: string; label: string }> = {
    scheduled: { bg: "bg-yellow-600/80", text: "text-white", label: "Scheduled" },
    locked: { bg: "bg-orange-600/80", text: "text-white", label: "Locked" },
    ended: { bg: "bg-gray-600/80", text: "text-gray-200", label: "Ended" },
    resolved: { bg: "bg-pump-green/80", text: "text-black", label: "Resolved" },
    cancelled: { bg: "bg-gray-700/80", text: "text-gray-300", label: "Cancelled" },
  };
  const s = map[status] || map.ended!;

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${s.bg} ${s.text}`}
    >
      {s.label}
    </span>
  );
}

function SessionCard({ session }: { session: LiveSession }) {
  return (
    <Link href={`/live/${session.id}`} className="block group">
      <article className="relative rounded-xl overflow-hidden border border-gray-800 bg-[#05070b] hover:border-pump-green hover:shadow-xl transition-all h-full">
        {/* Thumbnail area */}
        <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden">
          {session.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={session.thumbnail_url}
              alt={session.title}
              className="object-cover w-full h-full opacity-75 group-hover:opacity-90 transition"
            />
          ) : (
            <div className="flex flex-col items-center justify-center w-full h-full bg-gradient-to-br from-gray-900 via-pump-dark to-black">
              <div className="relative mb-1">
                {session.status === "live" && (
                  <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
                  </span>
                )}
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="w-10 h-10 text-gray-600"
                >
                  <circle cx="12" cy="12" r="2" />
                  <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
                  <path d="M7.76 7.76a6 6 0 0 0 0 8.48" />
                </svg>
              </div>
              <span className="text-[10px] text-gray-600 font-medium uppercase tracking-wider">Stream</span>
            </div>
          )}

          {/* Status badge */}
          <div className="absolute top-2 left-2">
            <StatusBadge status={session.status} />
          </div>

          {/* Dark fade bottom */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#05070b] via-transparent pointer-events-none" />
        </div>

        {/* Content */}
        <div className="p-3">
          <h3 className="font-semibold text-white text-sm leading-tight line-clamp-2 group-hover:text-pump-green transition">
            {session.title}
          </h3>
          <p className="text-[11px] text-gray-500 mt-1 truncate">
            {session.host_wallet.slice(0, 4)}...{session.host_wallet.slice(-4)}
          </p>
        </div>
      </article>
    </Link>
  );
}

export default function LivePage() {
  const { publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const router = useRouter();
  const [tab, setTab] = useState<FeedTab>("live");
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);

  const handleGoLive = useCallback(() => {
    if (!publicKey) {
      setVisible(true);
      return;
    }
    router.push("/live/new");
  }, [publicKey, router, setVisible]);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listLiveSessions();
      setSessions(data);
    } catch (e) {
      console.error("Failed to load live sessions:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // Realtime updates
  useEffect(() => {
    const unsubscribe = subscribeLiveSessionsList((session, eventType) => {
      setSessions((prev) => {
        if (eventType === "DELETE") {
          return prev.filter((s) => s.id !== session.id);
        }
        if (eventType === "INSERT") {
          return [session, ...prev];
        }
        // UPDATE
        return prev.map((s) => (s.id === session.id ? session : s));
      });
    });
    return unsubscribe;
  }, []);

  const liveSessions = sessions.filter((s) => s.status === "live" || s.status === "scheduled");
  const allSessions = sessions;

  const displaySessions = tab === "live" ? liveSessions : allSessions;

  return (
    <div className="min-h-[70vh] px-4 py-4 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        {/* Tabs */}
        <div className="flex items-center gap-1 bg-pump-dark/60 rounded-full p-1 border border-gray-800">
          <button
            onClick={() => setTab("live")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
              tab === "live"
                ? "bg-white text-black"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Live
          </button>
          <button
            onClick={() => setTab("feed")}
            className={`px-5 py-2 rounded-full text-sm font-semibold transition ${
              tab === "feed"
                ? "bg-white text-black"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Feed
          </button>
        </div>

        {/* Create button */}
        <button
          type="button"
          onClick={handleGoLive}
          className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:bg-[#74ffb8] transition"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="w-4 h-4">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
          {publicKey ? "Go Live" : "Connect to Go Live"}
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-pump-green" />
        </div>
      ) : displaySessions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="mx-auto mb-4 w-16 h-16 rounded-2xl border border-pump-green/30 bg-pump-green/10 flex items-center justify-center">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="w-8 h-8 text-pump-green"
            >
              <circle cx="12" cy="12" r="2" />
              <path d="M16.24 7.76a6 6 0 0 1 0 8.48" />
              <path d="M7.76 7.76a6 6 0 0 0 0 8.48" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white mb-1">
            {tab === "live" ? "No live sessions" : "No sessions yet"}
          </h2>
          <p className="text-sm text-gray-400 max-w-xs">
            {tab === "live"
              ? "No one is streaming right now. Be the first to go live!"
              : "Sessions will appear here once created."}
          </p>
          <button
            type="button"
            onClick={handleGoLive}
            className="mt-4 px-6 py-2 rounded-lg bg-pump-green text-black text-sm font-semibold hover:bg-[#74ffb8] transition"
          >
            {publicKey ? "Start a session" : "Connect wallet to start"}
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {displaySessions.map((session) => (
            <SessionCard key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}
