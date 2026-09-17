#!/usr/bin/env bash
# VOICE_ROOT 아래 파일의 목록(상대경로·크기·sha256)을 TSV 로 낸다. 읽기만 한다.
# Blob 이전 뒤 recordings 표(rel_path·bytes·sha256)와 대조하는 근거다.
#
#   ./scripts/azure/voice-inventory.sh [VOICE_ROOT] > voice-manifest.tsv
set -euo pipefail

root="${1:-${VOICE_ROOT:-./voice}}"
[ -d "$root" ] || { echo "폴더가 없다: $root" >&2; exit 1; }

cd "$root"
find . -type f ! -name '.*' | LC_ALL=C sort | while IFS= read -r f; do
  rel="${f#./}"
  bytes="$(stat -f %z "$f")"
  sha="$(shasum -a 256 "$f" | cut -d' ' -f1)"
  printf '%s\t%s\t%s\n' "$rel" "$bytes" "$sha"
done
