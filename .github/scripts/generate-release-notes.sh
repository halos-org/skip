#!/usr/bin/env bash
#
# Release-notes override for the shared build-release workflow (npm-only mode).
# The shared default emits APT install instructions; Skip publishes to npm, so
# this emits npm-appropriate notes instead.
#
# Usage: generate-release-notes.sh <debian-version> <tag> <prerelease|draft>
# Writes release_notes.md in the current directory.

set -euo pipefail

# $1 is the debian version from the shared workflow's positional contract;
# unused here because npm publishes the plain VERSION.
TAG_VERSION="$2"
MODE="$3"

NPM_VERSION="$(cat VERSION | tr -d '[:space:]')"

# Changelog since the last published (non-draft, non-prerelease) release.
LAST_TAG=$(gh release list --limit 100 --json tagName,isPrerelease,isDraft \
  --jq '.[] | select(.isDraft == false and .isPrerelease == false) | .tagName' | head -n1 || true)

if [ -n "$LAST_TAG" ]; then
  CHANGELOG=$(git log "${LAST_TAG}"..HEAD --pretty=format:"- %s (%h)" --no-merges -- || echo "- Release ${NPM_VERSION}")
else
  CHANGELOG=$(git log -10 --pretty=format:"- %s (%h)" --no-merges)
fi

if [ "$MODE" = "prerelease" ]; then
  SHORT_SHA="${GITHUB_SHA:0:7}"
  cat > release_notes.md <<NOTES_EOF
## Skip ${TAG_VERSION} (Pre-release)

> **Pre-release build from the main branch. Not published to npm — for testing only.**

**Build Information:**
- Version: ${NPM_VERSION}
- Commit: ${SHORT_SHA} (\`${GITHUB_SHA}\`)
- Built: $(date -u '+%Y-%m-%d %H:%M:%S UTC')

### Recent Changes

${CHANGELOG}
NOTES_EOF
else
  cat > release_notes.md <<NOTES_EOF
## Skip v${NPM_VERSION}

An advanced and versatile marine instrumentation package to display Signal K data.

### Changes

${CHANGELOG}

### Installation

Published to npm as [\`@halos-org/skip\`](https://www.npmjs.com/package/@halos-org/skip). On a Signal K server it is available from the Signal K app store, or install directly:

\`\`\`bash
npm install @halos-org/skip@${NPM_VERSION}
\`\`\`
NOTES_EOF
fi

echo "Generated release_notes.md ($MODE):"
cat release_notes.md
