#!/usr/bin/env bash
#
# Push Release Script for BotyTrader
# Automatically determines the next version, updates package.json,
# creates a git tag, and pushes to trigger the GitHub release workflow.
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get the latest git tag
get_latest_tag() {
    git tag -l "v*" | sort -V | tail -1 || echo ""
}

# Parse version components
parse_version() {
    local version="$1"
    version="${version#v}"  # Remove 'v' prefix if present
    echo "$version"
}

# Increment version based on type
increment_version() {
    local version="$1"
    local increment_type="$2"

    # Parse version into components
    local major minor patch
    major=$(echo "$version" | cut -d. -f1)
    minor=$(echo "$version" | cut -d. -f2)
    patch=$(echo "$version" | cut -d. -f3)

    case "$increment_type" in
        major)
            major=$((major + 1))
            minor=0
            patch=0
            ;;
        minor)
            minor=$((minor + 1))
            patch=0
            ;;
        patch|*)
            patch=$((patch + 1))
            ;;
    esac

    echo "${major}.${minor}.${patch}"
}

# Update package.json version
update_package_json() {
    local new_version="$1"
    local package_file="package.json"

    if [[ ! -f "$package_file" ]]; then
        log_error "package.json not found in current directory"
        exit 1
    fi

    # Use sed to update version in package.json
    sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"${new_version}\"/" "$package_file"
    log_info "Updated package.json to version ${new_version}"
}

# Check for uncommitted changes
check_working_tree() {
    if ! git diff-index --quiet HEAD --; then
        log_error "You have uncommitted changes. Please commit or stash them before releasing."
        git status --short
        exit 1
    fi
}

# Main release process
main() {
    local increment_type="${1:-patch}"  # Default to patch increment

    # Validate increment type
    if [[ ! "$increment_type" =~ ^(major|minor|patch)$ ]]; then
        log_error "Invalid increment type: $increment_type"
        echo "Usage: $0 [major|minor|patch]"
        echo "  major - Increment major version (x.0.0)"
        echo "  minor - Increment minor version (x.y.0)"
        echo "  patch - Increment patch version (x.y.z) [default]"
        exit 1
    fi

    log_info "Starting release process with $increment_type increment..."

    # Check if we're in a git repository
    if ! git rev-parse --git-dir > /dev/null 2>&1; then
        log_error "Not a git repository"
        exit 1
    fi

    # Ensure we're on the main/master branch
    local current_branch
    current_branch=$(git rev-parse --abbrev-ref HEAD)
    if [[ "$current_branch" != "main" && "$current_branch" != "master" ]]; then
        log_warn "Not on main/master branch (currently on: $current_branch)"
        read -p "Continue anyway? [y/N] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi

    # Pull latest changes
    log_info "Pulling latest changes..."
    git pull origin "$current_branch"

    # Check for uncommitted changes
    check_working_tree

    # Get latest tag
    local latest_tag
    latest_tag=$(get_latest_tag)

    if [[ -z "$latest_tag" ]]; then
        log_warn "No existing tags found. Starting from v0.0.0"
        latest_tag="v0.0.0"
    fi

    local current_version
    current_version=$(parse_version "$latest_tag")

    log_info "Current version: $current_version"

    # Calculate new version
    local new_version
    new_version=$(increment_version "$current_version" "$increment_type")
    local new_tag="v${new_version}"

    log_info "New version will be: $new_version (tag: $new_tag)"

    # Confirm with user
    read -p "Proceed with release? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        log_info "Release cancelled"
        exit 0
    fi

    # Update package.json
    update_package_json "$new_version"

    # Stage package.json
    git add package.json

    # Create commit
    git commit -m "chore(release): bump version to ${new_version}"
    log_success "Created release commit"

    # Push commit
    git push origin "$current_branch"
    log_success "Pushed commit to origin/$current_branch"

    # Create and push tag
    git tag -a "$new_tag" -m "Release ${new_version}"
    log_success "Created tag $new_tag"

    git push origin "$new_tag"
    log_success "Pushed tag $new_tag"

    echo
    log_success "Release $new_tag initiated!"
    log_info "GitHub Actions workflow will now build and publish the release."
    log_info "Monitor progress at: https://github.com/$(git remote get-url origin | sed 's/.*://; s/.git$//' | tr '/' ' ' | awk '{print $1}')/$(basename "$(git rev-parse --show-toplevel)")/actions"
}

# Run main function
main "$@"
