#!/bin/bash
# shellcheck shell=dash

# The enclave has no network time source, so its clock is never synced after
# boot and drifts (faster under load). Even ~100ms behind a client makes jose
# reject a fresh JWS whose whole-second iat is "in the future" (proxy 401s).
# Discipline it from the hypervisor's clock via the KVM virtual PTP device
# (CONFIG_PTP_1588_CLOCK_KVM=y in our kernel). Unverified on Nitro until staging
# shows "Syncing clock to /dev/ptpN"; see
# https://evervault.com/blog/how-we-built-enclaves-resolving-clock-drift-in-nitro-enclaves
CHRONY_CONF=${CHRONY_CONF:-/etc/chrony/chrony.conf}

# kvm_ptp_device - prints /dev/ptpN of the KVM virtual PTP clock (number is not fixed, no udev here)
kvm_ptp_device() {
  local dir
  for dir in /sys/class/ptp/ptp*; do
    if grep -q "KVM" "$dir/clock_name" 2>/dev/null; then
      echo "/dev/$(basename "$dir")"
      return 0
    fi
  done
  return 1
}

# setup_clock_sync - step the clock once now, then keep it disciplined under s6.
# Requires s6.ash to be sourced. Fails soft: a missing PTP device must not stop boot.
setup_clock_sync() {
  local dev
  if ! dev=$(kvm_ptp_device); then
    echo "⚠️ No KVM PTP clock found, enclave clock will drift"
    return 0
  fi

  echo "⚙️ Syncing clock to $dev"
  mkdir -p "$(dirname "$CHRONY_CONF")"
  # makestep 1 -1: slew small offsets, step anything over 1s (e.g. after host suspend).
  # cmdport 0: no chronyc control socket inside the enclave.
  cat > "$CHRONY_CONF" <<EOF
refclock PHC $dev poll 2
makestep 1 -1
cmdport 0
EOF

  # Set the clock before the services sign or verify anything; bounded so boot can't hang.
  timeout 30 chronyd -q -f "$CHRONY_CONF" || echo "⚠️ Initial clock sync failed, continuing"

  s6_service chrony "exec chronyd -d -f $CHRONY_CONF"
}
