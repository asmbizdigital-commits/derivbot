#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${project_root}"

if [[ -f ".env.local" ]]; then
  set -a
  # shellcheck disable=SC1091
  source ".env.local"
  set +a
fi

current_sha="$(git rev-parse --verify HEAD)"

if [[ -n "${RENDER_DEPLOY_HOOK_URL:-}" ]]; then
  hook_url="${RENDER_DEPLOY_HOOK_URL}"
  if [[ "${RENDER_DEPLOY_CURRENT_COMMIT:-1}" == "1" ]]; then
    separator="?"
    [[ "${hook_url}" == *"?"* ]] && separator="&"
    hook_url="${hook_url}${separator}ref=${current_sha}"
  fi

  echo "Triggering Render deploy hook for ${current_sha}..."
  curl --fail --silent --show-error --request POST "${hook_url}"
  echo
  echo "Render deploy hook triggered."
  exit 0
fi

if [[ -n "${RENDER_API_KEY:-}" && -n "${RENDER_SERVICE_ID:-}" ]]; then
  payload="$(
    node --input-type=module - "${current_sha}" <<'NODE'
const commitId = process.argv[2];
process.stdout.write(JSON.stringify({
  clearCache: process.env.RENDER_CLEAR_CACHE === "1" ? "clear" : "do_not_clear",
  commitId,
}));
NODE
  )"

  echo "Triggering Render API deploy for ${current_sha}..."
  curl \
    --fail \
    --silent \
    --show-error \
    --request POST \
    --url "https://api.render.com/v1/services/${RENDER_SERVICE_ID}/deploys" \
    --header "Authorization: Bearer ${RENDER_API_KEY}" \
    --header "Content-Type: application/json" \
    --data "${payload}"
  echo
  exit 0
fi

cat >&2 <<'EOF'
Render deployment is not configured.

Add one of these options to .env.local:

1. Deploy hook mode:
   RENDER_DEPLOY_HOOK_URL=https://api.render.com/deploy/...

2. API mode:
   RENDER_API_KEY=rnd_...
   RENDER_SERVICE_ID=srv_...
EOF
exit 78
