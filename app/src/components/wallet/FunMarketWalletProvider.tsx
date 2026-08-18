"use client";

// src/components/wallet/FunMarketWalletProvider.tsx
//
// THE FunMarket Solana wallet. One interface, two implementations
// underneath:
//
//   FUNMARKET SOLANA WALLET
//     ├── Privy embedded wallet      (Google user, no extension)
//     └── external wallet            (Phantom / Solflare via wallet-adapter)
//
// Every Real code path — trade page, FeedTradeSheet, Live, Crypto Daily,
// create, dashboard, admin — asks this hook for a public key and a
// signer. None of them knows which implementation answered, and none of
// them imports Privy.
//
// WHY THE ANCHOR PROGRAM DOES NOT CHANGE
// --------------------------------------
// Both implementations expose the same two things the program has always
// received: a PublicKey, and a function that turns an unsigned
// @solana/web3.js Transaction into a signed one. Privy signs over
// serialized transaction BYTES (Wallet Standard), so the adapter below
// serializes on the way in and re-parses on the way out. The instruction
// data, the account list, the PDAs and the lamport amounts are untouched.
//
// WHICH WALLET IS "THE" REAL WALLET
// ---------------------------------
// In priority order:
//   1. the address the user explicitly picked (persisted in localStorage)
//   2. a connected external wallet — going to the trouble of connecting
//      Phantom IS a choice, and silently trading from an empty embedded
//      wallet instead would be the "switched away from a funded wallet"
//      failure this rule exists to prevent
//   3. the Privy embedded wallet
//   4. nothing — disconnected
//
// A stored preference for an address that is no longer available is
// ignored, not honoured as "disconnected": losing Phantom should fall
// back to the embedded wallet, not strand the user.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePrivy } from "@privy-io/react-auth";
import {
  useWallets as usePrivySolanaWallets,
  useSignTransaction as usePrivySignTransaction,
  useSignMessage as usePrivySignMessage,
} from "@privy-io/react-auth/solana";
import { isPrivyConfigured } from "@/components/privy/PrivyAppProvider";
import { activePrivyChain } from "@/lib/privyChain";

/* -------------------------------------------------------------------------- */
/*  Public shape                                                               */
/* -------------------------------------------------------------------------- */

export type FunMarketWalletSource = "privy" | "external";

export type FunMarketWalletOption = {
  source: FunMarketWalletSource;
  address: string;
  /** Human label for the wallet picker: "Privy wallet", "Phantom", … */
  label: string;
};

/** The exact surface the Real paths used to take from useWallet(). */
export type FunMarketWallet = {
  /** Both underlying systems have finished their initial resolution. */
  ready: boolean;
  source: FunMarketWalletSource | null;
  connected: boolean;
  /**
   * An external wallet handshake is in flight. Always false for the
   * embedded wallet, which is either there or not — there is no
   * extension to wait on.
   */
  connecting: boolean;
  publicKey: PublicKey | null;
  address: string | null;

  /** Undefined when no wallet can sign — callers already guard on this. */
  signTransaction?: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions?: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
  signMessage?: (message: Uint8Array) => Promise<Uint8Array>;

  /** Disconnects the ACTIVE wallet only. Never logs the user out of Privy. */
  disconnect: () => Promise<void>;

  /** Every wallet the user could trade Real from, active one included. */
  options: FunMarketWalletOption[];
  /** Pick one of `options` by address. Persisted. */
  select: (address: string) => void;

  privyAddress: string | null;
  externalAddress: string | null;
  /** True once Privy has an embedded Solana wallet for this user. */
  hasEmbeddedWallet: boolean;
};

const FunMarketWalletContext = createContext<FunMarketWallet | null>(null);

const PREFERENCE_KEY = "fm.realWallet.address";

function readPreference(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PREFERENCE_KEY);
  } catch {
    return null;
  }
}

function writePreference(address: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (address) window.localStorage.setItem(PREFERENCE_KEY, address);
    else window.localStorage.removeItem(PREFERENCE_KEY);
  } catch {
    /* private browsing — the preference is a convenience, not state we need */
  }
}

/* -------------------------------------------------------------------------- */
/*  web3.js <-> Wallet Standard bytes                                          */
/* -------------------------------------------------------------------------- */

/**
 * Serialize an UNSIGNED (or partially signed) transaction for a Wallet
 * Standard signer.
 *
 * `requireAllSignatures: false` is what makes this work at all — the
 * transaction has no signatures yet, which is the entire point. Any
 * partial signature already applied (lib/solanaSend.ts's `beforeSign`
 * hook does this for a couple of flows) is carried inside these bytes and
 * survives the round trip.
 */
function serializeForSigning(tx: Transaction | VersionedTransaction): Uint8Array {
  if (tx instanceof VersionedTransaction) return tx.serialize();
  return new Uint8Array(
    tx.serialize({ requireAllSignatures: false, verifySignatures: false })
  );
}

function parseSigned<T extends Transaction | VersionedTransaction>(
  original: T,
  bytes: Uint8Array
): T {
  if (original instanceof VersionedTransaction) {
    return VersionedTransaction.deserialize(bytes) as T;
  }
  return Transaction.from(Buffer.from(bytes)) as T;
}

