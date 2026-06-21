// ---------------------------------------------------------------------------
// sapi4-mouth — vivify's SAPI4 TTS bridge with mouth/viseme capture.
//
// A Windows console program (run under Wine) that speaks `text` with a SAPI4
// voice (e.g. L&H TruVoice) and writes BOTH the synthesized audio (WAV) AND a
// per-phoneme mouth/viseme timeline (JSON). The timeline is the half-the-point
// of Cycle 5 — Cycle 6 lip-sync consumes it.
//
//   sapi4-mouth.exe --text-file <in.txt> --wav <out.wav> --timeline <out.json>
//                   [--voice <modeGuid>] [--speed <n>] [--pitch <n>]
//
// This is written against the REAL SAPI4 SDK header <speech.h> (Microsoft Speech
// SDK 4.0). The interface/struct/CLSID names + signatures match that header (and
// were cross-checked against the SAPI4 usage in TETYYS/SAPI4 and DoubleAgent):
//   - WAV output: CLSID_AudioDestFile -> IAudioFile::Set(path) (SAPI4 writes it).
//   - voice: CLSID_TTSEnumerator -> ITTSEnum::Select(modeGUID,&central,audio).
//   - mouth: ITTSNotifySink::Visual(qTime, ipa, eng, hints, PTTSMOUTH).
// We build ANSI (no _S_UNICODE) so the interface macros resolve to the *A* forms;
// only IAudioFile::Set takes a wide path. We ship NO Microsoft headers/binaries;
// the build supplies speech.h (see bridge/README.md).
// ---------------------------------------------------------------------------

#include <windows.h>
#include <objbase.h>
#include <initguid.h> // make speech.h's DEFINE_GUID(...) actually define the CLSID/IID symbols
#include <speech.h>   // SAPI4 SDK: ITTSEnum/ITTSCentral/ITTSNotifySink/IAudioFile/ITTSAttributes, TTSMOUTH, SDATA, ...
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
  return a.textFile && a.wavFile && a.timelineFile;
}

// ---- one captured mouth/viseme event --------------------------------------

struct MouthEvent {
  unsigned long long timeMs;
  int shape; // viseme/mouth-height (MouthEvent.shape in the IR)
  int phoneme;
  BYTE height, width, upturn; // raw TTSMOUTH (preserved for Cycle 6)
};

// ---- the notify sink: this is where mouth/viseme timing comes from ----------
// SAPI4 delivers these callbacks on the thread that pumps the message loop (see
// main), so the unsynchronized vector/`done` are single-threaded here.

