#!/bin/sh
# Cycle 7 entrypoint: bring up a PulseAudio null sink so Wine's MMAudioDest (real-time
# audio) has a device to render to in this headless container, then run the given CMD.
# Without an audio device, the bridge's Pass A (CLSID_MMAudioDest) Select() fails and the
# bridge exits non-zero with the HRESULT (see docs/cycles/cycle-7-realtime-audio.md).
set -e

mkdir -p /var/run/pulse /var/lib/pulse

# System mode (this container runs as root; PulseAudio refuses user mode as root and
# drops to the `pulse` user in --system mode). -n = ignore default config, -F = our file.
pulseaudio --system --disallow-exit --exit-idle-time=-1 -n -F /etc/pulse/vivify-null.pa \
  --daemonize=yes 2>/dev/null \
  || echo "WARN: pulseaudio failed to start — MMAudioDest will likely fail; see cycle-7 doc." >&2

# Wait up to ~10s for the socket the bridge connects to (PULSE_SERVER).
i=0
while [ ! -S /tmp/pulse-socket ] && [ "$i" -lt 50 ]; do
  i=$((i + 1))
  sleep 0.2
done
if [ -S /tmp/pulse-socket ]; then
  echo "pulse: null sink ready (PULSE_SERVER=$PULSE_SERVER)"
else
  echo "WARN: pulse socket /tmp/pulse-socket not present after wait" >&2
fi

exec "$@"
