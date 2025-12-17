# Switchboard Oracle Integration

## Vue d'ensemble

Ce projet intègre **Switchboard Oracle V2** pour permettre la résolution automatisée des markets de prédiction. Switchboard est un oracle décentralisé natif à Solana qui fournit des données fiables et vérifiables.

## Architecture

### Smart Contract (programs/funmarket-pump/src/lib.rs)

Le smart contract a été modifié pour supporter la résolution via oracle :

**Nouvelles Instructions:**
1. `request_resolution()` - Le créateur du market demande une résolution via l'oracle
2. `receive_oracle_result()` - Callback appelé par Switchboard pour fournir le résultat
3. `resolve_market()` - Résolution manuelle (fallback)

**Nouveaux Champs Market:**
- `resolution_requested: bool` - Indique si la résolution oracle a été demandée
- `resolution_timestamp: i64` - Timestamp de la demande de résolution

### Frontend (app/src/app/dashboard/page.tsx)

Le dashboard du créateur affiche maintenant :
- **Bouton "Resolve with Oracle"** - Déclenche la résolution automatique via Switchboard
- **Boutons "Manual: YES/NO"** - Résolution manuelle en fallback

## Configuration Switchboard

### 1. Créer un Aggregator Feed

Pour utiliser Switchboard, vous devez créer un aggregator feed sur Solana devnet/mainnet :

```bash
# Installer le CLI Switchboard
npm install -g @switchboard-xyz/cli

# Créer un aggregator pour BTC/USD (exemple)
sbv2 aggregator create \
  --keypair ~/.config/solana/id.json \
  --name "BTC/USD Price Feed" \
  --batchSize 3 \
  --minUpdateDelaySeconds 30 \
  --cluster devnet
```

### 2. Configurer les Jobs Oracle

Switchboard permet de définir des jobs qui récupèrent des données depuis différentes sources (APIs, sites web, etc.).

Exemple de job pour récupérer le prix BTC/USD :

```json
{
  "name": "BTC/USD Job",
  "tasks": [
    {
      "httpTask": {
        "url": "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
      }
    },
    {
      "jsonParseTask": {
        "path": "$.bitcoin.usd"
      }
    }
  ]
}
```

### 3. Intégration Frontend

Pour appeler l'instruction `request_resolution` depuis le frontend :

```typescript
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { FunmarketPump } from "../types/funmarket_pump";

async function requestOracleResolution(marketKey: string) {
  const provider = getProvider(); // Votre provider Phantom/Solflare
  const program = new Program<FunmarketPump>(IDL, PROGRAM_ID, provider);

  const marketPubkey = new PublicKey(marketKey);

  await program.methods
    .requestResolution()
    .accounts({
      market: marketPubkey,
      creator: provider.wallet.publicKey,
    })
    .rpc();

  console.log("Oracle resolution requested!");
}
```

### 4. Backend Worker (Oracle Callback)

Un worker backend doit écouter les événements de résolution et appeler `receive_oracle_result()` :

```typescript
// worker/oracle-resolver.ts
import { Connection, PublicKey } from "@solana/web3.js";

async function listenForResolutionRequests() {
  const connection = new Connection("https://api.devnet.solana.com");

  // Écouter les comptes Market avec resolution_requested = true
  const markets = await program.account.market.all([
    {
      memcmp: {
        offset: 8 + 32 + 200 + 500 + 8 + 1 + 1 + ..., // Offset du champ resolution_requested
        bytes: anchor.utils.bytes.bs58.encode([1]), // true
      }
    }
  ]);

  for (const market of markets) {
    // Récupérer la valeur depuis Switchboard
    const aggregatorPubkey = new PublicKey("VOTRE_AGGREGATOR_PUBKEY");
    const aggregatorAccount = await AggregatorAccount.load(connection, aggregatorPubkey);
    const result = await aggregatorAccount.getLatestValue();

    // Déterminer le winning outcome basé sur le résultat oracle
    const winningOutcome = determineWinner(result, market.account);

    // Appeler receive_oracle_result
    await program.methods
      .receiveOracleResult(winningOutcome)
      .accounts({
        market: market.publicKey,
        userCounter: userCounterPDA,
        aggregatorFeed: aggregatorPubkey,
        authority: oracleAuthority.publicKey,
      })
      .signers([oracleAuthority])
      .rpc();
  }
}
```

## Déploiement

### 1. Build le programme

```bash
anchor build
```

### 2. Deploy sur devnet

```bash
anchor deploy --provider.cluster devnet
```

### 3. Mettre à jour le PROGRAM_ID

Après le deploy, mettez à jour le `declare_id!()` dans `lib.rs` avec le nouveau program ID.

## Sécurité

**Important:**
- Validez toujours que l'oracle feed n'est pas obsolète (staleness check)
- Utilisez plusieurs oracles (multi-oracle) pour les markets à haute valeur
- Implémentez une résolution manuelle en fallback
- Limitez qui peut appeler `receive_oracle_result()` (seulement l'autorité oracle)

## Coûts

- Création d'un aggregator: ~0.5 SOL (devnet gratuit)
- Chaque update oracle: ~0.000005 SOL
- Transaction request_resolution: ~0.000005 SOL
- Transaction receive_oracle_result: ~0.000005 SOL

## Ressources

- [Switchboard Documentation](https://docs.switchboard.xyz/)
- [Switchboard V2 Rust SDK](https://github.com/switchboard-xyz/switchboard-v2)
- [Switchboard Explorer](https://app.switchboard.xyz/)
- [Example Markets](https://docs.switchboard.xyz/examples)

## Support

Pour toute question sur l'intégration Switchboard, consultez :
- Discord Switchboard: https://discord.gg/switchboard
- Documentation officielle: https://docs.switchboard.xyz/
