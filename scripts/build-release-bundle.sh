#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"
OUT_DIR="${1:-$ROOT_DIR/out}"
BUNDLE_ROOT="$OUT_DIR/tallybridge-$VERSION"

rm -rf "$BUNDLE_ROOT"
mkdir -p "$BUNDLE_ROOT"

cp -R "$ROOT_DIR/dist" "$BUNDLE_ROOT/dist"
cp -R "$ROOT_DIR/node_modules" "$BUNDLE_ROOT/node_modules"
cp "$ROOT_DIR/package.json" "$BUNDLE_ROOT/package.json"
cp "$ROOT_DIR/package-lock.json" "$BUNDLE_ROOT/package-lock.json"
cp "$ROOT_DIR/README.md" "$BUNDLE_ROOT/README.md"
cp "$ROOT_DIR/config.example.json" "$BUNDLE_ROOT/config.example.json"

mkdir -p "$OUT_DIR"
tar -C "$OUT_DIR" -czf "$OUT_DIR/tallybridge-$VERSION-bundle.tar.gz" "tallybridge-$VERSION"

echo "$OUT_DIR/tallybridge-$VERSION-bundle.tar.gz"
