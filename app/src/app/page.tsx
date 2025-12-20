// app/src/app/page.tsx
import Link from "next/link";
import Image from "next/image";

import { supabase } from "@/lib/supabaseClient";
import { lamportsToSol } from "@/utils/solana";

type DbMarket = {
  id: string;
  market_address: string;
  question: string | null;
  description: string | null;
  category: string | null;
  image_url: string | null;
  end_date: string;
  creator: string;
  total_volume: number | string | null;
  resolved: boolean;
  market_type: number | null;
  outcome_names: string[] | null;
};

function formatVolumeLamports(value: number | string | null) {
  const n = Number(value || 0);
  const sol = lamportsToSol(n);
  if (sol >= 1000) return `${(sol / 1000).toFixed(0)}k`;
  if (sol >= 100) return sol.toFixed(0);
  return sol.toFixed(2);
}

function categoryLabel(category?: string | null) {
  if (!category) return "Other";
  return category[0].toUpperCase() + category.slice(1);
}

export const dynamic = "force-dynamic";

export default async function HomePage() {
  // ✅ on récupère TOUT sans filtre program_id/cluster
  const { data, error } = await supabase
    .from("markets")
    .select(
      `
      id,
      market_address,
      question,
      description,
      category,
      image_url,
      end_date,
      creator,
      total_volume,
      resolved,
      market_type,
      outcome_names
    `
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Home markets error:", error.message);
  }

  const markets: DbMarket[] = (data as any[]) || [];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <h1 className="text-3xl sm:text-4xl font-bold text-white mb-6">
        Featured Markets
      </h1>

      {markets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="text-5xl mb-4">🤷‍♂️</div>
          <p className="text-gray-400 text-lg mb-4">
            No markets found yet.
          </p>
          <Link
            href="/create"
            className="btn-primary px-5 py-2 rounded-lg bg-pump-green text-black font-semibold"
          >
            Create the first one!
          </Link>
        </div>
      ) : (
        <>
          {/* All markets grid */}
          <section className="mt-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-white">All Markets</h2>
              <span className="text-sm text-gray-500">
                {markets.length} markets
              </span>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {markets.map((m) => {
                const endDate = new Date(m.end_date);
                const isEnded = endDate.getTime() <= Date.now();
                const isResolved = Boolean(m.resolved);
                const isClosed = isEnded || isResolved;

                const outcomes =
                  (Array.isArray(m.outcome_names)
                    ? m.outcome_names
                    : []) || [];

                return (
                  <Link
                    key={m.id}
                    href={`/trade/${m.market_address}`}
                    className="card-pump flex flex-col hover:border-pump-green/60 transition border border-gray-800 bg-pump-dark/70"
                  >
                    <div className="flex gap-3">
                      <div className="w-16 h-16 rounded-lg overflow-hidden bg-pump-dark flex-shrink-0">
                        {m.image_url ? (
                          <Image
                            src={m.image_url}
                            alt={m.question || "Market"}
                            width={64}
                            height={64}
                            className="object-cover w-full h-full"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-gray-500">
                            No image
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2 mb-1">
                          <h3 className="text-white font-semibold truncate">
                            {m.question || "Untitled market"}
                          </h3>

                          {isClosed && (
                            <span className="ml-auto inline-flex items-center rounded-full bg-gray-800 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-200">
                              {isResolved ? "Resolved" : "Ended"}
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-gray-400 line-clamp-2 mb-1">
                          {m.description || "No description"}
                        </p>

                        <div className="flex items-center gap-2 text-[11px] text-gray-500">
                          <span className="px-2 py-0.5 rounded-full bg-pump-dark/70 border border-gray-800">
                            {categoryLabel(m.category)}
                          </span>
                          <span>
                            Vol: {formatVolumeLamports(m.total_volume)} SOL
                          </span>
                          <span className="ml-auto">
                            {endDate.toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                            })}
                          </span>
                        </div>

                        {outcomes.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {outcomes.slice(0, 3).map((o, idx) => (
                              <span
                                key={idx}
                                className="text-[10px] px-2 py-0.5 rounded-full bg-gray-800/60 text-gray-200"
                              >
                                {o}
                              </span>
                            ))}
                            {outcomes.length > 3 && (
                              <span className="text-[10px] text-gray-400">
                                +{outcomes.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        </>
      )}
    </main>
  );
}