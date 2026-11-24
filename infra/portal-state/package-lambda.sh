#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 1 || $1 != /* || $1 != *.zip || -e $1 || -L $1 ]]; then
  echo 'Supply a new absolute .zip path in an existing private directory.' >&2
  exit 2
fi
output=$1
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
work=$(mktemp -d)
trap 'rm -r -- "$work"' EXIT
cp "$root/package.json" "$root/package-lock.json" "$work/"
mkdir -- "$work/onboarding"
for module in "$root"/onboarding/*.mjs; do
  [[ $module == *.test.mjs ]] || cp "$module" "$work/onboarding/"
done
cd -- "$work"
npm ci --omit=dev --ignore-scripts --no-audit --no-fund
(set -o noclobber; zip -q -r - onboarding node_modules package.json > "$output")
