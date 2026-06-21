# vivify voice-server — authentic SAPI4 + L&H TruVoice over Wine, behind a Node HTTP API.
#
# Builds a 32-bit Wine prefix, installs the USER-SUPPLIED runtime (vendor/spchapi.exe +
# vendor/tv_enua.exe — gitignored, see docs/legal-and-assets.md), compiles the
# SAPI4 mouth-capture bridge, and runs the Node server. Ships NO Microsoft/L&H IP;
# the proprietary installers come from the (gitignored) build context.
#
# STATUS: built/run only in a real Docker+Wine environment (no Wine in vivify's sandbox) —
# this is the Cycle 5 GO/NO-GO artifact (see docs/cycles/cycle-5-voice.md). The install
# steps were derived by inspecting the actual CAB installers + their INF scripts, but
# whether advpack/regsvr32 fully complete *under Wine* is the remaining unverified step;
# the verification RUN below fails the build loudly (with diagnostics) if they don't.

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

# --- install the SAPI4 runtime + L&H TruVoice into the Wine prefix (headless) ---
# vendor/ (gitignored) holds the user-supplied installers. These are MS CAB
# self-extractors whose GUI wizards can't be driven headless (the old `/S` guess
# installed nothing). Instead we extract the payload with cabextract and run each
# bundled .INF via advpack — the installer's own intended mechanism — which copies
# the DLLs and applies the COM registration with no UI:
#   spchapi.exe -> SPEECH.DLL (+ XVOICE/XLISTEN/XCOMMAND/XTEL/VTEXT/VDICT/VCMSHL/
#                  SPCHTEL/WRAPSAPI.DLL); SPCHAPI.INF registers the TTS Enumerator
#                  CLSID {D67C0280-C743-11cd-80E5-00AA003E4B50} -> Speech.dll via AddReg.
#   tv_enua.exe -> tv_enua.dll (engine) + tvenuax.dll + msvcp50/msvcirt runtimes;
#                  tv_enua.inf self-registers them with regsvr32.
COPY vendor/ /opt/vendor/
RUN set -eux; \
    wineboot --init; wineserver -w; \
    SYS="$WINEPREFIX/drive_c/windows/system32"; \
    SPEECHDIR="$WINEPREFIX/drive_c/windows/speech"; \
    FONTS="$WINEPREFIX/drive_c/windows/Fonts"; \
    mkdir -p "$SPEECHDIR" "$FONTS"; \
    cabextract -q -L -d /tmp/sapi4 /opt/vendor/spchapi.exe; \
    cabextract -q -L -d /tmp/tv /opt/vendor/tv_enua.exe; \
    # Stage the payload DLLs/EXE/TLB into system32 (always on the DLL search path) and \
    # the SAPI4 set also into C:\windows\speech, so COM finds them whichever path the \
    # registry records. Skip the advpack/w95inf install-helpers (use Wine's builtins). \
    find /tmp/sapi4 -maxdepth 1 -type f \( -iname '*.dll' -o -iname '*.exe' -o -iname '*.tlb' \) \
         -not -iname 'advpack.dll' -not -iname 'w95inf*.dll' -exec cp -f {} "$SYS/" \; ; \
    find /tmp/sapi4 -maxdepth 1 -type f \( -iname '*.dll' -o -iname '*.exe' -o -iname '*.tlb' \) \
         -not -iname 'advpack.dll' -not -iname 'w95inf*.dll' -exec cp -f {} "$SPEECHDIR/" \; ; \
    find /tmp/tv -maxdepth 1 -type f -iname '*.dll' -not -iname 'advpack.dll' \
         -not -iname 'w95inf*.dll' -exec cp -f {} "$SYS/" \; ; \
    find /tmp/tv -maxdepth 1 -type f -iname '*.ttf' -exec cp -f {} "$FONTS/" \; ; \
    # Run each INF via advpack (copies per DestinationDirs + applies AddReg / self-register). \
    # The manual copy above is the safety net; this supplies the registration. Wine's builtin \
    # advpack is used; if its AdvancedINF version is rejected, the verify step below fails loudly \
    # (then try the bundled native advpack via WINEDLLOVERRIDES="advpack=n"). \
    cp -r /tmp/sapi4 "$WINEPREFIX/drive_c/sapi4"; \
    cp -r /tmp/tv "$WINEPREFIX/drive_c/tv"; \
    xvfb-run -a wine rundll32 advpack.dll,LaunchINFSection 'C:\sapi4\SPCHAPI.INF,DefaultInstall' || true; \
    xvfb-run -a wine rundll32 advpack.dll,LaunchINFSection 'C:\tv\tv_enua.inf,DefaultInstall' || true; \
    # TruVoice self-registration is deterministic — do it explicitly too (idempotent). \
    xvfb-run -a wine regsvr32 /s 'C:\windows\system32\tv_enua.dll' || true; \
    xvfb-run -a wine regsvr32 /s 'C:\windows\system32\tvenuax.dll' || true; \
    wineserver -w; \
    rm -rf /tmp/sapi4 /tmp/tv "$WINEPREFIX/drive_c/sapi4" "$WINEPREFIX/drive_c/tv"

