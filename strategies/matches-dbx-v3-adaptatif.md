# DBX (V3.1) Adaptatif — Payout contrôlé

Cette révision remplace la V3 dans la liste des stratégies. Les anciens imports `executionMode: "dbx_dynamic"` utilisent désormais ces contrôles ; les variantes V2 fixe et V4 Last Digit + Most Appearing restent distinctes.

## Problème corrigé

L’ancienne V3 choisissait un digit adaptatif puis achetait sans vérifier l’espérance au payout proposé. La capture fournie montre **21 gains / 200 contrats (10,5 %)** pour **−62,56 $**. Ce seul bilan ne contient pas les ticks, cotations et mises de tous les contrats ; il ne permet pas d’optimiser honnêtement le modèle ou de reconstituer chaque perte.

À titre de calcul conditionnel : si les 200 mises étaient toutes de 5 $, le coût serait de 1 000 $, les paiements cumulés de 937,44 $, soit 44,64 $ en moyenne par gain. Le seuil d’équilibre correspondant serait `5 / 44,64 ≈ 11,20 %`, supérieur aux 10,5 % observés. Ce calcul n’établit pas une probabilité future.

## Contrôles avant chaque achat

1. **Choix du digit** : digit manuel de 0 à 9 ou, par défaut, Top 2 adaptatif sur les 50 derniers ticks, combinant fréquence, récence et transitions. Aucun changement forcé du digit après une perte.
2. **Données supplémentaires** : au moins **200 ticks valides disponibles**. L’historique chargé compte ; il ne faut pas attendre 200 nouveaux ticks si ces données sont déjà disponibles.
3. **Fréquence prudente** : compter les occurrences du digit choisi sur les 200 derniers ticks et calculer la borne basse de Wilson avec `z = 2,576`. Ce réglage correspond approximativement à une queue unilatérale de 0,5 % par digit ; il ne garantit pas une couverture sur des sélections répétées ou des données dépendantes.
4. **Score retenu en automatique** : minimum de l’estimation du modèle et de cette borne historique. En manuel, seule l’estimation du modèle est comparée au seuil. Pendant la cotation, retenir aussi le minimum entre l’estimation demandée et celle recalculée.
5. **Payout réel** : calculer le seuil `prix / paiement brut` et l’espérance prudente `score × paiement brut − prix`. Par défaut, accepter seulement si cette dernière atteint **2 % de la mise cotée**. L’option **Seuil manuel (%)** remplace cette condition par `estimation du modèle ≥ seuil choisi`, sans borne prudente ni marge de payout supplémentaire. Le seuil d’équilibre réel reste affiché dans les refus ; il n’est plus un minimum imposé en mode manuel. Les fréquences seules ne déclenchent plus l’achat.
6. **Fraîcheur** : refuser une réponse reçue plus de **3 secondes** après la demande, un changement d’instrument, ou un digit devenu différent de celui de la cotation.
7. **Budget de perte** : réserver la prochaine mise avant de demander une cotation, puis le prix réel avant l’achat. Par défaut, perte nette maximale de session de **4 mises** (20 $ pour une mise de 5 $), réglable de 1 à 100 mises avant Play. Arrêt après clôture si une nouvelle mise peut dépasser le budget. Le budget est réinitialisé au prochain Play.

La borne historique n’est pas une probabilité calibrée du prochain tick. Le filtre peut refuser **tous les trades** sur un flux sans avantage apparent, et ne transforme pas un processus aléatoire en source de profit. Deriv indique que ces indices utilisent un générateur aléatoire sécurisé : [source officielle](https://deriv.com/fr/markets/derived-indices/synthetic-indices).

## Exécution et suivi

- `DIGITMATCH` sur **Volatility 50 (1s)**, `1HZ50V`, durée **1 à 10 ticks** (1 par défaut), **un contrat à la fois**.
- Mise **5 par défaut**, modifiable avant Play, sans martingale, double risque ni demi-solde.
- La popup affiche les estimations et le **statut du contrôle payout**, notamment le motif du refus.
- Les demandes de cotation refusées ne consomment plus la limite de signaux ; la V3.1 compte une entrée quand elle envoie l’achat, même si le serveur refuse ensuite cet achat.
- Le bot attend la clôture du contrat précédent et s’arrête si son résultat net manque : un résultat absent n’est pas traité comme zéro pour le budget.
- Sélectionner ou importer prépare les paramètres sans démarrer les achats. Utiliser **Play** pour lancer ; **Stop** interrompt les futures entrées.

## Import

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
  "dbxMinimumProbability": null,
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

Le mode `dbx_dynamic` impose cette version intégrée ; modifier `bypassPayoutFilter` dans un ancien fichier ne désactive pas les contrôles. La mise, `durationTicks`, `dbxMinimumProbability` et `risk.lossBudgetStakes` sont personnalisables à l’import. `dbxMinimumProbability: null` conserve le seuil automatique ; `0.09` signifie un seuil manuel de **9 %** (le champ de l’interface affiche 9). Le seuil manuel est réglable de 0 à 100 %, et la durée de 1 à 10 ticks. Les anciens fichiers sans ces propriétés conservent 1 tick et le seuil automatique.

Ces réglages se changent avant Play, sans cotation, achat ou contrat en cours. En mode manuel, un seuil inférieur à l’équilibre du payout peut autoriser une entrée dont l’espérance estimée est négative. Le budget de perte reste actif. Les 200 ticks de contrôle et le Top 2 sur 50 ticks sont inchangés. Les estimations restent celles du prochain tick : elles ne sont pas calibrées pour les durées supérieures à 1 tick.

## Limites de validation

Les tests logiciels couvrent le calcul du payout, le refus de données insuffisantes, les cotations périmées, les changements de digit, les achats simultanés et le budget. Les séquences synthétiques vérifient les branches du code ; elles ne prouvent aucune rentabilité sur Deriv. Aucun trade réel n’est lancé par cette mise à jour. Il faudrait un historique détaillé et une validation prospective séparée pour évaluer les performances.

## Choix du digit : adaptatif ou manuel

Avant Play, utiliser **Mode du digit** :

- **Adaptatif** (par défaut) : le système choisit dans le Top 2 sur 50 ticks. Le JSON utilise `"barrierMode": "dynamic"` et `"fixedDigit": null`.
- **Manuel** : sélectionner un entier de **0 à 9**, conservé pour chaque contrat jusqu’à modification. Exemple d’import : remplacer ces deux propriétés par `"barrierMode": "fixed"` et `"fixedDigit": 0` pour trader le digit zéro. Le digit n’a pas besoin d’être dans le Top 2.

Le popup affiche le digit manuel et **son** estimation. Le seuil, le contrôle des cotations et le budget de perte restent appliqués. Choisir un digit manuellement ne force donc pas l’achat. Les changements sont bloqués pendant le trading ou tant qu’une cotation, un achat ou un contrat est en cours.
