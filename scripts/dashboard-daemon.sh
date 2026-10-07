#!/usr/bin/env bash
# scripts/dashboard-daemon.sh — keep the local StarNet dispute desk listening.
#
# The desk is http://127.0.0.1:8765 (scripts/dashboard-server.js).
# It serves scripts/dashboard/index.html: the case queue and the round-1
# DRAFT letters already saved under credit/cases/. It only reads those
# files. Closing the terminal, backgrounding this script, or a browser tab
# going idle must not take it down. Idle sockets are closed by the server;
# if the server process itself dies, this supervisor starts it again.
#
# This wrapper does not touch the p165 pipeline or case payload files.
#
# If a daemon is already running and you just pulled this page, restart it
# so the process loads the dispute desk instead of the old one-line page:
#   bash scripts/dashboard-daemon.sh restart
#
# macOS (Intel iMac, bash 3.2 from /bin/bash is enough):
#   bash scripts/dashboard-daemon.sh start
#   bash scripts/dashboard-daemon.sh status
#   bash scripts/dashboard-daemon.sh stop
#   bash scripts/dashboard-daemon.sh restart
#
# MacPorts / Homebrew PATH:
#   Non-login shells often omit Node. This script prepends, when present:
#     /opt/local/bin     MacPorts (typical on an Intel iMac)
#     /usr/local/bin     Homebrew on Intel macOS
#     /opt/homebrew/bin  Homebrew on Apple Silicon
#   Install Node with MacPorts if `node` is still missing:
#     sudo port install nodejs22
#
# State (pid files and the log) lives under ${TMPDIR:-/tmp}/starnet-dashboard-8765
# unless STARNET_DASHBOARD_STATE is set. Nothing is written into the repo.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "dashboard-daemon: run with bash, e.g. bash scripts/dashboard-daemon.sh start" >&2
  exit 1
fi

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SERVER="$ROOT/scripts/dashboard-server.js"
STATE="${STARNET_DASHBOARD_STATE:-${TMPDIR:-/tmp}/starnet-dashboard-8765}"
SUP_PID="$STATE/supervisor.pid"
SERVER_PID="$STATE/server.pid"
STOP="$STATE/stop"
LOG="$STATE/daemon.log"
LOCK="$STATE/start.lock"
URL="http://127.0.0.1:8765"

# MacPorts and Homebrew bins are not always on PATH for a non-login shell.
prepend_path() {
  if [ -d "$1" ]; then
    PATH="$1:$PATH"
  fi
}
prepend_path /opt/local/bin
prepend_path /usr/local/bin
prepend_path /opt/homebrew/bin
export PATH

usage() {
  echo "Usage: bash scripts/dashboard-daemon.sh {start|stop|status|restart}" >&2
  echo "  start    nohup the dashboard on 127.0.0.1:8765 and auto-restart it" >&2
  echo "  stop     stop the supervisor and the server" >&2
  echo "  status   print pid and whether GET ${URL} returns 200" >&2
  echo "  restart  stop, then start" >&2
}

