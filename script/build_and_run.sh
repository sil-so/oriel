#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONFIGURATION="${CONFIGURATION:-debug}"
APP_DIR="$ROOT_DIR/build/Oriel.app"
CONTENTS_DIR="$APP_DIR/Contents"
WEB_DIR="$CONTENTS_DIR/Resources/Web"
ENTITLEMENTS="$ROOT_DIR/Sources/OrielApp/Support/Oriel.entitlements"

runningPidsForExecutable() {
  local executable="$1"
  local pids=("${(@f)$(pgrep -f "$executable" 2>/dev/null || true)}")
  pids=("${(@)pids:#}")
  printf '%s\n' "${pids[@]}"
}

terminateExecutable() {
  local executable="$1"
  local pids=("${(@f)$(runningPidsForExecutable "$executable")}")
  pids=("${(@)pids:#}")
  (( ${#pids[@]} == 0 )) && return

  kill -TERM "${pids[@]}" 2>/dev/null || true
  for _ in {1..20}; do
    pids=("${(@f)$(runningPidsForExecutable "$executable")}")
    pids=("${(@)pids:#}")
    (( ${#pids[@]} == 0 )) && return
    sleep 0.1
  done
  kill -KILL "${pids[@]}" 2>/dev/null || true
}

runningPidsForProcessPattern() {
  local pattern="$1"
  local pids=("${(@f)$(pgrep -f "$pattern" 2>/dev/null || true)}")
  pids=("${(@)pids:#}")
  printf '%s\n' "${pids[@]}"
}

terminateProcessPattern() {
  local pattern="$1"
  local pids=("${(@f)$(runningPidsForProcessPattern "$pattern")}")
  pids=("${(@)pids:#}")
  (( ${#pids[@]} == 0 )) && return

  kill -TERM "${pids[@]}" 2>/dev/null || true
  for _ in {1..20}; do
    pids=("${(@f)$(runningPidsForProcessPattern "$pattern")}")
    pids=("${(@)pids:#}")
    (( ${#pids[@]} == 0 )) && return
    sleep 0.1
  done
  kill -KILL "${pids[@]}" 2>/dev/null || true
}

stopRunningOrielBundleProcesses() {
  terminateExecutable "$APP_DIR/Contents/MacOS/OrielBrowserBridge"
  terminateExecutable "$APP_DIR/Contents/MacOS/OrielApp"
  terminateProcessPattern "/Contents/MacOS/OrielBrowserBridge$"
  terminateProcessPattern "/Contents/MacOS/OrielApp$"
}

signOrielBundle() {
  local app_dir="$1"
  local verify_mode="${2:-standard}"
  local identity
  identity="$(resolveCodesignIdentity)"

  xattr -cr "$app_dir"
  codesign --force --options runtime \
    --sign "$identity" \
    "$app_dir/Contents/MacOS/OrielBrowserBridge"
  codesign --force --options runtime \
    --entitlements "$ENTITLEMENTS" \
    --sign "$identity" \
    "$app_dir"
  if [[ "$verify_mode" == "strict" ]]; then
    codesign --verify --deep --strict "$app_dir"
  else
    codesign --verify --deep "$app_dir"
  fi
}

resolveCodesignIdentity() {
  if [[ -n "${ORIEL_CODESIGN_IDENTITY:-}" ]]; then
    printf '%s' "$ORIEL_CODESIGN_IDENTITY"
    return
  fi

  local detected
  detected="$(security find-identity -v -p codesigning 2>/dev/null | sed -n 's/.*"\(.*\)".*/\1/p' | head -n 1)"
  if [[ -n "$detected" ]]; then
    printf '%s' "$detected"
  else
    printf '%s' "-"
  fi
}

cd "$ROOT_DIR"
swift build -c "$CONFIGURATION" --product OrielApp
swift build -c "$CONFIGURATION" --product OrielBrowserBridge
BIN_DIR="$(swift build -c "$CONFIGURATION" --show-bin-path)"
STAGE_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/oriel-app-stage.XXXXXX")"
STAGED_APP_DIR="$STAGE_ROOT/Oriel.app"
STAGED_CONTENTS_DIR="$STAGED_APP_DIR/Contents"
STAGED_WEB_DIR="$STAGED_CONTENTS_DIR/Resources/Web"

cleanupStage() {
  rm -rf "$STAGE_ROOT"
}
trap cleanupStage EXIT

mkdir -p "$STAGED_CONTENTS_DIR/MacOS" "$STAGED_WEB_DIR"
cp -X "$BIN_DIR/OrielApp" "$STAGED_CONTENTS_DIR/MacOS/OrielApp"
cp -X "$BIN_DIR/OrielBrowserBridge" "$STAGED_CONTENTS_DIR/MacOS/OrielBrowserBridge"
cp -X "$ROOT_DIR/Sources/OrielApp/Support/Info.plist" "$STAGED_CONTENTS_DIR/Info.plist"
cp -X "$ROOT_DIR/Sources/OrielApp/Support/Oriel.icns" "$STAGED_CONTENTS_DIR/Resources/Oriel.icns"
cp -X "$ROOT_DIR/Sources/OrielApp/Support/OrielStatusIcon.png" "$STAGED_CONTENTS_DIR/Resources/OrielStatusIcon.png"
cp -X "$ROOT_DIR/index.html" "$STAGED_WEB_DIR/index.html"
cp -R -X "$ROOT_DIR/js" "$STAGED_WEB_DIR/js"
cp -R -X "$ROOT_DIR/css" "$STAGED_WEB_DIR/css"
cp -R -X "$ROOT_DIR/assets" "$STAGED_WEB_DIR/assets"
signOrielBundle "$STAGED_APP_DIR" strict

stopRunningOrielBundleProcesses
rm -rf "$APP_DIR"
cp -R -X "$STAGED_APP_DIR" "$APP_DIR"
codesign --verify --deep "$APP_DIR"
codesign -dv "$APP_DIR" >/dev/null 2>&1

if [[ "${1:-}" == "--verify" ]]; then
  echo "Staged $APP_DIR"
  exit 0
fi

open "$APP_DIR"
