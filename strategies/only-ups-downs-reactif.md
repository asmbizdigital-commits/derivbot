# Only Ups / Only Downs - Série réactive

Dans Deriv Bot, choisir **Only Ups / Only Downs**, puis **Importer .md**. Le profil apparaît dans la liste des stratégies. Vérifier le sens, la durée et la mise avant **Play**. L’import ne lance aucun achat et ne fonctionne pas pendant une opération en cours.

## Déclenchement

- Only Ups : attendre deux hausses strictes consécutives, soit trois prix successifs.
- Only Downs : attendre deux baisses strictes consécutives.
- Un prix égal ou un mouvement contraire interrompt la confirmation.
- Le contrat acheté ensuite dure **2 ticks**, indépendamment des mouvements observés avant l’achat.
- Le signal est revérifié à réception du payout. Cotations périmées, prix invalides, paramètres modifiés ou solde insuffisant : achat refusé.
- Ce déclencheur décrit les prix passés, sans garantie de continuation ni de rentabilité.

```json
{
  "strategy": "only_ups_downs",
  "version": 1,
  "name": "Série réactive personnalisée",
  "entryMode": "consecutive",
  "confirmationMoves": 2,
  "durationTicks": 2,
  "contractType": null,
  "stake": null
}
```

## Personnaliser le profil

Un seul bloc JSON est accepté. Les autres passages du Markdown sont descriptifs ; aucun code du fichier n’est exécuté.

| Champ | Valeurs acceptées |
| --- | --- |
| `strategy` / `version` | `"only_ups_downs"` / `1` |
| `name` | Nom de 1 à 100 caractères |
| `entryMode` | `"consecutive"`, `"trend"`, `"momentum"` ou `"reversal"` |
| `confirmationMoves` | Entier de 1 à 5 ; utilisé uniquement par `consecutive` |
| `durationTicks` | Entier de 2 à 5 |
| `contractType` | `"RUNHIGH"` pour Only Ups, `"RUNLOW"` pour Only Downs, `null` pour conserver le sens sélectionné |
| `stake` | Mise de base entre 0,35 et 10 000, ou `null` pour conserver celle de l’interface |

Les modes `trend`, `momentum` et `reversal` utilisent les filtres directionnels existants avec au moins 80 ticks. Ils peuvent attendre plus longtemps. Ils ne transforment pas une probabilité Rise/Fall en probabilité de réussir une série.

Les paramètres non reconnus sont refusés. Les réglages de risque et de pause de l’interface restent applicables ; si un multiplicateur de mise est activé, la mise effective peut différer de la mise de base. Le profil importé reste disponible dans le sélecteur pendant la session de la page ; réimporter après rechargement.
