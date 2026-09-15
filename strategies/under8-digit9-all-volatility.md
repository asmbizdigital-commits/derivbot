# Under 8 — sortie du digit 9 sur toutes les volatilités

Cette stratégie est intégrée au bot. Ce document décrit son fonctionnement ; il ne s’importe pas avec l’importeur Markdown Matches.

## Activation

Choisir **Over/Under → Under 8**, régler la **mise par contrat**, puis utiliser **Full automatique → Play**. Le graphique n’impose pas les indices du scanner.

## Déclenchement et sélection

- Découverte de tous les indices de volatilité disponibles pour le compte, standards et 1 seconde, y compris les nouveaux symboles renvoyés par Deriv.
- Vérification de la disponibilité de `DIGITUNDER`, barrière **8**, durée **1 tick**, pour chaque indice.
- Historique glissant demandé : **200 ticks**. Aucun minimum de 100 ou 200 ticks n’est imposé au déclencheur : deux ticks consécutifs valides suffisent après initialisation du flux.
- Sur chaque indice : attendre un **9**, puis un digit **différent de 9**, donc **0 à 8**. Une répétition `9 → 9` n’est pas une sortie.
- Il faut un signal reçu en direct depuis **5 secondes au maximum sur chacun de deux indices distincts**. Les horodatages des deux ticks qui forment un signal doivent être espacés de 5 secondes au maximum.
- Le retour au **9** invalide le signal ; les ticks dupliqués ou anciens ne créent pas de signal. L’historique seul ne déclenche aucun achat.
- Parmi les signaux disponibles, sélectionner les deux indices ayant les fréquences Under 8 lissées les plus élevées : `(nombre de digits 0–7 + 40) / (nombre de ticks + 50)`. En cas d’égalité, ordre alphabétique des symboles.
- Chaque signal est consommé à la demande de cotation, même si celle-ci échoue. Une nouvelle paire nécessite de nouveaux signaux.

Le déclencheur reste **9 → autre digit** : `9 → 8` le déclenche aussi. Under 8 gagne lorsque le digit de fin du contrat est **0–7**, et perd pour **8 ou 9**. Le digit observé avant l’achat n’est pas le résultat du contrat suivant.

## Exécution de la paire

Les deux propositions portent sur des indices différents, chacune avec `DIGITUNDER`, barrière `8`, durée `1t` et la mise choisie. Après réception des deux cotations, le bot revérifie leur validité, la fraîcheur des signaux et le solde, puis envoie les **deux achats sans attendre la réponse du premier**.

L’exécution n’est pas atomique : le serveur peut accepter un achat et refuser l’autre. Dans ce cas, le bot arrête les nouvelles entrées et continue de suivre le contrat accepté, sans rachat automatique. Une nouvelle paire attend la résolution des achats et la clôture des contrats engagés.

Aucun seuil de fréquence ou d’espérance historique positive supplémentaire n’est ajouté au déclencheur Under 8. Les estimations historiques affichées servent au classement et au diagnostic, pas à garantir le résultat futur.

## Mise et suivi

- Mise identique pour les deux contrats, minimum applicatif **0,35** dans la devise du compte ; Deriv peut imposer ses propres conditions.
- Aucun plafond applicatif fixe de **2 USD**. Coût prévu de la paire : **2 × mise par contrat**, couvert par le solde disponible.
- Mise fixe : les options martingale, double risque et demi-solde ne s’appliquent pas au scanner multi-indices.
- Pause de **60 secondes** d’un indice après **2 contrats perdants consécutifs** sur cet indice.
- Arrêt après **3 paires déficitaires consécutives** ; protection de la moitié du pic de bénéfice une fois le pic égal au coût de deux paires, avant une nouvelle entrée qui pourrait franchir ce seuil.
- Le suivi conserve le contrat, l’indice et le résultat de chaque jambe, puis calcule le résultat net de la paire complète.
- **Stop** annule les entrées futures, sans effacer le suivi des contrats déjà engagés.

La sortie du digit 9 et les fréquences observées ne démontrent pas un avantage prédictif. Les deux contrats peuvent perdre ; aucune rentabilité n’est garantie.