/* -------------------------------------------------------------------------- */
/*  Provider                                                                   */
/* -------------------------------------------------------------------------- */

export function FunMarketWalletProvider({ children }: { children: ReactNode }) {
  // isPrivyConfigured() reads a build-time env var, so it is constant for
  // the life of the process. Branching on it picks a component ONCE and
  // never changes the number of hooks either branch runs.
  return isPrivyConfigured() ? (
    <WithPrivy>{children}</WithPrivy>
  ) : (
    <ExternalOnly>{children}</ExternalOnly>
  );
}

/** No Privy app id configured: the app behaves exactly as it did before. */
function ExternalOnly({ children }: { children: ReactNode }) {
  const adapter = useWallet();

  const value = useMemo<FunMarketWallet>(() => {
    const address = adapter.publicKey?.toBase58() ?? null;
    return {
      ready: true,
      source: adapter.connected && address ? "external" : null,
      connected: adapter.connected && !!address,
      connecting: adapter.connecting,
      publicKey: adapter.publicKey ?? null,
      address,
      signTransaction: adapter.signTransaction,
      signAllTransactions: adapter.signAllTransactions,
      signMessage: adapter.signMessage,
      disconnect: async () => {
        await adapter.disconnect();
      },
      options: address
        ? [{ source: "external", address, label: adapter.wallet?.adapter.name ?? "Wallet" }]
        : [],
      select: () => {},
      privyAddress: null,
      externalAddress: address,
      hasEmbeddedWallet: false,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    adapter.publicKey,
    adapter.connected,
    adapter.connecting,
    adapter.signTransaction,
    adapter.signAllTransactions,
    adapter.signMessage,
    adapter.disconnect,
    adapter.wallet,
  ]);

  return (
    <FunMarketWalletContext.Provider value={value}>
      {children}
    </FunMarketWalletContext.Provider>
  );
}

function WithPrivy({ children }: { children: ReactNode }) {
  const adapter = useWallet();
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { ready: walletsReady, wallets: privyWallets } = usePrivySolanaWallets();
  const { signTransaction: privySignTransaction } = usePrivySignTransaction();
  const { signMessage: privySignMessage } = usePrivySignMessage();

  const [preference, setPreference] = useState<string | null>(null);

  // Read the stored preference AFTER mount. Reading localStorage in a
  // useState initializer would return null on the server and a value on
  // the client — a hydration mismatch, the same trap ModeProvider avoids
  // by taking its initial mode as a prop.
  useEffect(() => setPreference(readPreference()), []);

  const externalAddress = adapter.connected
    ? adapter.publicKey?.toBase58() ?? null
    : null;

  /**
   * The address of the user's embedded Solana wallet, per Privy's own
   * user object.
   *
   * Taken from `linkedAccounts` rather than by inspecting the connected
   * wallet list, because that is where Privy states the fact
   * authoritatively: `walletClientType === 'privy'` (or 'privy-v2') on a
   * `chainType === 'solana'` wallet IS the definition of an embedded
   * wallet. Guessing from a wallet's display name would break the day
   * Privy renames it.
   */
  const embeddedAddress = useMemo(() => {
    const accounts = user?.linkedAccounts ?? [];
    for (const account of accounts) {
      if (account.type !== "wallet") continue;
      if (account.chainType !== "solana") continue;
      if (account.walletClientType !== "privy" && account.walletClientType !== "privy-v2") {
        continue;
      }
      return account.address;
    }
    return null;
  }, [user]);

  /**
   * The connected-wallet handle for that address.
   *
   * `useWallets()` from the /solana entrypoint returns every Solana
   * Standard wallet Privy knows about, which can include Phantom when the
   * user connected it through Privy rather than through our wallet-adapter
   * modal. Matching on the embedded address picks out the one Privy
   * custodies.
   */
  const embedded = useMemo(
    () => privyWallets.find((w) => w.address === embeddedAddress) ?? null,
    [privyWallets, embeddedAddress]
  );

  const privyAddress = embedded?.address ?? null;

  /* ---- the wallets the user can choose between ------------------------- */
  const options = useMemo<FunMarketWalletOption[]>(() => {
    const out: FunMarketWalletOption[] = [];
    if (externalAddress) {
      out.push({
        source: "external",
        address: externalAddress,
        label: adapter.wallet?.adapter.name ?? "External wallet",
      });
    }
    if (privyAddress) {
      out.push({ source: "privy", address: privyAddress, label: "Privy wallet" });
    }
    return out;
  }, [externalAddress, privyAddress, adapter.wallet]);

  /* ---- which one is active --------------------------------------------- */
  const active = useMemo<FunMarketWalletOption | null>(() => {
    const chosen = preference ? options.find((o) => o.address === preference) : undefined;
    if (chosen) return chosen;
    // A connected external wallet outranks the embedded one: connecting it
    // was itself a decision, and it is the wallet most likely to hold SOL.
    return (
      options.find((o) => o.source === "external") ??
      options.find((o) => o.source === "privy") ??
      null
    );
  }, [options, preference]);

  const select = useCallback((address: string) => {
    setPreference(address);
    writePreference(address);
  }, []);

  /* ---- signers ---------------------------------------------------------- */

  const chain = useMemo(() => activePrivyChain(), []);

  const signWithPrivy = useCallback(
    async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => {
      if (!embedded) throw new Error("No Privy wallet available");
      const { signedTransaction } = await privySignTransaction({
        transaction: serializeForSigning(tx),
        wallet: embedded,
        chain,
      });
      return parseSigned(tx, signedTransaction);
    },
    [embedded, privySignTransaction, chain]
  );

  const signAllWithPrivy = useCallback(
    async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
      if (!embedded) throw new Error("No Privy wallet available");
      if (txs.length === 0) return [];
      // The variadic overload signs the whole batch behind ONE user
      // approval; looping the single-transaction form would prompt once
      // per transaction.
      const results = await privySignTransaction(
        ...txs.map((tx) => ({
          transaction: serializeForSigning(tx),
          wallet: embedded,
          chain,
        }))
      );
      const list = Array.isArray(results) ? results : [results];
      return txs.map((tx, i) => parseSigned(tx, list[i].signedTransaction));
    },
    [embedded, privySignTransaction, chain]
  );

  const signMessageWithPrivy = useCallback(
    async (message: Uint8Array): Promise<Uint8Array> => {
      if (!embedded) throw new Error("No Privy wallet available");
      const { signature } = await privySignMessage({ message, wallet: embedded });
      return signature;
    },
    [embedded, privySignMessage]
  );

  const disconnect = useCallback(async () => {
    // Disconnects the ACTIVE wallet, nothing more. Logging out of Privy
    // here would take the user's Play session with it — that belongs to
    // an explicit "log out", not to putting one wallet away.
    if (active?.source === "external") await adapter.disconnect();
    // The embedded wallet has no disconnect: it exists as long as the
    // Privy session does.
  }, [active, adapter]);

  const value = useMemo<FunMarketWallet>(() => {
    const isPrivy = active?.source === "privy";
    const isExternal = active?.source === "external";

    return {
      ready: privyReady && walletsReady,
      source: active?.source ?? null,
      connected: !!active,
      // Only the external door can be mid-handshake.
      connecting: isExternal ? adapter.connecting : false,
      publicKey: active ? new PublicKey(active.address) : null,
      address: active?.address ?? null,

      signTransaction: isPrivy
        ? signWithPrivy
        : isExternal
        ? adapter.signTransaction
        : undefined,
      signAllTransactions: isPrivy
        ? signAllWithPrivy
        : isExternal
        ? adapter.signAllTransactions
        : undefined,
      signMessage: isPrivy
        ? signMessageWithPrivy
        : isExternal
        ? adapter.signMessage
        : undefined,

      disconnect,
      options,
      select,
      privyAddress,
      externalAddress,
      hasEmbeddedWallet: !!privyAddress && authenticated,
    };
  }, [
    active,
    privyReady,
    walletsReady,
    adapter.connecting,
    authenticated,
    signWithPrivy,
    signAllWithPrivy,
    signMessageWithPrivy,
    adapter.signTransaction,
    adapter.signAllTransactions,
    adapter.signMessage,
    disconnect,
    options,
    select,
    privyAddress,
    externalAddress,
  ]);

  return (
    <FunMarketWalletContext.Provider value={value}>
      {children}
    </FunMarketWalletContext.Provider>
  );
}

