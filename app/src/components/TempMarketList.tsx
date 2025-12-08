import { useEffect, useState } from 'react';

export default function TempMarketList() {
  const [markets, setMarkets] = useState<any[]>([]);

  useEffect(() => {
    // Mock temporaire – on affiche ton dernier marché même si Supabase bug
    setMarkets([
      {
        question: "BTC $150k 2025?",
        market_address: "2mujn2dmzHw4CYczu1VaMyCqge8T3PTziXxgunMukEuHryAFHF2BG9x7M8vyw6mGk5Y2kVdVTrVwmVcR4FFwwoJk2",
        creator: "2FuG.pA9Y...",
        yes_supply: 0,
        no_supply: 0,
        created_at: new Date().toISOString(),
      }
    ]);
  }, []);

  return (
    <div className="mt-8 p-6 bg-gray-900 rounded-xl">
      <h2 className="text-2xl font-bold mb-4">🔥 Dernier marché créé (temp)</h2>
      {markets.map(m => (
        <div key={m.market_address} className="p-6 bg-gray-800 rounded-lg hover:bg-gray-700 transition">
          <h3 className="text-2xl font-bold text-green-400">{m.question}</h3>
          <p className="text-sm text-gray-400 mt-2">by {m.creator.slice(0,8)}...{m.creator.slice(-6)}</p>
          <a href={`/trade/${m.market_address}`} className="inline-block mt-4 px-6 py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold">
            → Voir le marché
          </a>
        </div>
      ))}
    </div>
  );
}
