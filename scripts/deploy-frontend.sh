#!/usr/bin/env bash
# Deploy the static frontend to Azure Static Web Apps using the installed SWA CLI.
# Required env: API_BASE, SWA_CLI_DEPLOYMENT_TOKEN, SWA_URL.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${API_BASE:?Set API_BASE to the backend base URL}"
: "${SWA_CLI_DEPLOYMENT_TOKEN:?Set the SWA deployment token in the environment}"
: "${SWA_URL:?Set SWA_URL to the public site URL}"
SWA_ENV="${SWA_ENV:-production}"

if ! command -v swa >/dev/null 2>&1; then
  echo "Azure Static Web Apps CLI (swa) is required." >&2
  exit 1
fi

API_ORIGIN="$(API_BASE="$API_BASE" node -e '
  const url = new URL(process.env.API_BASE);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("API_BASE must be an HTTPS URL without credentials, query or fragment");
  }
  process.stdout.write(url.origin);
')"
BUILD_DIR="$(mktemp -d "$ROOT/.deploy.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT

cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$ROOT/sw.js" "$ROOT/staticwebapp.config.json" "$BUILD_DIR/"
for folder in icons src styles; do cp -R "$ROOT/$folder" "$BUILD_DIR/"; done
mkdir -p "$BUILD_DIR/scripts"
cp "$ROOT/scripts/stamp-build.mjs" "$BUILD_DIR/scripts/"

API_BASE="$API_BASE" node -e 'process.stdout.write(JSON.stringify({ apiBase: process.env.API_BASE }) + "\n")' > "$BUILD_DIR/config.json"
CONFIG="$BUILD_DIR/staticwebapp.config.json" API_ORIGIN="$API_ORIGIN" node --input-type=module -e '
  import { readFile, writeFile } from "node:fs/promises";
  const path = process.env.CONFIG;
  const text = await readFile(path, "utf8");
  if ((text.match(/__API_ORIGIN__/g) || []).length !== 1) throw new Error("Expected one CSP API origin placeholder");
  await writeFile(path, text.replace("__API_ORIGIN__", process.env.API_ORIGIN));
'

if [[ -n "${BUILD_ID:-}" ]]; then
  (cd "$BUILD_DIR" && BUILD_ID="$BUILD_ID" node scripts/stamp-build.mjs)
else
  (cd "$BUILD_DIR" && node scripts/stamp-build.mjs)
fi

export SWA_CLI_DEPLOYMENT_TOKEN
swa deploy "$BUILD_DIR" --env "$SWA_ENV"
printf 'Deployment URL: %s\n' "$SWA_URL"
