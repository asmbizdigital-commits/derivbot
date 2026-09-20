# Copytrading MT5 — 1 master et jusqu’à 50 suiveurs

Le module transmet les positions exécutées d’un terminal MT5 master vers des terminaux MT5 suiveurs. Chaque terminal possède une identité, une clé et une file de commandes distinctes. L’EA fourni est `DerivCopyTradingEA.mq5` ; il est indépendant de `DerivAITraderEA.mq5`.

**Une interface ouverte dans le navigateur ne suffit pas : le serveur et les terminaux MT5 doivent rester connectés.** Le module reste actif lorsque la page est fermée. Les mots de passe des comptes MT5 restent dans les terminaux ; seuls les identifiants de connexion, positions et equity sont transmis au serveur par HTTPS.

## 1. Préparer le serveur Render avec MySQL

Si le service privé MySQL est déjà créé dans un Blueprint, il faut maintenant connecter **le service web de l’application** à cette base. La création du service MySQL ne configure pas automatiquement l’application.

Dans Render, ouvrir le service web `derivbot` → **Environment** et renseigner :

| Variable sur le service web | Valeur / provenance |
| --- | --- |
| `COPYTRADING_STORAGE` | `mysql` |
| `COPYTRADING_ADMIN_KEY` | Clé aléatoire d’au moins 32 caractères, réservée à l’administrateur. Génération locale possible : `openssl rand -hex 32`. Elle est indépendante du mot de passe MySQL. |
| `MYSQL_HOST` | Nom d’hôte interne affiché dans **Connect / Internal** ou **Service Addresses** du service MySQL. Copier seulement l’hôte, sans `:3306` et sans `mysql://`. |
| `MYSQL_PORT` | `3306` — ne pas utiliser le port MySQL X `33060`. |
| `MYSQL_DATABASE` | `derivbot` — base dédiée à l’application. Ne pas utiliser la base système `mysql`. |
| `MYSQL_USER` | Utilisateur MySQL ayant accès à cette base. Utiliser un compte applicatif dédié, pas le compte root. |
| `MYSQL_PASSWORD` | Mot de passe de cet utilisateur, saisi uniquement dans les variables privées Render. |
| `MYSQL_SSL` | `false` pour la connexion privée au service MySQL du Blueprint standard ; `true` pour un serveur configuré avec TLS. La validation du certificat reste activée en mode TLS. |
| `MYSQL_SSL_CA` | Facultatif : certificat d’autorité pour un serveur TLS avec une CA privée. |
| `COPYTRADING_PUBLIC_URL` | Facultatif : URL publique exacte si vous utilisez un domaine personnalisé. Sur Render, le contrôle d’origine utilise automatiquement `RENDER_EXTERNAL_URL` pour le domaine `onrender.com`, même lorsque la connexion interne est en HTTP. |

Le service web et MySQL doivent appartenir au **même workspace et à la même région**. Vérification du 20 septembre 2026 : le service web `derivbot` et le nouveau service `mysql-frankfurt` sont tous deux à **Francfort**. Une connexion SQL depuis le service web vers la base `derivbot` a réussi avec l’utilisateur applicatif `derivbot`. L’adresse interne n’est pas directement accessible depuis un ordinateur hors Render. Pour développer localement, utiliser une base locale ou un tunnel explicitement configuré.

Sur le service MySQL, vérifier qu’un disque persistant est monté exactement sur **`/var/lib/mysql`**. Le statut « Live » confirme que le service tourne, pas à lui seul que les données sont conservées après redéploiement. Prévoir des sauvegardes MySQL avec `mysqldump`.

Après avoir renseigné les variables, déployer la version mise à jour du code. L’application crée automatiquement la table InnoDB **`copytrading_state`** dans la base choisie ; elle ne crée pas de base ni d’utilisateur MySQL. Le compte applicatif doit disposer des droits `CREATE`, `SELECT`, `INSERT` et `UPDATE` sur cette base. Les paramètres, clés terminal hachées, commandes et acquittements sont conservés dans cette table. Les mots de passe MySQL ne sont jamais exposés dans l’interface.

