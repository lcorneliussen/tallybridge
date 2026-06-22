class Tallybridge < Formula
  desc "ATEM-to-Hollyland tally bridge prototype"
  homepage "https://github.com/lcorneliussen/tallybridge"
  url "https://github.com/lcorneliussen/tallybridge/releases/download/v0.1.3/tallybridge-0.1.3-bundle.tar.gz"
  sha256 "b9d7f7671c54ed5d848f18b1a7aa4dacdd5530d6761ce0b42100a80d558a0aff"
  version "0.1.3"
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
    assert_match "0.1.3", shell_output("#{Formula["node"].opt_bin}/node -p \"require('#{libexec}/package.json').version\"")
  end
end
