# Strategie Matches - RNG Guard Proba

Profil importable pour le bot Matches.

Cette version remplace l'approche `chaque tick`. Elle ne modifie pas le RNG Deriv: elle filtre les entrees pour eviter de rester bloque sur un digit qui vient de perdre et pour refuser les contrats sans Edge positive.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Matches RNG Guard Proba",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": null,
  "bypassPayoutFilter": false,
  "rules": {
    "selectionMode": "advanced_probability",
    "minimumTicks": 650,
    "minimumProbability": 0.145,
    "minimumAgreementScore": 5,
    "minimumDominanceGap": 0.018,
    "minimumMediumProbability": 0.115,
    "minimumShortProbability": 0.125,
    "minimumEdge": 0.02,
    "requireConditionalEvidence": true,
    "maximumTopTwoGap": 1,
    "requireLastDigitMatch": false
  },
  "risk": {
    "digitBlockAfterLosses": 1,
    "digitBlockTicksMultiplier": 35,
    "digitBlockMaxTicks": 140
  }
}
```

## Changement par rapport a `Matches agressif chaque tick`

- Le filtre payout/Edge est actif avec `bypassPayoutFilter: false`.
- Le bot attend au moins 650 ticks avant de valider une entree.
- Le digit doit etre confirme par les fenetres longue, moyenne, courte, transition et contexte.
- La probabilite modelisee doit atteindre 14,5%.
- L'Edge minimale exigee est de +2%.
- Apres une perte sur un digit, ce digit est bloque immediatement pendant une periode dynamique.

## Utilisation

1. Ouvrir `Deriv Bot`.
2. Passer en `Full automatique`.
3. Choisir `Matches / Differs`, puis `Matches`.
4. Cliquer sur `Importer .md`.
5. Importer ce fichier.

## Remarque risque

Cette strategie reduit fortement le nombre d'entrees. C'est volontaire: apres une serie comme 35 pertes successives, le probleme principal est l'exces d'execution, pas la vitesse. Aucun filtre ne garantit un gain contre un flux aleatoire.
