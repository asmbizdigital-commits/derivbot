# Under 5 + Over 4 — deux instruments distincts, mode réactif

Stratégie intégrée dans **Deriv Bot → Under / Over → Under 5 + Over 4**. Ce guide décrit l’option du bot ; il ne s’importe pas dans l’importeur Markdown réservé à Matches.

## Fonctionnement

Chaque signal engage deux contrats de 1 tick, envoyés consécutivement sans attendre l’accusé du premier :

- **Under 5 sur l’instrument A** : gagne si son dernier chiffre est 0, 1, 2, 3 ou 4.
- **Over 4 sur l’instrument B** : gagne si son dernier chiffre est 5, 6, 7, 8 ou 9.

**A et B sont obligatoirement différents.** Exemple : Under 5 sur Volatility 25 et Over 4 sur Volatility 15 (1s). Ce sont des instruments sélectionnés dynamiquement, pas une paire imposée. Une seule paire peut être en cours. Sans deux instruments admissibles, le bot attend.

Les deux achats ne forment pas une opération atomique : leurs heures d’exécution et leurs ticks de règlement peuvent différer. Le résultat de chaque instrument est distinct ; les deux contrats peuvent gagner, les deux perdre, ou un seul gagner. Des instruments différents ne constituent pas une garantie d’indépendance statistique.

## Analyse séparée de chaque côté

1. Découvrir tous les indices de volatilité disponibles avec `active_symbols`, hors marchés fermés ou suspendus.
2. Vérifier séparément `contracts_for` : DIGITUNDER barrière 5 pour un candidat Under ; DIGITOVER barrière 4 pour un candidat Over. La durée de 1 tick doit être disponible. Un marché qui propose un seul des deux côtés peut être sélectionné pour ce côté.
3. Charger jusqu’à 200 ticks par indice, avec au moins 100 ticks avant qualification. Utiliser la précision de l’API ; conserver les zéros finaux, trier et dédupliquer par timestamp. Écarter un flux âgé de plus de 5 secondes.
4. Pour Under, compter les chiffres **0–4** de cet indice ; pour Over, compter **5–9**. Chaque côté exige au moins 52 % sur la fenêtre disponible (100 à 200 ticks) et 50 % sur les 50 derniers ticks.
5. Attendre un **passage vers la zone gagnante reçu en direct** sur chacun des deux instruments : **5–9 → 0–4 pour Under 5**, **0–4 → 5–9 pour Over 4**. Un changement au sein de la même zone ne déclenche pas d’entrée et ne prolonge pas la validité d’une transition. Un retour dans la zone perdante invalide le signal de ce côté. La transition doit dater de 5 secondes au maximum et relier deux ticks espacés de 5 secondes au maximum. L’historique initial, les doublons et les ticks arrivés en retard ne constituent pas un déclenchement.
6. Comparer les combinaisons ordonnées Under/Over admissibles, avec symboles différents. Ne retenir que les instruments avec une transition récente non consommée. Sélectionner la plus grande somme des deux fréquences lissées définies ci-dessous ; départager les égalités par symbole. Le choix est effectué avant cotations, sans prétendre comparer les payouts de toutes les combinaisons.

L’indice du graphique reste un réglage d’affichage indépendant. Le tableau de scan indique les fréquences Under et Over de chaque indice. Le journal des paires affiche le symbole propre à chaque contrat.

## Validation des cotations

Chaque fréquence est lissée vers 50 % : `(nombre de chiffres gagnants + 25) / (nombre de ticks + 50)`.

Pour chaque côté, la fréquence prudente est le minimum entre cette estimation lissée et `fréquence observée − sqrt(ln(2 × M / 0,05) / (2 × N))`, limité à zéro. `M` est le nombre d’indices découverts ; `N` est le nombre de ticks de l’instrument concerné. Ces bornes supposent des observations indépendantes dans un échantillon fixe. Elles ne garantissent pas un niveau de confiance de 95 % après des sélections répétées en direct. **En mode réactif, cette borne reste un diagnostic interne et ne bloque plus l’achat.**

