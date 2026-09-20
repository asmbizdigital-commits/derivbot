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
2. Enregistrer le master avec son nom, son **login MT5 numérique**, le **nom exact du serveur MT5** et le mode démo/réel.
3. Conserver `AgentId` et `AgentKey`, affichés une seule fois. Ne pas les partager avec d’autres terminaux.
4. Enregistrer chaque suiveur de la même manière, jusqu’à 50. Un compte déjà enregistré ne peut pas être inscrit une seconde fois avec le même serveur.
5. Régler individuellement le multiplicateur de lots, le maximum par copie, le maximum total de lots et la perte maximale de session. Les comptes suiveurs doivent être **hedging**, pas netting. Le master peut être hedging ou netting.

Un terminal MT5 connecté est nécessaire par compte. Plusieurs installations MT5 distinctes peuvent tourner sur un VPS adapté. La capacité administrative de 50 comptes est testée côté serveur ; elle ne constitue pas une mesure de performance avec 50 terminaux réels.

La clé administrateur permet de contrôler toutes les copies. En cas de fuite d’une clé terminal, mettre sa copie en pause, réconcilier/fermer ses positions, puis révoquer son identité. Ne pas supprimer le journal pour contourner une commande en attente.

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
| `TerminalMaxLot` | Maximum de lots par copie côté terminal, 1 par défaut. |
| `TerminalMaxTotalLots` | Maximum total du compte, 5 par défaut. |
| `TerminalLossLimitPercent` | Limite de perte par rapport à l’equity au démarrage de l’EA, 10 % par défaut. |
| `DeviationPoints` | Déviation autorisée à l’exécution, en points MT5, 20 par défaut. |

Les limites serveur **et** terminal s’appliquent : le réglage le plus restrictif prévaut. Une modification des limites côté interface ne supprime pas celles de l’EA. La limite de perte bloque les nouvelles expositions ; elle ne liquide pas toutes les positions et ne garantit pas un montant maximal de perte. Les positions et opérations manuelles du compte entrent dans le total des lots et l’equity.

L’EA master observe les positions sans ouvrir d’ordres. La copie des positions d’autres EA du compte master est donc possible. Sur les suiveurs, seules les positions portant le magic de la copie sont gérées. Ne pas faire gérer ces positions simultanément par un autre logiciel.

## 4. Démarrer, suivre et suspendre

1. Vérifier que le master et les suiveurs apparaissent **en ligne**.
2. Activer les suiveurs souhaités, puis **Démarrer la copie**.
3. Par défaut, seules les nouvelles positions observées après le démarrage sont copiées. Pour reprendre des positions existantes, cocher explicitement l’option correspondante avant le démarrage. Les positions déjà connues comme closes ne sont pas réouvertes.
4. Suivre les commandes, refus et erreurs dans le journal. Les pertes de connexion et commandes sans acquittement sont visibles par compte.
5. **Pause des nouvelles copies** bloque les ouvertures et augmentations. Les fermetures, réductions et modifications SL/TP des copies existantes restent suivies. Une commande déjà reçue/en cours d’exécution ne peut pas être annulée à distance avec certitude. Ce bouton ne ferme pas toutes les positions.

Réactiver un suiveur remet sa référence de perte session à son equity courante. Modifier multiplicateur, inversion ou correspondance de symboles concerne les nouvelles copies. La correspondance utilise un objet JSON, par exemple `{"EURUSD":"EURUSD.a"}`. Ne mapper que des instruments équivalents : les prix SL/TP sont transmis comme niveaux absolus, sans conversion de devise ou d’échelle.

## 5. Comportement de la réplication

