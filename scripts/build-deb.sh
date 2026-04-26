#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"
OUT_DIR="${1:-$ROOT_DIR/out}"
PACKAGE_ROOT="$OUT_DIR/deb-root"

rm -rf "$PACKAGE_ROOT"
mkdir -p "$PACKAGE_ROOT/DEBIAN"
mkdir -p "$PACKAGE_ROOT/opt/tallybridge"
mkdir -p "$PACKAGE_ROOT/etc/tallybridge"
mkdir -p "$PACKAGE_ROOT/usr/bin"
mkdir -p "$PACKAGE_ROOT/lib/systemd/system"

cat >"$PACKAGE_ROOT/DEBIAN/control" <<EOF
Package: tallybridge
Version: $VERSION
Section: video
Priority: optional
Architecture: all
Depends: nodejs
Maintainer: Lars Corneliussen <lc@talendos.com>
Description: ATEM-to-Hollyland tally bridge prototype
 Bridge a real ATEM switcher to Hollyland tally clients over Ethernet.
EOF

cp -R "$ROOT_DIR/dist" "$PACKAGE_ROOT/opt/tallybridge/dist"
cp -R "$ROOT_DIR/node_modules" "$PACKAGE_ROOT/opt/tallybridge/node_modules"
cp "$ROOT_DIR/package.json" "$PACKAGE_ROOT/opt/tallybridge/package.json"
cp "$ROOT_DIR/package-lock.json" "$PACKAGE_ROOT/opt/tallybridge/package-lock.json"
cp "$ROOT_DIR/README.md" "$PACKAGE_ROOT/opt/tallybridge/README.md"
cp "$ROOT_DIR/config.example.json" "$PACKAGE_ROOT/etc/tallybridge/config.example.json"
cp "$ROOT_DIR/packaging/linux/tallybridge" "$PACKAGE_ROOT/usr/bin/tallybridge"
cp "$ROOT_DIR/packaging/linux/tallybridge.service" "$PACKAGE_ROOT/lib/systemd/system/tallybridge.service"

chmod 0755 "$PACKAGE_ROOT/usr/bin/tallybridge"

mkdir -p "$OUT_DIR"
dpkg-deb --build "$PACKAGE_ROOT" "$OUT_DIR/tallybridge_${VERSION}_all.deb" >/dev/null

echo "$OUT_DIR/tallybridge_${VERSION}_all.deb"
