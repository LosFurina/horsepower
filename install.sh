#!/bin/sh
set -eu

VERSION="${HORSEPOWER_VERSION:-0.1.0-alpha.1}"
LOCALE=""
NO_SETUP=0
REPOSITORY="https://github.com/LosFurina/horsepower"
readonly NODE_COMPATIBILITY='>=22.19.0'
readonly PI_COMPATIBILITY='0.80.10'
readonly OPENSPEC_COMPATIBILITY='>=1.6.0 <2.0.0'

usage() {
  printf '%s\n' "Usage: install.sh [--version VERSION] [--locale en|zh-CN] [--no-setup]"
}

fail() {
  if [ "${LOCALE:-en}" = "zh-CN" ]; then printf '%s\n' "Horsepower 安装程序失败：$*" >&2
  else printf '%s\n' "horsepower installer: $*" >&2; fi
  exit 1
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --version) [ "$#" -ge 2 ] || fail "--version requires a value"; VERSION=$2; shift 2 ;;
    --locale) [ "$#" -ge 2 ] || fail "--locale requires a value"; LOCALE=$2; shift 2 ;;
    --no-setup) NO_SETUP=1; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

case "$VERSION" in
  ''|*[!0-9A-Za-z.-]*) fail "invalid version: $VERSION" ;;
esac
case "$LOCALE" in
  ''|en|zh-CN) ;;
  *) fail "unsupported locale: $LOCALE" ;;
esac

case "$(uname -s 2>/dev/null || printf unknown)" in
  Darwin|Linux) ;;
  *) fail "supported platforms are Linux and macOS" ;;
esac

command -v curl >/dev/null 2>&1 || fail "curl is required"
command -v tar >/dev/null 2>&1 || fail "tar is required"
command -v node >/dev/null 2>&1 || fail "Node.js $NODE_COMPATIBILITY is required"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=19)?0:1)' \
  || fail "Node.js $NODE_COMPATIBILITY is required"
command -v pi >/dev/null 2>&1 || fail "Pi $PI_COMPATIBILITY is required"
if PI_VERSION=$(pi --version 2>/dev/null); then :; else fail "Pi $PI_COMPATIBILITY is required"; fi
[ "$PI_VERSION" = "$PI_COMPATIBILITY" ] || fail "Pi $PI_COMPATIBILITY is required; found ${PI_VERSION:-unknown}"
command -v openspec >/dev/null 2>&1 || fail "Install official @fission-ai/openspec $OPENSPEC_COMPATIBILITY: https://github.com/Fission-AI/OpenSpec"
if OPENSPEC_VERSION=$(openspec --version 2>/dev/null); then :; else
  fail "Unable to determine official OpenSpec version; OpenSpec $OPENSPEC_COMPATIBILITY is required"
fi
node -e '
const value = process.argv[1];
const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
process.exit(match && match[4] === undefined && Number(match[1]) === 1 && Number(match[2]) >= 6 ? 0 : 1);
' "$OPENSPEC_VERSION" || fail "OpenSpec $OPENSPEC_COMPATIBILITY is required; found ${OPENSPEC_VERSION:-unknown}"

HOME_DIR=${HOME:?HOME is required}
MANAGED_ROOT="$HOME_DIR/.pi/agent/horsepower"
VERSIONS="$MANAGED_ROOT/versions"
VERSION_ROOT="$VERSIONS/v$VERSION"
CURRENT="$MANAGED_ROOT/current"
EXTENSION_LINK="$HOME_DIR/.pi/agent/extensions/horsepower"
SKILL_LINK="$HOME_DIR/.pi/agent/skills/horsepower"
CLI_LINK="$HOME_DIR/.local/bin/horsepower"
EXTENSION_TARGET="$MANAGED_ROOT/current/pi/extensions/horsepower"
SKILL_TARGET="$MANAGED_ROOT/current/pi/skills/horsepower"
CLI_TARGET="$MANAGED_ROOT/current/bin/horsepower"
for ancestor in "$HOME_DIR" "$HOME_DIR/.pi" "$HOME_DIR/.pi/agent" "$HOME_DIR/.local" "$HOME_DIR/.local/bin"; do
  [ ! -L "$ancestor" ] || fail "unsafe installation ancestor: $ancestor"
  [ ! -e "$ancestor" ] || [ -d "$ancestor" ] || fail "unsafe installation ancestor: $ancestor"
