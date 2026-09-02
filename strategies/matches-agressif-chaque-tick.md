# Strategie Matches agressive filtree

Profil importable pour le bot Matches. Cette version remplace l'ancien mode "chaque tick": elle reste plus rapide que le profil strict, mais elle filtre les entrees pour reduire les longues series de pertes.

Le probleme du profil precedent etait l'exces d'execution: il achetait presque a chaque tick, sans Edge payout, avec seulement 1 tick d'historique. Cette version attend une vraie dominance statistique et coupe le digit qui vient de perdre.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Matches agressif filtre",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": 1,
  "bypassPayoutFilter": false,
  "rules": {
    "selectionMode": "advanced_probability",
    "minimumTicks": 220,
    "minimumProbability": 0.14,
    "minimumAgreementScore": 4,
    "minimumDominanceGap": 0.014,
    "minimumMediumProbability": 0.112,
    "minimumShortProbability": 0.12,
    "minimumEdge": 0.012,
    "requireConditionalEvidence": true,
    "maximumTopTwoGap": 1,
    "requireLastDigitMatch": false
  },
  "risk": {
    "takeProfit": 5,
    "stopLoss": -10,
    "recoveryMultiplier": 2,
    "maxRecoverySteps": 2,
    "maxRecoveryStakeMultiplier": 4,
    "digitBlockAfterLosses": 1,
    "digitBlockTicksMultiplier": 30,
    "digitBlockMaxTicks": 120
  }
}
```

## Comportement

- Contrat force: `DIGITMATCH`.
- Digit: dynamique.
- Echantillon minimum: 220 ticks.
- Filtre Edge/payout: actif.
- Confirmation contexte/transition: activee.
- Entree seulement si le digit a une probabilite modelisee d'au moins 14%.
- Accord minimum: 4 signaux statistiques sur 5.
- Edge minimale: +1,2% au-dessus du break-even payout.
- Blocage digit perdant: immediat apres une perte, pendant 30 a 120 ticks.
- Take Profit session: +5 USD.
- Stop Loss session: -10 USD.
- Recuperation limitee: x2 apres une perte, mais seulement jusqu'a 2 etapes, avec plafond a 4x.

## Pourquoi moins de pertes successives

- Le bot n'entre plus sur un simple classement instantane.
- Un digit qui vient de perdre est temporairement exclu.
- Le filtre payout refuse les contrats dont le prix ne donne pas d'Edge.
- La recuperation est limitee pour eviter que la mise grossisse pendant une mauvaise sequence.

## Utilisation

1. Ouvrir `Deriv Bot`.
2. Choisir `Full automatique`.
3. Selectionner `Matches / Differs`, puis `Matches`.
4. Cliquer sur `Importer .md`.
5. Importer ce fichier.

Si le compte Deriv Options est connecte, le bot passe en mode auto et commence a scanner/executer avec ce profil.
