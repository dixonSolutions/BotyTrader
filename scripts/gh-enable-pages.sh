#!/usr/bin/env bash
# Enable GitHub Pages deployment from GitHub Actions.
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

echo "gh-enable-pages: configuring Pages for $REPO (source: GitHub Actions)"

set +e
OUT="$(gh api --method POST "repos/${REPO}/pages" \
  -f build_type=workflow 2>&1)"
POST_RC=$?
set -e

if [[ "$POST_RC" -eq 0 ]]; then
  echo "gh-enable-pages: created Pages site"
else
  echo "gh-enable-pages: POST returned ($POST_RC), trying PUT… $OUT"
  gh api --method PUT "repos/${REPO}/pages" \
    -f build_type=workflow
  echo "gh-enable-pages: updated Pages site"
fi

OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
echo "gh-enable-pages: site root is https://${OWNER}.github.io/${NAME}/ (deployed by the Release workflow)"
