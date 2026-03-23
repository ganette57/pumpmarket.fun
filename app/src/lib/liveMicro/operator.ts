import "server-only";

import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction } from "@solana/web3.js";
import idl from "@/idl/funmarket_pump.json";
import { assertLiveMicroGuards, getLiveMicroFlags, type SolanaCluster } from "@/lib/liveMicro/config";

const FLASH_OPERATOR_MAINNET_PROGRAM_ID = "DADaDENa6gPZjy92BjctBDKGqNBHhqPokpr5uY2UY3uJ";
const TOKEN_PROGRAM_ID_BASE58 = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const ASSOCIATED_TOKEN_PROGRAM_ID_BASE58 = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

function env(name: string): string {
  return String(process.env[name] || "").trim();
}

function requireEnv(name: string): string {
  const v = env(name);
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function decodeBs58(input: string): Uint8Array {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("bs58");
  const bs58 = mod?.decode ? mod : mod?.default;
  if (!bs58?.decode) throw new Error("bs58 decode not available");
  return bs58.decode(input.trim());
}

function parseSecretKey(raw: string): Uint8Array {
  const v = raw.trim();
  if (!v) throw new Error("Empty operator private key");

  if (v.startsWith("[")) {
    const arr = JSON.parse(v) as number[];
    if (!Array.isArray(arr)) throw new Error("Operator private key JSON must be an array");
    return Uint8Array.from(arr);
  }

  if (v.includes(",")) {
    const arr = v
      .split(",")
      .map((x) => Number(x.trim()))
      .filter((x) => Number.isFinite(x));
    return Uint8Array.from(arr);
  }

  return decodeBs58(v);
}

function rpcForCluster(cluster: SolanaCluster): string {
  const direct = env("LIVE_MICRO_RPC_URL") || env("SOLANA_RPC");
  if (direct) return direct;

  if (cluster === "devnet") {
    return env("NEXT_PUBLIC_RPC_DEVNET") || env("NEXT_PUBLIC_SOLANA_RPC") || env("NEXT_PUBLIC_SOLANA_RPC_URL") || "https://api.devnet.solana.com";
  }
  if (cluster === "testnet") {
    return env("NEXT_PUBLIC_RPC_TESTNET") || "https://api.testnet.solana.com";
  }
  return env("NEXT_PUBLIC_RPC_MAINNET") || "https://api.mainnet-beta.solana.com";
}

function inferClusterFromRpcEndpoint(endpoint: string): SolanaCluster {
  const e = String(endpoint || "").toLowerCase();
  if (!e) return "unknown";
  if (e.includes("devnet")) return "devnet";
  if (e.includes("testnet")) return "testnet";
  if (e.includes("mainnet")) return "mainnet-beta";
  return "unknown";
}

function programIdForCluster(cluster: SolanaCluster): { programId: PublicKey; source: string } {
  if (cluster === "mainnet-beta" && process.env.NODE_ENV === "production") {
    return {
      programId: new PublicKey(FLASH_OPERATOR_MAINNET_PROGRAM_ID),
      source: "hardcoded:production-mainnet",
    };
  }

  const [byCluster, byClusterSource] =
    cluster === "devnet"
      ? [env("NEXT_PUBLIC_PROGRAM_ID_DEVNET"), "env:NEXT_PUBLIC_PROGRAM_ID_DEVNET"]
      : cluster === "mainnet-beta"
      ? [env("NEXT_PUBLIC_PROGRAM_ID_MAINNET"), "env:NEXT_PUBLIC_PROGRAM_ID_MAINNET"]
      : [env("NEXT_PUBLIC_PROGRAM_ID_TESTNET"), "env:NEXT_PUBLIC_PROGRAM_ID_TESTNET"];
  const fallback = env("NEXT_PUBLIC_PROGRAM_ID");
  const selected = byCluster || fallback;
  if (!selected) throw new Error(`Missing program id for cluster=${cluster}`);
  return {
    programId: new PublicKey(selected),
    source: byCluster ? byClusterSource : "env:NEXT_PUBLIC_PROGRAM_ID",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function confirmByPolling(connection: Connection, signature: string, timeoutMs = 90_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const statuses = await connection.getSignatureStatuses([signature], { searchTransactionHistory: true });
    const status = statuses.value[0];

    if (status?.err) throw new Error(`Tx failed: ${JSON.stringify(status.err)}`);
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") return;

    await sleep(1_000);
  }
  throw new Error(`Timeout while confirming tx ${signature}`);
}

export function getLiveMicroOperatorKeypair(): Keypair {
  assertLiveMicroGuards({ requireOperator: true });
  const raw = requireEnv("LIVE_MICRO_OPERATOR_PRIVATE_KEY");
  const decoded = parseSecretKey(raw);
  if (decoded.length !== 64) {
    throw new Error(`LIVE_MICRO_OPERATOR_PRIVATE_KEY must decode to 64 bytes, got ${decoded.length}`);
  }
  return Keypair.fromSecretKey(decoded);
}

export function getLiveMicroProgram() {
  const flags = assertLiveMicroGuards({ requireOperator: true });

  const operator = getLiveMicroOperatorKeypair();
  const rpc = rpcForCluster(flags.currentCluster);
  const rpcCluster = inferClusterFromRpcEndpoint(rpc);
  const resolvedCluster = rpcCluster !== "unknown" ? rpcCluster : flags.currentCluster;
  const { programId, source: programIdSource } = programIdForCluster(resolvedCluster);

  console.log("[flash-operator] cluster resolved", {
    currentCluster: flags.currentCluster,
    rpcCluster,
    resolvedCluster,
    allowedCluster: flags.allowedCluster,
  });
  console.log("[flash-operator] rpc resolved", rpc);
  console.log("[flash-operator] program id resolved", {
    programId: programId.toBase58(),
    source: programIdSource,
  });
  console.log("[flash-operator] operator pubkey", operator.publicKey.toBase58());

  const connection = new Connection(rpc, { commitment: "confirmed" });

  const wallet = {
    publicKey: operator.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(operator);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      txs.forEach((tx) => tx.partialSign(operator));
      return txs;
    },
  } as any;

  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });

  const idlAny: any = { ...(idl as any) };
  if (!idlAny.address) idlAny.address = programId.toBase58();

  const ProgramAny: any = Program;
  const program =
    ProgramAny.length >= 3
      ? new ProgramAny(idlAny as Idl, programId, provider)
      : new ProgramAny(idlAny as Idl, provider);

  return { flags, operator, connection, program, programId };
}

