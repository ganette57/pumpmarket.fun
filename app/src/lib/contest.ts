// app/src/lib/contest.ts
import { supabase } from "@/lib/supabaseClient";

export async function contestResolution(
  marketAddress: string,
  payload?: { note?: string; proofUrl?: string; proofImage?: string }
) {
  const { error } = await supabase.rpc("contest_resolution", {
    p_market_address: marketAddress,
    p_note: payload?.note ?? null,
    p_proof_url: payload?.proofUrl ?? null,
    p_proof_image: payload?.proofImage ?? null,
  });
  if (error) throw error;
}