Une transition est consommée dès la demande de cotation, y compris si celle-ci est refusée. Une nouvelle paire attend de nouveaux changements sur ses deux instruments. Les transitions sont revérifiées avant achat et doivent toujours dater de 5 secondes au maximum. Les deux cotations sont demandées avant achat. Pour chaque contrat : prix positif, au plus la mise prévue, payout supérieur à son prix, et `fréquence lissée × payout − prix > 0`. L’espérance historique cumulée doit être positive ; le seuil supplémentaire de 2 % est supprimé. Une cotation à espérance historique négative sur un seul contrat reste refusée, même si l’autre contrat pourrait compenser. Le payout désigne le versement total, mise comprise.

Les fréquences et la fraîcheur des **deux** instruments sont revérifiées quand les cotations arrivent. Une dégradation, une cotation invalide, refusée, trop ancienne ou absente annule l’ensemble avant achat. Le bot ne remplace pas un instrument tout en conservant sa cotation précédente.

Le filtre n’exige plus qu’un seul payout couvre les deux mises : cette condition de l’ancienne stratégie ne convient pas aux nouvelles barrières. Exemple fictif : avec deux mises de 0,50 et deux payouts de 0,95, deux gains donnent +0,90 ; un gain et une perte donnent −0,05 ; deux pertes donnent −1,00. Les valeurs réelles dépendent des cotations.

## Mise et protections

- Régler la **mise par contrat** directement dans le panneau Under 5 + Over 4 : deux fois cette mise est engagée par signal. Le « total calculé » est le montant des deux mises, pas une limite. Martingale, double risque et demi-solde sont ignorés pour cette stratégie.
- Aucun budget monétaire de session ni plafond fixe de 2 par contrat n’est appliqué à cette stratégie. La mise saisie est envoyée sans réduction, sous réserve que le solde couvre les deux contrats et que Deriv accepte les cotations. Les pauses après pertes et la protection du pic restent actives.
- Après **2 contrats perdants consécutifs sur un même instrument**, exclure cet instrument pendant 60 secondes. Une perte n’est pas attribuée à son partenaire. Une pause limite l’exposition et ne rend pas les chiffres suivants plus prévisibles.
- Après **3 paires déficitaires consécutives**, tous instruments confondus, arrêter les entrées. Le résultat d’une paire est la somme des profits nets réellement reçus pour ses deux contrats.
- Dès que le pic de bénéfice atteint le coût de deux paires, refuser une entrée dont la perte maximale ramènerait le résultat sous 50 % de ce pic.
- En cas d’achat partiellement refusé ou d’accusé manquant, arrêter sans rachat automatique et conserver le suivi des contrats acceptés. En cas de résultat net manquant, arrêter pour réconciliation du portefeuille.
- Stop bloque les nouvelles entrées et conserve le suivi engagé. Un nouveau Play remet les compteurs de session à zéro. Les résultats antérieurs ne sont pas reconstruits.

## Utilisation après mise à jour

Arrêter l’ancienne session, attendre le règlement des contrats en cours, puis recharger l’application. Choisir **Under 5 + Over 4** et lancer une nouvelle session avec Play. Les contrats déjà achetés gardent leur instrument et leur barrière d’origine.

La transition est un déclencheur temporel et ne prouve pas que le prochain chiffre sera gagnant. Le mode réactif accepte des signaux que la borne prudente rejetterait : l’incertitude statistique est plus grande. Les fréquences historiques ne démontrent pas un avantage prédictif. Le filtre peut rester longtemps sans signal et ne garantit aucune rentabilité. Les vérifications utilisent des achats simulés ; aucun ordre réel n’est nécessaire pour tester le code.

Règles de règlement : [documentation officielle Deriv Over/Under](https://legacy-docs.deriv.com/docs/digit-overunder).
