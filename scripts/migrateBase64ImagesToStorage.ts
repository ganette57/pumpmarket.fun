import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
dotenv.config({ path: "app/.env.local" }); // ou ".env.local" ou "app/.env.local"


type MarketRow = {
  id: string;
  image_url: string | null;
};

type FailedItem = {
  id: string;
  reason: string;
};

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = "market-images";
const BATCH_SIZE = 500;

function failEnv(message: string): never {
  throw new Error(message);
}

function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) return null;
  return { mime: match[1], base64: match[2] };
}

async function fetchAllBase64Markets(): Promise<MarketRow[]> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    failEnv("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const out: MarketRow[] = [];
  let from = 0;

  while (true) {
    const to = from + BATCH_SIZE - 1;
    const { data, error } = await supabase
      .from("markets")
      .select("id,image_url")
      .like("image_url", "data:image/%")
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Fetch failed at range ${from}-${to}: ${error.message}`);
    }

    const rows = (data || []) as MarketRow[];
    out.push(...rows);

    if (rows.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return out;
}

async function run(): Promise<void> {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    failEnv("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const failed: FailedItem[] = [];
  const rows = await fetchAllBase64Markets();
  const total = rows.length;

  if (total === 0) {
    console.log("No base64 market images found.");
    return;
  }

  let migrated = 0;

  for (const row of rows) {
    try {
      const raw = String(row.image_url || "");
      const parsed = parseDataUrl(raw);
      if (!parsed) {
        failed.push({ id: row.id, reason: "Invalid data URL format" });
        continue;
      }

      const buffer = Buffer.from(parsed.base64, "base64");
      if (!buffer.length) {
        failed.push({ id: row.id, reason: "Decoded image buffer is empty" });
        continue;
      }

      const filename = `market-images/${row.id}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(filename, buffer, {
          contentType: parsed.mime,
          upsert: true,
        });

      if (uploadError) {
        failed.push({ id: row.id, reason: `Upload failed: ${uploadError.message}` });
        continue;
      }

      const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(filename);
      const publicUrl = publicData?.publicUrl;
      if (!publicUrl) {
        failed.push({ id: row.id, reason: "Public URL missing" });
        continue;
      }

      const { error: updateError } = await supabase
        .from("markets")
        .update({ image_url: publicUrl })
        .eq("id", row.id);

      if (updateError) {
        failed.push({ id: row.id, reason: `DB update failed: ${updateError.message}` });
        continue;
      }

      migrated += 1;
      console.log(`Migrated ${migrated} / ${total}`);
    } catch (err: any) {
      failed.push({ id: row.id, reason: err?.message || "Unknown error" });
    }
  }

  if (failed.length > 0) {
    const outPath = path.join(process.cwd(), "scripts", "migrateBase64ImagesToStorage.failed.json");
    fs.writeFileSync(outPath, JSON.stringify(failed, null, 2), "utf8");
    console.error(`Done with errors: ${migrated}/${total} migrated. Failed: ${failed.length}`);
    console.error(`Failure details written to ${outPath}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Done: ${migrated}/${total} migrated.`);
}

run()
  .catch((err: any) => {
    console.error("Migration failed:", err?.message || err);
    process.exitCode = 1;
  })
  .finally(() => {
    // Exit cleanly after async tasks flush logs.
    setTimeout(() => process.exit(process.exitCode || 0), 0);
  });
