#!/bin/sh
# Extract the single Depot executable from an independently SHA-256-verified archive.
# Handles depot, ./depot, and release-directory/depot without unpacking other files.
set -eu
archive=${1:?Usage: extract-depot.sh ARCHIVE DESTINATION}
destination=${2:?Usage: extract-depot.sh ARCHIVE DESTINATION}
[ -f "$archive" ] || { echo 'Depot archive missing' >&2; exit 1; }
mkdir -p "$destination"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT HUP INT TERM
tar -tzf "$archive" > "$work/members"
grep -E '(^|/)depot$' "$work/members" > "$work/candidates" || {
  echo 'No depot executable entry in the release archive' >&2
  exit 1
}
count=$(wc -l < "$work/candidates" | tr -d '[:space:]')
if [ "$count" -ne 1 ]; then
  echo "Expected exactly one depot executable, found $count" >&2
  exit 1
fi
entry=$(cat "$work/candidates")
printf 'Selected Depot release entry: %s\n' "$entry" >&2
tar -xzOf "$archive" "$entry" > "$destination/depot"
[ -s "$destination/depot" ] || { echo 'Extracted Depot binary was empty' >&2; exit 1; }
chmod 0755 "$destination/depot"
