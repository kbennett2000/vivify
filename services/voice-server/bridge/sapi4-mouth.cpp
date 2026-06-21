// ---------------------------------------------------------------------------
// sapi4-mouth — vivify's SAPI4 TTS bridge with mouth/viseme capture.
//
// A Windows console program (run under Wine) that speaks `text` with a SAPI4
// voice (e.g. L&H TruVoice) and writes a per-phoneme mouth/viseme timeline (JSON).
// It does NOT write audio — the server records that from the PulseAudio null sink.
//
//   sapi4-mouth.exe --text-file <in.txt> --timeline <out.json>
//                   [--wav <ignored>] [--voice <modeGuid>] [--speed <n>] [--pitch <n>]
//
// Cycle 7 — DENSE per-phoneme mouth data via REAL-TIME audio. In file-audio mode
// (CLSID_AudioDestFile) the engine emits flat/sparse Visual/TTSMOUTH events; the
// real-time multimedia destination (CLSID_MMAudioDest) emits the full per-phoneme
// stream, so synthesis plays in real time to a (dummy) audio device.
//
// Cycle 11 — SINGLE PASS. MMAudioDest gives no way to tee the rendered PCM (verified
// against the DoubleAgent oracle). Rather than a second CLSID_AudioDestFile pass for
// the WAV (the old Pass B — removed), the SERVER records the PulseAudio null sink's
// monitor with `parec` WHILE this one real-time pass plays. So the bridge produces only
// the dense events + timeline; `--wav` is accepted but ignored. See cycle-11 doc.
//
// Written against the REAL SAPI4 SDK header <speech.h> (Microsoft Speech SDK 4.0);
// the MMAudioDest wiring follows DoubleAgent's Sapi4Voice.cpp (read for API only):
//   CoCreateInstance(CLSID_MMAudioDest, NULL, CLSCTX_SERVER, IID_IUnknown, &audio)
//   ITTSEnum::Select(modeGuid, &central, (LPUNKNOWN)audio).
// MMAudioDest opens a waveOut device inside Select(); a headless Wine container must
// provide a (dummy) audio device — a PulseAudio null sink (see Dockerfile). If that
// device is missing, Select fails: we log the HRESULT and exit non-zero rather than
// silently returning sparse file-mode data.
//
// Build ANSI (no _S_UNICODE) so the interface macros resolve to the *A* forms. We ship
// NO Microsoft headers/binaries; the build supplies speech.h (see bridge/README.md).
// ---------------------------------------------------------------------------

#include <windows.h>
#include <objbase.h>
#include <initguid.h> // make speech.h's DEFINE_GUID(...) actually define the CLSID/IID symbols
#include <speech.h>   // SAPI4 SDK: ITTSEnum/ITTSCentral/ITTSNotifySink/IAudioFile/ITTSAttributes, TTSMOUTH, SDATA, CLSID_MMAudioDest, ...
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

// ---- args -----------------------------------------------------------------

struct Args {
  const char* textFile = nullptr;
  const char* wavFile = nullptr;
  const char* timelineFile = nullptr;
  const char* voice = nullptr;
  long speed = -1;
  long pitch = -1;
};

static bool parseArgs(int argc, char** argv, Args& a) {
  for (int i = 1; i < argc; ++i) {
    const char* k = argv[i];
    const char* v = (i + 1 < argc) ? argv[i + 1] : nullptr;
    if (!strcmp(k, "--text-file") && v) a.textFile = argv[++i];
    else if (!strcmp(k, "--wav") && v) a.wavFile = argv[++i];
    else if (!strcmp(k, "--timeline") && v) a.timelineFile = argv[++i];
    else if (!strcmp(k, "--voice") && v) a.voice = argv[++i];
    else if (!strcmp(k, "--speed") && v) a.speed = atol(argv[++i]);
    else if (!strcmp(k, "--pitch") && v) a.pitch = atol(argv[++i]);
  }
  // Cycle 11 single-pass: --wav is optional/ignored (audio comes from the null-sink capture).
  return a.textFile && a.timelineFile;
}