# --- fail the build loudly if the engine didn't actually install/register ---
# (Per the spike: a silent install miss must not pass as success.) Authoritative check.
RUN set -eu; \
    SYS="$WINEPREFIX/drive_c/windows/system32"; SPEECHDIR="$WINEPREFIX/drive_c/windows/speech"; \
    echo "== installed speech files =="; \
    find "$SYS" "$SPEECHDIR" -maxdepth 1 -iname 'speech.dll' -o -iname 'tv_enua.dll' -o -iname 'xvoice.dll' 2>/dev/null || true; \
    find "$SYS" "$SPEECHDIR" -maxdepth 1 -iname 'speech.dll' | grep -q . \
      || { echo "FATAL: SAPI4 Speech.dll not installed"; exit 1; }; \
    find "$SYS" -maxdepth 1 -iname 'tv_enua.dll' | grep -q . \
      || { echo "FATAL: TruVoice tv_enua.dll not installed"; exit 1; }; \
    grep -rqi 'D67C0280-C743-11cd-80E5-00AA003E4B50' "$WINEPREFIX"/*.reg \
      || { echo "FATAL: SAPI4 Text-to-Speech Enumerator not registered (advpack LaunchINFSection did not apply AddReg)"; \
           echo '-- system.reg speech entries --'; grep -i 'speech\|D67C0280' "$WINEPREFIX"/system.reg | head -20 || true; exit 1; }; \
    grep -rqi 'tv_enua\|truvoice' "$WINEPREFIX"/*.reg \
      || { echo "FATAL: TruVoice not registered (regsvr32 did not run)"; exit 1; }; \
    echo "OK: SAPI4 + TruVoice present and registered."
# (If your SAPI4 SDK headers/libs are supplied, COPY them to $SAPI4_SDK as well.)

# --- compile the bridge (32-bit, against the SAPI4 SDK) ---
# STATIC-link the C++ runtime: a dynamically-linked mingw exe pulls in libstdc++-6.dll /
# libgcc_s_*.dll / libwinpthread-1.dll, which aren't in the Wine prefix — Wine then fails
# to open the exe with c0000135 (STATUS_DLL_NOT_FOUND) before the engine is even reached.
# `set -e` + the trailing `test -f` make a failed compile abort the build (no silent miss).
COPY bridge/ /opt/vivify/bridge/
RUN set -eux; cd /opt/vivify/bridge; \
    i686-w64-mingw32-g++ -municode -O2 -static -static-libgcc -static-libstdc++ \
      -o sapi4-mouth.exe sapi4-mouth.cpp \
      -I"$SAPI4_SDK/include" -L"$SAPI4_SDK/lib" -lole32 -loleaut32 -luuid -lwinmm; \
    test -f sapi4-mouth.exe

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
