# Strategie Digits compatible Matches

Adaptation du fichier `strategie-digits.md` pour l'import Matches du bot.

Le document source decrit une strategie Digits generale avec deux variantes:

- `DIFFERS_ON_HOT`: parier Differs contre le digit le plus frequent.
- `MATCHES_ON_COLD`: parier Matches sur le digit le moins frequent.

L'import actuel du bot accepte uniquement les strategies Matches avancees avec `contractType: "DIGITMATCH"`. Cette version force donc `DIGITMATCH`, garde une barriere dynamique et utilise des seuils stricts pour ne prendre que les signaux qualifies.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Digits Matches compatible - filtre chi2 strict",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": null,
  "rules": {
    "minimumTicks": 200,
    "minimumProbability": 0.135,
    "minimumAgreementScore": 4,
    "minimumDominanceGap": 0.012,
    "minimumMediumProbability": 0.108,
    "minimumShortProbability": 0.118,
    "minimumEdge": 0.01,
    "requireConditionalEvidence": true
  },
  "risk": {
    "digitBlockAfterLosses": 2,
    "digitBlockTicksMultiplier": 12,
    "digitBlockMaxTicks": 60
  },
  "sourceMapping": {
    "sourceFile": "strategie-digits.md",
    "sourceMode": "MATCHES_ON_COLD",
    "tickHistorySize": 1000,
    "rollingWindow": 100,
    "minSampleBeforeTrade": 200,
    "chiSquareThreshold": 16.92,
    "duration": 1,
    "durationUnit": "t",
    "basis": "stake",
    "useMartingale": false,
    "maxTradesPerSession": 200
  }
}
```

## Correspondance avec la strategie source

- `minSampleBeforeTrade: 200` devient `rules.minimumTicks: 200`.
- `strategy: MATCHES_ON_COLD` devient `contractType: DIGITMATCH` avec `barrierMode: dynamic`.
- `baseStake: 1` reste gere par la mise deja saisie dans l'app, car `stake` vaut `null`.
- `useMartingale: false` est conserve: le fichier n'active pas la martingale.
- `chiSquareThreshold: 16.92` est conserve en metadata dans `sourceMapping`; le moteur actuel utilise plutot des seuils multi-fenetres, dominance et Edge payout.

## Utilisation dans l'application

1. Aller dans `Deriv Bot`.
2. Passer en `Full automatique`.
3. Choisir `Matches / Differs`, puis `Matches`.
4. Cliquer sur `Importer .md`.
5. Selectionner ce fichier.

Si le compte Deriv Options est connecte, l'import applique la strategie et lance le scan automatique. Le bot achete uniquement quand le signal Matches est qualifie par les seuils du bloc JSON.

## Ajustements rapides

- Augmenter `minimumProbability` pour reduire le nombre d'entrees.
- Augmenter `minimumEdge` pour refuser davantage de payouts faibles.
- Augmenter `minimumAgreementScore` a `5` pour exiger une confirmation maximale.
- Reduire `contractsPerSignal` a `1` si la serie de pertes augmente.