/* -------------------------------------------------------------------------- */
/*  Hook                                                                       */
/* -------------------------------------------------------------------------- */

export function useFunMarketWallet(): FunMarketWallet {
  const ctx = useContext(FunMarketWalletContext);
  if (!ctx) {
    throw new Error(
      "useFunMarketWallet must be used inside <FunMarketWalletProvider>"
    );
  }
  return ctx;
}

/** The minimum Anchor asks of a wallet. Nothing more is ever used. */
export type AnchorCompatibleWallet = {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  signAllTransactions: <T extends Transaction | VersionedTransaction>(txs: T[]) => Promise<T[]>;
};

/**
 * The active wallet in the shape `useAnchorWallet()` used to return.
 *
 * A drop-in for the pages that build their own AnchorProvider against a
 * cluster-specific Connection (contest) or pass `signTx` straight to
 * sendSignedTx (dashboard). Null when nothing can sign — the same null
 * those call sites already handle.
 */
export function useFunMarketAnchorWallet(): AnchorCompatibleWallet | null {
  const { publicKey, signTransaction, signAllTransactions } = useFunMarketWallet();

  return useMemo(() => {
    if (!publicKey || !signTransaction) return null;
    return {
      publicKey,
      signTransaction,
      signAllTransactions:
        signAllTransactions ??
        (async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => {
          const out: T[] = [];
          for (const tx of txs) out.push(await signTransaction(tx));
          return out;
        }),
    };
  }, [publicKey, signTransaction, signAllTransactions]);
}
