// src/lib/markets.ts
import { supabase } from "@/utils/supabase";
import type { Market } from "@/types/market";

function asStringArray(v: any): string[] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);

  if (typeof v === "string") {
    // sometimes stored as JSON string in jsonb
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map(String).map((s) => s.trim()).filter(Boolean);
    } catch {
      // ignore
    }
    // allow single string => not a list
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

  // ⚠️ on-chain can return length 10 always => trim to names length
  const trimmed = s.slice(0, safeNames.length);
  while (trimmed.length < safeNames.length) trimmed.push(0);

  return { names: safeNames, supplies: trimmed };
}

// allow-list DB columns ONLY (prevents "schema cache missing column")
const MARKET_COLUMNS = new Set([
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
    if (v === undefined) continue; // IMPORTANT: do not send undefined keys to PostgREST
    out[k] = v;
  }
  return out;
}

/**
 * ✅ Robust indexer:
 * - accepte snake_case + camelCase
 * - multi => refuse fallback YES/NO
 * - trims outcome_supplies to outcome_names length (on-chain often returns 10)
 * - strips unknown columns (fixes "winning_outcome schema cache")
 * - ensures yes_supply/no_supply never null (fixes NOT NULL constraint)
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

      // ✅ multi must have explicit outcomes
      if (market_type === 1 && (!parsedNames || parsedNames.length < 2)) {
        console.error("❌ indexMarket: multi market but missing outcome_names", { rawNames, marketData });
        throw new Error("Missing outcome_names for multi market");
      }

      const fallbackNames = market_type === 0 ? ["YES", "NO"] : null;
      const finalNamesRaw = parsedNames ?? fallbackNames;
      if (!finalNamesRaw) throw new Error("Missing outcome_names");

      const { names: finalNames, supplies: finalSupplies } = clampOutcomeArrays(finalNamesRaw, parsedSupplies);

      const isBinary = market_type === 0 && finalNames.length === 2;

      // ✅ YES/NO legacy columns MUST NOT be null if your DB has NOT NULL
      const yes_supply = isBinary ? (finalSupplies[0] ?? 0) : 0;
      const no_supply = isBinary ? (finalSupplies[1] ?? 0) : 0;

      const payloadCandidate: any = {
        ...marketData,

        // force DB fields
        market_type,
        outcome_names: finalNames,
        outcome_supplies: finalSupplies,

        yes_supply,
        no_supply,
      };

      const payload = pickMarketColumns(payloadCandidate);

      console.log("🧾 Supabase payload check:", {
        market_address: payload.market_address,
        market_type: payload.market_type,
        outcome_names: payload.outcome_names,
        outcome_supplies: payload.outcome_supplies,
        yes_supply: payload.yes_supply,
        no_supply: payload.no_supply,
      });

      // update-or-insert (no onConflict dependency)
      const { data: existing, error: findErr } = await supabase
        .from("markets")
        .select("market_address")
        .eq("market_address", payload.market_address)
        .maybeSingle();

      if (findErr) throw findErr;

      const { error } = existing
        ? await supabase.from("markets").update(payload).eq("market_address", payload.market_address)
        : await supabase.from("markets").insert(payload);

      if (!error) {
        console.log("✅ Market indexed:", payload.market_address);
        return true;
      }

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