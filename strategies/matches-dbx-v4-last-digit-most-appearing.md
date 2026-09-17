# DBX (V4) Last Digit + Most Appearing

Nouvelle variante locale de DBX. Les versions V2 (digit 1 fixe) et V3 (choix adaptatif) restent disponibles séparément.

## Règle d’entrée

1. Extraire les digits des **50 derniers ticks**, en conservant la précision du marché et les zéros finaux. La fenêtre inclut le dernier tick reçu.
2. Compter les occurrences de chaque digit de 0 à 9, puis retenir les **deux plus fréquents**. Les égalités sont départagées par digit croissant pour obtenir un classement déterministe.
3. Lire le **dernier digit reçu**. S’il est hors du Top 2, attendre un nouveau tick.
4. S’il correspond au premier ou au deuxième plus fréquent, demander **Matches sur ce même digit**. Il ne s’agit ni d’un tirage aléatoire, ni d’une alternance imposée.
5. À réception de la cotation, vérifier à nouveau que le dernier digit est toujours le digit coté et qu’il appartient toujours au Top 2. Sinon, annuler cette entrée et attendre un nouveau signal.

Exemple : Top 2 = **7 et 3**. Dernier digit **3** → proposition Matches **3**. Dernier digit **7** → proposition Matches **7**. Dernier digit **9** → **attente**, sans achat.

Le chiffre observé avant l’achat n’est pas le résultat du prochain contrat. Cette règle ne démontre pas un avantage prédictif : les fréquences affichées sont des **fréquences historiques**, pas des probabilités garanties. La V4 ne promet pas de réduire les séries perdantes.

## Paramètres

- Instrument : **Volatility 50 (1s)**, `1HZ50V`.
- Contrat : **DIGITMATCH**, durée manuelle de **1 à 10 ticks** (1 par défaut), **un contrat à la fois**.
- Mise : **5 dans la devise du compte par défaut**, modifiable avant Play, puis constante après gains et pertes.
- Démarrage après **50 ticks valides disponibles**, y compris l’historique chargé.
- Aucun seuil additionnel de fréquence ou d’Edge. Les vérifications de cotation, de solde, de portefeuille, les contrats déjà engagés, Stop et la limite de signaux restent applicables.
- Martingale, double risque et demi-solde ignorés, comme sur les autres variantes DBX.
- Après une perte, aucune rotation forcée : un même digit peut être choisi à nouveau s’il satisfait la règle sur un nouveau signal.

## Popup et sélection

Dans **Full automatique → Matches → Liste des stratégies Matches**, choisir **DBX (V4) Last Digit + Most Appearing**. La popup présente le **dernier digit reçu**, les deux **Most Appearing**, leurs fréquences, et le **digit à matcher** uniquement quand le signal est qualifié. Elle indique l’attente si le dernier digit est hors Top 2 ou si la fenêtre est incomplète.

Sélectionner ou importer le profil prépare les paramètres sans lancer les achats. Utiliser **Play** pour démarrer.

```json
{
  "strategy": "advanced_matches",
  "executionMode": "dbx_last_digit",
  "name": "DBX (V4) Last Digit + Most Appearing",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "stake": 5,
  "durationTicks": 1,
  "contractsPerSignal": 1,
  "bypassPayoutFilter": true,
  "rules": {
    "selectionMode": "last_digit_top_two",
    "minimumTicks": 50,
    "windowSize": 50,
    "minimumProbability": 0
  }
}
```

Ce Markdown est destiné à l’importeur de cette application. Le mode `dbx_last_digit` impose les règles V4 décrites ; la mise et `durationTicks` sont personnalisables à l’import. Il ne s’agit pas d’un XML pour Deriv DBot officiel.
