# Protocole EA MQL5 ↔ Deriv AI Trader

## Authentification

Chaque requête de l'EA envoie `X-EA-API-Key`. Le secret doit être identique à la variable serveur `EA_API_KEY`.

## Endpoints

- `POST /api/mt5/heartbeat` : état du terminal, compte, equity et latence.
- `POST /api/trading/analyze` : soumet un setup SMC et reçoit `BUY`, `SELL` ou `NO_TRADE`.
- `GET /api/system/status` : configuration publique et état d'activation.

## Règles de sécurité MVP

- compte démo uniquement ;
- V25 et V100 uniquement ;
- risque absolu maximal de 10 USD ;
- une position maximum par indice ;
- score minimum 75/100 ;
- concordance obligatoire entre biais SMC et direction ML ;
- l'EA conserve localement le stop-loss et l'arrêt d'urgence si l'API est indisponible.
