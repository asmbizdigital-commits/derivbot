# DBX (V3) Adaptatif — Matches dynamique

Nouvelle variante créée dans cette application à partir de **DBX (V2) Pro · Matches fixe 1**. Ce nom distingue notre adaptation du bot XML acheté ; il ne désigne pas une nouvelle version fournie par son vendeur. La version V2 à digit fixe reste disponible séparément.

## Choix dynamique du digit

1. Utiliser les **50 derniers ticks** de Volatility 50 (1s), `1HZ50V`, en respectant la précision des cotations pour extraire les digits.
2. Classer les dix digits et retenir les **deux plus fréquents**. En cas d’égalité de fréquence, classer par digit croissant.
3. Appliquer le sélecteur **Top 2 adaptatif** existant : comparer les estimations issues de la fréquence lissée, des 20 derniers ticks et des transitions, avec une référence uniforme. Les modèles sont pondérés selon leurs prévisions passées, calculées sans utiliser leur résultat futur.
4. Retenir le candidat du Top 2 ayant l’estimation la plus élevée ; départager les égalités par fréquence puis par digit croissant.
5. Recalculer avant chaque nouvelle demande de cotation. Le digit retenu reste attaché à cette cotation et au contrat acheté, même si de nouveaux ticks arrivent entre-temps.

**Aucun digit n’est imposé.** Le digit 1 peut être choisi si le modèle le classe en tête. Le bot ne change pas obligatoirement de digit après une perte et ne force pas d’alternance entre les deux candidats.

Démarrage dès **50 ticks valides disponibles**, y compris ceux chargés depuis l’historique. Aucun seuil supplémentaire de fréquence ou d’Edge n’est imposé. Ce choix fondé sur l’historique ne garantit pas la prédiction du prochain digit ni une meilleure rentabilité.

## Paramètres d’exécution

- Contrat **DIGITMATCH**, durée **1 tick**.
- **Un contrat à la fois**, sur `1HZ50V`.
- Mise **5 par défaut**, réglable dans la devise du compte, puis constante après gains et pertes.
- Martingale, double risque et demi-solde ignorés pour les deux versions DBX.
- Solde, cotation, état de connexion, clôture des contrats précédents et limite de signaux de l’application restent vérifiés.
- La sélection ou l’import prépare le profil sans démarrer les achats. Utiliser **Play** ; **Stop** interrompt les entrées futures.

## Utilisation

Recharger l’application, ouvrir **Deriv Bot → Full automatique → Matches → Liste des stratégies Matches**, puis sélectionner **DBX (V3) Adaptatif · Matches dynamique**. Ajuster la mise, puis lancer **Play**.

Ce document peut aussi être chargé avec **Importer .md**. La nouvelle variante n’est pas un fichier XML importable dans Deriv DBot officiel.

```json
{
  "strategy": "advanced_matches",
  "executionMode": "dbx_dynamic",
  "name": "DBX (V3) Adaptatif · Matches dynamique",
  "contractType": "DIGITMATCH",
  "barrierMode": "dynamic",
  "fixedDigit": null,
  "stake": 5,
  "contractsPerSignal": 1,
  "bypassPayoutFilter": true,
  "rules": {
    "selectionMode": "top_two_adaptive",
    "minimumTicks": 50,
    "windowSize": 50,
    "minimumProbability": 0
  }
}
```

Le mode `dbx_dynamic` sélectionne le profil V3 intégré. Seule la mise est personnalisée à l’import ; les règles ci-dessus décrivent ce profil. Pour retrouver exactement le digit 1 constant, sélectionner **DBX (V2) Pro · Matches fixe 1**.
