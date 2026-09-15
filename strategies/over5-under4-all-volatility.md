# Over 5 + Under 4 — filtre prudent et résultats par paire

Stratégie intégrée directement dans **Deriv Bot → Under / Over → Over 5 + Under 4**. Ce document est un guide, pas un profil à importer dans l'importeur Markdown réservé à Matches.

## Mise en route

1. Ouvrir la version mise à jour de l'application et connecter un compte Options, de préférence démo pour le premier essai.
2. Sélectionner **Under / Over**, puis **Over 5 + Under 4**. Le mode passe en automatique, sans acheter tant que Play n'est pas pressé.
3. Régler la **mise fixe par contrat**. Deux contrats sont engagés par signal : 0,50 par contrat coûte au plus 1,00 par paire, dans la devise du compte.
4. Régler le budget de perte de session (4 unités par défaut). Une nouvelle paire est refusée si la perte de ses deux mises ferait dépasser ce budget à partir du résultat réalisé de la session.
5. Appuyer sur **Play**. La limite de signaux de l'application compte une paire comme un signal et deux achats comme deux contrats. Stop bloque les futures entrées tout en conservant le suivi des achats déjà envoyés.

## Analyse et sélection

- Découverte dynamique via `active_symbols`, sans se limiter aux dix indices du sélecteur de graphique. Marchés fermés ou suspendus exclus.
- Vérification via `contracts_for` de la disponibilité de DIGITOVER barrière 5 et DIGITUNDER barrière 4, à une durée de 1 tick.
- Un abonnement par indice avec historique de 1 000 ticks ; précision fournie par l'API. Les historiques restent séparés, ordonnés et dédupliqués par timestamp. Un flux de plus de 5 secondes n'est pas sélectionné.
- Après au moins 500 ticks : fréquences 6–9 et 0–3 d’au moins 30 % chacune, couverture totale d’au moins 84 %, confirmée à 84 % sur les 200 derniers ticks et à 80 % sur les 50 derniers ticks.
- Classement des indices qualifiés par couverture totale décroissante ; égalités départagées par symbole. Une seule paire active, sur le meilleur indice disponible ; pas de paires simultanées sur tous les indices.
- L'indice du graphique reste un choix d'affichage indépendant. Le tableau de scan, le statut et le suivi des contrats indiquent le marché effectivement utilisé.

Ces seuils sont des paramètres expérimentaux, pas des probabilités de gain démontrées. Chaque estimation est lissée vers 40 % : `(nombre de chiffres gagnants + 20) / (nombre de ticks + 50)`.

## Cotations et exécution

Les deux propositions sont demandées avant tout achat. Le prix de chaque contrat doit être positif et ne pas dépasser la mise prévue. Le coût cumulé doit tenir dans la balance et le budget de session.

L'espérance estimée de la paire est `p_over × payout_over + p_under × payout_under − coût_total`. Le versement comprend la mise. L’estimation ponctuelle positive ne suffit plus pour acheter. Pour chaque côté, on retranche à la fréquence observée une marge `sqrt(ln(2 × M / 0,05) / (2 × N))`, où `M` est le nombre d’indices découverts et `N` le nombre de ticks. La probabilité prudente retenue est le minimum de cette borne et de l’estimation lissée, limité à zéro. Les bornes de Hoeffding et la correction de Bonferroni correspondent à un échantillon fixe d’observations indépendantes ; elles ne constituent pas une garantie à 95 % pour des sélections répétées en direct.

L’espérance calculée avec ces probabilités prudentes doit dépasser **2 % du coût total**. Le plus petit des deux payouts doit aussi dépasser le coût total : un seul gain doit pouvoir couvrir les deux mises. Une fréquence élevée peut donc être refusée si les cotations ou l’incertitude rendent la paire défavorable. Ces estimations restent historiques et non calibrées sur des résultats futurs ; elles ne démontrent pas une rentabilité réelle. Sur un flux proche d’une répartition uniforme, le bot peut rester longtemps sans entrer.

