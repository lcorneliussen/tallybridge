#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${VERSION:-$(node -p "require('$ROOT_DIR/package.json').version")}"
OWNER="${OWNER:-lcorneliussen}"
REPO="${REPO:-tallybridge}"
OUT_PATH="${1:-$ROOT_DIR/out/tallybridge.rb}"
TARBALL_PATH="${TARBALL_PATH:-$ROOT_DIR/out/tallybridge-$VERSION-bundle.tar.gz}"
SHA256="$(shasum -a 256 "$TARBALL_PATH" | awk '{print $1}')"
URL="https://github.com/$OWNER/$REPO/releases/download/v$VERSION/tallybridge-$VERSION-bundle.tar.gz"

mkdir -p "$(dirname "$OUT_PATH")"

cat >"$OUT_PATH" <<EOF
class Tallybridge < Formula
  desc "ATEM-to-Hollyland tally bridge prototype"
  homepage "https://github.com/$OWNER/$REPO"
  url "$URL"
  sha256 "$SHA256"
  version "$VERSION"
  depends_on "node"

  def install
    libexec.install Dir["*"]

    (bin/"tallybridge").write <<~SH
      #!/bin/bash
      export CONFIG_PATH="\${CONFIG_PATH:-#{etc}/tallybridge/config.json}"
      cd "#{libexec}"
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/dist/src/index.js"
    SH

    chmod 0755, bin/"tallybridge"
    (etc/"tallybridge").mkpath
    cp "#{libexec}/config.example.json", "#{etc}/tallybridge/config.example.json" unless (etc/"tallybridge/config.example.json").exist?
  end

  service do
    run [opt_bin/"tallybridge"]
    keep_alive true
    working_dir var
    log_path var/"log/tallybridge.log"
    error_log_path var/"log/tallybridge.log"
  end

  test do
    assert_match "$VERSION", shell_output("#{Formula["node"].opt_bin}/node -p \\"require('#{libexec}/package.json').version\\"")
  end
end
EOF

echo "$OUT_PATH"
