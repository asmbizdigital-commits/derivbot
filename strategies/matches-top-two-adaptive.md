# Matches Top 2 adaptatif — choix du chiffre sans alternance forcée

Profil expérimental pour le **moteur mis à jour de ce projet**. Il remplace l'alternance First/Second par une sélection entre les deux chiffres les plus fréquents, tout en gardant un démarrage après **50 ticks disponibles** et **un contrat de 1 tick à la fois**.

## Détection

1. Classer les dix chiffres sur les 50 derniers ticks et retenir les deux premiers. Égalités départagées par chiffre croissant.
2. Estimer une distribution avec quatre modèles : uniforme (10 % chacun), fréquence lissée sur 50 ticks, fréquence lissée sur 20 ticks et transitions après le dernier chiffre. Les transitions ne participent qu'à partir de 20 observations du contexte.
3. Comparer ces modèles sur au plus 100 prévisions passées, chacune calculée uniquement avec les ticks antérieurs à son résultat. Pondérer par vraisemblance prédictive, avec une préférence initiale pour le modèle uniforme.
4. Mélanger encore 50 % de référence uniforme au résultat pour limiter les scores extrêmes. Choisir le candidat du top 2 avec l'estimation la plus élevée ; en cas d'égalité, choisir la fréquence la plus élevée, puis le plus petit chiffre.

Le compteur de contrats et les pertes précédentes ne forcent plus le choix du deuxième rang. Aucun chiffre n'est considéré comme « dû » après une longue absence. Une estimation n'est pas une probabilité calibrée ni une preuve de rentabilité. La comparaison historique aide à choisir les modèles ; elle ne constitue pas un test final indépendant. Sans historique supplémentaire aux 50 ticks, les poids initiaux sont utilisés sans retarder les entrées.

## Profil importable

```json
{
  "strategy": "advanced_matches",
  "version": 2,
  "name": "Matches Top 2 Adaptatif - demo",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "contractsPerSignal": 1,
  "stake": 0.5,
  "bypassPayoutFilter": true,
  "rules": {
    "selectionMode": "top_two_adaptive",
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

## Utilisation

Mettre à jour l'application, arrêter le bot, choisir un compte **démo**, puis désactiver les options globales **Martingale**, **Double Risk** et **risque demi-solde**. Importer ce fichier via **Deriv Bot → Matches → Importer .md**. L'import peut démarrer immédiatement si le compte est connecté. La carte doit afficher **Top 2 adaptatif · 50 ticks · 1 contrat** ; arrêter si l'ancien affichage apparaît.

Mise fixe : **0,50 USD**. Arrêt sur résultat de session : **−4 USD**, contrôlé après règlement, donc dépassement possible par la dernière perte. Le fichier ne désactive pas les options globales de risque. Aucun achat n'est effectué par la création de ce fichier.

Le filtre de rentabilité reste désactivé pour conserver la cadence demandée : aucune espérance positive n'est exigée avant achat. Les délais réseau, règlements, erreurs, données invalides et protections de session peuvent suspendre les entrées. Les anciens profils conservent leur ancien comportement.

## Limites et validation

Aucun historique réel de vos 17 pertes n'a été fourni à cette modification. Les essais synthétiques servent à vérifier la logique, pas à démontrer un rendement sur Deriv. À 10 % de réussite avec indépendance, les 17 prochains contrats sont tous perdants avec une probabilité de 0,9^17 ≈ **16,68 %** ; la probabilité de rencontrer une telle série dans une longue session est supérieure.

Deriv décrit ses indices synthétiques comme générés par un générateur aléatoire sécurisé : [source officielle](https://deriv.com/markets/derived-indices/synthetic-indices). Aucune règle de fréquence ou de transition ne garantit la prédiction du prochain chiffre. Une réduction des séries perdantes reste à mesurer sur des résultats démo prospectifs, avec prix et règlements réels.

## Résultats de contrôle synthétique (7 septembre 2026)

Script reproductible : `node scripts/evaluate-match-selection.mjs`, graine 20260907. Chaque scénario comporte 2 000 décisions après 50 ticks d'amorçage. Les prix des contrats, les délais d'exécution et la durée réelle de règlement ne sont pas simulés.

| Scénario artificiel | Alternance : réussite / plus longue série perdante | Adaptatif : réussite / plus longue série perdante |
| --- | --- | --- |
| Chiffres uniformes indépendants | 9,55 % / 56 | 10,25 % / 46 |
| Biais injecté vers le chiffre 7 | 19,55 % / 29 | 33,20 % / 33 |
| Alternance parfaite 1, 2 | 100 % / 0 | 100 % / 0 |

Ces scénarios vérifient le fonctionnement sous des hypothèses connues. Le scénario biaisé montre notamment qu'un meilleur taux de réussite peut coexister avec une série perdante plus longue. Le résultat uniforme ne prouve aucun avantage statistique. Les performances de ces séquences fabriquées ne doivent pas être extrapolées à Deriv. Aucun réglage n'a été optimisé après lecture de ces résultats.
