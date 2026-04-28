#!/usr/bin/env bash
# Enable GitHub Pages from the default branch using the /docs folder (project site).
# Requires: gh auth login with repo scope.
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "gh-enable-pages: install GitHub CLI (gh)" >&2
  exit 1
fi

REPO="${1:-}"
if [[ -z "$REPO" ]]; then
  REPO="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
fi

DEFAULT_BRANCH="$(gh api "repos/${REPO}" --jq .default_branch)"

echo "gh-enable-pages: configuring Pages for $REPO (branch ${DEFAULT_BRANCH}, path /docs)"

set +e
OUT="$(gh api --method POST "repos/${REPO}/pages" \
  -f build_type=legacy \
  -f "source[branch]=${DEFAULT_BRANCH}" \
  -f source[path]=/docs 2>&1)"
POST_RC=$?
set -e

if [[ "$POST_RC" -eq 0 ]]; then
  echo "gh-enable-pages: created Pages site"
else
  echo "gh-enable-pages: POST returned ($POST_RC), trying PUT… $OUT"
  gh api --method PUT "repos/${REPO}/pages" \
    -f build_type=legacy \
    -f "source[branch]=${DEFAULT_BRANCH}" \
    -f source[path]=/docs
  echo "gh-enable-pages: updated Pages site"
fi

OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
echo "gh-enable-pages: site root is https://${OWNER}.github.io/${NAME}/ (served from /docs on ${DEFAULT_BRANCH})"