// ---- one captured mouth/viseme event --------------------------------------

struct MouthEvent {
  unsigned long long timeMs;
  int shape; // viseme/mouth-height (MouthEvent.shape in the IR)
  int phoneme;
  BYTE height, width, upturn; // raw TTSMOUTH (height+width drive the mouth-overlay mapping)
};

// ---- the notify sink: this is where mouth/viseme timing comes from ----------
// SAPI4 delivers these callbacks on the thread that pumps the message loop (see
// synthesize), so the unsynchronized vector/`done` are single-threaded here.

class CMouthSink : public ITTSNotifySink {
public:
  std::vector<MouthEvent>& out;
  volatile bool done = false;
  // Per-viseme timing is the WALL-CLOCK arrival of each Visual callback relative to
  // playback start, NOT the callback's qTimeStamp: in real-time (MMAudioDest) mode the
  // engine delivers Visual as the audio plays, so arrival ≈ audio position, whereas
  // qTimeStamp does not advance per viseme here. (DoubleAgent likewise ignores
  // Visual.qTimeStamp and times visemes by the audio device position — see ADR-0019.)
  DWORD baseMs = 0;
  bool started = false;
  // Diagnostics only (logged once per pass): did AudioStart fire, and what was the raw
  // qTimeStamp range (constant ⇒ confirms qTimeStamp is not a usable per-viseme clock).
  bool audioStartFired = false;
  bool rawQSeen = false;
  QWORD rawQMin = 0, rawQMax = 0;
  explicit CMouthSink(std::vector<MouthEvent>& sink) : out(sink) {}

  // IUnknown
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (riid == IID_IUnknown || riid == IID_ITTSNotifySink) {
      *ppv = static_cast<ITTSNotifySink*>(this);
      AddRef();
      return S_OK;
    }
    *ppv = nullptr;
    return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++mRef; }
  STDMETHODIMP_(ULONG) Release() override { return --mRef; } // one-shot process; not freed

  // ITTSNotifySink
  STDMETHODIMP AttribChanged(DWORD) override { return S_OK; }
  STDMETHODIMP AudioStart(QWORD /*qTimeStamp*/) override {
    baseMs = GetTickCount(); // playback-start zero point (wall clock)
    started = true;
    audioStartFired = true;
    return S_OK;
  }
  STDMETHODIMP AudioStop(QWORD) override {
    done = true;
    return S_OK;
  }
  STDMETHODIMP Visual(QWORD qTimeStamp, CHAR cIPAPhoneme, CHAR cEnginePhoneme, DWORD /*dwHints*/,
                      PTTSMOUTH pTTSMouth) override {
    const DWORD now = GetTickCount();
    if (!started) { // AudioStart didn't fire — base off the first viseme instead
      baseMs = now;
      started = true;
    }
    if (!rawQSeen) {
      rawQMin = rawQMax = qTimeStamp;
      rawQSeen = true;
    } else {
      if (qTimeStamp < rawQMin) rawQMin = qTimeStamp;
      if (qTimeStamp > rawQMax) rawQMax = qTimeStamp;
    }
    MouthEvent e{};
    e.timeMs = (now >= baseMs) ? static_cast<unsigned long long>(now - baseMs) : 0ULL;
    e.phoneme = static_cast<int>(cEnginePhoneme ? cEnginePhoneme : cIPAPhoneme);
    if (pTTSMouth) {
      e.height = pTTSMouth->bMouthHeight;
      e.width = pTTSMouth->bMouthWidth;
      e.upturn = pTTSMouth->bMouthUpturn;
    }
    e.shape = e.height; // viseme `shape` = mouth height; width carried for the overlay mapping
    out.push_back(e);
    return S_OK;
  }

private:
  LONG mRef = 1;
};

// ---- timeline writer -------------------------------------------------------