done
ASSET="horsepower-v$VERSION.tar.gz"
BASE_URL=${HORSEPOWER_RELEASE_BASE_URL:-"$REPOSITORY/releases/download/v$VERSION"}
TTY_INPUT=${HORSEPOWER_TTY_INPUT:-/dev/tty}
TTY_OUTPUT=${HORSEPOWER_TTY_OUTPUT:-/dev/tty}
INTERACTIVE=0
if [ "$NO_SETUP" -eq 0 ] && (exec 3<"$TTY_INPUT" 4>>"$TTY_OUTPUT") 2>/dev/null; then
  exec 3<"$TTY_INPUT" 4>>"$TTY_OUTPUT"
  INTERACTIVE=1
fi
if [ -z "$LOCALE" ] && [ -f "$MANAGED_ROOT/settings.json" ] && [ ! -L "$MANAGED_ROOT/settings.json" ]; then
  LOCALE=$(node -e 'const fs=require("fs");const v=JSON.parse(fs.readFileSync(process.argv[1],"utf8")).outputLocale;if(v==="en"||v==="zh-CN")process.stdout.write(v)' "$MANAGED_ROOT/settings.json" 2>/dev/null || true)
fi
if [ -z "$LOCALE" ] && [ "$INTERACTIVE" -eq 1 ]; then
  printf '%s\n' "Choose language / 选择语言: 1) English  2) 简体中文" >&4
  IFS= read -r LANGUAGE_CHOICE <&3 || LANGUAGE_CHOICE=""
  case "$LANGUAGE_CHOICE" in 2|zh-CN) LOCALE=zh-CN ;; *) LOCALE=en ;; esac
fi
if [ -z "$LOCALE" ]; then LOCALE=en; fi

TMP=$(mktemp -d "${TMPDIR:-/tmp}/horsepower-install.XXXXXX") || fail "unable to create temporary directory"
cleanup() { rm -rf "$TMP"; }
trap cleanup EXIT HUP INT TERM
ARCHIVE="$TMP/$ASSET"
CHECKSUM="$ARCHIVE.sha256"
curl -fsSL "$BASE_URL/$ASSET" -o "$ARCHIVE" || fail "unable to download $ASSET"
curl -fsSL "$BASE_URL/$ASSET.sha256" -o "$CHECKSUM" || fail "unable to download $ASSET.sha256"

EXPECTED=$(sed -n '1{s/[[:space:]].*$//;p;}' "$CHECKSUM")
CHECKSUM_NAME=$(sed -n '1{s/^[^[:space:]]*[[:space:]]*\*\{0,1\}//;p;}' "$CHECKSUM")
case "$EXPECTED" in ''|*[!0-9a-fA-F]*) fail "invalid checksum asset" ;; esac
[ "${#EXPECTED}" -eq 64 ] || fail "invalid checksum asset"
[ "$CHECKSUM_NAME" = "$ASSET" ] || fail "checksum filename does not match archive"
if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$ARCHIVE" | sed 's/[[:space:]].*$//');
elif command -v shasum >/dev/null 2>&1; then ACTUAL=$(shasum -a 256 "$ARCHIVE" | sed 's/[[:space:]].*$//');
else fail "sha256sum or shasum is required"; fi
[ "$ACTUAL" = "$EXPECTED" ] || fail "archive checksum mismatch"

