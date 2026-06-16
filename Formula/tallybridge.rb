class Tallybridge < Formula
  desc "ATEM-to-Hollyland tally bridge prototype"
  homepage "https://github.com/lcorneliussen/tallybridge"
  url "https://github.com/lcorneliussen/tallybridge/releases/download/v0.1.0/tallybridge-0.1.0-bundle.tar.gz"
  sha256 "af2a42be93ee491394b4740394c1076dcf6c9c2539e46d151857bf19e897ee76"
  version "0.1.0"
  depends_on "node"

  def install
    libexec.install Dir["*"]

    (bin/"tallybridge").write <<~SH
      #!/bin/bash
      export CONFIG_PATH="${CONFIG_PATH:-#{etc}/tallybridge/config.json}"
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
    assert_match "0.1.0", shell_output("#{Formula["node"].opt_bin}/node -p \"require('#{libexec}/package.json').version\"")
  end
end
