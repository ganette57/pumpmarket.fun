import Link from "next/link";
import { supabase } from "@/lib/supabaseClient";

type Props = {
  searchParams?: { q?: string };
};

export default async function SearchPage({ searchParams }: Props) {
  const q = (searchParams?.q || "").trim();

  // Si pas de query => prompt
  if (!q) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold mb-2">Search</h1>
        <p className="text-gray-400">
          Type something in the search bar (markets, creators, categories).
        </p>
      </div>
    );
  }

  // Query supabase (simple, robuste)
  // - on cherche dans question / category / creator / market_address
  const { data, error } = await supabase
    .from("markets")
    .select("market_address,question,category,image_url,market_type,end_date,total_volume,resolution_status,contested,contest_deadline")
    .or(
      [
        `question.ilike.%${q}%`,
        `category.ilike.%${q}%`,
        `creator.ilike.%${q}%`,
        `market_address.ilike.%${q}%`,
      ].join(",")
    )
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <h1 className="text-xl font-semibold mb-2">Search</h1>
        <p className="text-red-400 text-sm">Error: {error.message}</p>
      </div>
    );
  }

  const rows = data || [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="flex items-baseline justify-between mb-4">
        <h1 className="text-xl font-semibold">Search</h1>
        <div className="text-sm text-gray-400">{rows.length} results</div>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-2xl border border-gray-800 p-6 bg-black/40">
          <div className="text-gray-300 font-medium">No results</div>
          <div className="text-gray-500 text-sm mt-1">
            Try another keyword. Example: “sports”, “elon”, “binary”, “sol”.
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((m) => (
            <Link
              key={m.market_address}
              href={`/trade/${m.market_address}`}
              className="block rounded-2xl border border-gray-800 bg-black/40 hover:bg-black/60 transition p-4"
            >
              <div className="flex gap-3">
                <div className="h-14 w-14 rounded-xl overflow-hidden border border-gray-800 bg-black flex-shrink-0">
                  {m.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={m.image_url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-gray-500 text-xs">
                      No image
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-gray-100 truncate">
                    {m.question || "Untitled market"}
                  </div>

                  <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-2">
                    {m.category && (
                      <span className="px-2 py-1 rounded-full border border-gray-800">{m.category}</span>
                    )}
                    <span className="px-2 py-1 rounded-full border border-gray-800">
                      {m.market_type === 1 ? "Multi-choice" : "Binary"}
                    </span>
                    {m.resolution_status === "proposed" && (
                      <span className="px-2 py-1 rounded-full border border-[#61ff9a] text-[#61ff9a]">
                        Proposed
                      </span>
                    )}
                    {m.contested && (
                      <span className="px-2 py-1 rounded-full border border-red-400 text-red-300">
                        Contested
                      </span>
                    )}
                  </div>

                  <div className="text-xs text-gray-500 mt-2 truncate">
                    {m.market_address}
                  </div>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}