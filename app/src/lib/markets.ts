// app/src/lib/markets.ts
import { supabase } from "@/lib/supabaseClient";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type ResolutionStatus = "open" | "proposed" | "finalized" | "cancelled";

export type DbMarketRow = {
  id: string;
  market_address: string;
  question: string | null;
  description: string | null;
  category: string | null;
  image_url: string | null;
  end_date: string; // timestamptz
  creator: string;
  social_links: any | null;

  yes_supply: number | null;
  no_supply: number | null;
  total_volume: number; // lamports numeric

  resolved: boolean;
  created_at: string;

  market_type: number | null;
  outcome_names: string[] | null;
  outcome_supplies: number[] | null;

  // legacy resolved (on-chain)
  winning_outcome?: number | null;
  resolution_proof_url?: string | null;
  resolution_proof_image?: string | null;
  resolution_proof_note?: string | null;
  resolved_at?: string | null;

  // Off-chain contest flow (REAL schema)
  resolution_status?: ResolutionStatus | null;
  proposed_winning_outcome?: number | null;
  resolution_proposed_at?: string | null;
  contest_deadline?: string | null;
  contested?: boolean | null;
  contest_count?: number | null;

  proposed_proof_url?: string | null;
  proposed_proof_image?: string | null;
  proposed_proof_note?: string | null;
};

export type DbTransactionRow = {
  id: string;
  market_id: string;
  user_address: string;
  tx_signature: string;
  is_buy: boolean;
  is_yes: boolean;
  amount: number;
  cost: number;
  created_at: string;

  market_address: string | null;
  outcome_index: number | null;
  outcome_name: string | null;
  shares: number | null;
};

/* -------------------------------------------------------------------------- */
/*  Helpers                                                                   */
/* -------------------------------------------------------------------------- */