function parseStatus(statusObj: unknown): "open" | "proposed" | "finalized" | "cancelled" | "unknown" {
  if (!statusObj) return "unknown";
  if (typeof statusObj === "string") {
    const s = statusObj.toLowerCase();
    if (s === "open" || s === "proposed" || s === "finalized" || s === "cancelled") return s;
    return "unknown";
  }
  if (typeof statusObj === "object" && statusObj !== null) {
    const k = Object.keys(statusObj as Record<string, unknown>)[0]?.toLowerCase();
    if (k === "open" || k === "proposed" || k === "finalized" || k === "cancelled") return k;
  }
  return "unknown";
}

function bnToNum(x: unknown): number {
  if (x == null) return 0;
  if (typeof x === "number") return Math.floor(x);
  if (typeof x === "bigint") return Number(x);

  const obj = x as { toNumber?: () => number; toString?: () => string };
  if (typeof obj.toNumber === "function") return Math.floor(obj.toNumber());
  if (typeof obj.toString === "function") {
    const n = Number(obj.toString());
    return Number.isFinite(n) ? Math.floor(n) : 0;
  }

  const n = Number(x);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

export type OnchainProposalResult = {
  txSig: string | null;
  proposedOutcome: number;
  contestDeadlineIso: string;
  proposedAtIso: string;
};

export type CreateMarketResult = {
  marketAddress: string;
  txSig: string;
};

function getMethodBuilder<T extends keyof any>(methods: any, camel: string, snake: string) {
  const fn = methods?.[camel] || methods?.[snake];
  if (typeof fn !== "function") {
    throw new Error(`Program method not found: ${camel}/${snake}`);
  }
  return fn;
}

function logInstructionDebug(tx: Transaction) {
  tx.instructions.forEach((ix, idx) => {
    console.log(`[flash-create] instruction[${idx}].programId = ${ix.programId.toBase58()}`);
    ix.keys.forEach((k, keyIdx) => {
      console.log(
        `[flash-create] instruction[${idx}].account[${keyIdx}] = ${k.pubkey.toBase58()} signer=${k.isSigner} writable=${k.isWritable}`,
      );
    });
  });
}

export async function createBinaryMarketOnchain(params: {
  resolutionTimeSec: number;
  outcomes?: string[];
}): Promise<CreateMarketResult> {
  const { operator, connection, program } = getLiveMicroProgram();
  const programPubkey = ((program as any)?.programId as PublicKey | undefined)?.toBase58?.() || "unknown";

  const outcomes = params.outcomes && params.outcomes.length ? params.outcomes : ["YES", "NO"];

  const DEFAULT_B_LAMPORTS = Math.floor((Number(env("LIVE_MICRO_B_SOL") || "0.01") || 0.01) * 1_000_000_000);
  const DEFAULT_MAX_POSITION_BPS = Math.max(1, Math.min(10_000, Math.floor(Number(env("LIVE_MICRO_MAX_POSITION_BPS") || "10000") || 10_000)));
  const DEFAULT_MAX_TRADE_SHARES = Math.max(1, Math.floor(Number(env("LIVE_MICRO_MAX_TRADE_SHARES") || "5000000") || 5_000_000));
  const DEFAULT_COOLDOWN_SECONDS = Math.floor(Number(env("LIVE_MICRO_COOLDOWN_SECONDS") || "0") || 0);

  const market = Keypair.generate();
  const createAccounts = {
    market: market.publicKey,
    creator: operator.publicKey,
    systemProgram: SystemProgram.programId,
  };

  console.log("[flash-create] building createBinaryMarketOnchain", {
    resolutionTimeSec: Math.floor(params.resolutionTimeSec),
    outcomes,
  });
  console.log(`[flash-create] account.program = ${programPubkey}`);
  console.log(`[flash-create] account.systemProgram = ${createAccounts.systemProgram.toBase58()}`);
  console.log(`[flash-create] account.tokenProgram = ${TOKEN_PROGRAM_ID_BASE58}`);
  console.log(`[flash-create] account.associatedTokenProgram = ${ASSOCIATED_TOKEN_PROGRAM_ID_BASE58}`);
  console.log(`[flash-create] account.rent = ${SYSVAR_RENT_PUBKEY.toBase58()}`);
  console.log(`[flash-create] account.market = ${createAccounts.market.toBase58()}`);
  console.log(`[flash-create] account.creator = ${createAccounts.creator.toBase58()}`);

  const createMethod = getMethodBuilder(program.methods, "createMarket", "create_market");
  const tx = await createMethod(
    new BN(Math.floor(params.resolutionTimeSec)),
    outcomes,
    0,
    new BN(DEFAULT_B_LAMPORTS),
    DEFAULT_MAX_POSITION_BPS,
    new BN(DEFAULT_MAX_TRADE_SHARES),
    new BN(DEFAULT_COOLDOWN_SECONDS),
  )
    .accounts(createAccounts)
    .transaction();

  logInstructionDebug(tx);

  tx.feePayer = operator.publicKey;
  const { blockhash } = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.sign(operator, market);

  const raw = tx.serialize();
  let txSig = "";
  try {
    txSig = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
  } catch (sendErr: any) {
    const errMsg = String(sendErr?.message || sendErr || "unknown send error");
    console.error(`[flash-create] send tx failed = ${errMsg}`);
    logInstructionDebug(tx);
    console.error("[flash-create] critical accounts", {
      program: programPubkey,
      market: createAccounts.market.toBase58(),
      creator: createAccounts.creator.toBase58(),
      systemProgram: createAccounts.systemProgram.toBase58(),
      tokenProgram: TOKEN_PROGRAM_ID_BASE58,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID_BASE58,
      rent: SYSVAR_RENT_PUBKEY.toBase58(),
    });

    let simulationLogs: string[] | null = null;
    if (typeof sendErr?.getLogs === "function") {
      try {
        simulationLogs = await sendErr.getLogs(connection);
      } catch (logErr: any) {
        console.error(`[flash-create] getLogs() failed = ${String(logErr?.message || logErr)}`);
      }
    }
    if (!simulationLogs && Array.isArray(sendErr?.logs)) {
      simulationLogs = sendErr.logs.map((x: unknown) => String(x));
    }
    console.error("[flash-create] simulation logs =", simulationLogs || []);
    throw sendErr;
  }
  await confirmByPolling(connection, txSig);

  return {
    marketAddress: market.publicKey.toBase58(),
    txSig,
  };
}

export async function proposeResolutionOnchain(params: {
  marketAddress: string;
  outcomeIndex: 0 | 1;
}): Promise<OnchainProposalResult> {
  const { operator, connection, program } = getLiveMicroProgram();
  const marketPk = new PublicKey(params.marketAddress);

  const before: any = await (program as any).account.market.fetch(marketPk);
  const status = parseStatus(before?.status ?? before?.marketStatus ?? before?.market_status);

  if (before?.resolved || status === "finalized") {
    throw new Error("Cannot propose: market already finalized/resolved on-chain");
  }
  if (before?.cancelled || status === "cancelled") {
    throw new Error("Cannot propose: market cancelled on-chain");
  }

  let txSig: string | null = null;

  if (status === "open") {
    const proposeMethod = getMethodBuilder((program as any).methods, "proposeResolution", "propose_resolution");
    const tx = await proposeMethod(params.outcomeIndex)
      .accounts({
        market: marketPk,
        creator: operator.publicKey,
      })
      .transaction();

    tx.feePayer = operator.publicKey;
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.sign(operator);

    const raw = tx.serialize();
    txSig = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 3,
    });
    await confirmByPolling(connection, txSig);
  } else if (status !== "proposed") {
    throw new Error(`Cannot propose: invalid on-chain status=${status}`);
  }

  const after: any = await (program as any).account.market.fetch(marketPk);
  const proposedOutcome = bnToNum(after?.proposedOutcome ?? after?.proposed_outcome);
  const contestDeadlineSec = bnToNum(after?.contestDeadline ?? after?.contest_deadline);
  const proposedAtSec = bnToNum(after?.proposedAt ?? after?.proposed_at);

  return {
    txSig,
    proposedOutcome,
    contestDeadlineIso:
      contestDeadlineSec > 0
        ? new Date(contestDeadlineSec * 1000).toISOString()
        : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    proposedAtIso: proposedAtSec > 0 ? new Date(proposedAtSec * 1000).toISOString() : new Date().toISOString(),
  };
}

export function getOperatorPublicKeyBase58(): string {
  const flags = getLiveMicroFlags();
  if (!flags.operatorEnabled) return "";
  return getLiveMicroOperatorKeypair().publicKey.toBase58();
}
