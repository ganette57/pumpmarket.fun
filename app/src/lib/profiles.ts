// src/lib/profiles.ts
import { supabase } from "@/lib/supabaseClient";

export type Profile = {
  wallet_address: string;
  display_name: string | null;
  avatar_url: string | null;
  bio: string | null;
};

export async function getProfile(
  walletAddress: string
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("wallet_address, display_name, avatar_url, bio")
    .eq("wallet_address", walletAddress)
    .single();
  return data as Profile | null;
}

export async function getProfiles(
  walletAddresses: string[]
): Promise<Profile[]> {
  if (!walletAddresses.length) return [];
  const unique = Array.from(new Set(walletAddresses));
  const { data } = await supabase
    .from("profiles")
    .select("wallet_address, display_name, avatar_url, bio")
    .in("wallet_address", unique);
  return (data as Profile[]) || [];
}

export async function upsertProfile(
  walletAddress: string,
  updates: { display_name?: string | null; avatar_url?: string | null; bio?: string | null }
) {
  const { data, error } = await supabase.from("profiles").upsert({
    wallet_address: walletAddress,
    ...updates,
    updated_at: new Date().toISOString(),
  });
  return { data, error };
}

export async function uploadAvatar(
  walletAddress: string,
  file: File
): Promise<string | null> {
  const ext = file.name.split(".").pop() || "png";
  const path = `${walletAddress}.${ext}`;

  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });

  if (error) {
    console.error("Avatar upload error:", error);
    return null;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("avatars").getPublicUrl(path);

  return publicUrl;
}

// ---------- Follows ----------

export async function getFollowerCount(wallet: string): Promise<number> {
  if (!wallet) return 0;
  const { count, error } = await supabase
    .from("profile_follows")
    .select("follower_wallet", { count: "exact", head: true })
    .eq("following_wallet", wallet);
  if (error) {
    console.error("getFollowerCount error:", error);
    return 0;
  }
  return Number(count || 0);
}

export async function getFollowingCount(wallet: string): Promise<number> {
  if (!wallet) return 0;
  const { count, error } = await supabase
    .from("profile_follows")
    .select("following_wallet", { count: "exact", head: true })
    .eq("follower_wallet", wallet);
  if (error) {
    console.error("getFollowingCount error:", error);
    return 0;
  }
  return Number(count || 0);
}

export async function isFollowing(
  followerWallet: string,
  followingWallet: string,
): Promise<boolean> {
  if (!followerWallet || !followingWallet) return false;
  if (followerWallet === followingWallet) return false;
  const { data, error } = await supabase
    .from("profile_follows")
    .select("follower_wallet")
    .eq("follower_wallet", followerWallet)
    .eq("following_wallet", followingWallet)
    .maybeSingle();
  if (error) {
    console.error("isFollowing error:", error);
    return false;
  }
  return !!data;
}

export async function followProfile(
  followerWallet: string,
  followingWallet: string,
): Promise<void> {
  if (!followerWallet || !followingWallet) return;
  if (followerWallet === followingWallet) return;
  const { error } = await supabase.from("profile_follows").insert({
    follower_wallet: followerWallet,
    following_wallet: followingWallet,
  });
  // Idempotent: ignore duplicate primary key (already following).
  if (error && (error as any).code !== "23505") {
    throw error;
  }
}

export async function unfollowProfile(
  followerWallet: string,
  followingWallet: string,
): Promise<void> {
  if (!followerWallet || !followingWallet) return;
  if (followerWallet === followingWallet) return;
  const { error } = await supabase
    .from("profile_follows")
    .delete()
    .eq("follower_wallet", followerWallet)
    .eq("following_wallet", followingWallet);
  if (error) throw error;
}

export type FollowEdge = {
  wallet_address: string;
  created_at: string | null;
  profile: Profile | null;
};

async function fetchFollowEdges(
  matchColumn: "following_wallet" | "follower_wallet",
  walletColumn: "follower_wallet" | "following_wallet",
  wallet: string,
): Promise<FollowEdge[]> {
  if (!wallet) return [];
  const { data, error } = await supabase
    .from("profile_follows")
    .select(`${walletColumn}, created_at`)
    .eq(matchColumn, wallet)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("fetchFollowEdges error:", error);
    return [];
  }
  const rows = (data || []) as Array<Record<string, any>>;
  const wallets = rows
    .map((r) => String(r[walletColumn] || ""))
    .filter((w) => w.length > 0);
  if (!wallets.length) return [];
  const profiles = await getProfiles(wallets);
  const map = new Map<string, Profile>();
  for (const p of profiles) map.set(p.wallet_address, p);
  return rows.map((r) => {
    const w = String(r[walletColumn] || "");
    return {
      wallet_address: w,
      created_at: (r.created_at as string) ?? null,
      profile: map.get(w) ?? null,
    };
  });
}

/** Wallets that follow `wallet` (i.e. their `following_wallet === wallet`). */
export async function getFollowers(wallet: string): Promise<FollowEdge[]> {
  return fetchFollowEdges("following_wallet", "follower_wallet", wallet);
}

/** Wallets that `wallet` follows (i.e. their `follower_wallet === wallet`). */
export async function getFollowing(wallet: string): Promise<FollowEdge[]> {
  return fetchFollowEdges("follower_wallet", "following_wallet", wallet);
}
