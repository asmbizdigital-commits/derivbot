# DBX (V3.1) Adaptatif — Seuil personnalisable

Profil préconfiguré en **seuil manuel à 10 %**, durée **1 tick**. Importer ce fichier dans Deriv Bot → Matches → Importer .md, vérifier le mode **Seuil manuel (%)**, puis utiliser Play. L’import ne démarre pas les achats.

## Correction du filtre

L’ancienne configuration contenait `dbxMinimumProbability: null` : elle réactivait le filtre automatique malgré le nom du fichier. De plus, le seuil manuel était comparé à une borne historique prudente inférieure à l’estimation affichée dans le popup.

Ce fichier active explicitement le mode manuel. Dans la version corrigée de l’application, ce mode compare **l’estimation du modèle** au seuil choisi. Exemple : un score de 10,1 % passe un seuil de 10 %, même si la borne prudente est de 8,83 %. Un score de 9,9 % reste refusé. Pendant la cotation, le bot retient le plus faible score entre la demande et la réception, et refuse si le digit sélectionné a changé.

**10 % est un réglage de déclenchement, pas une preuve d’avantage ou une promesse de rentabilité.** Le mode manuel peut accepter une entrée sous le seuil d’équilibre du payout. Il ne garantit pas un trade à chaque tick.

## Réglages et exécution

- `DIGITMATCH`, Volatility 50 (1s), `1HZ50V`, un contrat à la fois.
- Digit manuel de 0 à 9 ou choisi parmi le Top 2 adaptatif sur 50 ticks ; 200 ticks valides requis avant cotation.
- Seuil manuel modifiable de 0 à 100 % avant Play. Dans le JSON, `0.10` signifie 10 % ; `null` rétablit le filtre automatique prudent avec marge de 2 % de la mise.
- **Durée manuelle en ticks** : sélecteur de 1 à 10 disponible en mode manuel et Full automatique pour tous les profils Matches, réglable avant Play ; estimation non calibrée pour une échéance de plusieurs ticks.
- Mise fixe de 5 par défaut ; budget de perte de 4 mises par session, réglable avant Play. Le budget repart au prochain Play.
- Cotations valides et récentes (3 secondes maximum), solde suffisant et absence de contrat/achat en cours requis. Aucune martingale.
- Les refus de cotation ne consomment pas la limite de signaux. Stop interrompt les prochaines entrées.

## Configuration importable

```json
{
  "strategy": "advanced_matches",
  "executionMode": "dbx_dynamic",
  "name": "DBX (V3.1) Adaptatif · Payout contrôlé",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "stake": 5,
  "durationTicks": 1,
  "dbxMinimumProbability": 0.10,
  "contractsPerSignal": 1,
  "bypassPayoutFilter": false,
  "risk": { "lossBudgetStakes": 4 },
  "rules": {
    "selectionMode": "top_two_adaptive",
    "minimumTicks": 50,
    "windowSize": 50,
    "minimumProbability": 0
  }
}
```

La correction nécessite le code de l’application mis à jour : réimporter ce MD dans une ancienne version ne suffit pas à changer la formule du filtre. Les anciens profils automatiques restent prudents ; seul ce fichier est préconfiguré en manuel.

## Choix du digit : adaptatif ou manuel

Avant Play, utiliser **Mode du digit** :

- **Adaptatif** (par défaut) : le système choisit dans le Top 2 sur 50 ticks. Le JSON utilise `"barrierMode": "dynamic"` et `"fixedDigit": null`.
- **Manuel** : sélectionner un entier de **0 à 9**, conservé pour chaque contrat jusqu’à modification. Exemple d’import : remplacer ces deux propriétés par `"barrierMode": "fixed"` et `"fixedDigit": 0` pour trader le digit zéro. Le digit n’a pas besoin d’être dans le Top 2.

Le popup affiche le digit manuel et **son** estimation. Le seuil, le contrôle des cotations et le budget de perte restent appliqués. Choisir un digit manuellement ne force donc pas l’achat. Les changements sont bloqués pendant le trading ou tant qu’une cotation, un achat ou un contrat est en cours.

## Durée et délai d’exécution

Une durée de 1 tick est envoyée telle quelle à Deriv. La prédiction suit le flux de marché ; la demande de cotation puis l’achat prennent du temps avant l’entrée du contrat. Le règlement est confirmé séparément par Deriv. Le suivi affiche la durée du contrat, les heures d’entrée/sortie reçues et distingue l’attente du tick d’entrée du règlement. Il ne faut pas assimiler tout ce délai à une durée de 2 ticks.
