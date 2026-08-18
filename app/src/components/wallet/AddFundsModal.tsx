"use client";

// src/components/wallet/AddFundsModal.tsx
//
// THE Add Funds surface. One component, every entry point, both platforms.
//
//   Buy SOL            card / Apple Pay / Google Pay, via Privy's onramp
//   Receive SOL        the wallet's own address
//   Use another wallet the existing external-wallet flow
//
// NOT A DEPOSIT. FunMarket never takes custody and never mints a balance
// of its own: every route here ends with SOL arriving at the user's own
// Solana address, and the app learns about it the same way it learns
// about any other balance change — by reading the chain.
//
// WHY BUY IS MAINNET-ONLY
// -----------------------
// A fiat onramp buys REAL SOL from a real provider. Privy's `environment`
// flag ('sandbox' | 'production') selects the PROVIDER's test mode — test
// cards, no real charge — it does not repoint the destination chain at a
// Solana testnet. So on devnet there is no honest way to run this flow.
// The row stays VISIBLE and disabled rather than hidden: during
// development, seeing the feature exist is worth more than a tidier menu.
//
// The words "Privy", "embedded wallet", "RPC" and "CAIP-2" appear nowhere
// a user can read.

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownToLine,
  ArrowLeft,
  Check,
  Copy,
  CreditCard,
  Wallet,
  X,
} from "lucide-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useFiatOnramp } from "@privy-io/react-auth";
import { useFunMarketWallet } from "@/components/wallet/FunMarketWalletProvider";
import { usePrivyIdentity } from "@/components/privy/PrivyIdentityProvider";
import {
  ONRAMP_SOLANA_MAINNET_CHAIN,
  ONRAMP_SOL_ASSET,
  isMainnet,
  solanaNetworkLabel,
} from "@/lib/privyChain";
import { solanaExplorerAddressUrl } from "@/utils/explorer";

