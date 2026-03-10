// src/lib/profiles.ts
import { supabase } from "@/lib/supabaseClient";

export type Profile = {
  wallet_address: string;
  display_name: string | null;
  avatar_url: string | null;
};

export async function getProfile(
  walletAddress: string
): Promise<Profile | null> {
  const { data } = await supabase
    .from("profiles")
    .select("wallet_address, display_name, avatar_url")
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
    .select("wallet_address, display_name, avatar_url")
    .in("wallet_address", unique);
  return (data as Profile[]) || [];
}

export async function upsertProfile(
  walletAddress: string,
  updates: { display_name?: string; avatar_url?: string }
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