- Ouvertures, changements de volume, fermetures partielles/totales et niveaux SL/TP sont synchronisés. Le volume cible est proportionnel au master, plafonné par compte, puis arrondi au pas inférieur autorisé par le broker. Un volume sous le minimum est refusé, pas augmenté automatiquement.
- L’inversion facultative échange BUY/SELL et les niveaux SL/TP. Le broker peut refuser un niveau incompatible avec son marché.
- Les ordres en attente ne sont pas copiés avant leur exécution sur le master. Leurs modifications/annulations ne sont donc pas répliquées.
- Il s’agit d’une synchronisation périodique, pas d’une exécution instantanée. Le délai inclut les cycles du master et du suiveur, le réseau et le broker. Une position ouverte puis fermée entre deux snapshots du master peut être manquée ; ce pont n’est pas adapté à une réplication garantie de positions très brèves.
- Un suiveur hors ligne ou en pause au moment d’une nouvelle position ne la copie pas automatiquement plus tard. Les copies déjà suivies sont réconciliées à la reconnexion.
- Si une copie se ferme sur le suiveur, par intervention manuelle ou SL/TP, elle n’est pas réouverte automatiquement.
- Chaque terminal envoie au maximum 300 positions. Au-delà, la synchronisation est refusée plutôt que d’utiliser un snapshot incomplet. Le journal conserve au maximum 15 000 associations de copies, fermées comprises ; ne pas l’effacer pendant l’exploitation.

## 6. Réponses perdues et reprise

Une seule commande attend un acquittement par suiveur. Le serveur renvoie le même identifiant jusqu’à son acquittement. L’EA conserve un marqueur d’exécution et un résultat dans le dossier commun MT5 (`Terminal/Common/Files`, fichiers préfixés `Copy_`). Il ne renvoie pas automatiquement un ordre dont le résultat reste incertain : il tente une réconciliation avec les positions, puis signale l’incertitude si nécessaire.

**Ne pas effacer ces fichiers ni déplacer un suiveur vers un nouveau VPS pendant une commande non résolue.** Pour migrer, suspendre les copies, attendre les acquittements, transférer les journaux et arrêter l’ancienne instance avant de reconnecter la nouvelle. Utiliser la même identité sur deux machines est refusé tant que la session précédente est en ligne, mais ne remplace pas cette procédure de migration.

Après un refus ou une incertitude, vérifier les positions et l’historique dans MT5, les volumes, le journal Experts, la marge et les permissions. Utiliser **Réessayer après vérification** seulement après avoir établi l’état réel, puis réactiver le suiveur si nécessaire. Une réconciliation peut encore fermer/réduire une copie lorsque les nouvelles ouvertures sont en pause. Ne pas réessayer tant qu’une exécution broker peut encore être en cours.

## 7. Validation avant utilisation

Le dépôt contient des tests du moteur : 50 files distinctes, authentification, anti-répétition, cycle ouverture/fermeture, volumes, limites, panne de stockage et redémarrage. Ils simulent les terminaux ; ils ne remplacent pas la compilation MQL5 et une recette avec le broker.

Validation de cette livraison : compilation de production réussie ; 128 tests ciblés réussis, dont 17 tests du moteur copytrading et 9 tests MySQL ; lint des nouveaux modules sans erreur. Les API compilées et l’interface ont été vérifiées avec des comptes simulés. Deux tests généraux (`rendered-html` : métadonnée de prévisualisation ; `ui-components` : utilitaires CSS) échouent aussi sur le commit précédant ces modifications. Le contrôle TypeScript conserve trois erreurs préexistantes liées à Cloudflare dans `db/index.ts` et `worker/index.ts`, sans erreur dans les nouveaux modules. Le stockage MySQL a également été testé sur un serveur MySQL local isolé (9.4) : 50 connexions de suiveurs simulés, transactions concurrentes, rollback, redémarrage, acquittements et réponse COMMIT perdue. Le 20 septembre 2026, une lecture SQL depuis le service web Render vers mysql-frankfurt (MySQL 8.0.24) a réussi. La base derivbot existe ; la table copytrading_state sera initialisée par le module à sa première connexion authentifiée. L’ancienne base en Oregon possède un état initial vide et en pause ; aucune migration de comptes actifs n’est nécessaire. L’EA MQL5 n’a pas été compilé dans MetaEditor ni testé avec un broker lors de cette livraison.

Compiler l’EA dans MetaEditor et commencer avec un master et un suiveur démo. Vérifier une ouverture, un changement SL/TP, une clôture partielle, une clôture totale, une coupure/reconnexion et un redémarrage serveur. Contrôler les volumes exécutés et le nombre d’ordres dans MT5 avant d’étendre progressivement à d’autres suiveurs. Les transactions ne sont pas lancées automatiquement lors de l’installation du module.

Référence technique : [MQL5 — CTrade et clôtures partielles](https://www.mql5.com/en/docs/standardlibrary/tradeclasses/ctrade/ctradepositionclosepartial).
