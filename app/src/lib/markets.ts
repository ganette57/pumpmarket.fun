import { supabase } from "@/utils/supabase";
import type { Market } from "@/types/market";

function asStringArray(v: any): string[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);

  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {
      // ignore
    }
    return null;
  }
  return null;
}

function asNumberArray(v: any): number[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map((x) => Number(x) || 0);

  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => Number(x) || 0);
    } catch {
      // ignore
    }
    return null;
  }
  return null;
}

function clampOutcomeArrays(names: string[], supplies: number[] | null): { names: string[]; supplies: number[] } {
  const safeNames = names.slice(0, 10);
  const s = (supplies ?? []).map((x) => Number(x) || 0);

  const trimmed = s.slice(0, safeNames.length);
  while (trimmed.length < safeNames.length) trimmed.push(0);

  return { names: safeNames, supplies: trimmed };
}

// allow-list DB columns ONLY
const MARKET_COLUMNS = new Set([
  "id",
  "market_address",
  "creator",
  "question",
  "description",
  "category",
  "end_date",
  "image_url",
  "market_type",
  "outcome_names",
  "outcome_supplies",
  "yes_supply",
  "no_supply",
  "total_volume",
  "resolved",
  "social_links",
]);

function pickMarketColumns(input: Record<string, any>) {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(input)) {
    if (!MARKET_COLUMNS.has(k)) continue;
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * ✅ Index market in Supabase (unchanged logic)
 */
export async function indexMarket(
  marketData: Omit<Market, "id" | "created_at" | "updated_at"> | any
): Promise<boolean> {
  for (let i = 0; i < 3; i++) {
    try {
      const mtRaw = marketData.market_type ?? marketData.marketType ?? 0;
      const market_type = (Number(mtRaw) || 0) as 0 | 1;

      const rawNames = marketData.outcome_names ?? marketData.outcomeNames;
      const rawSupplies = marketData.outcome_supplies ?? marketData.outcomeSupplies;

      const parsedNames = asStringArray(rawNames);
      const parsedSupplies = asNumberArray(rawSupplies);

      if (market_type === 1 && (!parsedNames || parsedNames.length < 2)) {
        console.error("❌ indexMarket: multi market but missing outcome_names", { rawNames, marketData });
        throw new Error("Missing outcome_names for multi market");
      }

      const fallbackNames = market_type === 0 ? ["YES", "NO"] : null;
      const finalNamesRaw = parsedNames ?? fallbackNames;
      if (!finalNamesRaw) throw new Error("Missing outcome_names");

      const { names: finalNames, supplies: finalSupplies } = clampOutcomeArrays(finalNamesRaw, parsedSupplies);

      const isBinaryStyle = finalNames.length === 2;

      const yes_supply = isBinaryStyle ? (finalSupplies[0] ?? 0) : 0;
      const no_supply = isBinaryStyle ? (finalSupplies[1] ?? 0) : 0;

      const payloadCandidate: any = {
        ...marketData,
        market_type,
        outcome_names: finalNames,
        outcome_supplies: finalSupplies,
        yes_supply,
        no_supply,
      };

      const payload = pickMarketColumns(payloadCandidate);

      const { data: existing, error: findErr } = await supabase
        .from("markets")
        .select("market_address")
        .eq("market_address", payload.market_address)
        .maybeSingle();

      if (findErr) throw findErr;

      const { error } = existing
        ? await supabase.from("markets").update(payload).eq("market_address", payload.market_address)
        : await supabase.from("markets").insert(payload);

      if (!error) return true;

      console.warn(`⚠️ indexMarket retry ${i + 1}/3:`, error.message);
      await new Promise((r) => setTimeout(r, 800));
    } catch (err) {
      console.error(`❌ indexMarket exception retry ${i + 1}/3:`, err);
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  console.error("❌ FAILED to index market in Supabase after retries");
  return false;
}

/**
 * ✅ Transactions
 * IMPORTANT: your transactions.market_id is UUID => we store markets.id here.
 */
type TxInsert = {
  market_id: string; // UUID (markets.id)
  user_address: string;
  tx_signature: string;
  is_buy: boolean;
  is_yes: boolean; // for 2-outcome markets: outcomeIndex 0 => true, 1 => false
  amount: number;
  cost: number; // SOL numeric (estimate)
};

export async function recordTransaction(tx: TxInsert): Promise<boolean> {
  try {
    const payload = {
      market_id: tx.market_id,
      user_address: tx.user_address,
      tx_signature: tx.tx_signature,
      is_buy: !!tx.is_buy,
      is_yes: !!tx.is_yes,
      amount: Number(tx.amount || 0),
      cost: Number(tx.cost || 0),
    };

    const { error } = await supabase.from("transactions").insert(payload);

    if (error) {
      console.warn("⚠️ recordTransaction insert error:", error.message);
      return false;
    }

    return true;
  } catch (e) {
    console.error("❌ recordTransaction exception:", e);
    return false;
  }
}

export async function getTransactionsByUser(userAddress: string) {
  const { data, error } = await supabase
    .from("transactions")
    .select("*")
    .eq("user_address", userAddress)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("❌ getTransactionsByUser error:", error.message);
    return [];
  }
  return data || [];
}

/**
 * ✅ Apply trade to markets table:
 * - updates outcome_supplies if present
 * - updates yes_supply/no_supply if 2 outcomes
 * - updates total_volume (lamports)
 */
export async function applyTradeToMarketInSupabase(args: {
  market_address: string;
  market_type: 0 | 1;
  outcome_index: number;
  delta_shares: number; // +buy, -sell
  delta_volume_lamports: number; // always +abs(volume)
}): Promise<boolean> {
  try {
    const { data: m, error: e1 } = await supabase
      .from("markets")
      .select("market_address, market_type, outcome_names, outcome_supplies, yes_supply, no_supply, total_volume")
      .eq("market_address", args.market_address)
      .maybeSingle();

    if (e1) {
      console.error("❌ applyTradeToMarketInSupabase select error:", e1.message);
      return false;
    }
    if (!m) return false;

    const names = asStringArray(m.outcome_names) || [];
    const supplies = asNumberArray(m.outcome_supplies) || [];

    const safeNames = names.slice(0, 10);

    // make array length match names if possible
    const nextSupplies = supplies.slice(0, Math.max(2, safeNames.length));
    while (nextSupplies.length < Math.max(2, safeNames.length)) nextSupplies.push(0);

    const i = Math.max(0, Math.min(args.outcome_index, nextSupplies.length - 1));
    nextSupplies[i] = Math.max(0, Number(nextSupplies[i] || 0) + Number(args.delta_shares || 0));

    // If market is effectively 2 outcomes => keep legacy columns updated
    const isBinaryStyle = safeNames.length === 2 || nextSupplies.length === 2;

    const nextYes = isBinaryStyle ? Number(nextSupplies[0] || 0) : Number(m.yes_supply || 0);
    const nextNo = isBinaryStyle ? Number(nextSupplies[1] || 0) : Number(m.no_supply || 0);

    const nextTotalVol = Number(m.total_volume || 0) + Number(args.delta_volume_lamports || 0);

    const updatePayload: any = pickMarketColumns({
      market_address: args.market_address,
      outcome_supplies: nextSupplies.slice(0, 10),
      yes_supply: nextYes,
      no_supply: nextNo,
      total_volume: nextTotalVol,
    });

    const { error: e2 } = await supabase
      .from("markets")
      .update(updatePayload)
      .eq("market_address", args.market_address);

    if (e2) {
      console.error("❌ applyTradeToMarketInSupabase update error:", e2.message);
      return false;
    }

    return true;
  } catch (e) {
    console.error("❌ applyTradeToMarketInSupabase exception:", e);
    return false;
  }
}

export async function getAllMarkets(): Promise<Market[]> {
  try {
    const { data, error } = await supabase.from("markets").select("*").order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Supabase getAllMarkets error:", error.message);
      return [];
    }

    const markets = (data || []).map((m: any) => ({
      ...m,
      outcome_names: asStringArray(m.outcome_names),
      outcome_supplies: asNumberArray(m.outcome_supplies),
    }));

    return markets as Market[];
  } catch (err) {
    console.error("❌ Exception in getAllMarkets:", err);
    return [];
  }
}

export async function getMarketByAddress(marketAddress: string): Promise<Market | null> {
  try {
    const { data, error } = await supabase
      .from("markets")
      .select("*")
      .eq("market_address", marketAddress)
      .maybeSingle();

    if (error) {
      console.error("❌ Supabase getMarketByAddress error:", error.message);
      return null;
    }
    if (!data) return null;

    const market: any = {
      ...data,
      outcome_names: asStringArray(data.outcome_names),
      outcome_supplies: asNumberArray(data.outcome_supplies),
    };

    return market as Market;
  } catch (err) {
    console.error("❌ Exception in getMarketByAddress:", err);
    return null;
  }
}

export async function getMarketsByCreator(creatorAddress: string): Promise<Market[]> {
  try {
    const { data, error } = await supabase
      .from("markets")
      .select("*")
      .eq("creator", creatorAddress)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ Supabase getMarketsByCreator error:", error.message);
      return [];
    }

    const markets = (data || []).map((m: any) => ({
      ...m,
      outcome_names: asStringArray(m.outcome_names),
      outcome_supplies: asNumberArray(m.outcome_supplies),
    }));

    return markets as Market[];
  } catch (err) {
    console.error("❌ Exception in getMarketsByCreator:", err);
    return [];
  }
}

export async function getMarketsByIds(ids: string[]): Promise<Market[]> {
  if (!ids.length) return [];
  try {
    const { data, error } = await supabase.from("markets").select("*").in("id", ids);

    if (error) {
      console.error("❌ getMarketsByIds error:", error.message);
      return [];
    }

    return (data || []).map((m: any) => ({
      ...m,
      outcome_names: asStringArray(m.outcome_names),
      outcome_supplies: asNumberArray(m.outcome_supplies),
    })) as Market[];
  } catch (e) {
    console.error("❌ getMarketsByIds exception:", e);
    return [];
  }
}