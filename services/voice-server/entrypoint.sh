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

# --- keep the null-sink monitor warm (Cycle 11) -----------------------------
# Each /tts spawns a fresh `parec` to record `dummy.monitor`. Between requests the monitor
# source can go cold/idle, so the FIRST real Speak after start clipped its opening even though
# the engine was warmed. Keep ONE long-lived reader on the monitor for the container's lifetime
# so the source stays continuously active — the per-request `parec` then always connects to a hot
# monitor (no cold-start clip; smaller captureReady). Multiple monitor readers fan out, so this
# doesn't disturb the per-request capture. Best-effort: if it dies (e.g. the monitor isn't
# enumerable yet) the only cost is the first Speak running colder — not a container failure —
# so there's no readiness check or retry here, unlike the pulse/Xvfb blocks above.
parec -d dummy.monitor >/dev/null 2>&1 &
echo "capture: keep-warm monitor reader started (pid $!)"

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

# --- warm the Wine prefix (Cycle 10) ----------------------------------------
# wineboot once, then keep wineserver PERSISTENT (-p) so it doesn't tear down between
# requests (which would re-pay prefix init on the next `wine`). Best-effort: a failure here
# only means requests run cold, not that the container dies.
wineboot --init >/dev/null 2>&1 || echo "WARN: wineboot --init failed (requests will run colder)." >&2
wineserver -p >/dev/null 2>&1 || echo "WARN: 'wineserver -p' (persist) failed." >&2

# NOTE: the engine + CAPTURE pipeline (parec + null-sink monitor + winepulse) are warmed by the
# SERVER at startup via one real synthesis (see `warmUp` in src/server.ts) — that primes the whole
# /tts path, not just the engine, so the FIRST real Speak isn't cold. A bridge-only warmup here
# (Cycle 10) left the capture path cold and clipped the first Speak's opening; it's removed.

exec "$@"
