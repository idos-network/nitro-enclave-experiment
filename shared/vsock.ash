#!/bin/bash
# shellcheck shell=dash

setup_vsock_networking() {
  local vsock_config="$1"

  if [ ! -f "$vsock_config" ]; then
    echo "⚠️ VSOCK config file $vsock_config not found, skipping vsock setup"
    return
  fi

  echo "🛜 Setting up VSOCK networking using $vsock_config"

  jq -c '.incoming[]' $vsock_config | while read -r entry; do
    NAME=$(echo "$entry" | jq -r '.name')
    TCP=$(echo "$entry" | jq -r '.tcp')
    VSOCK=$(echo "$entry" | jq -r '.vsock')

    echo "<- Starting incoming vsock $NAME TCP:$TCP <-> VSOCK:$VSOCK"
    socat VSOCK-LISTEN:"$VSOCK",fork TCP4-CONNECT:127.0.0.1:"$TCP" &
  done

  # Prepare outgoing proxies
  jq -c '.outgoing[]' $vsock_config | while read -r entry; do
    NAME=$(echo "$entry" | jq -r '.name')
    TCP=$(echo "$entry" | jq -r '.tcp')
    VSOCK=$(echo "$entry" | jq -r '.vsock')
    HOST=$(echo "$entry" | jq -r '.host')
    ENCLAVE_IP=$(echo "$entry" | jq -r '.enclave_ip')
    ENCLAVE_SKIP=$(echo "$entry" | jq -r '.enclave_skip')

    if [ "$ENCLAVE_SKIP" != "true" ]; then
      echo "-> Starting $NAME outgoing vsock TCP:$ENCLAVE_IP:$TCP <-> VSOCK:$VSOCK (host $HOST)"
      socat TCP4-LISTEN:"$TCP",fork,bind=$ENCLAVE_IP VSOCK-CONNECT:3:"$VSOCK" &

      if [ "$HOST" != "127.0.0.1" ]; then
        echo "  -> Adding $ENCLAVE_IP $HOST to /etc/hosts"
        echo "$ENCLAVE_IP $HOST" >> /etc/hosts
      fi
    fi
  done
}