Les requêtes d'achat sont envoyées consécutivement dans la même exécution, sans attendre le premier achat pour envoyer le second. L'API ne garantit ni une transaction atomique, ni un tick final identique. Une cotation manquante, invalide, périmée ou refusée annule toute la paire avant achat. Si un achat est refusé ou si un accusé manque, le bot arrête les entrées ; il ne réessaie pas automatiquement et conserve le suivi des achats engagés. Une réponse d'achat incertaine exige une reconnexion et une réconciliation du portefeuille avant reprise.

La mise est fixe pour les deux contrats : martingale, double risque et risque demi-solde ne sont pas appliqués à cette stratégie. Les indices récemment refusés sont temporairement écartés pour permettre la comparaison des suivants.

## Protection et suivi de session

- Le résultat d’une paire est la somme des profits nets réellement retournés pour ses deux contrats. Les accusés et règlements dupliqués ne sont comptés qu’une fois, quel que soit leur ordre.
- Après **2 paires déficitaires consécutives sur un indice**, cet indice est écarté pendant 60 secondes. Cela limite l’exposition ; cette pause ne rend pas les chiffres suivants plus prévisibles.
- Après **3 paires déficitaires consécutives tous indices confondus**, la session s’arrête. Aucune augmentation de mise ni récupération automatique.
- Dès que le pic de bénéfice atteint le coût de deux paires, la stratégie refuse une nouvelle entrée si sa perte maximale ramènerait le résultat sous 50 % de ce pic. Le budget de perte reste vérifié séparément.
- Un résultat net manquant déclenche un arrêt pour réconciliation ; il n’est pas considéré comme un gain ou un résultat nul.
- Le panneau affiche les paires rentables, déficitaires, la série de pertes et le résultat net des paires complètes, ainsi que les dix dernières paires. Les achats partiellement refusés restent visibles comme paires incomplètes, avec les contrats acceptés suivis dans le journal habituel ; ils sont exclus de ce total de paires complètes.
- Les compteurs et protections portent sur la session courante, sans reprise automatique après arrêt. Un nouveau Play remet la session à zéro. L’historique antérieur à cette mise à jour n’est pas reconstruit.

## Résultats possibles

Si les deux contrats se règlent sur le même chiffre : 0–3 fait gagner Under 4 seulement ; 6–9 fait gagner Over 5 seulement ; 4 ou 5 fait perdre les deux. Un contrat gagnant ne garantit pas un bénéfice net sur la paire, puisqu'il faut couvrir les deux mises. Si les contrats se règlent sur des ticks différents, ils peuvent tous deux gagner ou tous deux perdre.

Exemple de la capture du 15 septembre : deux mises de 2 et un payout gagnant de 4,85 donnent **+0,85 par paire à un gain**, contre **−4 pour une double perte**. Il faut donc cinq paires à +0,85 pour dépasser une perte de 4. Avec exactement ces deux issues, le seuil de rentabilité est `4 / 4,85 ≈ 82,47 %` de paires à un gain. Ce seuil change avec les cotations et l’exécution ; le taux de contrats gagnants ne suffit pas à évaluer la stratégie.

Source : [règles Over/Under Deriv](https://legacy-docs.deriv.com/docs/digit-overunder) et [flux API officiel](https://developers.deriv.com/docs/workflows/).

## Vérifications effectuées

Tests automatisés : résultat net par paire, règlements dupliqués ou inversés, espérance ponctuelle positive refusée après marge d’incertitude, pause par indice, arrêt après trois pertes, protection du pic avant achat, résultat net manquant, barrières strictes, indices découverts dynamiquement, classement, précision, déduplication, attente des deux cotations, fonds insuffisants, Stop, données périmées, refus partiel et réponse d'achat manquante. Vérification publique en lecture seule le 15 septembre 2026 : 13 indices découverts, 200 ticks frais par indice. Les achats sont simulés dans les tests ; aucun trade réel n'a été ouvert pour valider cette fonctionnalité.