class CMouthSink : public ITTSNotifySink {
public:
  std::vector<MouthEvent>& out;
  volatile bool done = false;
  QWORD t0 = 0;
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
  STDMETHODIMP AudioStart(QWORD qTimeStamp) override {
    t0 = qTimeStamp; // zero point so timestamps are audio-relative
    return S_OK;
  }
  STDMETHODIMP AudioStop(QWORD) override {
    done = true;
    return S_OK;
  }
  STDMETHODIMP Visual(QWORD qTimeStamp, CHAR cIPAPhoneme, CHAR cEnginePhoneme, DWORD /*dwHints*/,
                      PTTSMOUTH pTTSMouth) override {
    MouthEvent e{};
    e.timeMs = (qTimeStamp >= t0) ? static_cast<unsigned long long>(qTimeStamp - t0) : 0ULL;
    e.phoneme = static_cast<int>(cEnginePhoneme ? cEnginePhoneme : cIPAPhoneme);
    if (pTTSMouth) {
      e.height = pTTSMouth->bMouthHeight;
      e.width = pTTSMouth->bMouthWidth;
      e.upturn = pTTSMouth->bMouthUpturn;
    }
    e.shape = e.height; // Cycle 5: viseme `shape` = mouth height; Cycle 6 maps to overlays
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

// ---- main ------------------------------------------------------------------

int main(int argc, char** argv) {
  Args a;
  if (!parseArgs(argc, argv, a)) {
    fprintf(stderr, "usage: sapi4-mouth --text-file <in> --wav <out.wav> --timeline <out.json>"
                    " [--voice <modeGuid>] [--speed n] [--pitch n]\n");
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

  int rc = 0;
  std::vector<MouthEvent> events;
  ITTSEnum* pEnum = nullptr;
  IAudioFile* pAudio = nullptr;
  ITTSCentral* pCentral = nullptr;
  CMouthSink* sink = nullptr;
  DWORD sinkKey = 0;

  // 1. Enumerator + a file audio destination (SAPI4 writes the WAV itself).
  hr = CoCreateInstance(CLSID_TTSEnumerator, nullptr, CLSCTX_ALL, IID_ITTSEnum, (void**)&pEnum);
  if (FAILED(hr) || !pEnum) {
    fprintf(stderr, "TTS enumerator (CLSID_TTSEnumerator) failed: 0x%08lx\n", hr);
    rc = 5;
    goto cleanup;
  }
  hr = CoCreateInstance(CLSID_AudioDestFile, nullptr, CLSCTX_ALL, IID_IAudioFile, (void**)&pAudio);
  if (FAILED(hr) || !pAudio) {
    fprintf(stderr, "audio file dest (CLSID_AudioDestFile) failed: 0x%08lx\n", hr);
    rc = 6;
    goto cleanup;
  }
  {
    WCHAR wszWav[MAX_PATH];
    MultiByteToWideChar(CP_ACP, 0, a.wavFile, -1, wszWav, MAX_PATH);
    hr = pAudio->Set(wszWav, 1); // dwID=1, per the SAPI4 file-audio convention
    if (FAILED(hr)) {
      fprintf(stderr, "IAudioFile::Set(%s) failed: 0x%08lx\n", a.wavFile, hr);
      rc = 7;
      goto cleanup;
    }
  }

  // 2. Pick the voice mode: the requested mode GUID, else the first enumerated mode.
  {
    GUID modeGuid = GUID_NULL;
    bool haveMode = false;
    if (a.voice && a.voice[0]) {
      WCHAR w[64];
      MultiByteToWideChar(CP_ACP, 0, a.voice, -1, w, 64);
      if (CLSIDFromString(w, &modeGuid) == S_OK) haveMode = true;
    }
    if (!haveMode) {
      TTSMODEINFOA mi{};
      ULONG got = 0;
      if (SUCCEEDED(pEnum->Next(1, &mi, &got)) && got == 1) {
        modeGuid = mi.gModeID;
        haveMode = true;
      }
    }
    if (!haveMode) {
      fprintf(stderr, "no SAPI4 TTS voice modes installed\n");
      rc = 8;
      goto cleanup;
    }
    hr = pEnum->Select(modeGuid, &pCentral, (LPUNKNOWN)pAudio);
    if (FAILED(hr) || !pCentral) {
      fprintf(stderr, "ITTSEnum::Select failed: 0x%08lx\n", hr);
      rc = 9;
      goto cleanup;
    }
  }

  // 3. Register our mouth sink so Visual()/AudioStart/AudioStop fire during speak.
  sink = new CMouthSink(events);
  hr = pCentral->Register((PVOID)(ITTSNotifySink*)sink, IID_ITTSNotifySink, &sinkKey);
  if (FAILED(hr)) {
    fprintf(stderr, "ITTSCentral::Register failed: 0x%08lx\n", hr);
    rc = 10;
    goto cleanup;
  }

  // 4. Speed/pitch via ITTSAttributes (best-effort).
  {
    ITTSAttributes* pAttr = nullptr;
    if (SUCCEEDED(pCentral->QueryInterface(IID_ITTSAttributes, (void**)&pAttr)) && pAttr) {
      if (a.speed >= 0) pAttr->SpeedSet((DWORD)a.speed);
      if (a.pitch >= 0) pAttr->PitchSet((WORD)a.pitch);
      pAttr->Release();
    }
  }

  // 5. Speak. SDATA carries the ANSI text; the engine drives our file audio + sink.
  {
    SDATA data{};
    data.pData = (PVOID)text.c_str();
    data.dwSize = (DWORD)(text.size() + 1);
    hr = pCentral->TextData(CHARSET_TEXT, TTSDATAFLAG_TAGGED, data, nullptr, IID_ITTSBufNotifySink);
    if (FAILED(hr)) {
      fprintf(stderr, "ITTSCentral::TextData failed: 0x%08lx\n", hr);
      rc = 11;
      goto cleanup;
    }
  }

  // 6. Pump messages until AudioStop fires (SAPI4 callbacks arrive as messages).
  {
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

  // 7. Finalize the WAV + write the timeline.
  if (pAudio) pAudio->Flush();
  if (!writeTimeline(a.timelineFile, events)) {
    fprintf(stderr, "failed writing timeline %s\n", a.timelineFile);
    rc = 12;
  } else {
    fprintf(stderr, "ok: %zu mouth events\n", events.size());
  }

cleanup:
  if (pCentral && sinkKey) pCentral->UnRegister(sinkKey);
  if (pCentral) pCentral->Release();
  if (pAudio) pAudio->Release();
  if (pEnum) pEnum->Release();
  CoUninitialize();
  return rc;
}
