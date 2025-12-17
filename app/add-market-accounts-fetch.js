const fs = require('fs');

const file = 'src/app/dashboard/page.tsx';
let content = fs.readFileSync(file, 'utf8');

// Trouve où insérer le useEffect (après le useEffect qui charge myMarkets/myTxs)
const searchStr = `  }, [connected, walletBase58]);

  // ---------- compute claimables ----------`;

const insertCode = `  }, [connected, walletBase58]);

  // ---------- fetch market accounts on-chain ----------
  useEffect(() => {
    if (!connected || !program || myMarkets.length === 0) {
      setMarketAccounts(new Map());
      return;
    }

    let cancelled = false;

    (async () => {
      const newMap = new Map<string, any>();

      for (const mk of myMarkets) {
        if (cancelled) break;
        const addr = mk.market_address;
        if (!addr) continue;

        try {
          const marketPk = new PublicKey(addr);
          const acc = await (program as any).account.market.fetch(marketPk);
          newMap.set(addr, acc);
        } catch (e) {
          // market not found on-chain
        }
      }

      if (!cancelled) setMarketAccounts(newMap);
    })();

    return () => {
      cancelled = true;
    };
  }, [connected, program, myMarkets]);

  // ---------- compute claimables ----------`;

content = content.replace(searchStr, insertCode);

fs.writeFileSync(file, content);
console.log('✅ Market accounts fetch useEffect added!');