static bool writeTimeline(const char* path, const std::vector<MouthEvent>& ev) {
  FILE* fp = fopen(path, "wb");
  if (!fp) return false;
  fputs("{\"events\":[", fp);
  for (size_t i = 0; i < ev.size(); ++i) {
    const MouthEvent& e = ev[i];
    fprintf(fp,
            "%s{\"timeMs\":%llu,\"shape\":%d,\"phoneme\":%d,"
            "\"mouth\":{\"height\":%u,\"width\":%u,\"upturn\":%u}}",
            i ? "," : "", e.timeMs, e.shape, e.phoneme, e.height, e.width, e.upturn);
  }
  fputs("]}", fp);
  fclose(fp);
  return true;
}

static std::string readFile(const char* path) {
  FILE* fp = fopen(path, "rb");
  if (!fp) return std::string();
  std::string s;
  char buf[4096];
  size_t n;
  while ((n = fread(buf, 1, sizeof buf, fp)) > 0) s.append(buf, n);
  fclose(fp);
  return s;
}

// ---- one synthesis pass ----------------------------------------------------
// Selects the voice mode onto the given audio destination, registers a fresh mouth
// sink (filling `events`), sets speed/pitch, speaks, and pumps messages until the
// engine fires AudioStop. `label` tags diagnostics. Returns the first failing HRESULT
// (S_OK on success). The sink is intentionally not freed (one-shot process).

static HRESULT synthesize(const GUID& modeGuid, IUnknown* pAudio, const std::string& text, long speed,
                          long pitch, std::vector<MouthEvent>& events, const char* label,
                          DWORD* outTtfbMs = nullptr, DWORD* outTotalMs = nullptr) {
  // Cycle 10 timing: wall-clock at pass entry. TTFB = AudioStart (first audio) relative to
  // here; total = whole pass. Declared before any `goto done` so it can't be jumped over.
  const DWORD tPassStart = GetTickCount();
  if (outTtfbMs) *outTtfbMs = 0;
  if (outTotalMs) *outTotalMs = 0;
  ITTSEnum* pEnum = nullptr;
  ITTSCentral* pCentral = nullptr;
  CMouthSink* sink = nullptr;
  DWORD sinkKey = 0;
  HRESULT hr =
      CoCreateInstance(CLSID_TTSEnumerator, nullptr, CLSCTX_ALL, IID_ITTSEnum, (void**)&pEnum);
  if (FAILED(hr) || !pEnum) {
    fprintf(stderr, "[%s] TTS enumerator (CLSID_TTSEnumerator) failed: 0x%08lx\n", label, hr);
    goto done;
  }
  hr = pEnum->Select(modeGuid, &pCentral, (LPUNKNOWN)pAudio);
  if (FAILED(hr) || !pCentral) {
    fprintf(stderr, "[%s] ITTSEnum::Select failed: 0x%08lx\n", label, hr);
    if (SUCCEEDED(hr)) hr = E_FAIL;
    goto done;
  }
  sink = new CMouthSink(events);
  hr = pCentral->Register((PVOID)(ITTSNotifySink*)sink, IID_ITTSNotifySink, &sinkKey);
  if (FAILED(hr)) {
    fprintf(stderr, "[%s] ITTSCentral::Register failed: 0x%08lx\n", label, hr);
    goto done;
  }
  {
    ITTSAttributes* pAttr = nullptr;
    if (SUCCEEDED(pCentral->QueryInterface(IID_ITTSAttributes, (void**)&pAttr)) && pAttr) {
      if (speed >= 0) pAttr->SpeedSet((DWORD)speed);
      if (pitch >= 0) pAttr->PitchSet((WORD)pitch);
      pAttr->Release();
    }
  }
  {
    SDATA data{};
    data.pData = (PVOID)text.c_str();
    data.dwSize = (DWORD)(text.size() + 1);
    hr = pCentral->TextData(CHARSET_TEXT, TTSDATAFLAG_TAGGED, data, nullptr, IID_ITTSBufNotifySink);
    if (FAILED(hr)) {
      fprintf(stderr, "[%s] ITTSCentral::TextData failed: 0x%08lx\n", label, hr);
      goto done;
    }
  }
  {
    // SAPI4 callbacks (AudioStart/Visual/AudioStop) arrive as window messages on this
    // thread. Real-time playback runs ~utterance-length; this spin cap is only a local
    // backstop — the server SIGKILLs the bridge at its own timeout (120s) well before it.
    MSG msg;
    for (int spins = 0; !sink->done && spins < 200000; ++spins) {
      while (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
      }
      if (sink->done) break;
      Sleep(2);
    }
  }
  if (sink) {
    const unsigned long long firstT = events.empty() ? 0ULL : events.front().timeMs;
    const unsigned long long lastT = events.empty() ? 0ULL : events.back().timeMs;
    fprintf(stderr,
            "[%s] events=%zu timeMs=[%llu..%llu]ms rawQ=[%llu..%llu] audioStart=%s\n", label,
            events.size(), firstT, lastT, sink->rawQMin, sink->rawQMax,
            sink->audioStartFired ? "yes" : "no");
    // Pass timing (Cycle 10): TTFB = AudioStart tick − pass start; total = now − pass start.
    const DWORD tNow = GetTickCount();
    if (outTotalMs) *outTotalMs = tNow - tPassStart;
    if (outTtfbMs && sink->started && sink->baseMs >= tPassStart) *outTtfbMs = sink->baseMs - tPassStart;
  }
done:
  if (pCentral && sinkKey) pCentral->UnRegister(sinkKey);
  if (pCentral) pCentral->Release();
  if (pEnum) pEnum->Release();
  return hr;
}

