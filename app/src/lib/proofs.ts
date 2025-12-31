import { supabase } from "@/lib/supabaseClient";

export async function uploadResolutionProofImage(file: File, marketAddress: string) {
  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${marketAddress}/${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
  .from(process.env.NEXT_PUBLIC_SUPABASE_PROOFS_BUCKET || "resolution-proofs")    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file.type || "image/png",
    });

    if (upErr) {
        // typiques: "Bucket not found", "new row violates row-level security", "not allowed"
        throw new Error(`Proof upload failed: ${upErr.message}`);
      }
  const { data } = supabase.storage.from("resolution-proofs").getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Failed to get public URL");
  return data.publicUrl;
}