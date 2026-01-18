"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import Image from "next/image";

import { PublicKey } from "@solana/web3.js";
import { Program, type Idl } from "@coral-xyz/anchor";
import { useConnection, useWallet, useAnchorWallet } from "@solana/wallet-adapter-react";

import idl from "@/idl/funmarket_pump.json";
import { getProvider, PROGRAM_ID } from "@/utils/solana";
import { supabase } from "@/lib/supabaseClient";
import { sendSignedTx } from "@/lib/solanaSend";

type DbMarket = {
  market_address: string;
  question: string | null;

  // DB state
  resolution_status: "open" | "proposed" | "finalized" | "cancelled" | null;
  proposed_winning_outcome: number | null;
  resolution_proposed_at: string | null;
  contest_deadline: string | null;

  // optional counters
  contest_count: number | null;
  contested: boolean | null;

  // proposed proof
  proposed_proof_url: string | null;
  proposed_proof_image: string | null;
  proposed_proof_note: string | null;

  // outcomes labels
  outcome_names: string[] | null;
};

type DbDispute = {
  id: string;
  market_address: string;
  disputor: string;
  note: string | null;
  proof_url: string | null;
  created_at: string;
};

function safeId(p: unknown): string | null {
  if (!p) return null;
  if (typeof p === "string") return p;
  if (Array.isArray(p) && typeof p[0] === "string") return p[0];
  return null;
}

