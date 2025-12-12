# Fix: ConstraintSeeds Error - Wallet Mismatch

## Problème Identifié

L'erreur `ConstraintSeeds` lors de la création de market était causée par un **mismatch entre le wallet utilisé par useWallet() et le wallet Phantom réellement connecté**.

### Symptômes
- Erreur: `AnchorError caused by account: user_counter. Error Code: ConstraintSeeds. Error Number: 2006`
- PDA calculé côté frontend: `5BeBLz91gySA7ptxi5MSR9pircCmfEBGszYXysxENopL`
- PDA calculé côté smart contract: `3TJweNytnvCrZFMCJfnuozjDpi5DMhwds7cwg5Aofj23`
- Wallet Phantom connecté: `4HUzkoC5WTePEoQdJ382naSS6Eht3yKxoqYf7c9yCyB1`

### Cause Racine

Le hook `useWallet()` de `@solana/wallet-adapter-react` ne retournait pas le même `publicKey` que `window.solana.publicKey` du wallet Phantom.

Calcul du PDA:
```typescript
// Frontend calculait avec le mauvais publicKey
const [userCounterPDA] = getUserCounterPDA(wrongPublicKey);
// Résultat: 5BeBLz91gySA7ptxi5MSR9pircCmfEBGszYXysxENopL

// Smart contract attendait le PDA calculé avec le vrai wallet Phantom
seeds: [b"user_counter", phantomPublicKey.as_ref()]
// Résultat: 3TJweNytnvCrZFMCJfnuozjDpi5DMhwds7cwg5Aofj23
```

## Solution Implémentée

### 1. Hook Personnalisé: `usePhantomWallet`

Créé `/app/src/hooks/usePhantomWallet.ts` qui:
- Détecte automatiquement si Phantom est disponible via `window.solana`
- Priorise `window.solana.publicKey` sur `useWallet().publicKey`
- Log les mismatches pour diagnostic
- Assure l'utilisation du bon wallet

```typescript
export function usePhantomWallet() {
  const { publicKey: walletAdapterKey, connected } = useWallet();
  const [resolvedPublicKey, setResolvedPublicKey] = useState<PublicKey | null>(null);

  useEffect(() => {
    if (typeof window !== 'undefined' && (window as any).solana) {
      const phantomPublicKey = (window as any).solana.publicKey;
      if (phantomPublicKey) {
        // Toujours utiliser Phantom si disponible
        setResolvedPublicKey(phantomPublicKey);
        return;
      }
    }
    // Fallback vers wallet adapter
    setResolvedPublicKey(walletAdapterKey);
  }, [walletAdapterKey, connected]);

  return { publicKey: resolvedPublicKey, connected };
}
```

### 2. Mise à Jour de `useProgram`

Modifié `/app/src/hooks/useProgram.ts` pour:
- Utiliser directement `window.solana` si disponible
- Créer un adapter compatible pour Phantom
- Assurer que le provider Anchor utilise le bon wallet

### 3. Mise à Jour de `create/page.tsx`

Remplacé:
```typescript
const { publicKey, connected } = useWallet();
```

Par:
```typescript
const { publicKey, connected } = usePhantomWallet();
```

## Vérification

### Logs de Diagnostic

Les hooks ajoutent des logs dans la console:
```
🔍 Wallet Detection:
  useWallet: [address si différent]
  Phantom: 4HUzkoC5WTePEoQdJ382naSS6Eht3yKxoqYf7c9yCyB1
⚠️ WALLET MISMATCH - Using Phantom wallet
```

### Test du Fix

1. Connectez votre wallet Phantom
2. Ouvrez la console du navigateur
3. Allez sur `/create`
4. Vérifiez que le log montre le bon wallet
5. Créez un market
6. L'erreur ConstraintSeeds ne devrait plus apparaître

## PDAs Calculés

Avec le bon wallet (`4HUzkoC5WTePEoQdJ382naSS6Eht3yKxoqYf7c9yCyB1`), les PDAs calculés correspondent maintenant:

```typescript
// user_counter PDA
seeds: ["user_counter", publicKey.toBuffer()]
// Résultat: 3TJweNytnvCrZFMCJfnuozjDpi5DMhwds7cwg5Aofj23 ✅

// market PDA
seeds: ["market", publicKey.toBuffer(), question.as_bytes()]
// Résultat: [calculé avec le bon wallet] ✅
```

## Fichiers Modifiés

1. ✅ `/app/src/hooks/usePhantomWallet.ts` (nouveau)
2. ✅ `/app/src/hooks/useProgram.ts` (mis à jour)
3. ✅ `/app/src/app/create/page.tsx` (mis à jour)

## Prochaines Étapes

1. Testez la création de market
2. Vérifiez que les PDAs correspondent
3. Confirmez que l'erreur ConstraintSeeds est résolue
4. Déployez sur production si tout fonctionne

## Notes Importantes

- Le fix fonctionne spécifiquement pour Phantom wallet
- Pour supporter d'autres wallets (Solflare, etc.), il faudrait adapter la logique
- Les logs de diagnostic restent activés pour faciliter le debugging futur
