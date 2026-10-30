#!/usr/bin/env bash
# 重部署测试实例（仅按监听端口的 PID 杀，绝不按进程名）：scripts/redeploy.sh a|b|both
set -u
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DSH="${DSH:-dsh}"
cd "$REPO"
deploy() {
  local name="$1" home="$2" port="$3" log="$4"
  local pid
  pid=$(netstat -ano | grep "127.0.0.1:$port " | grep LISTENING | awk '{print $5}' | head -1)
  if [ -n "${pid:-}" ]; then taskkill //T //F //PID "$pid" >/dev/null 2>&1; sleep 2; fi
  [ "${RESET:-0}" = 1 ] && rm -f "$REPO/$home/dsh-coshare/state.json"
  export DSH_HOME="$REPO/$home"
  # RESET=1：清掉测试实例的插件状态（仅 .test-home*，配对/授权从零开始）
  if [ "${RESET:-0}" = "1" ]; then rm -f "$REPO/$home/dsh-coshare/state.json"; fi
  "$DSH" plugin --profile web remove dsh-coshare >/dev/null 2>&1
  "$DSH" plugin --profile web add "file:$REPO" 2>&1 | tail -2
  : > "$home/$log"; : > "$home/$log.err"
  nohup "$DSH" web --no-open --port "$port" >"$home/$log" 2>"$home/$log.err" &
  for i in $(seq 1 30); do grep -q "token=" "$home/$log" 2>/dev/null && break; sleep 1; done
  echo "== $name"; cat "$home/$log"; grep -iE "warning|did not activate|error" "$home/$log.err" | head -5
}
case "${1:-both}" in
  a) deploy A .test-home 3211 cur.log ;;
  b) deploy B .test-home-b 3212 cur.log ;;
  both) deploy A .test-home 3211 cur.log; deploy B .test-home-b 3212 cur.log ;;
esac
