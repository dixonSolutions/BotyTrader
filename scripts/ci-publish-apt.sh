#!/usr/bin/env bash
# Publish signed APT metadata under docs/ on the default branch (GitHub Pages: main + /docs).
# Run from a checkout of that branch after building the .deb (file may be untracked in repo root).
# Expects: GITHUB_WORKSPACE, GITHUB_REPOSITORY, GITHUB_TOKEN, DEB (filename only),
#          APT_GPG_PRIVATE_KEY (armored secret key).
# Optional: DEFAULT_BRANCH (defaults to main).
set -euo pipefail

DEFAULT_BRANCH="${DEFAULT_BRANCH:-main}"

if [[ -z "${DEB:-}" ]]; then
  echo "ci-publish-apt: DEB env must be set to the .deb filename" >&2
  exit 1
fi

if [[ -z "${APT_GPG_PRIVATE_KEY:-}" ]]; then
  echo "ci-publish-apt: secret APT_GPG_PRIVATE_KEY is not set. Run scripts/apt-bootstrap-secrets.sh locally." >&2
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "ci-publish-apt: GITHUB_TOKEN env must be set so CI can push APT metadata to ${DEFAULT_BRANCH}" >&2
  exit 1
fi

DEB_PATH="${GITHUB_WORKSPACE}/${DEB}"
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

REPREPRO_ROOT="${GITHUB_WORKSPACE}/docs"
CONF_SRC="${REPREPRO_ROOT}/conf/distributions"
if [[ ! -f "$CONF_SRC" ]]; then
  echo "ci-publish-apt: missing ${CONF_SRC}" >&2
  exit 1
fi

cd "$GITHUB_WORKSPACE"

gpg --batch --armor --export "$KEY_FP" > "${REPREPRO_ROOT}/public.asc"

reprepro -b "$REPREPRO_ROOT" includedeb stable "$DEB_PATH"

git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git config user.name "github-actions[bot]"

git add "${REPREPRO_ROOT}/public.asc" "${REPREPRO_ROOT}/conf/distributions"
if [[ -d "${REPREPRO_ROOT}/db" ]]; then git add "${REPREPRO_ROOT}/db"; fi
if [[ -d "${REPREPRO_ROOT}/dists" ]]; then git add "${REPREPRO_ROOT}/dists"; fi
if [[ -d "${REPREPRO_ROOT}/pool" ]]; then git add -f "${REPREPRO_ROOT}/pool"; fi
if [[ -d "${REPREPRO_ROOT}/lists" ]]; then git add "${REPREPRO_ROOT}/lists"; fi

if git diff --staged --quiet; then
  echo "ci-publish-apt: nothing to commit"
else
  git commit -m "chore(apt): publish ${DEB} [skip ci]"
  git push "https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "HEAD:${DEFAULT_BRANCH}"
fi

echo "ci-publish-apt: published APT metadata under docs/ on ${DEFAULT_BRANCH}"
