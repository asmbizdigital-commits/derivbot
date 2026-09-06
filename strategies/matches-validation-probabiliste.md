# Digit Matches — stratégie de validation probabiliste

Conception du 6 septembre 2026. Protocole de recherche et de test en démo ; ce document n'est pas un profil importable et ne modifie pas le bot.

## Objectif

Sélectionner un chiffre uniquement si une validation indépendante indique un avantage économique. Aucune « meilleure probabilité » n'est démontrée avec les données actuellement examinées : aucun historique de résultats et de prix de contrats n'a été testé pour cette conception.

Un contrat DIGITMATCH gagne lorsque le dernier chiffre du tick final correspond au chiffre choisi. Les chiffres possibles vont de 0 à 9. Source : [documentation officielle Deriv](https://legacy-docs.deriv.com/docs/digit-matchesdiffers).

Si les chiffres sont indépendants et uniformes, chaque chiffre a 10 % de probabilité. Une fréquence passée de 30 % sur dix ticks, une longue absence ou une répétition ne change pas cette probabilité. Une échéance de cinq ticks ne donne pas cinq chances : seul le tick final détermine Matches.

## Condition économique d'entrée

Soit S le prix d'achat et R le montant total versé en cas de gain, mise comprise :

- Seuil de rentabilité : p_seuil = S / R.
- Espérance nette par contrat : E = p × R − S.
- Choix : maximiser p_prudente × R / S − 1 parmi les candidats validés.
- Entrée seulement si p_prudente > S / R + 0,01 ; sinon, aucune entrée.

La marge de 0,01 correspond à un point de pourcentage. C'est un choix de prudence à fixer avant le test, pas un avantage démontré. Vérifier le prix et le versement de la proposition effective avant chaque décision.

Exemple purement illustratif : achat 1 USD, versement total 9 USD. Le seuil est 11,11 %. Avec p = 10 %, l'espérance vaut −0,10 USD par contrat. Une estimation ponctuelle à 13 % ne suffit pas si sa borne prudente reste sous 12,11 %.

## Construction et validation

1. Collecter les ticks horodatés d'un seul instrument, avec leur précision officielle pour conserver les zéros finaux. Fixer une échéance, par exemple un tick si disponible. Ne pas mélanger instruments ou échéances.
2. Réserver chronologiquement trois jeux disjoints : développement, calibration et test final. Exemple de budget initial : 50 000 ticks, 25 000 ticks et 25 000 ticks. Ces volumes ne garantissent pas assez de signaux qualifiés ; prolonger la collecte selon un plan fixé à l'avance, sans décider d'arrêter dès qu'un résultat devient favorable.
3. Sur le développement, comparer la référence uniforme à une règle simple de fréquences lissées sur 1 000 ticks : p_d = (nombre_d + 10) / (1 000 + 100). Le lissage ramène les estimations vers 10 %. Considérer le moteur existant comme un autre candidat expérimental, sans assimiler ses scores à des probabilités calibrées.
4. Fixer les paramètres avant calibration. Enregistrer à chaque décision le chiffre sélectionné, le score, l'échéance, le prix proposé et le résultat réellement réglé. Les ticks seuls ne permettent pas de reconstituer les prix historiques ou les délais d'achat.
5. Sur la calibration, définir à l'avance des groupes de scores et calculer leur taux de réussite sur les prédictions sélectionnées, pas sur les dix chiffres rétrospectivement. La borne inférieure unilatérale de Wilson à 99 % peut servir de p_prudente sous une hypothèse d'indépendance raisonnable. Si les résultats sont dépendants, employer une méthode par blocs adaptée ou s'abstenir. Corriger les comparaisons multiples si plusieurs groupes ou stratégies sont évalués.
6. Geler règle, groupes, bornes et filtres. Tester une seule fois sur le jeu final, avec uniquement les informations disponibles avant chaque décision. Exiger une espérance observée positive et une borne inférieure de confiance positive sur le rendement net, en tenant compte des dépendances. Tout ajustement après ce test impose de nouvelles données finales.
7. Confirmer prospectivement en démo avec les propositions et règlements effectifs. Un groupe insuffisamment documenté, une borne sous le seuil ou un résultat final non concluant signifie « attendre », même si le score affiché est élevé.

Les bornes historiques ne garantissent pas la probabilité future. Contrôler la dégradation sur des périodes de surveillance fixées à l'avance ; suspendre et revalider si la calibration ou les rendements se dégradent. Ne pas multiplier les essais jusqu'à obtenir une validation favorable.

## Exécution et limites de risque proposées

- Démo pendant toute la validation ; un seul contrat ouvert à la fois.
- Mise fixe plafonnée à 0,25 % du capital de début de session, sans martingale ni récupération après perte. Si la mise minimale du contrat dépasse ce plafond, ne pas entrer.
- Budget de perte de session de 2 % de ce capital : refuser toute nouvelle mise dont la perte ferait dépasser le budget. Ce plafond limite l'exposition, sans améliorer la probabilité.
- Ne pas changer de chiffre parce qu'il vient de perdre ; ne pas augmenter la mise pour récupérer. Recalculer uniquement selon la règle validée.
- Suspendre les entrées si des ticks manquent, si la précision est inconnue, si la proposition n'est plus valide ou si un contrat n'est pas réconcilié.

À 10 % de réussite avec indépendance, la probabilité que les 20 prochains contrats soient tous perdants est 0,9^20 ≈ 12,16 %. Le risque de rencontrer une telle série au cours d'une longue session est plus élevé. Avoir au moins un gain ne signifie pas finir bénéficiaire.

## Conséquences pour le projet actuel

`lib/match-prediction.ts` combine des fréquences et des transitions historiques. Sa propriété `probability` est une estimation heuristique non validée dans cette étude. Augmenter `minimumProbability` ne démontre pas une meilleure probabilité réelle.

Le profil `matches-momentum-equilibre.md` sélectionne le chiffre le plus fréquent sur dix ticks, désactive le filtre de prix et prévoit une augmentation de mise après perte. Ces règles ne constituent pas une preuve d'avantage probabiliste.

Pour automatiser ce protocole, il reste à implémenter la collecte des propositions et résultats, la calibration indépendante, les bornes prudentes et le contrôle du budget avant achat. Les profils actuels ne suffisent pas à appliquer cette validation. Aucun ordre n'a été envoyé et aucun réglage d'exécution n'a été changé.
