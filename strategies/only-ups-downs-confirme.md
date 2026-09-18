# Only Ups / Only Downs - Série confirmée

Importer dans la catégorie **Only Ups / Only Downs**, vérifier la mise et le sens puis appuyer sur **Play**. Aucun achat ne démarre à l’import.

Ce profil attend **trois mouvements stricts consécutifs** dans le sens sélectionné, soit quatre ticks. Un mouvement contraire ou égal casse la confirmation. Le contrat suivant dure **2 ticks**. Les observations avant achat ne garantissent pas les mouvements après entrée.

```json
{
  "strategy": "only_ups_downs",
  "version": 1,
  "name": "Série confirmée personnalisée",
  "entryMode": "consecutive",
  "confirmationMoves": 3,
  "durationTicks": 2,
  "contractType": null,
  "stake": null
}
```

`contractType: null` conserve le sens choisi dans l’interface ; `stake: null` conserve la mise de base. Les réglages de risque existants restent applicables. Pour les autres options, consulter `only-ups-downs-reactif.md`.
