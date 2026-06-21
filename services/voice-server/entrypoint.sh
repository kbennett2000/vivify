#!/bin/sh
# voice-server entrypoint.
#
# Cycle 7: bring up a PulseAudio null sink so Wine's MMAudioDest (real-time audio) has a
# device to render to in this headless container.
# Cycle 10 (warm engine): keep Xvfb + wineserver PERSISTENT for the container's lifetime so
# each /tts no longer pays a fresh `xvfb-run` Xvfb spawn + wineserver/wineboot cold-start.
# A best-effort warmup synth pages in the TruVoice DLLs / fills the OS file cache so the
# first real Speak isn't extra-cold. Then run the given CMD (the Node server).
# See docs/cycles/cycle-7-realtime-audio.md and docs/cycles/cycle-10-latency.md.
set -e

# --- PulseAudio null sink (Cycle 7) -----------------------------------------
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

# --- persistent Xvfb (Cycle 10) ---------------------------------------------
# The per-request bridge command is now a plain `wine …` (no `xvfb-run -a`), so it needs a
# live display. Start ONE Xvfb on :99 for the whole container instead of one per request.
: "${DISPLAY:=:99}"
export DISPLAY
DISP_NUM=$(echo "$DISPLAY" | tr -d ':')
if [ ! -S "/tmp/.X11-unix/X${DISP_NUM}" ]; then
  Xvfb "$DISPLAY" -screen 0 1024x768x16 -nolisten tcp >/dev/null 2>&1 &
  i=0
  while [ ! -S "/tmp/.X11-unix/X${DISP_NUM}" ] && [ "$i" -lt 50 ]; do
    i=$((i + 1))
    sleep 0.2
  done
fi
if [ -S "/tmp/.X11-unix/X${DISP_NUM}" ]; then
  echo "xvfb: display $DISPLAY ready"
else
  echo "WARN: Xvfb $DISPLAY did not come up — bridge synthesis will fail until it does." >&2
fi

# --- warm the Wine prefix + engine (Cycle 10) -------------------------------
# wineboot once, then keep wineserver PERSISTENT (-p) so it doesn't tear down between
# requests (which would re-pay prefix init on the next `wine`). Best-effort: a failure here
# only means requests run cold, not that the container dies.
wineboot --init >/dev/null 2>&1 || echo "WARN: wineboot --init failed (requests will run colder)." >&2
wineserver -p >/dev/null 2>&1 || echo "WARN: 'wineserver -p' (persist) failed." >&2

# Warmup synth: speak a tiny phrase so the TruVoice DLLs + COM registration are paged in and
# the OS file cache is warm. Output is discarded; non-fatal. Its [timing] line shows the
# first-pass cost so the cold-vs-warm delta is visible in the logs.
BRIDGE_EXE="/opt/vivify/bridge/sapi4-mouth.exe"
if [ -f "$BRIDGE_EXE" ]; then
  printf 'warm' >/tmp/warm.txt
  echo "warmup: priming the SAPI4 engine…"
  wine "$BRIDGE_EXE" --text-file /tmp/warm.txt --wav /tmp/warm.wav --timeline /tmp/warm.json \
    || echo "WARN: warmup synth failed (first real Speak will be colder)." >&2
  rm -f /tmp/warm.txt /tmp/warm.wav /tmp/warm.json
fi

exec "$@"
