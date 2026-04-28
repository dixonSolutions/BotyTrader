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
DEFAULT_BRANCH="$(gh api "repos/${REPO}" --jq .default_branch)"
echo "gh-enable-pages: allowing the APT Pages workflow to deploy from ${DEFAULT_BRANCH}"
gh api --method PUT "repos/${REPO}/environments/github-pages" \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true" >/dev/null
gh api --method POST "repos/${REPO}/environments/github-pages/deployment-branch-policies" \
  -f "name=${DEFAULT_BRANCH}" \
  -f type=branch >/dev/null 2>&1 || true
echo "gh-enable-pages: site root is https://${OWNER}.github.io/${NAME}/ (deployed by the APT Pages workflow)"
