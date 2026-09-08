#!/bin/bash
# shellcheck shell=dash

# s6-svscan is PID 1 (reaps), s6-supervise restarts each service, s6-log
# writes stdout+stderr to /mnt/encrypted/logs/<name>, and vector tails those
# files. Vector dying, or Loki being down, costs logs - never the service.
S6_SCANDIR=${S6_SCANDIR:-/etc/s6}
S6_LOGDIR=${S6_LOGDIR:-/mnt/encrypted/logs}

# s6_service <name> <command line>
# <name> is also the logdir name and the `component` label vector derives.
s6_service() {
  local name=$1 cmd=$2

  mkdir -p "$S6_SCANDIR/$name/log" "$S6_LOGDIR/$name"

  # exec 2>&1 so stderr shares the logger pipe - nothing bypasses the logdir
  printf '#!/bin/bash\nexec 2>&1\n%s\n' "$cmd" > "$S6_SCANDIR/$name/run"

  # n10 s10000000: 10 x 10MB rotated per service, so logs cannot fill the
  # encrypted volume. -b blocks rather than buffering unflushed lines in RAM;
  # enclave memory is fixed, and the encrypted disk is already a hard
  # dependency of every service, so stalling on it is not a new failure mode.
  # Trailing `1` also copies each line to stdout, i.e. `nitro-cli console`.
  printf '#!/bin/bash\nexec s6-log -b n10 s10000000 %s/%s 1\n' \
    "$S6_LOGDIR" "$name" > "$S6_SCANDIR/$name/log/run"

  chmod +x "$S6_SCANDIR/$name/run" "$S6_SCANDIR/$name/log/run"
}

# s6_service_once <name> - start once, never restart (pm2's `max_restarts: 0`)
s6_service_once() {
  printf '#!/bin/bash\nexec s6-svc -d .\n' > "$S6_SCANDIR/$1/finish"
  chmod +x "$S6_SCANDIR/$1/finish"
}
