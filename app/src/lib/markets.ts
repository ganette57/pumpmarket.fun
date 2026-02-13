// app/src/lib/markets.ts
import { supabase } from "@/lib/supabaseClient";

/* -------------------------------------------------------------------------- */
/*  Types                                                                      */
/* -------------------------------------------------------------------------- */

export type ResolutionStatus = "open" | "proposed" | "finalized" | "cancelled";

export type DbMarket = {
  id?: string;
  created_at?: string;

  market_address: string;
  creator?: string | null;

  question?: string | null;
  description?: string | null;
  category?: string | null;
  image_url?: string | null;

  total_volume?: number | null; // lamports
  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;

  resolved?: boolean | null;

  // on-chain fields (mirrored in DB)
  winning_outcome?: number | null;
  resolved_at?: string | null;
  resolution_proof_url?: string | null;
  resolution_proof_image?: string | null;
  resolution_proof_note?: string | null;

  // off-chain contest flow
  resolution_status?: ResolutionStatus | string | null;
  proposed_winning_outcome?: number | null;
  resolution_proposed_at?: string | null;
  contest_deadline?: string | null;
  contested?: boolean | null;
  contest_count?: number | null;

  proposed_proof_url?: string | null;
  proposed_proof_image?: string | null;
  proposed_proof_note?: string | null;

  // optional
  social_links?: any;
  market_type?: number | null; // 0 binary, 1 multi
  outcome_names?: any;
  outcome_supplies?: any;
  yes_supply?: number | null;
  no_supply?: number | null;
  is_blocked?: boolean | null;
  blocked_reason?: string | null;
  blocked_at?: string | null;
  blocked_by?: string | null;

  // sport market fields
  market_mode?: string | null;
  sport_event_id?: string | null;
  sport_meta?: Record<string, unknown> | null;
  sport_trading_state?: string | null;
};

export type RecordTxInput = {
  market_id?: string | null;
  market_address: string;

  user_address: string;
  tx_signature: string;

  is_buy: boolean;
  is_yes?: boolean | null;

  amount?: number | null; // legacy
  shares?: number | null; // new
  cost?: number | null; // SOL, not lamports (as you already do)

  outcome_index?: number | null;
  outcome_name?: string | null;
};

export type ProposeResolutionInput = {
  market_address: string;
  proposed_winning_outcome: number;
  contest_deadline_iso: string;
  proposed_proof_url?: string | null;
  proposed_proof_image?: string | null;
  proposed_proof_note?: string | null;
};