Ouvrir **Copytrading**, puis se connecter avec `COPYTRADING_ADMIN_KEY`. Le message **« Stockage MySQL connecté »** apparaît uniquement après une lecture réussie de la base. Une erreur de configuration ou de connexion bloque les commandes ; le système ne revient pas silencieusement au stockage fichier.

Chaque modification utilise une transaction et un verrou de ligne. La commande n’est renvoyée au terminal qu’après confirmation du `COMMIT`. Le tableau de bord et les terminaux partagent ainsi le même journal, y compris avec des requêtes concurrentes. Conserver une instance applicative pour cette version : une nouvelle instance remet les ouvertures en pause au démarrage. Les identités et identifiants des commandes en attente sont préservés, et les copies existantes restent suivies après reconnexion.

Le disque persistant du **service web** et les variables `COPYTRADING_DATA_DIR` / `COPYTRADING_PERSISTENT_STORAGE` ne sont pas nécessaires en mode MySQL. Le service web Free peut émettre des requêtes privées, mais reste soumis aux limites de disponibilité de cette offre. Aucun changement d’offre ni création d’un deuxième service MySQL n’est effectué par cette configuration.

Le fichier `render.yaml` déclare ces variables pour le service web, avec les valeurs sensibles à saisir dans Render. Pour un service déjà déployé, vérifier manuellement **Environment** après la synchronisation du Blueprint : ajouter des entrées `sync: false` ne remplit pas les secrets existants.

