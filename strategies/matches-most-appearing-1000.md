# Strategie Matches - Digit le plus frequent 1000 ticks

Profil importable pour le bot Matches.

Cette strategie suit la logique fournie:

- calcule le digit le plus frequent sur les 1000 derniers ticks;
- calcule le deuxieme digit le plus frequent sur les 1000 derniers ticks;
- calcule leurs pourcentages;
- valide le signal seulement si l'ecart entre les deux pourcentages est inferieur ou egal a 0,3 point;
- valide l'entree seulement si le dernier digit recu est egal au digit le plus frequent;
- lance un contrat `DIGITMATCH` sur ce digit dynamique.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Matches most appearing 1000",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": null,
  "bypassPayoutFilter": true,
  "rules": {
    "selectionMode": "most_appearing_1000",
    "minimumTicks": 1000,
    "minimumProbability": 0.1,
    "minimumAgreementScore": 1,
    "minimumDominanceGap": 0,
    "minimumMediumProbability": 0,
    "minimumShortProbability": 0,
    "minimumEdge": -1,
    "requireConditionalEvidence": false,
    "maximumTopTwoGap": 0.003,
    "requireLastDigitMatch": true
  },
  "risk": {
    "digitBlockAfterLosses": 10,
    "digitBlockTicksMultiplier": 1,
    "digitBlockMaxTicks": 1
  }
}
```

## Notes

- `0.003` correspond a 0,3 point de pourcentage.
- `bypassPayoutFilter: true` applique directement la logique de frequence sans refuser le trade sur l'Edge payout.
- `minimumTicks: 1000` force le systeme a utiliser une fenetre complete de 1000 ticks avant de prendre un signal.
- `requireLastDigitMatch: true` reproduit la condition `Last Digit = Most_appearing_digit`.

## Utilisation

1. Ouvrir `Deriv Bot`.
2. Passer en `Full automatique`.
3. Choisir `Matches / Differs`, puis `Matches`.
4. Cliquer sur `Importer .md`.
5. Importer ce fichier.