alive() {
  local pid="${1:-}"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

read_pid() {
  # Always return 0. macOS bash 3.2 exits on a failing command substitution
  # under `set -e` (bash 4.4+ does not). A missing pid file is "no pid".
  local file="$1"
  if [ -f "$file" ]; then
    tr -cd '0-9' < "$file" || true
  fi
  return 0
}

http_code() {
  curl -sS -o /dev/null -w '%{http_code}' --max-time 3 "$URL" 2>/dev/null || true
}

http_up() {
  [ "$(http_code)" = "200" ]
}

require_node() {
  if ! command -v node >/dev/null 2>&1; then
    echo "dashboard-daemon: node was not found on PATH." >&2
    echo "On an Intel iMac with MacPorts: sudo port install nodejs22" >&2
    echo "Then ensure /opt/local/bin is on PATH (this script prepends it when the directory exists)." >&2
    exit 1
  fi
  if [ ! -f "$SERVER" ]; then
    echo "dashboard-daemon: missing $SERVER" >&2
    exit 1
  fi
}

supervise() {
  # The start command already nohup'd us. Ignore hangup again so a closed
  # terminal cannot tear down the restart loop. SIGTERM still stops us.
  trap '' HUP
  trap 'touch "$STOP"; if [ -f "$SERVER_PID" ]; then kill "$(read_pid "$SERVER_PID")" 2>/dev/null || true; fi; exit 0' TERM INT
  mkdir -p "$STATE"
  while true; do
    if [ -f "$STOP" ]; then
      exit 0
    fi
    node "$SERVER" >>"$LOG" 2>&1 &
    local child=$!
    echo "$child" > "$SERVER_PID"
    local code=0
    wait "$child" || code=$?
    rm -f "$SERVER_PID"
    if [ -f "$STOP" ]; then
      exit 0
    fi
    # Exit 2 is EADDRINUSE: another listener owns the port. Restarting will not help.
    if [ "$code" -eq 2 ]; then
      echo "dashboard-daemon: server exited 2 (address in use); supervisor stopping" >>"$LOG"
      exit 1
    fi
    echo "dashboard-daemon: server exited ${code}; restarting in 1s" >>"$LOG"
    sleep 1
  done
}

start() {
  require_node
  mkdir -p "$STATE"
  local sup
  sup=$(read_pid "$SUP_PID")
  if alive "$sup" && http_up; then
    echo "dashboard: already running (supervisor ${sup})"
    echo "url: ${URL}"
    return 0
  fi
  if http_up && ! alive "$sup"; then
    echo "dashboard-daemon: ${URL} already returns 200, but this daemon is not running it." >&2
    echo "Stop the other listener before starting, so two servers do not fight over port 8765." >&2
    return 1
  fi
  if [ -d "$LOCK" ]; then
    if ! alive "$sup"; then
      rmdir "$LOCK" 2>/dev/null || true
    fi
  fi
  if ! mkdir "$LOCK" 2>/dev/null; then
    echo "dashboard-daemon: start already in progress" >&2
    return 1
  fi
  rm -f "$STOP"
  # nohup + stdin from /dev/null: closing the terminal does not deliver SIGHUP
  # as a fatal signal. macOS has no setsid; nohup is the portable detach.
  nohup "$BASH" "$0" supervise >>"$LOG" 2>&1 </dev/null &
  sup=$!
  disown "$sup" 2>/dev/null || true
  echo "$sup" > "$SUP_PID"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    if http_up; then
      rmdir "$LOCK" 2>/dev/null || true
      echo "dashboard: running (supervisor ${sup})"
      echo "url: ${URL}"
      echo "log: ${LOG}"
      return 0
    fi
    if ! alive "$sup"; then
      rmdir "$LOCK" 2>/dev/null || true
      echo "dashboard-daemon: supervisor exited before the port came up. See ${LOG}" >&2
      return 1
    fi
    sleep 0.25
  done
  rmdir "$LOCK" 2>/dev/null || true
  echo "dashboard-daemon: timed out waiting for ${URL} to return 200. See ${LOG}" >&2
  return 1
}

stop() {
  mkdir -p "$STATE"
  touch "$STOP"
  local sup srv
  sup=$(read_pid "$SUP_PID")
  srv=$(read_pid "$SERVER_PID")
  if alive "$sup"; then
    kill "$sup" 2>/dev/null || true
  fi
  if alive "$srv"; then
    kill "$srv" 2>/dev/null || true
  fi
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    sup=$(read_pid "$SUP_PID")
    srv=$(read_pid "$SERVER_PID")
    if ! alive "$sup" && ! alive "$srv"; then
      break
    fi
    sleep 0.25
  done
  sup=$(read_pid "$SUP_PID")
  srv=$(read_pid "$SERVER_PID")
  if alive "$sup"; then
    kill -9 "$sup" 2>/dev/null || true
  fi
  if alive "$srv"; then
    kill -9 "$srv" 2>/dev/null || true
  fi
  # The supervisor's trap may still be writing the server pid. Give it a beat.
  sleep 0.2
  srv=$(read_pid "$SERVER_PID")
  if alive "$srv"; then
    kill -9 "$srv" 2>/dev/null || true
  fi
  rm -f "$STOP" "$SUP_PID" "$SERVER_PID"
  rmdir "$LOCK" 2>/dev/null || true
  echo "dashboard: stopped"
}

status() {
  local sup srv code
  sup=$(read_pid "$SUP_PID")
  srv=$(read_pid "$SERVER_PID")
  code=$(http_code)
  if alive "$sup" && [ "$code" = "200" ]; then
    echo "dashboard: running"
    echo "supervisor: ${sup}"
    if alive "$srv"; then
      echo "server: ${srv}"
    fi
    echo "url: ${URL}"
    echo "http: 200"
    return 0
  fi
  if alive "$sup"; then
    echo "dashboard: supervisor ${sup} is up but ${URL} returned ${code:-nothing}" >&2
    echo "It will be restarted if the server process died. Log: ${LOG}" >&2
    return 1
  fi
  echo "dashboard: stopped"
  if [ -n "$code" ] && [ "$code" != "000" ]; then
    echo "http: ${code} (not this daemon)" >&2
  fi
  return 1
}

cmd="${1:-}"
case "$cmd" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  restart) stop; start ;;
  supervise) supervise ;;
  *) usage; exit 2 ;;
esac
