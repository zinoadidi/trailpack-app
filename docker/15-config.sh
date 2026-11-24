#!/bin/sh
# Sourced (not executed) by the nginx entrypoint at start, before the templates step: writes config.json from API_BASE.
# templates step after this, so API_ORIGIN (for the security policy) is exported here too.
set -eu
: "${API_BASE:?Set API_BASE to the backend base URL, e.g. https://api.example.com/api/v1}"
API_ORIGIN=$(printf '%s' "$API_BASE" | sed -E 's#^(https://[^/]+).*#\1#')
case "$API_ORIGIN" in
  https://*) ;;
  *) echo "API_BASE must be an https URL" >&2; exit 1 ;;
esac
printf '{"apiBase":"%s"}\n' "$API_BASE" > /usr/share/nginx/html/config.json
export API_ORIGIN
