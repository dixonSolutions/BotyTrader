#!/usr/bin/env bash
# Build signed APT metadata for the GitHub Pages deployment artifact.
# Run from a checkout after building the .deb (file may be untracked in repo root).
# Expects: GITHUB_WORKSPACE, DEB or DEB_PATH, APT_GPG_PRIVATE_KEY (armored secret key).
# Optional: PAGES_ROOT (defaults to docs/ for local testing).
set -euo pipefail

if [[ -z "${DEB:-}" && -z "${DEB_PATH:-}" ]]; then
  echo "ci-publish-apt: DEB or DEB_PATH env must be set to the .deb package" >&2
  exit 1
fi

if [[ -z "${APT_GPG_PRIVATE_KEY:-}" ]]; then
  echo "ci-publish-apt: secret APT_GPG_PRIVATE_KEY is not set. Run scripts/apt-bootstrap-secrets.sh locally." >&2
  exit 1
fi

if [[ -z "${DEB_PATH:-}" ]]; then
  DEB_PATH="${GITHUB_WORKSPACE}/${DEB}"
fi

if [[ ! -f "$DEB_PATH" ]]; then
  echo "ci-publish-apt: missing package file: $DEB_PATH" >&2
  exit 1
fi

sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends reprepro gnupg

export GNUPGHOME="${RUNNER_TEMP:-/tmp}/gnupg-apt"
mkdir -p "$GNUPGHOME"
chmod 700 "$GNUPGHOME"

printf '%s\n' "$APT_GPG_PRIVATE_KEY" | gpg --batch --import

KEY_FP="$(gpg --batch --with-colons --list-secret-keys 2>/dev/null | awk -F: '$1 == "fpr" { print $10; exit }')"
if [[ -z "$KEY_FP" ]]; then
  echo "ci-publish-apt: could not determine GPG fingerprint after import" >&2
  exit 1
fi

SOURCE_DOCS="${GITHUB_WORKSPACE}/docs"
REPREPRO_ROOT="${PAGES_ROOT:-${SOURCE_DOCS}}"

if [[ "$REPREPRO_ROOT" != "$SOURCE_DOCS" ]]; then
  rm -rf "$REPREPRO_ROOT"
  mkdir -p "$REPREPRO_ROOT"
  cp -a "${SOURCE_DOCS}/." "$REPREPRO_ROOT/"
fi

CONF_SRC="${REPREPRO_ROOT}/conf/distributions"
if [[ ! -f "$CONF_SRC" ]]; then
  echo "ci-publish-apt: missing ${CONF_SRC}" >&2
  exit 1
fi

rm -rf "${REPREPRO_ROOT}/db" "${REPREPRO_ROOT}/dists" "${REPREPRO_ROOT}/lists" "${REPREPRO_ROOT}/pool"
rm -f "${REPREPRO_ROOT}/public.asc"

gpg --batch --armor --export "$KEY_FP" > "${REPREPRO_ROOT}/public.asc"

reprepro -b "$REPREPRO_ROOT" includedeb stable "$DEB_PATH"

echo "ci-publish-apt: built APT Pages artifact at ${REPREPRO_ROOT}"