export type ApplyTradeInput = {
  market_address: string;
  market_type: 0 | 1;
  outcome_index: number;
  delta_shares: number; // + buy, - sell
  delta_volume_lamports: number; // lamports
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function toNumber(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(x: any, fallback = 0) {
  return Math.floor(toNumber(x, fallback));
}

export function toResolutionStatus(x: any): ResolutionStatus {
  const s = String(x || "").toLowerCase().trim();
  if (s === "proposed" || s === "finalized" || s === "cancelled") return s;
  return "open";
}

export function parseSupabaseEndDateToResolutionTime(endDate: any): number {
  if (!endDate) return 0;
  if (endDate instanceof Date) {
    const ms = endDate.getTime();
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
  }

  const raw = String(endDate).trim();
  if (!raw) return 0;

  const normalized = raw.includes(" ") ? raw.replace(" ", "T") : raw;
  const hasTimezone = /(?:Z|[+-]\d{2}:\d{2})$/i.test(normalized);
  const utcSafe = hasTimezone ? normalized : `${normalized}Z`;
  const ms = Date.parse(utcSafe);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

/* -------------------------------------------------------------------------- */
/*  READ                                                                        */
/* -------------------------------------------------------------------------- */

export async function getMarketByAddress(marketAddress: string): Promise<DbMarket | null> {
  const addr = String(marketAddress || "").trim();
  if (!addr) return null;

  // Prefer a “full” select, but keep it resilient if columns differ.
  const trySelects = [
    [
      "id",
      "created_at",
      "market_address",
      "creator",
      "question",
      "description",
      "category",
      "image_url",
      "total_volume",
      "end_date",
      "start_time",
      "end_time",
      "resolved",
      "market_type",
      "outcome_names",
      "outcome_supplies",
      "yes_supply",
      "no_supply",
      "social_links",

      // on-chain mirror
      "winning_outcome",
      "resolved_at",
      "resolution_proof_url",
      "resolution_proof_image",
      "resolution_proof_note",

      // off-chain flow
      "resolution_status",
      "proposed_winning_outcome",
      "resolution_proposed_at",
      "contest_deadline",
      "contested",
      "contest_count",
      "proposed_proof_url",
      "proposed_proof_image",
      "proposed_proof_note",
      "cancelled_at",
      "cancel_reason",
      "is_blocked",
      "blocked_reason",
      "blocked_at",
      "blocked_by",
      "market_mode",
      "sport_event_id",
      "sport_meta",
      "sport_trading_state",
    ].join(","),
    "id,market_address,creator,question,description,category,image_url,total_volume,end_date,resolved,market_type,outcome_names,outcome_supplies,yes_supply,no_supply",
    "id,market_address,creator,question,total_volume,end_date,resolved",
  ];

  for (const sel of trySelects) {
    const { data, error } = await supabase.from("markets").select(sel).eq("market_address", addr).maybeSingle();

    if (!error) return (data as any) || null;

    const msg = String((error as any)?.message || "");
    // if schema mismatch, try next select
    if (!msg.includes("column") && !msg.includes("does not exist")) {
      console.error("getMarketByAddress error:", error);
      return null;
    }
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/*  WRITE (secure via API routes)                                              */
/* -------------------------------------------------------------------------- */

export async function proposeResolution(input: ProposeResolutionInput): Promise<void> {
  const payload = {
    market_address: String(input.market_address || "").trim(),
    proposed_winning_outcome: toInt(input.proposed_winning_outcome, 0),
    contest_deadline_iso: String(input.contest_deadline_iso || "").trim(),
    proposed_proof_url: input.proposed_proof_url ?? null,
    proposed_proof_image: input.proposed_proof_image ?? null,
    proposed_proof_note: input.proposed_proof_note ?? null,
  };

  if (!payload.market_address) throw new Error("market_address is required");
  if (!payload.contest_deadline_iso) throw new Error("contest_deadline_iso is required");

  if (payload.proposed_proof_url && payload.proposed_proof_image) {
    throw new Error("Provide either proposed_proof_url OR proposed_proof_image, not both.");
  }

  const res = await fetch("/api/markets/propose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j?.error || `Propose failed (${res.status})`);
  }
}

/* -------------------------------------------------------------------------- */
/*  Transactions (insert from client is ok if table policy allows)             */
/* -------------------------------------------------------------------------- */

export async function recordTransaction(input: RecordTxInput): Promise<void> {
  const payload: any = {
    market_id: input.market_id ?? null,
    market_address: String(input.market_address || "").trim(),
    user_address: String(input.user_address || "").trim(),
    tx_signature: String(input.tx_signature || "").trim(),

    is_buy: !!input.is_buy,
    is_yes: input.is_yes ?? null,

    amount: input.amount ?? input.shares ?? null,
    shares: input.shares ?? input.amount ?? null,

    cost: input.cost ?? null,

    outcome_index: input.outcome_index ?? null,
    outcome_name: input.outcome_name ?? null,
  };

  if (!payload.market_address) throw new Error("recordTransaction: market_address missing");
  if (!payload.user_address) throw new Error("recordTransaction: user_address missing");
  if (!payload.tx_signature) throw new Error("recordTransaction: tx_signature missing");

  const { error } = await supabase.from("transactions").insert(payload);
  if (error) {
    console.error("recordTransaction error:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Apply trade to market in Supabase                                          */
/*  NOTE: Idéalement -> move server-side (API + service role)                  */
/* -------------------------------------------------------------------------- */

export async function applyTradeToMarketInSupabase(input: ApplyTradeInput): Promise<void> {
  const payload = {
    market_address: String(input.market_address || "").trim(),
    market_type: input.market_type,
    outcome_index: toInt(input.outcome_index, 0),
    delta_shares: toInt(input.delta_shares, 0),
    delta_volume_lamports: toInt(input.delta_volume_lamports, 0),
  };

  if (!payload.market_address) throw new Error("applyTrade: market_address missing");

  /**
   * Option A (best): call API route (secure)
   * - Create /api/markets/apply-trade with service role
   */
  // const res = await fetch("/api/markets/apply-trade", {
  //   method: "POST",
  //   headers: { "Content-Type": "application/json" },
  //   body: JSON.stringify(payload),
  // });
  // if (!res.ok) {
  //   const j = await res.json().catch(() => ({}));
  //   throw new Error(j?.error || `apply-trade failed (${res.status})`);
  // }
  // return;

  /**
   * Option B (temp): do it client-side (less secure)
   * - Requires policies allowing update
   * - Works for dev, but move to API before launch
   */
  const mk = await getMarketByAddress(payload.market_address);
  if (!mk) throw new Error("applyTrade: market not found");

  // Update total volume (lamports)
  const nextTotal = toNumber(mk.total_volume, 0) + payload.delta_volume_lamports;

  // Update supplies depending on market_type
  if (payload.market_type === 0) {
    // binary uses yes_supply/no_supply
    const yes = toNumber(mk.yes_supply, 0);
    const no = toNumber(mk.no_supply, 0);

    const nextYes = payload.outcome_index === 0 ? Math.max(0, yes + payload.delta_shares) : yes;
    const nextNo = payload.outcome_index === 1 ? Math.max(0, no + payload.delta_shares) : no;

    const { error } = await supabase
    .from("markets")
    .update({
      total_volume: nextTotal,
      yes_supply: nextYes,
      no_supply: nextNo,
  
      // 🔥 IMPORTANT: keep outcome_supplies in sync for binary markets
      outcome_supplies: [nextYes, nextNo],
    })
    .eq("market_address", payload.market_address);

    if (error) throw error;
    return;
  }

  // multi-choice uses outcome_supplies array
  const raw = mk.outcome_supplies;
  const arr: number[] = Array.isArray(raw)
    ? raw.map((x: any) => toInt(x, 0))
    : typeof raw === "string"
    ? (() => {
        try {
          const p = JSON.parse(raw);
          return Array.isArray(p) ? p.map((x) => toInt(x, 0)) : [];
        } catch {
          return [];
        }
      })()
    : [];

  while (arr.length <= payload.outcome_index) arr.push(0);
  arr[payload.outcome_index] = Math.max(0, toInt(arr[payload.outcome_index], 0) + payload.delta_shares);

  const { error } = await supabase
    .from("markets")
    .update({
      total_volume: nextTotal,
      outcome_supplies: arr,
    })
    .eq("market_address", payload.market_address);

  if (error) throw error;
}
/* -------------------------------------------------------------------------- */
/*  CREATE / INDEX market (used by /create)                                    */
/* -------------------------------------------------------------------------- */

export type IndexMarketInput = {
  market_address: string;
  creator?: string | null;

  question?: string | null;
  description?: string | null;
  category?: string | null;
  image_url?: string | null;

  end_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  market_type?: number | null; // 0 binary, 1 multi
  outcome_names?: any;
  outcome_supplies?: any;
  yes_supply?: number | null;
  no_supply?: number | null;

  social_links?: any;

  // optional
  total_volume?: number | null; // lamports

  // sport market fields
  market_mode?: string | null;
  sport_event_id?: string | null;
  sport_meta?: Record<string, unknown> | null;
};

export async function indexMarket(input: IndexMarketInput): Promise<void> {
  const market_address = String(input.market_address || "").trim();
  if (!market_address) throw new Error("indexMarket: market_address missing");

  const payload: any = {
    market_address,
    creator: input.creator ?? null,

    question: input.question ?? null,
    description: input.description ?? null,
    category: input.category ?? null,
    image_url: input.image_url ?? null,

    end_date: input.end_date ?? null,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,

    market_type: input.market_type ?? null,
    outcome_names: input.outcome_names ?? null,
    outcome_supplies: input.outcome_supplies ?? null,
    yes_supply: input.yes_supply ?? null,
    no_supply: input.no_supply ?? null,

    social_links: input.social_links ?? null,

    total_volume: input.total_volume ?? 0,

    // defaults safe
    resolved: false,
    resolution_status: "open",
    contested: false,
    contest_count: 0,
  };

  // Sport fields (only included when present)
  if (input.market_mode) payload.market_mode = input.market_mode;
  if (input.sport_event_id) payload.sport_event_id = input.sport_event_id;
  if (input.sport_meta) payload.sport_meta = input.sport_meta;

  // Upsert by market_address (requires unique index on market_address)
  const { error } = await supabase
    .from("markets")
    .upsert(payload, { onConflict: "market_address" });

  if (error) {
    console.error("indexMarket error:", error);
    throw error;
  }
}

/** Optional alias if your UI expects createMarket() */
export const createMarket = indexMarket;
