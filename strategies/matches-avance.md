# Strategie Matches avancee

Ce fichier documente le profil Matches avance et contient un bloc JSON que l'application peut importer.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Matches avance strict",
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
  }
}
```

## Logique

- Le bot utilise `DIGITMATCH`.
- Le mode `barrierMode: "dynamic"` laisse le bot choisir le digit le mieux qualifie.
- Le bot n'achete pas un digit seulement parce qu'il est le plus haut du moment.
- Un signal doit passer les seuils court, moyen, long, contexte, dominance et Edge payout.
- Apres plusieurs pertes sur le meme digit, ce digit est temporairement exclu pour eviter de rester bloque sur une serie perdante.

## Utilisation

1. Dans Deriv Bot, choisir `Full automatique`.
2. Selectionner la categorie `Matches / Differs`, puis `Matches`.
3. Cliquer sur `Importer .md`.
4. Choisir ce fichier.
5. Si le compte Deriv Options est connecte, l'import applique la strategie et lance le scan automatique.

## Parametres utiles

- `contractsPerSignal`: nombre de contrats pris quand un signal Matches est qualifie, de 1 a 10.
- `stake`: mise forcee par l'import. Mettre `null` pour garder la mise deja saisie dans l'app.
- `minimumProbability`: probabilite modelisee minimale du digit.
- `minimumEdge`: marge minimale entre probabilite modelisee et probabilite de break-even du payout.
- `digitBlockAfterLosses`: nombre de pertes sur un meme digit avant exclusion temporaire.
