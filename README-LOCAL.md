# Deriv AI Trader — test local

## Prérequis

- Node.js 22.13 ou plus récent
- npm
- Deriv MetaTrader 5 sur un compte démo
- MetaEditor pour compiler l'EA MQL5

## 1. Lancer la plateforme

```bash
npm install
cp .env.example .env.local
npm run dev
```

Ouvrez ensuite `http://localhost:5173`.

Remplacez la valeur de `EA_API_KEY` dans `.env.local` par une longue clé secrète.
La même valeur doit être placée dans le paramètre `ApiKey` de l'EA.

Pour connecter Deriv Bot sans saisir d'Account ID ni de jeton dans l'interface,
créez une app OAuth2 Deriv, ajoutez exactement
`http://localhost:5173/deriv-oauth/callback` comme Redirect URI, puis mettez
son client ID dans `DERIV_OAUTH_CLIENT_ID` dans `.env.local`. Pour la version
hébergée, la même valeur doit être configurée côté Sites dans
`DERIV_OAUTH_REDIRECT_URI`.
Si la page OAuth2 Deriv répond `Access Denied`, renseignez aussi
`DERIV_LEGACY_APP_ID` avec l'ID d'une app Deriv API dont le Website URL pointe
vers le même callback, puis utilisez le bouton `Connexion alternative`.

## 2. Tester l'API

```bash
curl http://localhost:5173/api/system/status
```

L'endpoint protégé d'analyse est `POST /api/trading/analyze`. Il exige l'en-tête
`X-EA-API-Key` et un payload conforme au fichier `MT5-PROTOCOL.md`.

## 3. Installer l'EA dans MT5

Le fichier est situé dans `public/DerivAITraderEA.mq5`.

1. Copiez-le dans le dossier `MQL5/Experts` du terminal.
2. Compilez-le avec MetaEditor.
3. Dans MT5, autorisez WebRequest pour `http://localhost:5173`.
4. Dans les inputs de l'EA, mettez `ApiBaseUrl=http://localhost:5173`.
5. Renseignez la même `ApiKey` que dans `.env.local`.
6. Attachez l'EA au graphique V25 ou V100.
7. Gardez `AllowAutoExecution=false` pendant la validation des signaux.

## Architecture utile

- `app/page.tsx` : dashboard React
- `app/api/` : routes API Node.js/Vinext
- `lib/trading-engine.ts` : moteur SMC, score et Risk Manager
- `public/DerivAITraderEA.mq5` : agent d'exécution MT5
- `MT5-PROTOCOL.md` : contrat de communication

## Limites de cette version

- données du dashboard encore démonstratives ;
- modèle ML encore représenté par un score de confiance fourni par l'EA ;
- aucune persistance PostgreSQL/Redis ;
- aucun entraînement historique automatique ;
- exécution réelle verrouillée au niveau API.

La perte maximale configurée de 10 USD représente 10% du capital de référence
de 100 USD. Testez exclusivement sur compte démo.