// ---- main ------------------------------------------------------------------

int main(int argc, char** argv) {
  const DWORD tProcStart = GetTickCount(); // Cycle 10: total-latency zero point
  // Cycle 11 (WIN 2): emit a marker as the very first thing main does + flush it, so the
  // server can time spawn→first-stderr-byte ≈ the Wine process-load prologue (which sits
  // outside main's self-measured window). See cycle-11 doc / timing.ts.
  fprintf(stderr, "[boot] sapi4-mouth\n");
  fflush(stderr);
  Args a;
  if (!parseArgs(argc, argv, a)) {
    // Cycle 11: single-pass — the bridge no longer produces the WAV (the server records it
    // from the PulseAudio null-sink monitor during this real-time pass). --wav is accepted
    // but ignored; only --text-file and --timeline are required.
    fprintf(stderr, "usage: sapi4-mouth --text-file <in> --timeline <out.json>"
                    " [--wav <ignored>] [--voice <modeGuid>] [--speed n] [--pitch n]\n");
    return 2;
  }

  std::string text = readFile(a.textFile);
  if (text.empty()) {
    fprintf(stderr, "sapi4-mouth: empty/unreadable text file\n");
    return 3;
  }

  HRESULT hr = CoInitialize(nullptr);
  if (FAILED(hr)) {
    fprintf(stderr, "CoInitialize failed: 0x%08lx\n", hr);
    return 4;
  }

  // Resolve the voice mode once (the requested mode GUID, else the first enumerated).
  GUID modeGuid = GUID_NULL;
  bool haveMode = false;
  if (a.voice && a.voice[0]) {
    WCHAR w[64];
    MultiByteToWideChar(CP_ACP, 0, a.voice, -1, w, 64);
    if (CLSIDFromString(w, &modeGuid) == S_OK) haveMode = true;
  }
  if (!haveMode) {
    ITTSEnum* pEnum = nullptr;
    if (SUCCEEDED(
            CoCreateInstance(CLSID_TTSEnumerator, nullptr, CLSCTX_ALL, IID_ITTSEnum, (void**)&pEnum)) &&
        pEnum) {
      TTSMODEINFOA mi{};
      ULONG got = 0;
      if (SUCCEEDED(pEnum->Next(1, &mi, &got)) && got == 1) {
        modeGuid = mi.gModeID;
        haveMode = true;
      }
      pEnum->Release();
    }
  }
  if (!haveMode) {
    fprintf(stderr, "no SAPI4 TTS voice modes installed\n");
    CoUninitialize();
    return 8;
  }

  std::vector<MouthEvent> events;

  // Engine init (Cycle 10): everything up to here — CoInitialize + voice-mode resolve — is
  // the per-request engine-init cost (the warm-engine cycle target; see cycle-10 doc).
  const DWORD initMs = GetTickCount() - tProcStart;
  DWORD passAttfbMs = 0, passAtotalMs = 0;

  // SINGLE PASS (Cycle 11) — DENSE events via real-time multimedia audio (CLSID_MMAudioDest).
  // The engine plays the whole utterance to the PulseAudio null sink in real time; the server
  // records that sink's monitor to produce the WAV, so there is NO second (file) pass. The
  // bridge only emits events + the timeline. MMAudioDest opens a waveOut device inside Select();
  // if the container has no (dummy) audio device, Select fails here — report, don't fake.
  {
    IUnknown* pMM = nullptr;
    hr = CoCreateInstance(CLSID_MMAudioDest, nullptr, CLSCTX_SERVER, IID_IUnknown, (void**)&pMM);
    if (FAILED(hr) || !pMM) {
      fprintf(stderr,
              "FATAL: real-time audio (CLSID_MMAudioDest) create failed: 0x%08lx — is a (dummy) "
              "audio device available under Wine (PulseAudio null sink)?\n",
              hr);
      CoUninitialize();
      return 6;
    }
    hr = synthesize(modeGuid, pMM, text, a.speed, a.pitch, events, "mmaudio", &passAttfbMs,
                    &passAtotalMs);
    pMM->Release();
    if (FAILED(hr)) {
      fprintf(stderr,
              "FATAL: real-time synthesis pass failed (0x%08lx). MMAudioDest needs a working audio "
              "device; refusing to fall back to sparse file-mode data.\n",
              hr);
      CoUninitialize();
      return 9;
    }
  }

  // Write the dense timeline (Pass A) + a density summary so a flat timeline is obvious.
  int rc = 0;
  const unsigned long long firstT = events.empty() ? 0 : events.front().timeMs;
  const unsigned long long lastT = events.empty() ? 0 : events.back().timeMs;
  const DWORD tWriteStart = GetTickCount();
  if (!writeTimeline(a.timelineFile, events)) {
    fprintf(stderr, "failed writing timeline %s\n", a.timelineFile);
    rc = 12;
  } else {
    fprintf(stderr, "ok: %zu mouth events, timeMs span=[%llu..%llu]ms\n", events.size(), firstT,
            lastT);
  }
  const DWORD writeMs = GetTickCount() - tWriteStart;

  // Cycle 10/11: one machine-readable per-stage breakdown the server parses + logs (timing.ts).
  // passA_total ≈ utterance length (the inherent real-time floor); init is the per-request
  // engine COM init. Pass B is gone (single pass) — passB_* dropped.
  // The server treats `[timing]` as the bridge's definitive SUCCESS marker (it SIGKILLs us on
  // sight to skip Wine teardown), so emit it ONLY when rc == 0 — never on a failure path. The
  // timeline file is already written + fclosed above, so it's complete when this prints.
  const DWORD totalMs = GetTickCount() - tProcStart;
  if (rc == 0) {
    fprintf(stderr,
            "[timing] initMs=%lu passA_ttfbMs=%lu passA_totalMs=%lu writeMs=%lu totalMs=%lu\n",
            initMs, passAttfbMs, passAtotalMs, writeMs, totalMs);
  }

  // Cycle 11 (WIN 2): fast exit. The synthesis is done and the timeline is written; skip the
  // slow graceful teardown (CoUninitialize + TruVoice/MMAudioDest DLL unload + device close/
  // drain) that sits AFTER this point and inflates the server-observed spawn→close window.
  // This is a one-shot process — the OS/Wine reclaims everything on exit. fflush first since
  // _Exit does not flush stdio.
  fflush(nullptr);
  _Exit(rc);
}
