#!/usr/bin/env bash
# One-time (or rotate): generate a signing-only GPG key, store private key locally
# in a gitignored file, record key id in .env, and upload to GitHub Actions secrets via gh.
#
# Prerequisites: gh auth login, git remote origin = GitHub repo.
# Never commit .apt-gpg-private.asc or real .env secrets.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v gh >/dev/null 2>&1; then
  echo "apt-bootstrap-secrets: install GitHub CLI (gh)" >&2
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "apt-bootstrap-secrets: run: gh auth login" >&2
  exit 1
fi

PRIVATE_KEY_FILE="${ROOT}/.apt-gpg-private.asc"
BATCH_FILE="${ROOT}/.apt-gpg-gen-key.batch"

if [[ -f "$PRIVATE_KEY_FILE" ]] && [[ "${1:-}" != "--force" ]]; then
  echo "apt-bootstrap-secrets: $PRIVATE_KEY_FILE already exists. Use --force to regenerate (rotates key)." >&2
  exit 1
fi

cat > "$BATCH_FILE" <<'BATCH'
%no-protection
Key-Type: RSA
Key-Length: 4096
Subkey-Type: RSA
Subkey-Length: 4096
Name-Real: BotyTrader APT Signing
Name-Email: apt-signing@local
Expire-Date: 0
%commit
%echo done
BATCH

gpg --batch --gen-key "$BATCH_FILE"
rm -f "$BATCH_FILE"

KEY_ID="$(gpg --with-colons --list-secret-keys --keyid-format LONG "apt-signing@local" | awk -F: '$1 == "sec" { print $5; exit }')"
if [[ -z "$KEY_ID" ]]; then
  echo "apt-bootstrap-secrets: failed to read new key id" >&2
  exit 1
fi

gpg --batch --armor --export-secret-keys "$KEY_ID" > "$PRIVATE_KEY_FILE"
chmod 600 "$PRIVATE_KEY_FILE"

echo "apt-bootstrap-secrets: wrote $PRIVATE_KEY_FILE (mode 600, gitignored)"

# Merge APT_GPG_KEY_ID into .env without overwriting unrelated keys
ENV_FILE="${ROOT}/.env"
touch "$ENV_FILE"
if grep -q '^APT_GPG_KEY_ID=' "$ENV_FILE" 2>/dev/null; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    sed -i '' "s/^APT_GPG_KEY_ID=.*/APT_GPG_KEY_ID=${KEY_ID}/" "$ENV_FILE"
  else
    sed -i "s/^APT_GPG_KEY_ID=.*/APT_GPG_KEY_ID=${KEY_ID}/" "$ENV_FILE"
  fi
else
  printf '\n# APT repo signing (local bootstrap; private key in .apt-gpg-private.asc)\nAPT_GPG_KEY_ID=%s\n' "$KEY_ID" >> "$ENV_FILE"
fi

echo "apt-bootstrap-secrets: appended/updated APT_GPG_KEY_ID in .env"

gh secret set APT_GPG_PRIVATE_KEY < "$PRIVATE_KEY_FILE"
echo "apt-bootstrap-secrets: uploaded secret APT_GPG_PRIVATE_KEY"

printf '%s' "$KEY_ID" | gh secret set APT_GPG_KEY_ID
echo "apt-bootstrap-secrets: uploaded secret APT_GPG_KEY_ID"

echo ""
echo "Next: enable GitHub Pages (source: GitHub Actions) if not already — npm run apt:enable-pages or docs/publishing.md"
echo "      Tag a release: git tag v0.1.1 && git push origin v0.1.1"
