"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { usePrivyIdentity } from "@/components/privy/PrivyIdentityProvider";
import { supabase } from "@/lib/supabaseClient";
import { Bookmark, Share2, MoreHorizontal, Share } from "lucide-react";
import ReportMarketButton from "@/components/ReportMarketButton";

type Props = {
  // compat ancien prop
  marketId?: string;

  // nouveaux props
  marketAddress?: string; // adresse solana
  marketDbId?: string | null; // uuid markets.id

  question: string;
  subtle?: boolean;
  mobileHeader?: boolean;
};

export default function MarketActions({
  marketId,
  marketAddress,
  marketDbId,
  question,
  subtle = false,
  mobileHeader = false,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportRequest, setReportRequest] = useState(0);
  const menuRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const outside = (e: PointerEvent) => { if (!menuRoot.current?.contains(e.target as Node)) setMenuOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setMenuOpen(false); menuRoot.current?.querySelector<HTMLButtonElement>('[aria-label="Market actions"]')?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [menuOpen]);
  const { publicKey } = useFunMarketWallet();
  const privy = usePrivyIdentity();
  /**
   * The logged-out branch of every social action here. It used to be
   * alert("Connect your wallet") — accurate and useless, since the alert
   * offered no way to do it and implied a browser extension. Routes into
   * the canonical Privy login; external wallets remain available the
   * normal way, through the account menu.
   */
  const requireSignIn = () => {
    if (privy.configured) privy.loginWithGoogle();
    else alert("Connect your wallet to continue.");
  };


  const [busy, setBusy] = useState(false);
  const [bookmarkRowId, setBookmarkRowId] = useState<string | null>(null);
  const [marketUuid, setMarketUuid] = useState<string | null>(marketDbId ?? null);

  const address = useMemo(() => marketAddress || marketId || "", [marketAddress, marketId]);
  const userAddress = useMemo(() => publicKey?.toBase58() ?? null, [publicKey]);

  const bookmarked = !!bookmarkRowId;

  async function getMarketUuidFallback(): Promise<string | null> {
    if (!address) return null;
    try {
      const { data, error } = await supabase
        .from("markets")
        .select("id")
        .eq("market_address", address)
        .maybeSingle();

      if (error) return null;
      return data?.id ?? null;
    } catch {
      return null;
    }
  }

  async function fetchBookmarkRowId(params: { user: string; mid: string }) {
    const { user, mid } = params;

    const { data, error } = await supabase
      .from("bookmarks")
      .select("id")
      .eq("user_address", user)
      .eq("market_id", mid)
      .maybeSingle();

    if (error) throw error;
    return data?.id ?? null;
  }

  useEffect(() => {
    let alive = true;

    async function run() {
      if (!userAddress) {
        if (alive) setBookmarkRowId(null);
        return;
      }

      let mid = marketDbId ?? marketUuid ?? null;
      if (!mid) mid = await getMarketUuidFallback();

      if (!alive) return;

      setMarketUuid(mid);

      if (!mid) {
        setBookmarkRowId(null);
        return;
      }

      try {
        const rowId = await fetchBookmarkRowId({ user: userAddress, mid });
        if (!alive) return;
        setBookmarkRowId(rowId);
      } catch {
        if (!alive) return;
        setBookmarkRowId(null);
      }
    }

    run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userAddress, marketDbId, address]);

  async function toggleBookmark() {
    if (!userAddress) return requireSignIn();
    if (!address) return;

    setBusy(true);
    const prev = bookmarkRowId;

    try {
      let mid = marketUuid ?? marketDbId ?? null;
      if (!mid) mid = await getMarketUuidFallback();

      if (!mid) {
        alert("Market not indexed yet (no DB id). Refresh in a few seconds.");
        return;
      }

      // optimistic
      if (prev) setBookmarkRowId(null);
      else setBookmarkRowId("optimistic");

      if (prev) {
        const { error } = await supabase.from("bookmarks").delete().eq("id", prev);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from("bookmarks")
          .insert({ user_address: userAddress, market_id: mid })
          .select("id")
          .single();

        if (error) throw error;
        setBookmarkRowId(data?.id ?? null);
      }
    } catch (e: any) {
      setBookmarkRowId(prev);
      alert(e?.message || "Bookmark failed");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!address) return;

    const url =
      typeof window !== "undefined"
        ? `${window.location.origin}/trade/${address}`
        : `/trade/${address}`;

    try {
      if (navigator.share) {
        await navigator.share({
          title: "Funmarket",
          text: question,
          url,
        });
        return;
      }
    } catch {
      return; // user cancelled
    }

    try {
      await navigator.clipboard.writeText(url);
      alert("Link copied ✅");
    } catch {
      prompt("Copy link:", url);
    }
  }

  if (mobileHeader) return (
    <div ref={menuRoot} className="relative flex items-center text-gray-200">
      <button type="button" aria-label="Share market" title="Share" onClick={share} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition duration-150"><Share size={22} strokeWidth={1.6} aria-hidden="true" /></button>
      <button type="button" aria-label="Market actions" title="Market actions" aria-expanded={menuOpen} onClick={() => setMenuOpen(v => !v)} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/5 active:scale-95 transition duration-150"><MoreHorizontal size={22} strokeWidth={1.6} aria-hidden="true" /></button>
      {menuOpen && <div role="group" aria-label="Market actions" className="absolute right-0 top-full mt-2 w-48 rounded-2xl border border-white/10 bg-zinc-950/95 p-1.5 shadow-lg backdrop-blur-xl">
        <button type="button" disabled={busy} onClick={() => { setMenuOpen(false); void toggleBookmark(); }} className={`block w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-white/5 ${bookmarked ? "text-pump-green" : ""}`}>{bookmarked ? "Remove bookmark" : "Bookmark"}</button>
        <button type="button" onClick={() => { setMenuOpen(false); setReportRequest(v => v + 1); }} className="block w-full rounded-xl px-3 py-3 text-left text-sm hover:bg-white/5">Report</button>
      </div>}
      <ReportMarketButton marketAddress={address} hideTrigger openRequest={reportRequest} />
    </div>);

  return (
    <div className={`flex items-center gap-2 shrink-0 ${subtle ? "[&_svg]:stroke-[1.6] [&_svg]:h-[18px] [&_svg]:w-[18px] [&>button]:h-9 [&>button]:w-9" : ""}`}>
      {/* Bookmark */}
      <button
        type="button"
        disabled={busy}
        onClick={toggleBookmark}
        className={[
          "p-2 rounded-lg transition",
          "hover:bg-white/5 active:scale-[0.98]",
          bookmarked ? "text-pump-green" : subtle ? "text-gray-500" : "text-gray-400",
          busy ? "opacity-60" : "",
        ].join(" ")}
        title={bookmarked ? "Bookmarked" : "Bookmark"}
        aria-label={bookmarked ? "Remove bookmark" : "Bookmark market"}
      >
        <Bookmark
          className="w-5 h-5"
          fill={bookmarked ? "currentColor" : "none"}
        />
      </button>

      {/* Share */}
      <button
        type="button"
        onClick={share}
        className={`p-2 rounded-lg ${subtle ? "text-gray-500" : "text-gray-400"} hover:bg-white/5 active:scale-[0.98] transition`}
        title="Share"
        aria-label="Share market"
      >
        <Share2 className="w-5 h-5" />
      </button>

      {/* Report */}
      {!subtle && <ReportMarketButton marketAddress={address} variant="icon" />}
    </div>
  );
}
