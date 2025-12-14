# Configuration du Wallet de la Plateforme

## Wallet de la Plateforme

Le wallet de la plateforme reçoit 1% de fees sur chaque trade (achat et vente).

### Configuration pour le Déploiement

Lors du déploiement et de l'utilisation du programme, vous devez spécifier l'adresse du wallet de la plateforme dans chaque transaction `buy_shares` et `sell_shares`.

**Important:** Remplacez `YOUR_PLATFORM_WALLET_ADDRESS` par votre adresse wallet Solana réelle.

### Exemple d'adresse Platform Wallet

```
Adresse Platform Wallet: <VOTRE_ADRESSE_ICI>
```

Pour générer une nouvelle adresse wallet pour la plateforme:

```bash
solana-keygen new --outfile ~/.config/solana/platform-wallet.json
solana address -k ~/.config/solana/platform-wallet.json
```

### Utilisation dans le Code Frontend

Dans `app/src/utils/solana.ts`, ajoutez:

```typescript
// Platform wallet qui reçoit 1% des fees
export const PLATFORM_WALLET = new PublicKey('VOTRE_ADRESSE_PLATFORM_WALLET');
```

### Utilisation dans les Transactions

Exemple d'appel pour acheter des shares:

```typescript
await program.methods
  .buyShares(new anchor.BN(amount), true) // true = YES
  .accounts({
    market: marketPDA,
    userPosition: userPositionPDA,
    buyer: wallet.publicKey,
    creator: creatorAddress,
    platformWallet: PLATFORM_WALLET, // ← Wallet de la plateforme
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

## Structure des Fees

- **Créateur du marché:** 1% de chaque trade
- **Plateforme:** 1% de chaque trade
- **Total fees:** 2% par trade

### Répartition des Revenus

Sur un trade de 1 SOL:
- Coût de base: 1.00 SOL → va dans le marché
- Fee créateur: 0.01 SOL → va au créateur du marché
- Fee plateforme: 0.01 SOL → va au wallet de la plateforme
- **Total payé par l'utilisateur:** 1.02 SOL

## Sécurité

⚠️ **Important:**
- Gardez la clé privée du wallet plateforme en sécurité
- Ne commitez JAMAIS le fichier `.json` de la clé privée
- Utilisez un wallet multisig pour la production
- Mettez en place un système de monitoring des fees collectées

## Monitoring des Revenus

Pour vérifier les revenus de la plateforme:

```bash
solana balance VOTRE_ADRESSE_PLATFORM_WALLET --url devnet
```

Pour l'historique des transactions:

```bash
solana transaction-history VOTRE_ADRESSE_PLATFORM_WALLET --url devnet
```

---

**Note:** Ce fichier contient des instructions pour configurer le wallet de la plateforme qui collecte 1% de fees sur tous les trades.
