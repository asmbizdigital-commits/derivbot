# DBX (V2) Pro — Matches fixe 1

Stratégie extraite du fichier fourni `DBX (V2) Pro (1) (5).xml`.
Disponible dans **Deriv Bot → Full automatique → Matches → Liste des stratégies Matches**.
Ce fichier peut aussi être chargé avec **Importer .md**, puis lancé avec **Play**.

## Règles réellement présentes dans le XML

| Paramètre | Valeur exécutée |
| --- | --- |
| Instrument | Volatility 50 (1s), `1HZ50V` |
| Contrat | `DIGITMATCH` |
| Digit prédit | **1**, constant |
| Durée | **1 tick** |
| Mise | **5**, littérale dans le bloc `AMOUNT` |
| Entrée | Achat sans condition statistique ; test d’égalité de deux textes vides, donc vrai |
| Après clôture | `trade_again`, recommencer après gain ou perte |
| Sortie anticipée | Aucune : le bloc `check_sell` n’a pas d’action associée |
| Arrêt de gain/perte | Aucun seuil défini dans le fichier |
| Redémarrage sur erreur | Activé dans le XML |

Le fichier ne calcule ni fréquence de digits, ni transition, ni probabilité, ni classement de digits.
Le commentaire désactivé affirmant que `AMOUNT` utilise `CURRENT_STAKE` ne correspond pas au branchement effectif : `AMOUNT` contient le nombre **5**.

La martingale est initialisée à **FALSE**. Son code pourrait multiplier la variable `CURRENT_STAKE` par 2 après une perte, mais cette variable n’est jamais lue par `AMOUNT` : activer ce booléen ne modifierait donc pas les mises de cette version XML. Le changement de Step Index est également désactivé et ses variables ne sont pas utilisées pour sélectionner le marché.

## Adaptation dans l’application

- Digit **1**, instrument **1HZ50V**, durée réglable de **1 à 10 ticks** (1 par défaut), **un contrat à la fois**. Choisir la durée avant Play dans **Durée en ticks** ; arrêter le bot et attendre la clôture du contrat avant de la modifier.
- Mise de départ **5 dans la devise du compte**, réglable dans le champ de mise. Elle reste constante après un gain ou une perte ; aucune martingale ou multiplication liée au solde ne s’applique.
- Aucun filtre statistique, blocage du digit après pertes ou seuil d’Edge n’est ajouté. Le popup de prédiction Matches est affiché, avec le dernier digit reçu et un rappel du digit 1 acheté et de la durée. Ses estimations sont informatives et ne modifient pas le digit ou les entrées de V2 ; elles concernent le prochain tick, pas une échéance de plusieurs ticks.
- Après clôture, le prochain traitement de ticks peut déclencher le contrat suivant. Le bot attend toujours la résolution de la cotation, de l’achat et du contrat précédent.
- Cotation valide et solde suffisant requis. Le bouton **Stop**, la connexion et la limite de signaux de l’application restent applicables.
- Choisir ou importer ce profil ne lance pas les achats : utiliser **Play**.

Le nom commercial du bot n’apporte aucune preuve d’un avantage prédictif ou de rentabilité.

## Configuration importable

```json
{
  "strategy": "advanced_matches",
  "executionMode": "dbx_fixed",
  "name": "DBX (V2) Pro · Matches fixe 1",
  "contractType": "DIGITMATCH",
  "barrierMode": "fixed",
  "fixedDigit": 1,
  "stake": 5,
  "durationTicks": 1,
  "contractsPerSignal": 1,
  "bypassPayoutFilter": true
}
```

Le mode `dbx_fixed` impose les paramètres opérationnels extraits du XML (digit 1, instrument 1HZ50V, un contrat). La mise et la durée en ticks sont personnalisables dans cette adaptation ; il ne s’agit pas d’un importeur universel de bots XML.

La règle Matches porte sur le dernier digit du **tick final** du contrat, comme décrit dans la [documentation Deriv](https://legacy-docs.deriv.com/docs/digit-matchesdiffers).
