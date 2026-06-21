# vivify voice-server — authentic SAPI4 + L&H TruVoice over Wine, behind a Node HTTP API.
#
# Builds a 32-bit Wine prefix, installs the USER-SUPPLIED runtime (vendor/spchapi.exe +
# vendor/tv_enua.exe — gitignored, see docs/legal-and-assets.md), compiles the
# SAPI4 mouth-capture bridge, and runs the Node server. Ships NO Microsoft/L&H IP;
# the proprietary installers come from the (gitignored) build context.
#
# STATUS: written but NOT built/run in vivify's sandbox — this is the Cycle 5 GO/NO-GO
# artifact (see docs/cycles/cycle-5-voice.md). Expect to iterate on the Wine + silent-
# install + bridge-compile steps in a real Docker environment. The unattended install
# of the old Win32 installers is the most likely step to need adjustment (flags / a
# scripted clicker), per the TETYYS/SAPI4 reference.

FROM debian:bookworm-slim

# 32-bit Wine + Xvfb (SAPI4/TruVoice are 32-bit; the bridge needs a display) + build + Node.
# xauth is required by the `xvfb-run` wrapper; it's a *recommended* dep of xvfb that
# --no-install-recommends drops, so it must be named explicitly or xvfb-run fails with
# "xauth command not found". (mcookie, the wrapper's other dep, is in the base image.)
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
      wine wine32 xvfb xauth winbind cabextract ca-certificates \
      gcc-mingw-w64-i686 g++-mingw-w64-i686 \
      curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

ENV WINEARCH=win32 \
    WINEPREFIX=/opt/wineprefix \
    WINEDEBUG=-all \
    SAPI4_SDK=/opt/sapi4-sdk

WORKDIR /opt/vivify

# --- install the SAPI4 runtime + TruVoice voice into the Wine prefix ---
# vendor/ is gitignored and supplied via the build context. The installers are
# interactive Win32 setups; run them under Xvfb. CONFIRM the unattended flags for
# your installer versions (try `/S`, `/q`; otherwise script the clicks). Reference:
# github.com/TETYYS/SAPI4 (it documents the working Wine install of exactly these).
COPY vendor/ /opt/vendor/
RUN wineboot --init && \
    xvfb-run -a wine /opt/vendor/spchapi.exe /S ; \
    xvfb-run -a wine /opt/vendor/tv_enua.exe /S ; \
    wineserver -w || true
# (If your SAPI4 SDK headers/libs are supplied, COPY them to $SAPI4_SDK as well.)

# --- compile the bridge (32-bit, against the SAPI4 SDK) ---
COPY bridge/ /opt/vivify/bridge/
RUN cd /opt/vivify/bridge && \
    i686-w64-mingw32-g++ -municode -O2 -o sapi4-mouth.exe sapi4-mouth.cpp \
      -I"$SAPI4_SDK/include" -L"$SAPI4_SDK/lib" -lole32 -loleaut32 -luuid -lwinmm \
    || echo "BRIDGE BUILD FAILED — supply the SAPI4 SDK headers/libs and re-run (see bridge/README.md)"

# --- the Node HTTP server ---
# The server uses ONLY Node built-ins at runtime (its @vivify/types imports are
# type-only and erased at compile), so we just copy the prebuilt dist and run it.
# Build dist first on the host: `pnpm --filter @vivify/voice-server typecheck`
# (emits dist/ via tsc --build), then `docker build services/voice-server`.
COPY dist/ /opt/vivify/dist/

ENV PORT=8080 \
    VIVIFY_SAPI4_BRIDGE="xvfb-run -a wine /opt/vivify/bridge/sapi4-mouth.exe"
EXPOSE 8080
CMD ["node", "dist/main.js"]
