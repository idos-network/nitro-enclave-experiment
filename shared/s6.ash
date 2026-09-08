#!/bin/bash
# shellcheck shell=dash

# s6-svscan is PID 1 (reaps), s6-supervise restarts each service, s6-log
# writes stdout+stderr to /mnt/encrypted/logs/<name>, and vector tails those
# files. Vector dying, or Loki being down, costs logs - never the service.
S6_SCANDIR=${S6_SCANDIR:-/etc/s6}
S6_LOGDIR=${S6_LOGDIR:-/mnt/encrypted/logs}

# Restart backoff. s6-supervise SIGKILLs ./finish once timeout-finish (default
# 5000ms) elapses, so the cap is raised explicitly rather than left implicit.
S6_RESTART_DELAY=${S6_RESTART_DELAY:-5}
S6_FINISH_TIMEOUT=${S6_FINISH_TIMEOUT:-10000}

# s6_service <name> <command line>
# <name> is also the logdir name and the `component` label vector derives.
s6_service() {
  local name=$1 cmd=$2

  mkdir -p "$S6_SCANDIR/$name/log" "$S6_LOGDIR/$name"

  # exec 2>&1 so stderr shares the logger pipe - nothing bypasses the logdir
  printf '#!/bin/bash\nexec 2>&1\n%s\n' "$cmd" > "$S6_SCANDIR/$name/run"

  # n10 s10000000: 10 x 10MB rotated per service, so logs cannot fill the
  # encrypted volume. Deliberately no -b, i.e. s6-log discards rather than
  # blocks when it cannot write: /mnt/encrypted is host-served over NBD and
  # pino writes stdout synchronously, so blocking there would fill the 64KB
  # pipe and stall the node event loop. Losing log lines is the cheaper
  # failure - the same trade-off as vector dying costing logs, not the service.
  # Trailing `1` also copies each line to stdout, i.e. `nitro-cli console`.
  printf '#!/bin/bash\nexec s6-log n10 s10000000 %s/%s 1\n' \
    "$S6_LOGDIR" "$name" > "$S6_SCANDIR/$name/log/run"

  # Without this s6-supervise restarts a dead service in ~1s. The vector
  # supervision this replaced waited 5s, and a deterministic boot failure
  # re-runs the KMS/Mongo bootstrap over the vsock proxy on every attempt.
  printf '%s\n' "$S6_FINISH_TIMEOUT" > "$S6_SCANDIR/$name/timeout-finish"
  printf '#!/bin/bash\nsleep %s\n' "$S6_RESTART_DELAY" > "$S6_SCANDIR/$name/finish"

  chmod +x "$S6_SCANDIR/$name/run" "$S6_SCANDIR/$name/log/run" \
    "$S6_SCANDIR/$name/finish"
}

# s6_service_once <name> - start once, never restart (pm2's `max_restarts: 0`)
# Call after s6_service: it replaces the backoff finish script above.
s6_service_once() {
  printf '#!/bin/bash\nexec s6-svc -d .\n' > "$S6_SCANDIR/$1/finish"
  chmod +x "$S6_SCANDIR/$1/finish"
}
