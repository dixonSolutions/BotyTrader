#!/usr/bin/env bash
# Add the unofficial BotyTrader APT source (GitHub Pages) and install the package.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/install.sh | sudo bash -s -- OWNER/REPO
#   sudo ./install.sh OWNER/REPO
#   sudo ./install.sh https://github.com/OWNER/REPO
#   sudo BOTYTRADER_REPO=OWNER/REPO ./install.sh
set -euo pipefail

# Accept OWNER/REPO or a full github.com URL (https / git@); always yield OWNER/REPO.
normalize_repo_slug() {
  local raw="$1"
  raw="${raw%/}"
  raw="${raw%.git}"
  if [[ "$raw" =~ ^https?://github\.com/([^/]+)/([^/?#]+) ]]; then
    printf '%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi
  if [[ "$raw" =~ ^git@github\.com:([^/]+)/([^/?#]+) ]]; then
    printf '%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi
  printf '%s\n' "$raw"
  return 0
}

resolve_repo_from_git() {
  local dir="$1"
  local url
  url="$(git -C "$dir" remote get-url origin 2>/dev/null)" || return 1
  # https://github.com/OWNER/REPO(.git) or git@github.com:OWNER/REPO(.git)
  if [[ "$url" =~ github\.com[:/]([^/]+)/([^/.]+)(\.git)?$ ]]; then
    printf '%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi
  if [[ "$url" =~ github\.com[:/]([^/]+)/(.+)\.git$ ]]; then
    printf '%s/%s\n' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
    return 0
  fi
  return 1
}

REPO="${1:-${BOTYTRADER_REPO:-}}"
if [[ -z "$REPO" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd 2>/dev/null)" || SCRIPT_DIR=""
  if [[ -n "$SCRIPT_DIR" ]] && git -C "$SCRIPT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    REPO="$(resolve_repo_from_git "$SCRIPT_DIR" || true)"
  fi
fi

if [[ -z "$REPO" ]]; then
  echo "Usage: sudo $0 OWNER/REPO" >&2
  echo "   or: sudo $0 https://github.com/OWNER/REPO" >&2
  echo "   or: curl .../install.sh | sudo bash -s -- OWNER/REPO" >&2
  echo "   or: sudo BOTYTRADER_REPO=OWNER/REPO $0" >&2
  exit 1
fi

REPO="$(normalize_repo_slug "$REPO")"

if [[ "$REPO" != */* ]] || [[ "$REPO" == */*/* ]]; then
  echo "Expected OWNER/REPO (two path segments), got: $REPO" >&2
  echo "Example: sudo $0 dixonSolutions/BotyTrader" >&2
  exit 1
fi

OWNER="${REPO%%/*}"
NAME="${REPO#*/}"
OWNER_LC="$(echo "$OWNER" | tr '[:upper:]' '[:lower:]')"
NAME_LC="$(echo "$NAME" | tr '[:upper:]' '[:lower:]')"

# GitHub Pages project URLs are often served with a lowercase path; try a few bases.
APT_BASE_CANDIDATES=(
  "https://${OWNER_LC}.github.io/${NAME_LC}"
  "https://${OWNER_LC}.github.io/${NAME}"
  "https://${OWNER}.github.io/${NAME_LC}"
  "https://${OWNER}.github.io/${NAME}"
)

if [[ "$(id -u)" -ne 0 ]]; then
  echo "This installer must run as root (sudo)." >&2
  exit 1
fi

has_stable_index() {
  local base="$1"
  curl -fsSL -o /dev/null --connect-timeout 10 "$base/dists/stable/InRelease" 2>/dev/null \
    || curl -fsSL -o /dev/null --connect-timeout 10 "$base/dists/stable/Release" 2>/dev/null
}

PAGES_BASE_URL=""
for base in "${APT_BASE_CANDIDATES[@]}"; do
  if has_stable_index "$base"; then
    PAGES_BASE_URL="$base"
    break
  fi
done

if [[ -z "$PAGES_BASE_URL" ]]; then
  echo "Could not reach this repo's APT metadata on GitHub Pages (tried dists/stable/InRelease or Release)." >&2
  echo "Tried:" >&2
  for base in "${APT_BASE_CANDIDATES[@]}"; do
    echo "  - $base" >&2
  done
  echo "" >&2
  echo "Fix:" >&2
  echo "  1. Settings → Pages: Deploy from branch, folder /docs (default branch)." >&2
  echo "  2. Push a version tag (v*) so the Release workflow publishes docs/pool and docs/dists." >&2
  echo "  3. Pass repo explicitly: sudo $0 ${OWNER}/${NAME}" >&2
  echo "     or full URL: sudo $0 https://github.com/${OWNER}/${NAME}" >&2
  exit 1
fi

KEYRING="/etc/apt/keyrings/botytrader.gpg"
SOURCE_LIST="/etc/apt/sources.list.d/botytrader.list"

mkdir -p /etc/apt/keyrings
umask 022

if ! curl -fsSL --connect-timeout 15 "${PAGES_BASE_URL}/public.asc" | gpg --dearmor -o "$KEYRING"; then
  echo "Found APT index at ${PAGES_BASE_URL} but failed to download public.asc (same base URL)." >&2
  exit 1
fi
chmod 644 "$KEYRING"

echo "deb [arch=amd64 signed-by=${KEYRING}] ${PAGES_BASE_URL} stable main" > "$SOURCE_LIST"
chmod 644 "$SOURCE_LIST"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y botytrader

echo "Installed botytrader (APT base: ${PAGES_BASE_URL}). Run: botytrader"
