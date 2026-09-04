# Render deployment

This project can be deployed to Render from GitHub with `render.yaml`.

## First setup

1. Push this repository to GitHub.
2. In Render, create a new Blueprint from:
   `https://github.com/asmbizdigital-commits/derivbot`
3. Use `render.yaml` from the repository root.
4. Add the required secret values in Render. The keys are declared in `render.yaml` with `sync: false`, so values are not committed.

For the hosted OAuth callback, set:

```text
DERIV_OAUTH_REDIRECT_URI=https://YOUR-RENDER-DOMAIN/deriv-oauth/callback
```

Then register the same URL exactly in the Deriv API dashboard.

## Deploy from Codex

After the Render service exists, add one of these to `.env.local`.

Deploy hook mode:

```text
RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/...
```

API mode:

```text
RENDER_API_KEY=rnd_...
RENDER_SERVICE_ID=srv_...
```

Then run:

```bash
npm run deploy:render
```

By default, the script deploys the current Git commit SHA. Set `RENDER_CLEAR_CACHE=1` to clear Render's build cache when using API mode.