tar -tzf "$ARCHIVE" > "$TMP/entries" || fail "unable to inspect archive"
[ -s "$TMP/entries" ] || fail "archive is empty"
cat > "$TMP/expected-entries" <<'EOF'
horsepower/
horsepower/LICENSE
horsepower/bin/
horsepower/bin/horsepower
horsepower/package.json
horsepower/pi/
horsepower/pi/extensions/
horsepower/pi/extensions/horsepower/
horsepower/pi/extensions/horsepower/index.js
horsepower/pi/skills/
horsepower/pi/skills/horsepower/
horsepower/pi/skills/horsepower/SKILL.md
horsepower/release-manifest.json
horsepower/resources/
horsepower/resources/agents/
horsepower/resources/agents/architect.md
horsepower/resources/agents/coder.md
horsepower/resources/agents/researcher.md
horsepower/resources/agents/reviewer.md
horsepower/resources/agents/tester.md
EOF
LC_ALL=C sort "$TMP/entries" > "$TMP/entries.sorted"
LC_ALL=C sort "$TMP/expected-entries" > "$TMP/expected-entries.sorted"
cmp -s "$TMP/entries.sorted" "$TMP/expected-entries.sorted" || fail "unexpected archive entry or missing release entry"
while IFS= read -r entry; do
  case "$entry" in
    horsepower|horsepower/) ;;
    horsepower/*) ;;
    /*|../*|*/../*|*/..|*\\*) fail "unsafe archive path: $entry" ;;
    *) fail "unexpected archive root: $entry" ;;
  esac
done < "$TMP/entries"
tar -tvzf "$ARCHIVE" > "$TMP/types" || fail "unable to inspect archive types"
while IFS= read -r listing; do
  kind=$(printf '%s' "$listing" | cut -c 1)
  case "$kind" in d|-) ;; *) fail "archive contains an unsafe link or entry type" ;; esac
done < "$TMP/types"

mkdir -p "$TMP/stage"
tar -xzf "$ARCHIVE" -C "$TMP/stage" || fail "unable to extract archive"
STAGED="$TMP/stage/horsepower"
[ -d "$STAGED" ] && [ ! -L "$STAGED" ] || fail "staged release root is invalid"
[ -x "$STAGED/bin/horsepower" ] || fail "staged CLI is missing or not executable"
mkdir -p "$TMP/preflight-home"
HOME="$TMP/preflight-home" "$STAGED/bin/horsepower" preflight "$STAGED" --version "$VERSION" --json >/dev/null \
  || fail "staged release preflight failed"

AUDIT_JSON="$TMP/skill-audit.json"
HOME="$HOME_DIR" "$STAGED/bin/horsepower" skill-audit --json >"$AUDIT_JSON" \
  || fail "staged Skill audit failed"
AUDIT_GATE=$(node -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data;process.stdout.write(r.status!=="complete"||r.externalCount>0?"warn":"clean")' "$AUDIT_JSON") \
  || fail "invalid staged Skill audit output"
if [ "$AUDIT_GATE" = "warn" ]; then
  AUDIT_TEXT="$TMP/skill-audit.txt"
  HOME="$HOME_DIR" "$STAGED/bin/horsepower" skill-audit --locale "$LOCALE" >"$AUDIT_TEXT" || fail "unable to render staged Skill audit"
  if [ "$INTERACTIVE" -eq 1 ]; then
    cat "$AUDIT_TEXT" >&4
    if [ "$LOCALE" = "zh-CN" ]; then printf '%s ' "Worker 使用 --no-skills，但主 Captain 仍可能受这些技能影响。继续？[y/N]：" >&4
    else printf '%s ' "Horsepower workers use --no-skills, but the main Captain may still be influenced. Continue? [y/N]:" >&4; fi
    IFS= read -r AUDIT_CONFIRM <&3 || AUDIT_CONFIRM=""
    case "$AUDIT_CONFIRM" in y|Y|yes) ;; *) fail "Skill audit declined before activation" ;; esac
  else
    cat "$AUDIT_TEXT" >&2
  fi
fi

