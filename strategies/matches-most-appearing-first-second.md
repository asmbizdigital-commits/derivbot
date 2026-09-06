# Matches Most Appearing — First and Second

Profil importable dans **Deriv Bot de ce projet, après mise à jour du moteur**. Ce fichier utilise le nouveau mode `top_two_frequency` : ne pas l'importer dans une ancienne version, qui pourrait le traiter comme une stratégie avancée classique.

## Fonctionnement

- Classe les chiffres de 0 à 9 par nombre d'apparitions sur les **50 derniers ticks**.
- Attend 50 ticks disponibles, puis sélectionne le **premier** du classement pour le premier contrat, le **deuxième** pour le suivant, puis recommence 1 → 2 → 1 → 2.
- Recalcule le classement à chaque décision : les chiffres peuvent changer. En cas d'égalité, le plus petit chiffre passe avant l'autre.
- Avance l'alternance uniquement après un achat confirmé. Une proposition refusée ou un achat échoué ne consomme pas le rang. Un nouvel import réinitialise la session et reprend au premier rang.
- Un seul contrat ouvert à la fois, durée **1 tick**. Reprend au prochain passage du moteur une fois le contrat réglé ; les délais de Deriv restent applicables.
- Aucun seuil de fréquence, aucune attente de cluster, aucun blocage après perte dans ce mode. Les protections de session et la limite de signaux restent actives.
- **Filtre de rentabilité désactivé** : le profil suit les fréquences sans exiger d'avantage estimé sur le prix proposé. Une fréquence passée n'est pas une probabilité de gain future.

## Paramètres

Mise fixe **0,50 USD par contrat**, récupération Matches désactivée, arrêt de session à **−4 USD**, sans objectif de gain. Le seuil de perte est contrôlé après règlement et peut être dépassé par la dernière perte.

```json
{
  "strategy": "advanced_matches",
  "version": 1,
  "name": "Matches Most Appearing - First and Second",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": 0.5,
  "bypassPayoutFilter": true,
  "rules": {
    "selectionMode": "top_two_frequency",
    "minimumTicks": 50,
    "minimumProbability": 0,
    "minimumAgreementScore": 1,
    "minimumDominanceGap": 0,
    "minimumMediumProbability": 0,
    "minimumShortProbability": 0,
    "minimumEdge": 0,
    "requireConditionalEvidence": false,
    "maximumTopTwoGap": 1,
    "requireLastDigitMatch": false,
    "windowSize": 50
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

## Import

1. Ouvrir la version mise à jour du projet. Si l'application est hébergée, elle doit recevoir la mise à jour du moteur avant cet import.
2. Arrêter le bot et sélectionner le compte **démo**.
3. Désactiver les options globales **Martingale**, **Double Risk** et **risque demi-solde** ; ce fichier ne modifie pas ces options.
4. Ouvrir **Deriv Bot → Matches / Differs → Matches → Importer .md** et sélectionner ce fichier.
5. Vérifier que la carte affiche **1er / 2e en alternance · 50 ticks · 1 contrat**, et que la mise est 0,50 USD. Si elle affiche « Min … · edge … », arrêter le bot : le moteur est encore ancien.

**L'import peut lancer immédiatement les achats si le compte est connecté.** La fenêtre peut être déjà remplie par l'historique disponible. Sinon, l'attente correspond aux ticks manquants, pas nécessairement à 50 secondes.

Changer le champ « Nombre de contrats » ne multiplie pas les positions de ce mode : le moteur impose un seul contrat par signal. Le stop de session ne doit pas être contourné par des réimports successifs.

Ce profil remplace l'attente statistique par une alternance de classement. Il ne reproduit pas la validation probabiliste du document initial et ne garantit pas la rentabilité.
