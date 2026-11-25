#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -ne 2 || $1 != /* || $2 != /* || $2 != *.zip || -e $2 || -L $2 ]]; then
  echo 'Usage: bash package-plan.sh /absolute/runner-assets-directory /absolute/new-bundle.zip' >&2
  exit 2
fi
assets=$1
bundle=$2
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
pilot="$root/../pilot"
work=$(mktemp -d)
trap 'rm -r -- "$work"' EXIT

cp "$pilot"/{main.tf,variables.tf,.terraform.lock.hcl,artifacts.sha256} "$work/"
cp "$root"/{buildspec.yml,run-plan.sh} "$work/"
mkdir "$work/artifacts"
cp "$assets"/{webhook.zip,runners.zip,runner-binaries-syncer.zip} "$work/artifacts/"
cd "$work"
sha_check=$(command -v sha256sum || command -v shasum)
"$sha_check" -c artifacts.sha256
# The preview starts from empty local state and cannot be applied through the installer.
node --input-type=module <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
const source = readFileSync('main.tf', 'utf8');
const backend = '  backend "s3" {\n    encrypt      = true\n    use_lockfile = true\n  }\n\n';
if (!source.includes(backend)) throw new Error('Review the pilot backend block before packaging a preview.');
writeFileSync('main.tf', source.replace(backend, ''));
JS
(set -o noclobber; zip -q -r - . > "$bundle")
