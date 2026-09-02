# Strategie Matches frequence 10 ticks

Profil importable pour le bot Deriv Matches. Cette strategie trade uniquement `DIGITMATCH` quand un digit domine les 10 derniers ticks.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Matches frequence 10 ticks",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": 1,
  "rules": {
    "selectionMode": "frequency_window",
    "windowSize": 10,
    "minimumTicks": 10,
    "minimumProbability": 0.5,
    "minimumAgreementScore": 1,
    "minimumDominanceGap": 0,
    "minimumMediumProbability": 0,
    "minimumShortProbability": 0,
    "minimumEdge": 0,
    "requireConditionalEvidence": false
  },
  "risk": {
    "takeProfit": 5,
    "stopLoss": -10,
    "recoveryMultiplier": 2,
    "maxRecoverySteps": 3,
    "maxRecoveryStakeMultiplier": 10,
    "digitBlockAfterLosses": 10,
    "digitBlockTicksMultiplier": 1,
    "digitBlockMaxTicks": 1
  }
}
```

## Logique

- Analyse les 10 derniers ticks du symbole actif.
- Extrait le dernier chiffre de chaque prix.
- Compte les occurrences de chaque digit de 0 a 9.
- Selectionne le digit le plus frequent uniquement si sa frequence est au moins 50%.
- Envoie un contrat `DIGITMATCH` avec ce digit comme barriere et une duree de 1 tick.
- Passe le tick sans trader quand aucun digit n'atteint le seuil.

## Risque

- Mise de base: 1.00 USD.
- Apres une perte, prochaine mise = base x `2 ^ pertes_consecutives`.
- La mise est plafonnee a 10x la mise de base.
- Apres 3 pertes consecutives Matches, la recuperation revient a 0 et la prochaine mise repart a la base.
- Take Profit session: +5.00 USD.
- Stop Loss session: -10.00 USD.

## Utilisation

1. Dans Deriv Bot, choisir `Full automatique`.
2. Selectionner `Matches / Differs`, puis `Matches`.
3. Cliquer sur `Importer .md`.
4. Choisir ce fichier.
5. Le bot applique la strategie et lance le scan si le compte Deriv Options est connecte.