function formatMsToHhMm(ms: number) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h <= 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function shortAddr(a?: string) {
  if (!a) return "";
  if (a.length <= 10) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

function normalizeUrl(raw?: string | null) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function parseDateMs(s?: string | null): number {
  if (!s) return NaN;
  const t = new Date(s).getTime();
  return Number.isFinite(t) ? t : NaN;
}

export default function ContestPage() {
  const params = useParams();
  const id = safeId((params as any)?.id);

  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const anchorWallet = useAnchorWallet();
  const walletBase58 = publicKey?.toBase58() || "";

  const [market, setMarket] = useState<DbMarket | null>(null);
  const [disputes, setDisputes] = useState<DbDispute[]>([]);
  const [loading, setLoading] = useState(true);

  const [now, setNow] = useState(() => Date.now());

  // form
  const [note, setNote] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Tx guard: prevent double-submit
  const inFlightRef = useRef<Record<string, boolean>>({});

  // --- derived ---
  const deadlineMs = useMemo(() => parseDateMs(market?.contest_deadline), [market?.contest_deadline]);
  const remainingMs = useMemo(() => (Number.isFinite(deadlineMs) ? deadlineMs - now : NaN), [deadlineMs, now]);

  const contestOpen = useMemo(() => {
    if (!market) return false;
    if (market.resolution_status !== "proposed") return false;
    if (!Number.isFinite(remainingMs)) return false;
    return remainingMs > 0;
  }, [market, remainingMs]);

  const alreadyDisputedByMe = useMemo(() => {
    if (!walletBase58) return false;
    return disputes.some((d) => d.disputor === walletBase58);
  }, [disputes, walletBase58]);

  const outcomeLabel = useMemo(() => {
    if (!market) return null;
    const names = Array.isArray(market.outcome_names) ? market.outcome_names : null;
    const idx = market.proposed_winning_outcome;

    if (idx == null || !Number.isFinite(Number(idx))) return null;
    const i = Number(idx);

    if (names && typeof names[i] === "string" && names[i]) return names[i];
    return `Option ${i + 1}`;
  }, [market]);

  const proposedProofImg = market?.proposed_proof_image || "";
  const proposedProofUrl = market?.proposed_proof_url || "";
  const proposedProofNote = market?.proposed_proof_note || "";

  const proofIsLikelyAboveFold = true; // change to false if you know it's usually below fold

  // --- anchor program ---
  const getAnchorProgram = useCallback((): Program<Idl> | null => {
    if (!anchorWallet) return null;
    const provider = getProvider(anchorWallet, connection);

    // Anchor recent: new Program(idl, provider)
    // If your idl doesn't include `address`, Program uses it from the IDL.
    // If you ever need to force the program id: ensure PROGRAM_ID matches idl.address.
    return new Program(idl as unknown as Idl, provider);
  }, [anchorWallet, connection]);

  // --- data load ---
  const loadAll = useCallback(async (marketAddress: string) => {
    setLoading(true);
    setMsg(null);

    try {
      const { data: mk, error: mkErr } = await supabase
        .from("markets")
        .select(
          [
            "market_address",
            "question",
            "resolution_status",
            "proposed_winning_outcome",
            "resolution_proposed_at",
            "contest_deadline",
            "contest_count",
            "contested",
            "proposed_proof_url",
            "proposed_proof_image",
            "proposed_proof_note",
            "outcome_names",
          ].join(",")
        )
        .eq("market_address", marketAddress)
        .maybeSingle();

      if (mkErr) throw mkErr;

      if (!mk) {
        setMarket(null);
        setDisputes([]);
        return;
      }
      setMarket(mk as any);

      const { data: ds, error: dsErr } = await supabase
        .from("market_disputes")
        .select("id,market_address,disputor,note,proof_url,created_at")
        .eq("market_address", marketAddress)
        .order("created_at", { ascending: false })
        .limit(200);

      if (dsErr) throw dsErr;
      setDisputes(((ds as any[]) || []) as DbDispute[]);
    } catch (e: any) {
      console.error("contest load error:", e);
      setMarket(null);
      setDisputes([]);
      setMsg(e?.message || "Failed to load contest page");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    void loadAll(id);
  }, [id, loadAll]);

  // live countdown tick
  useEffect(() => {
    if (!market?.contest_deadline) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [market?.contest_deadline]);

  // --- dispute submit ---
  const submitDispute = useCallback(async () => {
    if (!id || !market) return;
    setMsg(null);

    // Tx guard: prevent double-submit
    const key = "contest_submit";
    if (inFlightRef.current[key]) return;

    if (!connected || !publicKey || !walletBase58) {
      setMsg("Connect your wallet to submit a dispute.");
      return;
    }
    if (!contestOpen) {
      setMsg("Dispute window is closed.");
      return;
    }
    if (alreadyDisputedByMe) {
      setMsg("You already disputed this market with this wallet.");
      return;
    }

    const cleanNote = note.trim();
    const cleanUrl = proofUrl.trim();
    if (!cleanNote && !cleanUrl) {
      setMsg("Add a note and/or a proof link.");
      return;
    }

    inFlightRef.current[key] = true;
    setSubmitting(true);
    try {
      const program = getAnchorProgram();
      if (!program) throw new Error("Wallet provider not ready. Reconnect your wallet.");

      const marketPk = new PublicKey(id);

      // 1) ON-CHAIN (centralized send + already processed safe)
      const tx = await program.methods
        .dispute()
        .accounts({
          market: marketPk,
          user: publicKey,
        })
        .transaction();

      const txSig = await sendSignedTx({
        connection,
        tx,
        signTx: anchorWallet!.signTransaction,
        feePayer: publicKey,
        commitment: "confirmed",
      });

      console.log("✅ dispute tx:", txSig);

      // 2) OFF-CHAIN (DB record)
      try {
        const res = await fetch("/api/markets/contest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            market_address: id,
            disputor: walletBase58,
            note: cleanNote || null,
            proof_url: cleanUrl || null,
            tx_sig: txSig,
          }),
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          const emsg = json?.error || json?.message || "Failed to submit dispute";
          if (String(emsg).toLowerCase().includes("duplicate") || String(emsg).toLowerCase().includes("unique")) {
            console.warn("DB duplicate dispute (tx still succeeded)");
          } else {
            console.error("DB commit error (tx still succeeded):", emsg);
          }
        }
      } catch (dbErr) {
        console.error("DB commit error (tx still succeeded):", dbErr);
        // Continue - on-chain is source of truth
      }

      setNote("");
      setProofUrl("");
      setMsg(`✅ Dispute submitted. Tx: ${txSig}`);

      await loadAll(id);
    } catch (e: any) {
      console.error("submitDispute error:", e);
      const errMsg = String(e?.message || "");

      // Handle "already been processed" gracefully
      if (errMsg.toLowerCase().includes("already been processed")) {
        setMsg("Transaction already processed. Refreshing…");
        await loadAll(id);
        return;
      }

      // Handle user rejection
      if (errMsg.toLowerCase().includes("user rejected")) {
        setMsg("Transaction cancelled by user.");
        return;
      }

      setMsg(errMsg || "Dispute failed.");
    } finally {
      inFlightRef.current[key] = false;
      setSubmitting(false);
    }
  }, [
    id,
    market,
    connected,
    publicKey,
    walletBase58,
    contestOpen,
    alreadyDisputedByMe,
    note,
    proofUrl,
    getAnchorProgram,
    connection,
    loadAll,
  ]);

  // --- UI states ---
  if (!id) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="card-pump">Missing market id</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-pump-green" />
          <p className="text-gray-400 mt-4">Loading contest…</p>
        </div>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="card-pump">
          <div className="text-white font-semibold">Market not found</div>
          <div className="text-sm text-gray-400 mt-1">This contest page needs a valid market address.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 space-y-6">
      {/* header */}
      <div className="card-pump">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs text-gray-500">Contest</div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-white leading-tight mt-1">
              {market.question || "Market"}
            </h1>

            <div className="text-xs text-gray-500 mt-2 flex flex-wrap items-center gap-2">
              <span className="font-mono">{shortAddr(market.market_address)}</span>
              <span>•</span>
              <Link href={`/trade/${market.market_address}`} className="text-pump-green hover:underline">
                Back to market
              </Link>
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <div
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${
                contestOpen
                  ? "border-[#ff5c73]/30 bg-[#ff5c73]/10 text-[#ff5c73]"
                  : "border-white/10 bg-black/20 text-gray-300"
              }`}
            >
              {contestOpen ? "Dispute window OPEN" : "Dispute window CLOSED"}
            </div>

            {Number.isFinite(remainingMs) ? (
              <div className={`text-xs font-semibold ${contestOpen ? "text-[#ff5c73]" : "text-gray-400"}`}>
                {contestOpen ? `${formatMsToHhMm(remainingMs)} left` : "—"}
              </div>
            ) : (
              <div className="text-xs text-gray-500">No deadline</div>
            )}

            {alreadyDisputedByMe && <div className="text-[11px] text-gray-400">You already disputed with this wallet.</div>}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-gray-500">Proposed outcome</div>
            <div className="text-white font-bold text-lg mt-1">{outcomeLabel || "—"}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-gray-500">Disputes</div>
            <div className="text-white font-bold text-lg mt-1">{disputes.length}</div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="text-xs text-gray-500">Status</div>
            <div className="text-white font-bold text-lg mt-1">{market.resolution_status || "open"}</div>
          </div>
        </div>
      </div>

      {/* proposed proof */}
      {(proposedProofNote || proposedProofUrl || proposedProofImg) && (
        <div className="card-pump">
          <div className="text-white font-bold mb-3">Proposed proof</div>

          {proposedProofNote && <p className="text-sm text-gray-300 mb-3">{proposedProofNote}</p>}

          {proposedProofUrl && (
            <p className="text-sm text-gray-300 mb-3">
              Link:{" "}
              <a href={proposedProofUrl} target="_blank" rel="noreferrer" className="text-pump-green underline">
                open proof
              </a>
            </p>
          )}

          {proposedProofImg && (
            <div className="rounded-2xl overflow-hidden border border-white/10 bg-black/20">
              <div className="relative w-full aspect-video">
                <Image
                  src={proposedProofImg}
                  alt="Proposed proof"
                  fill
                  sizes="(max-width: 768px) 100vw, 900px"
                  priority={proofIsLikelyAboveFold}
                  className="object-contain bg-black"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* submit dispute */}
      <div className="card-pump">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="text-white font-bold">Submit a dispute</div>
          <div className="text-xs text-gray-500">
            {connected ? (
              <>
                Wallet: <span className="font-mono text-white/80">{shortAddr(walletBase58)}</span>
              </>
            ) : (
              <>Connect wallet to submit</>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-gray-400">Note (optional)</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={4}
              placeholder="Explain why the proposed outcome is wrong…"
              className="mt-1 w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/50"
            />
          </div>

          <div>
            <label className="text-xs text-gray-400">Proof link (optional)</label>
            <input
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              placeholder="https://..."
              className="mt-1 w-full px-3 py-2 rounded-xl bg-black/30 border border-white/10 text-white placeholder:text-gray-500 focus:outline-none focus:border-pump-green/50"
            />

            <div className="mt-3 text-xs text-gray-500">
              1 dispute per wallet per market (DB-enforced). On-chain dispute increments the counter.
            </div>

            <button
              onClick={submitDispute}
              disabled={!contestOpen || !connected || submitting || alreadyDisputedByMe}
              aria-busy={submitting}
              className={`mt-4 w-full px-4 py-3 rounded-xl font-semibold transition ${
                !contestOpen || !connected || submitting || alreadyDisputedByMe
                  ? "bg-gray-700 text-gray-300 cursor-not-allowed"
                  : "bg-[#ff5c73] text-black hover:opacity-90"
              }`}
              type="button"
            >
              {submitting ? "Processing…" : "🚨 Submit dispute (on-chain)"}
            </button>
          </div>
        </div>

        {msg && (
          <div className="mt-4 text-sm text-gray-200 bg-black/20 border border-white/10 rounded-xl p-3 whitespace-pre-wrap">
            {msg}
          </div>
        )}
      </div>

      {/* disputes list */}
      <div className="card-pump">
        <div className="flex items-center justify-between mb-3">
          <div className="text-white font-bold">Public disputes</div>
          <button
            onClick={() => void loadAll(id)}
            className="px-3 py-1.5 rounded-lg border border-white/10 text-gray-200 hover:bg-white/5 transition text-xs"
            type="button"
          >
            Refresh
          </button>
        </div>

        {disputes.length === 0 ? (
          <div className="text-sm text-gray-500">No disputes yet.</div>
        ) : (
          <div className="space-y-3">
            {disputes.map((d) => (
              <div key={d.id} className="rounded-2xl border border-white/10 bg-black/20 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs text-gray-500">
                    <span className="font-mono text-white/80">{shortAddr(d.disputor)}</span>
                    <span className="text-gray-600"> • </span>
                    {d.created_at ? new Date(d.created_at).toLocaleString() : ""}
                  </div>
                </div>

                {d.note && <div className="text-sm text-gray-200 mt-2 whitespace-pre-wrap">{d.note}</div>}

                {d.proof_url && (
                  <div className="text-sm text-gray-300 mt-2">
                    Proof:{" "}
                    <a
                      href={normalizeUrl(d.proof_url)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-pump-green underline"
                    >
                      open
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-gray-600 text-center">Transparency first. This page is public by design.</div>
    </div>
  );
}