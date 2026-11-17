#!/bin/sh
# Run the core unit tests from a terminal, no server needed.
# Uses Node 20+ when installed, otherwise macOS's built-in JavaScriptCore.
cd "$(dirname "$0")/.." || exit 1
if command -v node >/dev/null 2>&1; then
  exec node --test tests/
fi
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc
if [ ! -x "$JSC" ]; then
  echo "Need Node 20+ (or macOS, for its built-in JavaScriptCore)." >&2
  exit 1
fi
exec "$JSC" -m tests/jsc-runner.mjs