function short(address: string) {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

type View = "menu" | "receive";

/* -------------------------------------------------------------------------- */
/*  Option row                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * One funding method.
 *
 * The whole row is the control. A row with a little button inside it gives
 * the user two targets for one intent, and on a phone that is a miss
 * waiting to happen.
 *
 * `tone` carries the hierarchy — primary reads as the recommended path,
 * quiet as the alternate one — so the ranking is a property of the row
 * rather than a pile of one-off classNames at each call site.
 */
function OptionRow({
  icon,
  title,
  subtitle,
  onClick,
  disabled,
  badge,
  tone = "default",
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick?: () => void;
  disabled?: boolean;
  badge?: string;
  tone?: "primary" | "default" | "quiet";
}) {
  const toneClass = disabled
    ? "cursor-not-allowed border-gray-800/60 bg-black/20"
    : tone === "primary"
    ? "border-pump-green/30 bg-pump-green/[0.07] hover:border-pump-green/60 hover:bg-pump-green/[0.12]"
    : tone === "quiet"
    ? "border-gray-800/80 bg-transparent hover:border-gray-700 hover:bg-white/[0.03]"
    : "border-gray-800 bg-black/30 hover:border-gray-700 hover:bg-white/[0.05]";

  const iconClass = disabled
    ? "bg-white/[0.04] text-gray-600"
    : tone === "primary"
    ? "bg-pump-green/15 text-pump-green"
    : "bg-white/[0.06] text-gray-300";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-3.5 rounded-2xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70 focus-visible:ring-offset-2 focus-visible:ring-offset-pump-gray ${toneClass}`}
    >
      <span
        aria-hidden="true"
        className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition ${iconClass}`}
      >
        {icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={`text-[15px] font-semibold ${disabled ? "text-gray-400" : "text-white"}`}>
            {title}
          </span>
          {badge && (
            <span className="shrink-0 rounded-full border border-gray-700 px-1.5 py-0.5 text-[11px] font-medium text-gray-400">
              {badge}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-[13px] leading-snug text-gray-400">{subtitle}</span>
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Modal                                                                      */
/* -------------------------------------------------------------------------- */

export default function AddFundsModal({
  open,
  onClose,
  /** Re-read the Real balance after money should have moved. */
  onFunded,
}: {
  open: boolean;
  onClose: () => void;
  onFunded?: () => void;
}) {
  const wallet = useFunMarketWallet();
  const privy = usePrivyIdentity();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const { fund } = useFiatOnramp();

  const [view, setView] = useState<View>("menu");
  const [copied, setCopied] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyError, setBuyError] = useState<string | null>(null);
  // While the onramp is on screen this modal steps out of the way instead
  // of stacking behind it. Still MOUNTED — it has to survive to report a
  // genuine failure — just not rendered.
  const [yielded, setYielded] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  // Portals need a real document. Next renders this component on the
  // server first, so the portal is created only after the client mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const mainnet = isMainnet();
  const networkLabel = solanaNetworkLabel();
  const address = wallet.address;
  const isEmbedded = wallet.source === "privy";
  const walletLabel = isEmbedded
    ? "FunMarket wallet"
    : wallet.options.find((o) => o.address === address)?.label ?? "Wallet";

  // Always reopen on the menu. A modal that remembers it was last on the
  // receive screen is a modal that hides its other two options.
  useEffect(() => {
    if (open) {
      setView("menu");
      setBuyError(null);
      setYielded(false);
    }
  }, [open]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  // Escape steps BACK from the receive view rather than discarding the
  // whole modal — the same thing the on-screen back arrow does.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (view === "receive") setView("menu");
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose, view]);

  // Generated locally, on demand, from the RAW ADDRESS ONLY — no payment
  // URI, no amount, no chain parameter. A QR that silently encoded
  // anything beyond the address is a way to lose money.
  //
  // Dynamically imported so the encoder is not in the main bundle for the
  // majority of sessions that never open this screen.
  useEffect(() => {
    if (view !== "receive" || !address) {
      setQr(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(address, {
          width: 320,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#000000", light: "#ffffff" },
        });
        if (!cancelled) setQr(url);
      } catch {
        // The address and Copy button are the actual feature; a missing
        // QR is a smaller card, not a broken screen.
        if (!cancelled) setQr(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [view, address]);

  const copy = useCallback(async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* clipboard blocked — the address is on screen and selectable */
    }
  }, [address]);

  const handleBuy = useCallback(async () => {
    if (!address || buying || !mainnet) return;
    setBuying(true);
    setBuyError(null);
    // Yield BEFORE the call so the provider UI never opens on top of ours.
    setYielded(true);
    try {
      await fund({
        source: { defaultAsset: "usd", assets: ["usd", "eur", "gbp"] },
        destination: {
          asset: ONRAMP_SOL_ASSET,
          chain: ONRAMP_SOLANA_MAINNET_CHAIN,
          address,
        },
        environment: "production",
      });
      // Resolves on 'submitted' as well as 'confirmed', so this is a
      // "money may have moved" signal, not a guarantee. Re-reading is
      // cheap and the poll is the backstop either way.
      onFunded?.();
      onClose();
    } catch (e) {
      // The SDK rejects for BOTH "user closed the modal" and "this is
      // actually broken", so the two have to be told apart here or every
      // changed mind looks like a failure.
      //
      // Closing the provider UI rejects with the literal message
      // "User exited flow" — confirmed at runtime. Normal cancellation:
      // nothing to report, just close.
      const msg = String((e as Error)?.message || "");
      const cancelled = /user exited|exit|cancel|close|abort|dismiss/i.test(msg);
      if (cancelled) {
        onClose();
      } else {
        // A real fault. Come back on screen and say so in one sentence
        // that points at the route which always works. The provider's own
        // error text is deliberately not shown.
        setYielded(false);
        setBuyError(
          "Card payments are unavailable right now. You can still receive SOL manually."
        );
      }
    } finally {
      setBuying(false);
    }
  }, [address, buying, mainnet, fund, onFunded, onClose]);

  if (!open || yielded || !mounted) return null;

  const heading = view === "menu" ? "Add funds" : "Receive SOL";

  // PORTALLED TO document.body ON PURPOSE.
  //
  // Rendered in place, this overlay sits inside the header — which is
  // `fixed … backdrop-blur`, and backdrop-filter makes an element the
  // containing block for `position: fixed` descendants. `inset-0` would
  // then mean "the 64px header", not "the viewport": clipped off the top
  // on desktop, jammed into the 288px dropdown on mobile.
  //
  // document.body has no such ancestor, so `fixed inset-0` means the
  // viewport again — no width/height/offset hacks required.
  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-end justify-center bg-black/75 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={heading}
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl border border-gray-800 bg-pump-gray p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl sm:max-w-[440px] sm:rounded-2xl sm:pb-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Bottom-sheet grab handle. Mobile only. */}
        <div aria-hidden="true" className="mx-auto mb-4 h-1 w-10 rounded-full bg-gray-700 sm:hidden" />

        {/* ---------------- header ---------------- */}
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {view === "receive" && (
              <button
                type="button"
                onClick={() => setView("menu")}
                aria-label="Back to funding options"
                className="-ml-1 rounded-lg p-1.5 text-gray-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
            )}
            <h2 className="truncate text-lg font-bold text-white">{heading}</h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 shrink-0 rounded-lg p-1.5 text-gray-400 transition hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ---------------- no wallet yet ---------------- */}
        {!address ? (
          <div className="pb-1">
            <p className="mb-5 text-[13px] text-gray-400">
              Connect an account to receive SOL.
            </p>
            <button
              type="button"
              onClick={() => {
                if (privy.configured) privy.loginWithGoogle();
                else setWalletModalVisible(true);
                onClose();
              }}
              className="h-11 w-full rounded-xl bg-pump-green text-[15px] font-semibold text-black transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70 focus-visible:ring-offset-2 focus-visible:ring-offset-pump-gray"
            >
              {privy.configured ? "Continue with Google" : "Connect wallet"}
            </button>
          </div>
        ) : view === "menu" ? (
          <>
            <p className="mb-4 text-[13px] text-gray-400">Add SOL to trade in Real mode.</p>

            {/* Where the money lands. Compact and label-first — the full
                address belongs on the receive screen, not here. */}
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-gray-800/80 bg-black/30 px-3.5 py-2.5">
              <span className="min-w-0">
                <span className="block text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                  Funding destination
                </span>
                <span className="mt-0.5 block truncate text-[13px] font-medium text-white">
                  {walletLabel}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-gray-400">
                {short(address)}
              </span>
            </div>

            <div className="space-y-2.5">
              <OptionRow
                tone="primary"
                icon={<CreditCard className="h-5 w-5" />}
                title="Buy SOL"
                subtitle={
                  mainnet
                    ? buying
                      ? "Opening…"
                      : "Card, Apple Pay or Google Pay"
                    : "Available on mainnet"
                }
                badge={mainnet ? undefined : "Mainnet only"}
                onClick={handleBuy}
                disabled={!mainnet || buying}
              />

              <OptionRow
                icon={<ArrowDownToLine className="h-5 w-5" />}
                title="Receive SOL"
                subtitle="Send SOL from another wallet or exchange"
                onClick={() => setView("receive")}
              />

              <OptionRow
                tone="quiet"
                icon={<Wallet className="h-5 w-5" />}
                title="Use another wallet"
                subtitle="Phantom or Solflare"
                onClick={() => {
                  setWalletModalVisible(true);
                  onClose();
                }}
              />
            </div>

            {buyError && (
              <p
                role="status"
                className="mt-3.5 rounded-xl border border-red-500/25 bg-red-500/[0.07] px-3.5 py-2.5 text-[12px] leading-relaxed text-red-300"
              >
                {buyError}
              </p>
            )}
          </>
        ) : (
          /* ---------------- receive ---------------- */
          <>
            <div className="mb-4">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-700 bg-black/40 px-2.5 py-1 text-[11px] font-semibold text-gray-300">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-pump-green" />
                {networkLabel}
              </span>
            </div>

            {qr && (
              <div className="mb-4 flex justify-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qr}
                  alt="QR code containing your wallet address"
                  width={156}
                  height={156}
                  className="h-[156px] w-[156px] rounded-xl border border-gray-800 bg-white p-2"
                />
              </div>
            )}

            <div className="mb-3">
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                Your wallet address
              </div>
              <div className="rounded-xl border border-gray-800 bg-black/40 p-3">
                <code className="block break-all font-mono text-[12px] leading-relaxed text-gray-200">
                  {address}
                </code>
              </div>
            </div>

            <button
              type="button"
              onClick={copy}
              aria-label="Copy wallet address"
              className="mb-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-pump-green text-[15px] font-semibold text-black transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70 focus-visible:ring-offset-2 focus-visible:ring-offset-pump-gray"
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy address
                </>
              )}
            </button>

            {/* The one warning that actually prevents lost money. */}
            <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.07] px-3.5 py-2.5">
              <p className="text-[12px] leading-relaxed text-amber-200/90">
                Only send SOL on Solana to this address.
                {!mainnet && (
                  <>
                    {" "}
                    <span className="font-semibold">
                      Devnet SOL only — test funds have no real value.
                    </span>
                  </>
                )}
              </p>
            </div>

            <a
              href={solanaExplorerAddressUrl(address)}
              target="_blank"
              rel="noreferrer"
              className="mt-3.5 block rounded-lg text-center text-[12px] text-gray-500 transition hover:text-gray-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-pump-green/70"
            >
              View on Solana Explorer
            </a>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}