Sources : [MySQL sur Render](https://render.com/docs/deploy-mysql), [réseau privé Render](https://render.com/docs/private-network), [verrouillage InnoDB](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html).

### Stockage local facultatif et changement de stockage

Sans `COPYTRADING_STORAGE=mysql`, le mode `file` reste disponible pour les installations existantes. Il utilise `.copytrading-data/state.json` par défaut, ou `COPYTRADING_DATA_DIR`. Les comptes réels y nécessitent un répertoire persistant et `COPYTRADING_PERSISTENT_STORAGE=true`. Une seule instance/processus peut utiliser ce stockage fichier.

Le passage de `file` à `mysql` **ne migre pas automatiquement** les anciens comptes et positions. Si le module était déjà utilisé, suspendre les copies, résoudre les commandes en attente et fermer/réconcilier les positions avant de changer de stockage ; conserver la sauvegarde du journal. Ne pas recréer aveuglément les comptes autour de copies encore ouvertes. Pour une première installation, enregistrer les terminaux directement après la connexion MySQL.

## 2. Enregistrer le master et les suiveurs

1. Ouvrir **Copytrading** et saisir la clé administrateur. Elle reste en mémoire dans la page, sans stockage dans le navigateur.
2. Cliquer sur **Ajouter un terminal** pour ouvrir la fenêtre d’enregistrement. Enregistrer le master avec son nom, son **login MT5 numérique**, le **nom exact du serveur MT5** et le mode démo/réel. Une erreur laisse les champs saisis disponibles pour correction.
3. Conserver `AgentId` et `AgentKey`, affichés une seule fois. Utiliser **Copier AgentId** pour le champ MT5 `AgentId` (36 caractères), puis **Copier AgentKey** pour `AgentKey` (64 caractères). Chaque bouton copie uniquement sa valeur. Ne pas les partager avec d’autres terminaux.
4. Enregistrer chaque suiveur de la même manière, jusqu’à 50. Un compte déjà enregistré ne peut pas être inscrit une seconde fois avec le même serveur.
5. La copie est **identique 1:1**, sans réglage personnalisé. Tous les brokers et serveurs sont acceptés : ils peuvent différer entre le master et les suiveurs, y compris entre comptes démo et réels. Les comptes suiveurs doivent être **hedging** pour conserver séparément les positions ; le master peut être hedging ou netting.

Un terminal MT5 connecté est nécessaire par compte. Plusieurs installations MT5 distinctes peuvent tourner sur un VPS adapté. La capacité administrative de 50 comptes est testée côté serveur ; elle ne constitue pas une mesure de performance avec 50 terminaux réels.

La clé administrateur permet de contrôler toutes les copies. En cas de fuite d’une clé terminal, mettre sa copie en pause, réconcilier/fermer ses positions, puis révoquer son identité. Ne pas supprimer le journal pour contourner une commande en attente.

### Remplacer le master par un nouveau compte réel

1. Dans le panneau **Master**, cliquer sur **Changer de master**. Le formulaire sélectionne automatiquement le rôle **Master** et le type de compte **Réel**.
2. Saisir le nom, le **login MT5 du nouveau compte réel** et son **serveur MT5 exact**, puis cliquer sur **Remplacer le master**. Il n’est pas nécessaire de révoquer puis recréer manuellement les terminaux.
3. Si des commandes sont en cours, attendre leur acquittement. Les suiveurs associés à des copies exécutées ou à un résultat inconnu doivent être connectés pour vérifier leur état ; les copies encore ouvertes doivent être clôturées puis synchronisées avant le remplacement. Les copies dont aucune commande n’a été envoyée et les refus confirmés sans ouverture ne nécessitent plus de reconnexion. L’interface affiche le compte concerné. Les refus sans position ouverte sont nettoyés lors du remplacement, après cette vérification.
4. Le changement révoque les identifiants de l’ancien master et conserve **les comptes slaves et leurs AgentId/AgentKey**. La copie et les slaves sont mis en pause. Les positions manuelles indépendantes des slaves restent intactes. Aucune clôture ni ouverture n’est envoyée par l’action de remplacement.
5. Connecter le terminal MT5 au nouveau compte réel, attacher l’EA **1.04** avec **Role=MASTER**, puis renseigner les nouveaux **AgentId** et **AgentKey** affichés. Le master observe ses positions ; `AllowRealTrading` concerne l’exécution sur les slaves réels.
6. Attendre que le nouveau master apparaisse **En ligne**, activer les slaves souhaités, puis cliquer sur **Démarrer la copie**. Ses positions déjà ouvertes seront incluses.

Un stockage persistant configuré est requis pour enregistrer le nouveau master réel. Si la saisie est invalide ou si l’enregistrement échoue, l’ancien master est conservé. Le remplacement d’un compte par un autre ne nécessite pas de recompiler l’EA.

### Nouveau master : aucune transmission et serveur mal renseigné

Après remplacement, **En attente de la première transmission** signifie que le nouveau terminal n’a pas encore transmis ses données. Cela ne prouve pas que son EA est ancien. Le tableau conserve « — » jusqu’à réception des montants et distingue cette attente d’une transmission reçue sans statistiques.

Le **login MT5** est le numéro du compte ; le **serveur MT5 exact** est le nom fourni par le broker. Si le login a été recopié dans le champ serveur, cliquer sur **Corriger le serveur MT5** dans le panneau Master et saisir le nom exact affiché dans MT5. Cette correction est disponible avant la toute première connexion du nouveau master. Elle conserve son login, son mode et ses **AgentId/AgentKey**, et ne démarre aucune copie.

Dans le terminal, vérifier `Role=MASTER`, les nouveaux `AgentId`/`AgentKey` issus du remplacement, la connexion au bon compte/serveur et l’autorisation WebRequest vers l’application. L’EA **1.04** transmet déjà la balance, la devise et le PnL : aucune réinstallation de 1.02 n’est nécessaire. Une fois la première transmission acceptée, les valeurs apparaissent automatiquement.

### Ancien compte supprimé mais toujours cité pendant le changement de master

Supprimer un compte dans MT5 ne supprime pas automatiquement son enregistrement dans Copytrading. Si le formulaire indique **« Reconnectez … pour vérifier ses copies »** alors que ce compte a été supprimé, utiliser **« Compte supprimé : retirer [nom] du module »** directement dans la fenêtre **Changer de master**. Les champs déjà saisis pour le nouveau master sont conservés et le blocage est recalculé après le retrait.

Cette action est réservée à un ancien **suiveur hors ligne** déclaré supprimé. Elle révoque ses identifiants et retire ses associations du suivi actif. Les dernières positions, commandes et associations sont archivées dans le stockage pour conserver leur trace ; **aucun ordre de clôture ni d’ouverture n’est envoyé**. Si le compte existe encore chez le broker, ses éventuelles positions ne seront plus gérées par ce module. Les autres comptes restent inchangés.

Les anciennes associations dont le résultat n’est pas connu ne sont pas assimilées automatiquement à des copies jamais exécutées. Pour un compte supprimé, l’action de retrait évite d’exiger une reconnexion impossible tout en préservant cet historique.

## 3. Installer l’EA dans MT5

1. Télécharger **DerivCopyTradingEA.mq5** depuis le module.
2. Dans MT5 : **Fichier → Ouvrir le dossier des données → MQL5 → Experts**. Ajouter le fichier puis l’ouvrir dans MetaEditor et le compiler.
3. Dans **Outils → Options → Expert Advisors**, autoriser les WebRequest vers l’URL HTTPS exacte de l’application, par exemple `https://derivbot-qnwz.onrender.com`.
4. Attacher l’EA à un seul graphique du terminal, puis activer Algo Trading et les permissions de trading nécessaires sur les suiveurs.
5. Renseigner ses paramètres :

| Paramètre EA | Réglage |
| --- | --- |
| `Role` | `MASTER` sur le master, `SLAVE` sur chaque suiveur. |
| `ApiBaseUrl` | URL de votre application, sans slash final. |
| `AgentId`, `AgentKey` | Identifiants générés pour ce terminal précis. Ne pas utiliser la clé administrateur ici. |
| `PollSeconds` | 2 secondes par défaut. |
| `AllowRealTrading` | `false` par défaut ; `true` nécessaire pour exécuter sur un suiveur réel. |
| `DeviationPoints` | Déviation autorisée à l’exécution, en points MT5, 20 par défaut. |

L’EA **1.04** ne possède aucun plafond personnalisé de lots ou de perte. Il transmet le volume et les niveaux SL/TP exacts, sans arrondi vers un volume inférieur. Le broker reste responsable de l’acceptation de l’ordre : marge disponible, spécifications et autorisations de trading. Un même broker/serveur ne garantit pas une marge identique sur les comptes.

### Si MT5 retire l’EA avec « incorrect parameters »

La version **1.01** remplace le message général « Paramètres copytrading invalides » par une alerte indiquant précisément le champ refusé. Elle retire les espaces, tabulations et retours à la ligne aux extrémités des valeurs collées, accepte une ligne préfixée par `AgentId=` ou `AgentKey=`, et retire le slash final de l’URL. Elle ne transforme pas un bloc contenant les deux identifiants en une seule valeur valide. La clé n’est jamais affichée dans ces diagnostics.

Télécharger le nouveau `.mq5`, remplacer l’ancien fichier dans `MQL5/Experts`, puis le **recompiler dans MetaEditor** et rattacher l’EA au graphique. Un push GitHub ou un déploiement Render ne remplace pas le `.ex5` déjà installé dans MT5. Vérifier la version **1.04** sur le master et chaque suiveur.

- `AgentId` : UUID de 36 caractères généré pour ce terminal, et non son login MT5.
- `AgentKey` : clé terminal de 64 caractères (`0-9`, `a-f`), et non `COPYTRADING_ADMIN_KEY`. Conserver exactement la casse de la valeur générée.
- `PollSeconds` : au moins 1 ; valeur par défaut 2.
- Sur un **SLAVE**, utiliser un compte hedging et une déviation positive ou nulle ; il n’y a plus de paramètres de plafonds de lots ou de perte.

« Paramètres validés » signifie uniquement que les entrées locales sont acceptées. La connexion est confirmée ensuite par l’état connecté et le master en ligne dans l’application. Une clé au bon format mais incorrecte reste refusée par le serveur.

L’EA master observe les positions sans ouvrir d’ordres. La copie des positions d’autres EA du compte master est donc possible. Sur les suiveurs, seules les positions portant le magic de la copie sont gérées. Ne pas faire gérer ces positions simultanément par un autre logiciel.

## 4. Démarrer, suivre et suspendre

1. Vérifier que le master et les suiveurs apparaissent **en ligne**.
2. Activer les suiveurs souhaités, puis **Démarrer la copie**.
3. Toutes les positions encore ouvertes du master sont incluses, y compris au démarrage, à l’activation d’un suiveur et à sa reconnexion. Les copies déjà clôturées localement ne sont pas réouvertes automatiquement.
4. Suivre les commandes, refus et erreurs dans le journal. Les pertes de connexion et commandes sans acquittement sont visibles par compte.
5. **Pause des nouvelles copies** bloque les ouvertures et augmentations. Les fermetures, réductions et modifications SL/TP des copies existantes restent suivies. Une commande déjà reçue/en cours d’exécution ne peut pas être annulée à distance avec certitude. Ce bouton ne ferme pas toutes les positions.

Les anciens réglages de multiplicateur, plafonds, inversion et correspondance de symboles ne sont plus utilisés. La commande **Paramètres** a été retirée.

## 5. Comportement de la réplication

### Tableaux de suivi — EA 1.02

Installer et recompiler **DerivCopyTradingEA.mq5 version 1.04 sur le master et chaque suiveur**, en conservant leurs `AgentId` et `AgentKey`. Le déploiement du site ne met pas à jour les `.ex5` des terminaux. Les anciens EA peuvent toujours transmettre leurs données et acquitter les commandes existantes ; aucune nouvelle commande 1:1 ne leur est délivrée. Les EA 1.00/1.01 n’envoient pas les statistiques : le tableau affiche « — » pour les valeurs absentes, sans inventer une balance ou un PnL nul.

Le tableau master présente les positions ouvertes : instrument, identifiant MT5, BUY/SELL, lots, prix d’entrée, prix actuel, SL/TP et PnL flottant (profit + swap). Les cartes présentent :

- **Balance** : solde `ACCOUNT_BALANCE` du compte MT5.
- **Equity** : valeur `ACCOUNT_EQUITY` du compte MT5.
- **PnL flottant** : somme des profits et swaps des positions ouvertes.
- **Bénéfice net du jour** : somme `DEAL_PROFIT + DEAL_SWAP + DEAL_COMMISSION + DEAL_FEE` des transactions BUY/SELL depuis minuit, selon la date du **serveur MT5**. Les dépôts, retraits, crédits et écritures de commission séparées de ces transactions ne sont pas inclus. Un résultat négatif est affiché comme une perte.
- **PnL total** : bénéfice net du jour + PnL flottant actuel. Ce n’est pas un résultat historique depuis l’ouverture du compte : des positions encore ouvertes peuvent avoir été prises avant aujourd’hui.

Le second tableau réunit les suiveurs ayant transmis une position ou une transaction du jour. Ils restent visibles après clôture grâce à un indicateur conservé dans le stockage. Les anciennes copies déjà acquittées sont également reconnues. Chaque ligne conserve **sa propre devise**, son solde, son equity, ses résultats et l’heure de dernière réception. Déplier **Positions ouvertes** affiche le détail, en distinguant les copies du master des autres positions du compte. Les résultats couvrent l’ensemble du compte, y compris ses trades manuels ; ils ne représentent pas uniquement la rentabilité du copytrading.

Les snapshots MT5 sont transmis toutes les `PollSeconds` (2 s par défaut), et la page les récupère toutes les 3 s. Le délai dépend donc des deux cycles et du réseau. Après 15 s sans nouvelle transmission, ou lors d’une erreur de lecture du tableau de bord, les chiffres conservés sont marqués **Données anciennes**. L’EA 1.02 suspend ses transmissions quand MT5 est déconnecté du broker. Si l’historique du jour est indisponible, le réalisé et le total restent indisponibles, tandis que les positions et le solde peuvent encore être affichés.

Références : [propriétés des transactions MQL5](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties), [sélection de l’historique selon l’heure serveur](https://www.mql5.com/en/docs/trading/historyselect), [propriétés des positions](https://www.mql5.com/en/docs/constants/tradingconstants/positionproperties).

### Copie identique — EA 1.04

- Chaque position du master conserve son **symbole exact, BUY/SELL, volume et SL/TP**. Aucun multiplicateur, plafond personnalisé, inversion ou mapping n’est appliqué, même si l’ancien stockage contient encore ces paramètres.
- Le broker et le serveur du suiveur ne sont pas comparés à ceux du master. Chaque commande reste adressée au compte, au serveur et au broker propres au suiveur ; l’EA vérifie cette identité de destination avant l’exécution. Installer **1.04 sur le master et chaque suiveur** : les versions précédentes ne déclarent pas ce protocole et conservent leurs propres plafonds.
- Toutes les positions exécutées encore ouvertes sont reprises au démarrage ou à la reconnexion. Les ouvertures, augmentations, réductions, clôtures et modifications SL/TP sont synchronisées. Les positions manuelles indépendantes des suiveurs restent intactes.
- Les ordres en attente ne sont copiés qu’après leur exécution sur le master. La synchronisation est périodique : une position ouverte puis fermée entre deux snapshots peut être manquée. Le prix d’exécution dépend du marché au moment où le suiveur exécute l’ordre.
- Le moteur n’impose plus le plafond de 300 positions par snapshot ni celui de 15 000 associations. Les transmissions restent soumises à la taille maximale des requêtes de l’API ; un snapshot trop volumineux est refusé intégralement, jamais tronqué.
- Si une copie se ferme localement par intervention manuelle ou SL/TP, elle n’est pas réouverte automatiquement. La pause continue d’empêcher les nouvelles expositions tout en suivant les réductions et clôtures.

### Copie entre brokers et serveurs différents

Le retrait de la restriction master/suiveur est une mise à jour du serveur et de l’interface. Les EA **1.04 déjà installés restent compatibles**, sans recompilation : le champ broker d’une commande désigne celui du suiveur, jamais celui du master. Le login, le serveur et le mode enregistrés doivent toujours correspondre au terminal qui se connecte.

Après déploiement, le message imposant un broker et un serveur identiques disparaît. Activer le suiveur souhaité pour reprendre les positions ouvertes du master. Les symboles, lots et SL/TP sont transmis tels quels ; un instrument absent ou un volume non accepté chez le broker destinataire reste signalé avec son motif précis.

Validation du correctif inter-brokers/serveurs : **45 tests ciblés réussis**, dont un cycle complet ouverture, modification SL/TP, augmentation, réduction et clôture avec brokers, serveurs et modes démo/réel différents. Le test MySQL réel reste ignoré faute de serveur de test configuré. Compilation web et lint ciblé réussis.

### Migration des anciennes copies

Conserver les mêmes identifiants et journaux, déployer le serveur puis installer/recompiler **1.04** sur les terminaux. Une commande déjà en attente doit être acquittée avant migration. Une ancienne commande non exécutée refusée par le nouvel EA doit être vérifiée puis réessayée avec le protocole actuel.

Lorsqu’un suiveur actif est compatible, une copie précédemment plafonnée reprend le volume exact du master avec son magic existant. Une copie anciennement inversée ou mappée est clôturée avant d’être remplacée par une copie correspondant exactement au master. Cette migration peut donc augmenter le volume et clôturer/remplacer les anciennes copies personnalisées.

Les blocages identifiés comme provenant des anciens plafonds de lots sont levés pendant cette migration. Les erreurs génériques, les anciens refus de marge et les résultats incertains restent à réconcilier : mettre le suiveur en pause, attendre l’acquittement, vérifier le terminal, utiliser **Réessayer après vérification**, puis réactiver. Aucun paramètre personnalisé n’est à régler.

### Refus du broker

Les refus avant ouverture (symbole indisponible, spécifications manquantes, volume incompatible) et les rejets broker explicitement confirmés sans position ouverte sont isolés à la copie concernée. Le volume du master n’est jamais réduit pour contourner le refus. Le message broker inclut son code, sa description et le lot demandé ; les autres copies continuent. Un acquittement broker perdu conserve le même identifiant de commande et ne renvoie pas un nouvel ordre.

Un manque de marge réel peut toujours empêcher l’exécution, même avec le même broker et serveur. Les résultats incertains et erreurs sur des copies existantes mettent le suiveur en pause pour réconciliation. Les exécutions partielles ou valeurs différentes du master ne sont pas acceptées silencieusement comme une copie exacte.

## 6. Réponses perdues et reprise

Une seule commande attend un acquittement par suiveur. Le serveur renvoie le même identifiant jusqu’à son acquittement. L’EA conserve un marqueur d’exécution et un résultat dans le dossier commun MT5 (`Terminal/Common/Files`, fichiers préfixés `Copy_`). Il ne renvoie pas automatiquement un ordre dont le résultat reste incertain : il tente une réconciliation avec les positions, puis signale l’incertitude si nécessaire.

**Ne pas effacer ces fichiers ni déplacer un suiveur vers un nouveau VPS pendant une commande non résolue.** Pour migrer, suspendre les copies, attendre les acquittements, transférer les journaux et arrêter l’ancienne instance avant de reconnecter la nouvelle. Utiliser la même identité sur deux machines est refusé tant que la session précédente est en ligne, mais ne remplace pas cette procédure de migration.

Après un refus ou une incertitude, vérifier les positions et l’historique dans MT5, les volumes, le journal Experts, la marge et les permissions. Utiliser **Réessayer après vérification** seulement après avoir établi l’état réel, puis réactiver le suiveur si nécessaire. Une réconciliation peut encore fermer/réduire une copie lorsque les nouvelles ouvertures sont en pause. Ne pas réessayer tant qu’une exécution broker peut encore être en cours.

## 7. Validation avant utilisation

Le dépôt contient des tests du moteur : 50 files distinctes, authentification, anti-répétition, cycle ouverture/fermeture, volumes exacts, copie entre brokers/serveurs différents, migration, panne de stockage et redémarrage. Ils simulent les terminaux ; ils ne remplacent pas la compilation MQL5 et une recette avec le broker.

Validation de la version **1.04** : **44 tests ciblés réussis**, dont la copie exacte, la reprise, la migration des anciens paramètres, les refus broker isolés et l’anti-duplication. Le test d’intégration MySQL réel est ignoré faute de serveur de test configuré. Compilation MetaEditor : **0 erreur, 0 avertissement**. Compilation web de production réussie avec `vinext build` ; le wrapper `npm run build` nécessite GNU `timeout`, absent de cette machine. Lint des modules modifiés sans erreur. Le contrôle TypeScript global conserve trois erreurs préexistantes de types Cloudflare (`db/index.ts`, `worker/index.ts`). Aucun ordre n’a été envoyé au broker pendant ces vérifications ; le serveur et les terminaux actifs ne sont pas mis à jour par la compilation locale.

Compiler l’EA dans MetaEditor et commencer avec un master et un suiveur démo. Vérifier une ouverture, un changement SL/TP, une clôture partielle, une clôture totale, une coupure/reconnexion et un redémarrage serveur. Contrôler les volumes exécutés et le nombre d’ordres dans MT5 avant d’étendre progressivement à d’autres suiveurs. Les transactions ne sont pas lancées automatiquement lors de l’installation du module.

Référence technique : [MQL5 — CTrade et clôtures partielles](https://www.mql5.com/en/docs/standardlibrary/tradeclasses/ctrade/ctradepositionclosepartial).
