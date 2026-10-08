#!/bin/sh
# Install a snapweb release build from pbtrung/snapweb into ./snapweb
# (or $SNAPWEB_DIR), without rebuilding anything.
# Usage: update-snapweb.sh [tag]  (default: the latest release)
#        FORCE=1 update-snapweb.sh  (reinstall even if up to date)
#        SNAPWEB_DIR=/path update-snapweb.sh  (install somewhere else)
set -e

REPO="pbtrung/snapweb"
DEST="${SNAPWEB_DIR:-./snapweb}"
# Without a trailing slash, "$DEST.old" would end up inside $DEST
DEST="${DEST%/}"
TAG="${1:-latest}"

command -v unzip >/dev/null 2>&1 || {
  printf "unzip is required\n" >&2
  exit 1
}

# fetch URL FILE ("-" for stdout), with curl or wget, whichever exists
fetch() {
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL -o "$2" "$1"
  else
    wget -q -O "$2" "$1"
  fi
}

if [ "$TAG" = "latest" ]; then
  API="https://api.github.com/repos/$REPO/releases/latest"
else
  API="https://api.github.com/repos/$REPO/releases/tags/$TAG"
fi

json="$(fetch "$API" -)" || {
  printf "Can't fetch release info from %s\n" "$API" >&2
  exit 1
}
tag="$(printf "%s\n" "$json" |
  sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1)"
url="$(printf "%s\n" "$json" |
  sed -n 's/.*"browser_download_url": *"\([^"]*\.zip\)".*/\1/p' | head -n 1)"
if [ -z "$tag" ] || [ -z "$url" ]; then
  printf "No .zip asset found in release %s of %s\n" "$TAG" "$REPO" >&2
  exit 1
fi

if [ "${FORCE:-0}" = 0 ] && [ "$(cat "$DEST/.version" 2>/dev/null)" = "$tag" ]; then
  printf "snapweb %s is already installed in %s\n" "$tag" "$DEST"
  exit 0
fi

# Unpack next to $DEST (same filesystem), so the swap below is two renames
# and the web server never serves a half-extracted tree.
mkdir -p "$(dirname "$DEST")"
tmp="$(mktemp -d "$(dirname "$DEST")/.snapweb.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT
# dash skips the EXIT trap when interrupted, so exit through it
trap 'exit 1' INT TERM HUP

printf "Downloading %s\n" "$url"
fetch "$url" "$tmp/snapweb.zip"
unzip -q "$tmp/snapweb.zip" -d "$tmp/unzip"
# Accept index.html at the zip root or inside one top-level folder
# (e.g. snapweb/index.html).
if [ -f "$tmp/unzip/index.html" ]; then
  mv "$tmp/unzip" "$tmp/new"
else
  for f in "$tmp"/unzip/*/index.html; do
    [ -f "$f" ] || continue
    if [ -e "$tmp/new" ]; then
      printf "%s has more than one folder with an index.html\n" "$url" >&2
      exit 1
    fi
    mv "$(dirname "$f")" "$tmp/new"
  done
fi
if [ ! -f "$tmp/new/index.html" ]; then
  printf "%s has no index.html at its root or in a top-level folder\n" "$url" >&2
  exit 1
fi
printf "%s\n" "$tag" >"$tmp/new/.version"
chmod -R a+rX "$tmp/new"

rm -rf "$DEST.old"
[ -e "$DEST" ] && mv "$DEST" "$DEST.old"
mv "$tmp/new" "$DEST"
rm -rf "$DEST.old"

printf "Installed snapweb %s in %s\n" "$tag" "$DEST"