function toNumber(value: any, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toResolutionStatus(x: any): ResolutionStatus | "open" {
  const s = String(x || "").toLowerCase().trim();
  if (s === "proposed" || s === "finalized" || s === "cancelled" || s === "open") return s as ResolutionStatus;
  return "open";
}

/* -------------------------------------------------------------------------- */
/*  Market loading                                                            */
/* -------------------------------------------------------------------------- */

export async function getMarketByAddress(marketAddress: string): Promise<DbMarketRow | null> {
  const { data, error } = await supabase
    .from("markets")
    .select(
      `
      id,
      market_address,
      question,
      description,
      category,
      image_url,
      creator,
      social_links,

      market_type,
      outcome_names,
      outcome_supplies,
      yes_supply,
      no_supply,

      total_volume,
      end_date,

      resolved,
      winning_outcome,
      resolved_at,
      resolution_proof_url,
      resolution_proof_image,
      resolution_proof_note,

      resolution_status,
      proposed_winning_outcome,
      resolution_proposed_at,
      contest_deadline,
      contested,
      contest_count,

      proposed_proof_url,
      proposed_proof_image,
      proposed_proof_note
      `
    )
    .eq("market_address", marketAddress)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  // normalize numbers / enums
  const m: any = data;
  const row: DbMarketRow = {
    ...m,
    id: String(m.id),
    market_address: String(m.market_address),
    creator: String(m.creator),

    yes_supply: m.yes_supply == null ? null : toNumber(m.yes_supply, 0),
    no_supply: m.no_supply == null ? null : toNumber(m.no_supply, 0),
    total_volume: toNumber(m.total_volume, 0),

    market_type: typeof m.market_type === "number" ? m.market_type : 0,
    outcome_names: Array.isArray(m.outcome_names) ? m.outcome_names.map(String) : null,
    outcome_supplies: Array.isArray(m.outcome_supplies) ? m.outcome_supplies.map((v: any) => toNumber(v, 0)) : null,

    winning_outcome: m.winning_outcome == null ? null : toNumber(m.winning_outcome, 0),

    resolution_status: toResolutionStatus(m.resolution_status),
    proposed_winning_outcome: m.proposed_winning_outcome == null ? null : toNumber(m.proposed_winning_outcome, 0),
    contest_count: m.contest_count == null ? 0 : toNumber(m.contest_count, 0),
    contested: !!m.contested,
  };

  return row;
}

/* -------------------------------------------------------------------------- */
/*  Resolution (off-chain)                                                    */
/* -------------------------------------------------------------------------- */

export type ProposeResolutionInput = {
  market_address: string;
  proposed_winning_outcome: number;
  contest_deadline_iso: string; // ISO string
  proposed_proof_url?: string | null;
  proposed_proof_image?: string | null;
  proposed_proof_note?: string | null;
};

export async function proposeResolution(input: ProposeResolutionInput): Promise<void> {
  const payload: any = {
    resolution_status: "proposed",
    proposed_winning_outcome: Math.floor(toNumber(input.proposed_winning_outcome, 0)),
    resolution_proposed_at: new Date().toISOString(),
    contest_deadline: input.contest_deadline_iso,

    contested: false,
    contest_count: 0,

    proposed_proof_url: input.proposed_proof_url ?? null,
    proposed_proof_image: input.proposed_proof_image ?? null,
    proposed_proof_note: input.proposed_proof_note ?? null,
  };

  if (payload.proposed_proof_url && payload.proposed_proof_image) {
    throw new Error("Provide either proposed_proof_url OR proposed_proof_image, not both.");
  }

  const { error } = await supabase.from("markets").update(payload).eq("market_address", input.market_address);

  if (error) {
    console.error("proposeResolution error:", error);
    throw error;
  }
}

export type ContestResolutionInput = {
  market_address: string;
  // optional: store a proof/comment via comments table in your /contest page
};

export async function contestResolution(input: ContestResolutionInput): Promise<void> {
  // MVP: just flips flags + increments counter
  // (Better: do it in an RPC to avoid race condition; MVP ok.)
  const { data: current, error: readErr } = await supabase
    .from("markets")
    .select("contest_count, contested, resolution_status")
    .eq("market_address", input.market_address)
    .maybeSingle();

  if (readErr) throw readErr;
  const prevCount = toNumber((current as any)?.contest_count, 0);

  const { error } = await supabase
    .from("markets")
    .update({
      contested: true,
      contest_count: prevCount + 1,
    })
    .eq("market_address", input.market_address);

  if (error) {
    console.error("contestResolution error:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Transactions                                                              */
/* -------------------------------------------------------------------------- */

export type RecordTxInput = {
  market_id?: string | null;
  market_address?: string | null;
  user_address: string;
  tx_signature: string;
  is_buy: boolean;
  is_yes: boolean | null;
  amount: number;
  cost: number;
  outcome_index?: number | null;
  outcome_name?: string | null;
  shares?: number | null;
};

export async function recordTransaction(input: RecordTxInput): Promise<void> {
  const row = {
    market_id: input.market_id ?? null,
    market_address: input.market_address ?? null,
    user_address: input.user_address,
    tx_signature: input.tx_signature,
    is_buy: input.is_buy,
    is_yes: input.is_yes ?? false, // schema NOT NULL
    amount: Math.floor(toNumber(input.amount, 0)),
    cost: toNumber(input.cost, 0),
    outcome_index: input.outcome_index ?? null,
    outcome_name: input.outcome_name ?? null,
    shares: input.shares ?? input.amount,
  };

  const { error } = await supabase.from("transactions").insert(row as any);

  if (error) {
    console.error("recordTransaction error:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Apply trade to market (RPC)                                               */
/* -------------------------------------------------------------------------- */

export type ApplyTradeArgs = {
  market_address: string;
  market_type: number;
  outcome_index: number;
  delta_shares: number;
  delta_volume_lamports: number;
};

export async function applyTradeToMarketInSupabase(args: ApplyTradeArgs): Promise<void> {
  const { error } = await supabase.rpc("apply_trade_to_market", {
    p_market_address: args.market_address,
    p_outcome_index: Math.floor(toNumber(args.outcome_index, 0)),
    p_delta_shares: Math.floor(toNumber(args.delta_shares, 0)),
    p_delta_volume_lamports: Math.floor(toNumber(args.delta_volume_lamports, 0)),
  });

  if (error) {
    console.error("applyTradeToMarketInSupabase rpc error:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Index market                                                              */
/* -------------------------------------------------------------------------- */

export type IndexMarketInput = Partial<DbMarketRow> & {
  marketAddress?: string;
  imageUrl?: string;
  endDate?: string;
  creatorAddress?: string;
  outcomes?: string[];
};

export async function indexMarket(market: IndexMarketInput | null | undefined): Promise<void> {
  if (!market) return;

  const addr = market.market_address || market.marketAddress || (market as any).address;
  if (!addr) {
    console.warn("indexMarket: missing market_address", market);
    return;
  }

  const nowIso = new Date().toISOString();
  const creator = market.creator || market.creatorAddress || (market as any).wallet || "";

  const outcomeNames: string[] | null =
    (market.outcome_names as any) ??
    (market.outcomes ? market.outcomes.map(String) : null) ??
    (Array.isArray((market as any).outcomes) ? (market as any).outcomes.map(String) : null);

  const payload: any = {
    market_address: addr,
    question: market.question ?? null,
    description: market.description ?? null,
    category: market.category ?? null,
    image_url: market.image_url ?? market.imageUrl ?? null,
    end_date: market.end_date ?? market.endDate ?? nowIso,
    creator,
    social_links: market.social_links ?? (market as any).socialLinks ?? null,

    yes_supply: toNumber((market as any).yes_supply ?? market.yes_supply ?? 0, 0),
    no_supply: toNumber((market as any).no_supply ?? market.no_supply ?? 0, 0),
    total_volume: toNumber((market as any).total_volume ?? market.total_volume ?? 0, 0),
    resolved: !!(market as any).resolved,

    created_at: (market as any).created_at ?? nowIso,

    market_type:
      typeof market.market_type === "number"
        ? market.market_type
        : outcomeNames && outcomeNames.length > 2
        ? 1
        : 0,

    outcome_names: outcomeNames,
    outcome_supplies:
      market.outcome_supplies ??
      (Array.isArray((market as any).outcome_supplies)
        ? (market as any).outcome_supplies.map((v: any) => toNumber(v, 0))
        : null),

    outcome_count: market.outcome_count ?? (outcomeNames ? outcomeNames.length : null),
    program_id: market.program_id ?? (market as any).programId ?? null,
    cluster: market.cluster ?? (market as any).cluster ?? null,
  };

  const { error } = await supabase.from("markets").insert(payload as any);

  if (error) {
    console.error("indexMarket insert error:", error);
    throw error;
  }
}