for pair in "$EXTENSION_LINK|$EXTENSION_TARGET" "$SKILL_LINK|$SKILL_TARGET" "$CLI_LINK|$CLI_TARGET"; do
  link=${pair%%|*}; target=${pair#*|}
  if [ -L "$link" ]; then [ "$(readlink "$link")" = "$target" ] || fail "conflicting path: $link"
  elif [ -e "$link" ]; then fail "conflicting path: $link"
  fi
done
OLD_CURRENT=""
if [ -L "$CURRENT" ]; then OLD_CURRENT=$(readlink "$CURRENT");
elif [ -e "$CURRENT" ]; then fail "conflicting path: $CURRENT"; fi
if [ -e "$VERSION_ROOT" ] || [ -L "$VERSION_ROOT" ]; then
  [ -d "$VERSION_ROOT" ] && [ ! -L "$VERSION_ROOT" ] || fail "version destination conflicts: $VERSION_ROOT"
fi
SETTINGS_PATH="$MANAGED_ROOT/settings.json"
SETTINGS_EXISTED=0
if [ -L "$SETTINGS_PATH" ]; then fail "conflicting path: $SETTINGS_PATH"
elif [ -f "$SETTINGS_PATH" ]; then cp "$SETTINGS_PATH" "$TMP/settings.backup"; SETTINGS_EXISTED=1
elif [ -e "$SETTINGS_PATH" ]; then fail "conflicting path: $SETTINGS_PATH"
fi

mkdir -p "$VERSIONS" "$(dirname "$EXTENSION_LINK")" "$(dirname "$SKILL_LINK")" "$(dirname "$CLI_LINK")"
if [ ! -e "$VERSION_ROOT" ]; then mv "$STAGED" "$VERSION_ROOT"; fi
CREATED_LINKS=""
activate_failed=1
rollback() {
  [ "$activate_failed" -eq 1 ] || return 0
  if [ "$SETTINGS_EXISTED" -eq 1 ]; then
    cp "$TMP/settings.backup" "$SETTINGS_PATH.rollback"
    chmod 600 "$SETTINGS_PATH.rollback"
    mv -f "$SETTINGS_PATH.rollback" "$SETTINGS_PATH"
  elif [ -f "$SETTINGS_PATH" ] && [ ! -L "$SETTINGS_PATH" ]; then rm "$SETTINGS_PATH"; fi
  for link in $CREATED_LINKS; do [ -L "$link" ] && rm "$link"; done
  if [ -n "$OLD_CURRENT" ]; then
    ln -s "$OLD_CURRENT" "$CURRENT.rollback"
    mv -f "$CURRENT.rollback" "$CURRENT"
  else
    [ -L "$CURRENT" ] && rm "$CURRENT"
  fi
}
trap 'rollback; cleanup' EXIT HUP INT TERM
ln -s "versions/v$VERSION" "$CURRENT.new"
mv -f "$CURRENT.new" "$CURRENT"
for pair in "$EXTENSION_LINK|$EXTENSION_TARGET" "$SKILL_LINK|$SKILL_TARGET" "$CLI_LINK|$CLI_TARGET"; do
  link=${pair%%|*}; target=${pair#*|}
  if [ ! -L "$link" ]; then ln -s "$target" "$link"; CREATED_LINKS="$CREATED_LINKS $link"; fi
done

[ "$(readlink "$CURRENT")" = "versions/v$VERSION" ] || fail "post-install current verification failed"
[ "$(readlink "$EXTENSION_LINK")" = "$EXTENSION_TARGET" ] || fail "post-install extension verification failed"
[ "$(readlink "$SKILL_LINK")" = "$SKILL_TARGET" ] || fail "post-install skill verification failed"
[ "$(readlink "$CLI_LINK")" = "$CLI_TARGET" ] || fail "post-install CLI verification failed"
[ -x "$CLI_LINK" ] || fail "post-install CLI is not executable"
HOME="$HOME_DIR" "$CLI_LINK" doctor --installation-only --json >/dev/null \
  || fail "post-install doctor failed"

HOME="$HOME_DIR" "$CLI_LINK" configure --locale "$LOCALE" --json >/dev/null \
  || fail "unable to persist output locale"
if [ "$INTERACTIVE" -eq 1 ]; then
  if [ "$LOCALE" = "zh-CN" ]; then printf '%s ' "Webhook URL（留空跳过）：" >&4
  else printf '%s ' "Webhook URL (leave empty to skip):" >&4; fi
  IFS= read -r WEBHOOK_URL <&3 || WEBHOOK_URL=""
  if [ -z "$WEBHOOK_URL" ]; then
    HOME="$HOME_DIR" "$CLI_LINK" webhook skip --json >/dev/null || fail "unable to skip webhook setup"
  else
    if [ "$LOCALE" = "zh-CN" ]; then printf '%s ' "认证方式 [hmac/bearer/none]（推荐 hmac）：" >&4
    else printf '%s ' "Authentication [hmac/bearer/none] (hmac recommended):" >&4; fi
    IFS= read -r WEBHOOK_AUTH <&3 || WEBHOOK_AUTH=""
    [ -n "$WEBHOOK_AUTH" ] || WEBHOOK_AUTH=hmac
    case "$WEBHOOK_AUTH" in hmac|bearer|none) ;; *) fail "invalid webhook authentication mode" ;; esac
    WEBHOOK_CREDENTIAL=""
    if [ "$WEBHOOK_AUTH" = "hmac" ]; then
      if [ "$LOCALE" = "zh-CN" ]; then printf '%s ' "HMAC secret：" >&4; else printf '%s ' "HMAC secret:" >&4; fi
      IFS= read -r WEBHOOK_CREDENTIAL <&3 || WEBHOOK_CREDENTIAL=""
      [ -n "$WEBHOOK_CREDENTIAL" ] || fail "HMAC secret is required"
    elif [ "$WEBHOOK_AUTH" = "bearer" ]; then
      if [ "$LOCALE" = "zh-CN" ]; then printf '%s ' "Bearer token：" >&4; else printf '%s ' "Bearer token:" >&4; fi
      IFS= read -r WEBHOOK_CREDENTIAL <&3 || WEBHOOK_CREDENTIAL=""
      [ -n "$WEBHOOK_CREDENTIAL" ] || fail "Bearer token is required"
    fi
    if [ "$LOCALE" = "zh-CN" ]; then printf '%s ' "启用 dispatch 通知？[y/N]：" >&4
    else printf '%s ' "Enable dispatch notifications? [y/N]:" >&4; fi
    IFS= read -r WEBHOOK_DISPATCH <&3 || WEBHOOK_DISPATCH=""
    case "$WEBHOOK_DISPATCH" in y|Y|yes|YES) DISPATCH_FLAG=--dispatch ;; *) DISPATCH_FLAG=--no-dispatch ;; esac
    if [ "$WEBHOOK_AUTH" = "hmac" ]; then
      HOME="$HOME_DIR" "$CLI_LINK" webhook configure --url "$WEBHOOK_URL" --auth hmac --secret "$WEBHOOK_CREDENTIAL" --change "$DISPATCH_FLAG" --json >/dev/null || fail "unable to configure webhook"
    elif [ "$WEBHOOK_AUTH" = "bearer" ]; then
      HOME="$HOME_DIR" "$CLI_LINK" webhook configure --url "$WEBHOOK_URL" --auth bearer --token "$WEBHOOK_CREDENTIAL" --change "$DISPATCH_FLAG" --json >/dev/null || fail "unable to configure webhook"
    else
      HOME="$HOME_DIR" "$CLI_LINK" webhook configure --url "$WEBHOOK_URL" --auth none --change "$DISPATCH_FLAG" --json >/dev/null || fail "unable to configure webhook"
    fi
    WEBHOOK_CREDENTIAL=""
  fi
fi
activate_failed=0
trap cleanup EXIT HUP INT TERM

if [ "$LOCALE" = "zh-CN" ]; then
  printf '%s\n' "Horsepower 安装成功。"
  printf '%s\n' "下一步：horsepower setup"
else
  printf '%s\n' "Horsepower installed successfully."
  printf '%s\n' "Next: horsepower setup"
  if [ "$NO_SETUP" -eq 1 ]; then printf '%s\n' "Chinese output: horsepower configure --locale zh-CN"; fi
fi
