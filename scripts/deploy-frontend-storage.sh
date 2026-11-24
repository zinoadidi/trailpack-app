#!/usr/bin/env bash
# Deploy the static frontend to an Azure Storage static website (use when Static Web Apps
# is not available in your subscription's allowed regions).
# Required env: API_BASE (https backend base URL), AZ_SUBSCRIPTION, AZ_RG, WEB_STORAGE (account name).
# Optional: AZ_LOCATION (default norwayeast). Creates the account on the first run. No secrets are stored.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${API_BASE:?Set API_BASE to the backend base URL}"
: "${AZ_SUBSCRIPTION:?Set AZ_SUBSCRIPTION}"
: "${AZ_RG:?Set AZ_RG}"
: "${WEB_STORAGE:?Set WEB_STORAGE to the storage account name}"
AZ_LOCATION="${AZ_LOCATION:-norwayeast}"

API_ORIGIN="$(API_BASE="$API_BASE" node -e '
  const url = new URL(process.env.API_BASE);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("API_BASE must be an HTTPS URL without credentials, query or fragment");
  }
  process.stdout.write(url.origin);
')"
BUILD_DIR="$(mktemp -d "$ROOT/.deploy.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT

cp "$ROOT/index.html" "$ROOT/manifest.webmanifest" "$ROOT/sw.js" "$BUILD_DIR/"
for folder in icons src styles; do cp -R "$ROOT/$folder" "$BUILD_DIR/"; done
mkdir -p "$BUILD_DIR/scripts"
cp "$ROOT/scripts/stamp-build.mjs" "$BUILD_DIR/scripts/"
API_BASE="$API_BASE" node -e 'process.stdout.write(JSON.stringify({ apiBase: process.env.API_BASE }) + "\n")' > "$BUILD_DIR/config.json"
(cd "$BUILD_DIR" && node scripts/stamp-build.mjs && rm -rf scripts)

# Storage cannot send headers, so the security policy goes into index.html as a meta tag.
INDEX="$BUILD_DIR/index.html" API_ORIGIN="$API_ORIGIN" node --input-type=module -e '
  import { readFile, writeFile } from "node:fs/promises";
  const csp = `default-src \x27self\x27; script-src \x27self\x27; style-src \x27self\x27; img-src \x27self\x27 data: blob:; font-src \x27self\x27; connect-src \x27self\x27 ${process.env.API_ORIGIN}; media-src \x27self\x27 blob:; worker-src \x27self\x27; manifest-src \x27self\x27; object-src \x27none\x27; base-uri \x27self\x27; form-action \x27self\x27`;
  const text = await readFile(process.env.INDEX, "utf8");
  if (!text.includes("<head>")) throw new Error("index.html has no <head>");
  await writeFile(process.env.INDEX, text.replace("<head>", `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">`));
'

SUB=(--subscription "$AZ_SUBSCRIPTION")
if ! az storage account show -n "$WEB_STORAGE" -g "$AZ_RG" "${SUB[@]}" -o none 2>/dev/null; then
  az storage account create -n "$WEB_STORAGE" -g "$AZ_RG" "${SUB[@]}" -l "$AZ_LOCATION" --sku Standard_LRS \
    --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false -o none
fi
KEY="$(az storage account keys list -n "$WEB_STORAGE" -g "$AZ_RG" "${SUB[@]}" --query '[0].value' -o tsv)"
az storage blob service-properties update --account-name "$WEB_STORAGE" --account-key "$KEY" \
  --static-website --index-document index.html --404-document index.html -o none
az storage blob upload-batch --account-name "$WEB_STORAGE" --account-key "$KEY" -d '$web' -s "$BUILD_DIR" --overwrite -o none
URL="$(az storage account show -n "$WEB_STORAGE" -g "$AZ_RG" "${SUB[@]}" --query primaryEndpoints.web -o tsv)"
printf 'Deployment URL: %s\n' "$URL"
