// app/src/lib/markets.ts
import { supabase } from "./supabaseClient";

/* -------------------------------------------------------------------------- */
/*  Types DB                                                                  */
/* -------------------------------------------------------------------------- */

export type DbMarketRow = {
  id: string;
  market_address: string;
  question: string | null;
  description: string | null;
  category: string | null;
  image_url: string | null;
  end_date: string; // timestamp
  creator: string;
  social_links: any | null;
  yes_supply: number | null;
  no_supply: number | null;
  total_volume: number; // lamports (numeric)
  resolved: boolean;
  created_at: string;
  market_type: number | null;
  outcome_names: string[] | null;   // jsonb -> array de strings
  outcome_supplies: number[] | null; // jsonb -> array de numbers
  outcome_count: number | null;
  program_id: string | null;
  cluster: string | null;
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

function cloneNumberArray(x: any): number[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map((v) => toNumber(v, 0));
  return [];
}

function cloneStringArray(x: any): string[] {
  if (!x) return [];
  if (Array.isArray(x)) return x.map((v) => String(v));
  return [];
}

/* -------------------------------------------------------------------------- */
/*  Market loading                                                            */
/* -------------------------------------------------------------------------- */

export async function getMarketByAddress(
  marketAddress: string
): Promise<DbMarketRow | null> {
  const { data, error } = await supabase
    .from("markets")
    .select(
      [
        "id",
        "market_address",
        "question",
        "description",
        "category",
        "image_url",
        "end_date",
        "creator",
        "social_links",
        "yes_supply",
        "no_supply",
        "total_volume",
        "resolved",
        "created_at",
        "market_type",
        "outcome_names",
        "outcome_supplies",
        "outcome_count",
        "program_id",
        "cluster",
      ].join(",")
    )
    .eq("market_address", marketAddress)
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("getMarketByAddress error:", error);
    return null;
  }

  if (!data) return null;

  const m = data as any;

  return {
    id: String(m.id),
    market_address: String(m.market_address),
    question: m.question ?? null,
    description: m.description ?? null,
    category: m.category ?? null,
    image_url: m.image_url ?? null,
    end_date: m.end_date,
    creator: String(m.creator),
    social_links: m.social_links ?? null,
    yes_supply: toNumber(m.yes_supply, 0),
    no_supply: toNumber(m.no_supply, 0),
    total_volume: toNumber(m.total_volume, 0),
    resolved: !!m.resolved,
    created_at: m.created_at,
    market_type: typeof m.market_type === "number" ? m.market_type : 0,
    outcome_names: cloneStringArray(m.outcome_names),
    outcome_supplies: cloneNumberArray(m.outcome_supplies),
    outcome_count:
      typeof m.outcome_count === "number" ? m.outcome_count : null,
    program_id: m.program_id ?? null,
    cluster: m.cluster ?? null,
  };
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

  // pour binary seulement; pour multi-choice, on mettra null
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
    is_yes: input.is_yes ?? false, // la colonne est NOT NULL, donc false si multi-choice
    amount: input.amount,
    cost: input.cost,
    outcome_index:
      input.outcome_index !== undefined ? input.outcome_index : null,
    outcome_name: input.outcome_name ?? null,
    shares:
      input.shares !== undefined && input.shares !== null
        ? input.shares
        : input.amount,
  };

  const { error } = await supabase.from("transactions").insert(row);

  if (error) {
    console.error("recordTransaction error:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Mise à jour des markets après un trade                                    */
/* -------------------------------------------------------------------------- */

export type ApplyTradeArgs = {
  market_address: string;
  market_type: number; // 0 = binary, 1 = multi-choice

  outcome_index: number;
  delta_shares: number; // +shares si buy, -shares si sell (en unités de shares)
  delta_volume_lamports: number; // volume ajouté (en lamports, toujours positif)
};

/**
 * Met à jour les champs agrégés dans la table `markets` :
 * - outcome_supplies (pour multi-choice)
 * - yes_supply / no_supply (pour binary, ou fallback quand seulement 2 outcomes)
 * - total_volume
 */
export async function applyTradeToMarketInSupabase(
  args: ApplyTradeArgs
): Promise<void> {
  const { market_address, market_type, outcome_index } = args;
  const deltaShares = toNumber(args.delta_shares, 0);
  const deltaVolumeLamports = toNumber(args.delta_volume_lamports, 0);

  if (!market_address) return;

  // 1) récupérer le market actuel
  const market = await getMarketByAddress(market_address);
  if (!market) {
    console.warn(
      "applyTradeToMarketInSupabase: market not found for",
      market_address
    );
    return;
  }

  const mt = typeof market_type === "number" ? market_type : 0;

  let outcomeSupplies = cloneNumberArray(market.outcome_supplies);
  const outcomeNames = cloneStringArray(market.outcome_names);
  const outcomeCount =
    typeof market.outcome_count === "number"
      ? market.outcome_count
      : outcomeNames.length || outcomeSupplies.length || 0;

  const idx = Math.max(0, Math.min(outcome_index, Math.max(0, outcomeCount - 1)));

  // garantir la taille du tableau outcomeSupplies
  const finalLen = Math.max(
    outcomeSupplies.length,
    outcomeNames.length,
    outcomeCount,
    idx + 1
  );
  if (!outcomeSupplies.length && finalLen > 0) {
    outcomeSupplies = Array(finalLen).fill(0);
  } else if (outcomeSupplies.length < finalLen) {
    outcomeSupplies = [
      ...outcomeSupplies,
      ...Array(finalLen - outcomeSupplies.length).fill(0),
    ];
  }

  // 2) appliquer le delta sur le bon outcome
  if (finalLen > 0) {
    const current = toNumber(outcomeSupplies[idx], 0);
    const next = Math.max(0, current + deltaShares);
    outcomeSupplies[idx] = next;
  }

  // 3) mettre à jour yes/no pour les marchés binaires (ou fallback quand seulement 2 outcomes)
  let yesSupply = toNumber(market.yes_supply, 0);
  let noSupply = toNumber(market.no_supply, 0);

  const isBinary =
    mt === 0 ||
    (outcomeNames.length === 2 && outcomeSupplies.length === 2);

  if (isBinary && outcomeSupplies.length >= 2) {
    yesSupply = toNumber(outcomeSupplies[0], 0);
    noSupply = toNumber(outcomeSupplies[1], 0);
  }

  // 4) volume total
  const totalVolume =
    toNumber(market.total_volume, 0) + Math.max(0, deltaVolumeLamports);

  // 5) update Supabase
  const updatePayload: Partial<DbMarketRow> = {
    outcome_supplies: outcomeSupplies,
    yes_supply: yesSupply,
    no_supply: noSupply,
    total_volume: totalVolume,
  };

  // garder outcome_count cohérent si besoin
  if (!market.outcome_count && finalLen > 0) {
    (updatePayload as any).outcome_count = finalLen;
  }

  const { error } = await supabase
    .from("markets")
    .update(updatePayload as any)
    .eq("market_address", market_address);

  if (error) {
    console.error("applyTradeToMarketInSupabase error:", error);
    throw error;
  }
}

/* -------------------------------------------------------------------------- */
/*  Indexation / insertion lors de la création                                */
/* -------------------------------------------------------------------------- */

export type IndexMarketInput = Partial<DbMarketRow> & {
  // on accepte aussi des noms alternatifs envoyés par /create
  marketAddress?: string;
  imageUrl?: string;
  endDate?: string;
  creatorAddress?: string;
  outcomes?: string[];
};

/**
 * indexMarket
 *
 * Appelée après la création d'un market.
 * Ici on s'assure qu'une row existe dans la table `markets`.
 */
export async function indexMarket(
  market: IndexMarketInput | null | undefined
): Promise<void> {
  if (!market) return;

  // on récupère l'address quelle que soit la clé utilisée
  const addr =
    market.market_address ||
    market.marketAddress ||
    (market as any).address;

  if (!addr) {
    console.warn("indexMarket: missing market_address", market);
    return;
  }

  const nowIso = new Date().toISOString();

  const creator =
    market.creator ||
    market.creatorAddress ||
    (market as any).wallet ||
    "";

  const outcomeNames =
    market.outcome_names ||
    market.outcomes ||
    (Array.isArray((market as any).outcomes)
      ? (market as any).outcomes.map(String)
      : null);

  const payload = {
    market_address: addr,
    question: market.question ?? null,
    description: market.description ?? null,
    category: market.category ?? null,
    image_url: market.image_url ?? market.imageUrl ?? null,
    end_date: market.end_date ?? market.endDate ?? nowIso,
    creator,
    social_links: market.social_links ?? (market as any).socialLinks ?? null,
    yes_supply: toNumber((market as any).yes_supply ?? 0, 0),
    no_supply: toNumber((market as any).no_supply ?? 0, 0),
    total_volume: toNumber((market as any).total_volume ?? 0, 0),
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
    outcome_count:
      market.outcome_count ??
      (outcomeNames ? outcomeNames.length : null),
    program_id: market.program_id ?? (market as any).programId ?? null,
    cluster: market.cluster ?? (market as any).cluster ?? null,
  };

  const { error } = await supabase.from("markets").insert(payload as any);

  if (error) {
    console.error("indexMarket insert error:", error);
    throw error;
  }
}