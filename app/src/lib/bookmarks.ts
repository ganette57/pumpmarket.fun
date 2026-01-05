import { supabase } from "@/lib/supabaseClient";

export async function getBookmarkId(params: { userAddress: string; marketId: string }) {
  const { userAddress, marketId } = params;

  const { data, error } = await supabase
    .from("bookmarks")
    .select("id")
    .eq("user_address", userAddress)
    .eq("market_id", marketId)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

export async function addBookmark(params: { userAddress: string; marketId: string }) {
  const { userAddress, marketId } = params;

  const { data, error } = await supabase
    .from("bookmarks")
    .insert({ user_address: userAddress, market_id: marketId })
    .select("id")
    .single();

  if (error) throw error;
  return data.id as string;
}

export async function removeBookmark(bookmarkId: string) {
  const { error } = await supabase.from("bookmarks").delete().eq("id", bookmarkId);
  if (error) throw error;
}