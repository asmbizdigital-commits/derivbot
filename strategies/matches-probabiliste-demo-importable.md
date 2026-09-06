# Matches probabiliste — profil démo importable

Adaptation expérimentale du protocole `matches-validation-probabiliste.md` au moteur actuel. Compatible avec le bouton **Importer .md** de l'onglet **Deriv Bot de ce projet**.

Ce profil applique les filtres heuristiques disponibles ; il n'effectue pas la calibration indépendante ni le calcul de borne de confiance du protocole. Le seuil de score à 13,5 % n'est pas une probabilité de réussite démontrée.

## Avant l'import

L'import peut lancer automatiquement le scan et les achats si un compte est connecté. Sélectionner d'abord un **compte démo**, arrêter le bot, puis désactiver les options globales **Martingale**, **Double Risk** et **risque demi-solde**. Le fichier désactive la récupération propre à Matches, mais l'import ne désactive pas ces options globales.

Préconfiguration pour un capital démo de référence de **200 USD** : mise fixe **0,50 USD**, seuil d'arrêt de session **−4 USD**. Les montants ne se recalculent pas en fonction du solde. Utiliser uniquement un contrat dont la mise minimale permet 0,50 USD ; ne pas augmenter automatiquement la mise en cas de refus.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Matches probabiliste - demo experimental",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": 0.5,
  "bypassPayoutFilter": false,
  "rules": {
    "selectionMode": "advanced_probability",
    "minimumTicks": 1000,
    "minimumProbability": 0.135,
    "minimumAgreementScore": 4,
    "minimumDominanceGap": 0.012,
    "minimumMediumProbability": 0.108,
    "minimumShortProbability": 0.118,
    "minimumEdge": 0.01,
    "requireConditionalEvidence": true,
    "maximumTopTwoGap": 1,
    "requireLastDigitMatch": false,
    "windowSize": 1000
  },
  "risk": {
    "takeProfit": null,
    "stopLoss": -4,
    "recoveryMultiplier": 1,
    "maxRecoverySteps": 0,
    "maxRecoveryStakeMultiplier": 1,
    "digitBlockAfterLosses": 10,
    "digitBlockTicksMultiplier": 1,
    "digitBlockMaxTicks": 1
  }
}
```

## Installation

1. Effectuer les réglages démo et désactiver les options de hausse de mise indiqués ci-dessus, avant de charger le fichier.
2. Dans l'application du projet, ouvrir **Deriv Bot**, choisir **Full automatique**, puis **Matches / Differs → Matches**.
3. Cliquer sur **Importer .md** et sélectionner ce fichier.
4. Vérifier le nom « Matches probabiliste - demo experimental », la mise 0,50 USD et SL −4 USD. Si aucun compte n'était connecté, connecter le compte démo puis utiliser Play.
5. Laisser le bot attendre un signal qualifié. « Aucun signal qualifié » est normal ; ne pas désactiver le filtre de prix pour forcer des achats.

## Comportement réellement disponible

- Attend 1 000 ticks disponibles avant de qualifier un signal. Le moteur utilise ensuite ses propres fenêtres de 500, 160 et 50 ticks et des transitions ; `windowSize` ne remplace pas ces fenêtres en mode avancé.
- Choisit un chiffre dynamique via le moteur existant et exige au moins quatre indicateurs au-dessus de leurs seuils. Ces indicateurs partagent les mêmes données et ne sont pas des validations indépendantes.
- Exige un score d'au moins 13,5 %, les filtres de stabilité et un écart estimé d'au moins un point de pourcentage au-dessus de prix d'achat / versement total. L'espérance calculée avec ce score doit être positive.
- Demande un contrat par signal. Le moteur fixe les contrats digits à un tick ; la durée n'est pas un paramètre importable de ce fichier.
- Ne programme aucune récupération de mise Matches. Les options globales doivent rester désactivées pour conserver la mise fixe.
- Le blocage de chiffre ne peut pas être totalement désactivé par ce format : il est réduit à un tick après dix pertes comptabilisées sur ce chiffre. Ce mécanisme ne prouve aucun avantage.
- L'arrêt de perte est évalué sur le résultat de session, après règlement. Il ne réserve pas le budget avant chaque achat : le seuil −4 USD peut être dépassé par la dernière perte. Ce n'est donc pas le plafond strict de 2 % prévu par le protocole complet.
- Aucun objectif de gain n'est imposé. Un nouvel import réinitialise les statistiques de session lorsqu'il relance le bot ; ne pas réimporter pour contourner l'arrêt de perte.

## Limites

Le profil est prêt pour un essai technique en démo, sans preuve de rentabilité. Un fichier Markdown ne peut pas ajouter les fonctions absentes du moteur : validation hors échantillon, probabilités calibrées, borne prudente, mise proportionnelle automatique ou contrôle strict du budget avant achat. Ces fonctions nécessitent une évolution du code pour exécuter fidèlement le protocole initial.

Référence du contrat : [documentation Deriv Digit Matches/Differs](https://legacy-docs.deriv.com/docs/digit-matchesdiffers). Aucun ordre n'est envoyé par la simple création de ce fichier.
