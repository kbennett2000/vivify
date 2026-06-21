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
// LICENSE: this is vivify's own MIT code. It is written against the **SAPI4 SDK**
// (Microsoft Speech SDK 4.0) low-level TTS API — `ITTSEnumW` / `ITTSCentralW` /
// `ITTSAttributesW` / `ITTSNotifySinkW` / `IAudio(Dest)` / `TTSMOUTH`. We ship NO
// Microsoft headers or binaries; the build supplies the SAPI4 SDK include/libs
// (see bridge/README.md).
//
// STATUS: written from the documented SAPI4 API but **NOT compiled or run** in
// vivify's dev sandbox (no Wine/SAPI4 there). It must be built + validated in the
// Docker/Wine image. Spots needing confirmation against the actual SDK headers
// are marked `// CONFIRM:`. This is the GO/NO-GO artifact — do not assume it works
// until the curl test passes (docs/cycles/cycle-5-voice.md).
// ---------------------------------------------------------------------------

#include <windows.h>
#include <objbase.h>
#include <mmsystem.h>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

// SAPI4 SDK — provides the TTS interfaces/structs below. CONFIRM the exact header
// name(s) against your SDK (commonly <sapi.h> for the SAPI4 SDK, distinct from
// SAPI5). The Docker build sets the include path to the SAPI4 SDK.
#include <sapi.h> // CONFIRM: SAPI4 SDK header (ITTSCentralW, ITTSEnumW, ITTSNotifySinkW, IAudio, TTSMOUTH, ...)

// ---- args -----------------------------------------------------------------

struct Args {
  std::wstring textFile, wavFile, timelineFile, voice;
  long speed = -1, pitch = -1;
};

static std::wstring argVal(int argc, wchar_t** argv, int& i) {
  return (i + 1 < argc) ? argv[++i] : std::wstring();
}

static bool parseArgs(int argc, wchar_t** argv, Args& a) {
  for (int i = 1; i < argc; ++i) {
    std::wstring k = argv[i];
    if (k == L"--text-file") a.textFile = argVal(argc, argv, i);
    else if (k == L"--wav") a.wavFile = argVal(argc, argv, i);
    else if (k == L"--timeline") a.timelineFile = argVal(argc, argv, i);
    else if (k == L"--voice") a.voice = argVal(argc, argv, i);
    else if (k == L"--speed") a.speed = _wtol(argVal(argc, argv, i).c_str());
    else if (k == L"--pitch") a.pitch = _wtol(argVal(argc, argv, i).c_str());
  }
  return !a.textFile.empty() && !a.wavFile.empty() && !a.timelineFile.empty();
}

// ---- one captured mouth/viseme event --------------------------------------

struct MouthEvent {
  unsigned long long timeMs;
  int shape;          // viseme/mouth-height (MouthEvent.shape in the IR)
  char phoneme;       // engine phoneme code
  BYTE height, width, upturn; // raw TTSMOUTH (preserved for Cycle 6)
};

// ---- audio capture: an IAudioDest that buffers PCM + remembers the format ---
// SAPI4 writes synthesized PCM to the audio destination we hand ITTSEnumW::Select.
// We capture it to memory, then write a RIFF/WAVE wrapper. CONFIRM IAudioDest /
// IAudio vtable + IID against the SDK.

class AudioCapture : public IAudioDest, public IAudio {
public:
  std::vector<BYTE> pcm;
  WAVEFORMATEX fmt{};
  AudioCapture() {
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = 1;
    fmt.nSamplesPerSec = 11025; // TruVoice default; overwritten by SetFormat
    fmt.wBitsPerSample = 16;
    fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;
  }
  // IUnknown
  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (riid == IID_IUnknown || riid == IID_IAudioDest) { *ppv = static_cast<IAudioDest*>(this); }
    else if (riid == IID_IAudio) { *ppv = static_cast<IAudio*>(this); }
    else { *ppv = nullptr; return E_NOINTERFACE; }
    AddRef();
    return S_OK;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++ref; }
  STDMETHODIMP_(ULONG) Release() override { return --ref; } // single-process lifetime; not freed
  // IAudioDest: the engine sets the wave format and pushes data.
  STDMETHODIMP SetFormat(PCMWAVEFORMAT* pFmt, DWORD dwSize) {
    if (pFmt) std::memcpy(&fmt, pFmt, sizeof(PCMWAVEFORMAT)); // CONFIRM: SetFormat signature
    return S_OK;
  }
  STDMETHODIMP DataSet(void* pData, DWORD dwSize) {
    const BYTE* b = static_cast<const BYTE*>(pData);
    pcm.insert(pcm.end(), b, b + dwSize);
    return S_OK;
  }
  // ... remaining IAudio/IAudioDest methods (Flush/Reset/Start/Stop/etc.) return S_OK.
  // CONFIRM the full method set + order against the SAPI4 SDK and stub them here.
private:
  LONG ref = 1;
};

// ---- the notify sink: this is where mouth/viseme timing comes from ----------
// ITTSNotifySinkW::Visual is called per phoneme with an audio-relative timestamp
// and a TTSMOUTH (mouth height/width/upturn). We record each into the timeline.
// AudioStart gives the zero point so timestamps are audio-relative ms.
//
// CONFIRM: assumes SAPI4 delivers notify callbacks on the message-pump thread
// (why main() pumps PeekMessage) — so the unsynchronized push_back into `out`
// and the plain `volatile bool done` are single-threaded. If your engine fires
// Visual/AudioStop on a worker thread, this is a data race: guard with a CS.

class MouthSink : public ITTSNotifySinkW {
public:
  std::vector<MouthEvent>& out;
  volatile bool done = false;
  unsigned long long t0 = 0;
  explicit MouthSink(std::vector<MouthEvent>& sink) : out(sink) {}

  STDMETHODIMP QueryInterface(REFIID riid, void** ppv) override {
    if (riid == IID_IUnknown || riid == IID_ITTSNotifySinkW) { *ppv = this; AddRef(); return S_OK; }
    *ppv = nullptr; return E_NOINTERFACE;
  }
  STDMETHODIMP_(ULONG) AddRef() override { return ++ref; }
  STDMETHODIMP_(ULONG) Release() override { return --ref; }

  STDMETHODIMP AttribChanged(DWORD) override { return S_OK; }
  STDMETHODIMP AudioStart(QWORD qTimeStamp) override { t0 = qTimeStamp; return S_OK; }
  STDMETHODIMP AudioStop(QWORD) override { done = true; return S_OK; }
  // The mouth/viseme callback. CONFIRM the exact signature/arg order vs the SDK.
  STDMETHODIMP Visual(QWORD qTimeStamp, CHAR cIPAPhoneme, CHAR cEnginePhoneme, DWORD dwHints,
                      PTTSMOUTH pTTSMouth) override {
    MouthEvent e{};
    e.timeMs = (qTimeStamp >= t0) ? (qTimeStamp - t0) : 0; // SAPI4 audio timestamps are ms
    e.phoneme = cEnginePhoneme ? cEnginePhoneme : cIPAPhoneme;
    if (pTTSMouth) {
      e.height = pTTSMouth->bMouthHeight; // CONFIRM TTSMOUTH field names
      e.width = pTTSMouth->bMouthWidth;
      e.upturn = pTTSMouth->bMouthUpturn;
    }
    e.shape = e.height; // Cycle 5: viseme `shape` = mouth height; Cycle 6 maps to overlays
    out.push_back(e);
    return S_OK;
  }
private:
  LONG ref = 1;
};

// ---- WAV + JSON writers ----------------------------------------------------

static bool writeWav(const std::wstring& path, const WAVEFORMATEX& f, const std::vector<BYTE>& pcm) {
  FILE* fp = _wfopen(path.c_str(), L"wb");
  if (!fp) return false;
  const DWORD dataLen = (DWORD)pcm.size();
  const DWORD riffLen = 36 + dataLen;
  fwrite("RIFF", 1, 4, fp); fwrite(&riffLen, 4, 1, fp); fwrite("WAVE", 1, 4, fp);
  fwrite("fmt ", 1, 4, fp);
  const DWORD fmtLen = 16;
  fwrite(&fmtLen, 4, 1, fp);
  fwrite(&f.wFormatTag, 2, 1, fp); fwrite(&f.nChannels, 2, 1, fp);
  fwrite(&f.nSamplesPerSec, 4, 1, fp); fwrite(&f.nAvgBytesPerSec, 4, 1, fp);
  fwrite(&f.nBlockAlign, 2, 1, fp); fwrite(&f.wBitsPerSample, 2, 1, fp);
  fwrite("data", 1, 4, fp); fwrite(&dataLen, 4, 1, fp);
  if (dataLen) fwrite(pcm.data(), 1, dataLen, fp);
  fclose(fp);
  return true;
}

static bool writeTimeline(const std::wstring& path, const std::vector<MouthEvent>& ev) {
  FILE* fp = _wfopen(path.c_str(), L"wb");
  if (!fp) return false;
  fputs("{\"events\":[", fp);
  for (size_t i = 0; i < ev.size(); ++i) {
    const MouthEvent& e = ev[i];
    fprintf(fp,
            "%s{\"timeMs\":%llu,\"shape\":%d,\"phoneme\":%d,"
            "\"mouth\":{\"height\":%u,\"width\":%u,\"upturn\":%u}}",
            i ? "," : "", e.timeMs, e.shape, (int)e.phoneme, e.height, e.width, e.upturn);
  }
  fputs("]}", fp);
  fclose(fp);
  return true;
}

static std::string readUtf8(const std::wstring& path) {
  FILE* fp = _wfopen(path.c_str(), L"rb");
  if (!fp) return std::string();
  std::string s; char buf[4096]; size_t n;
  while ((n = fread(buf, 1, sizeof buf, fp)) > 0) s.append(buf, n);
  fclose(fp);
  return s;
}

// ---- main ------------------------------------------------------------------

int wmain(int argc, wchar_t** argv) {
  Args a;
  if (!parseArgs(argc, argv, a)) {
    fwprintf(stderr, L"usage: sapi4-mouth --text-file <in> --wav <out.wav> --timeline <out.json>"
                     L" [--voice <modeGuid>] [--speed n] [--pitch n]\n");
    return 2;
  }
  if (FAILED(CoInitialize(nullptr))) return 3;

  std::vector<MouthEvent> events;
  AudioCapture* audio = new AudioCapture();
  MouthSink* sink = new MouthSink(events);

  // 1. Enumerate SAPI4 TTS modes and Select the requested voice (TruVoice),
  //    handing it our AudioCapture as the destination.  CONFIRM CLSID/IID names.
  ITTSEnumW* enumer = nullptr;
  HRESULT hr = CoCreateInstance(CLSID_TTSEnumerator, nullptr, CLSCTX_ALL, IID_ITTSEnumW,
                                (void**)&enumer);
  if (FAILED(hr) || !enumer) { fwprintf(stderr, L"TTS enumerator failed: 0x%08lx\n", hr); return 4; }

  ITTSCentralW* central = nullptr;
  GUID mode{};
  bool haveMode = !a.voice.empty() && IIDFromString((LPOLESTR)a.voice.c_str(), &mode) == S_OK;
  // Select by mode GUID when given; else Select(NULL) picks the default installed voice.
  hr = enumer->Select(haveMode ? mode : GUID_NULL, &central, static_cast<IAudio*>(audio)); // CONFIRM Select sig
  if (FAILED(hr) || !central) { fwprintf(stderr, L"TTS Select failed: 0x%08lx\n", hr); return 5; }

  // 2. Register our mouth sink so Visual()/AudioStart/AudioStop fire during speak.
  DWORD sinkKey = 0;
  central->Register((void*)static_cast<ITTSNotifySinkW*>(sink), IID_ITTSNotifySinkW, &sinkKey); // CONFIRM Register sig

  // 3. Speed/pitch via ITTSAttributesW (best-effort; ignore failures).
  ITTSAttributesW* attrs = nullptr;
  if (SUCCEEDED(central->QueryInterface(IID_ITTSAttributesW, (void**)&attrs)) && attrs) {
    if (a.speed >= 0) attrs->SpeedSet((DWORD)a.speed);
    if (a.pitch >= 0) attrs->PitchSet((WORD)a.pitch);
    attrs->Release();
  }

  // 4. Speak. TextData with the wide text; the engine drives our audio + sink.
  std::string utf8 = readUtf8(a.textFile);
  int wlen = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
  std::wstring wtext(wlen > 0 ? wlen - 1 : 0, L'\0');
  if (wlen > 0) MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, &wtext[0], wlen);

  SDATA data{}; // CONFIRM: SAPI4 TextData takes an SDATA {pData, dwSize}
  data.pData = (void*)wtext.c_str();
  data.dwSize = (DWORD)((wtext.size() + 1) * sizeof(wchar_t));
  hr = central->TextData(CHARSET_TEXT, 0, data, static_cast<ITTSBufNotifySinkW*>(nullptr),
                         IID_ITTSBufNotifySinkW); // CONFIRM TextData sig
  if (FAILED(hr)) { fwprintf(stderr, L"TextData failed: 0x%08lx\n", hr); return 6; }

  // 5. Pump messages until AudioStop fires (synthesis is async via the sink).
  for (int spins = 0; !sink->done && spins < 60000; ++spins) {
    MSG msg;
    while (PeekMessage(&msg, nullptr, 0, 0, PM_REMOVE)) { TranslateMessage(&msg); DispatchMessage(&msg); }
    Sleep(5);
  }

  // 6. Write outputs.
  bool okWav = writeWav(a.wavFile, audio->fmt, audio->pcm);
  bool okTl = writeTimeline(a.timelineFile, events);

  central->UnRegister(sinkKey);
  central->Release();
  enumer->Release();
  CoUninitialize();

  if (!okWav || !okTl) { fwprintf(stderr, L"failed writing outputs\n"); return 7; }
  fwprintf(stderr, L"ok: %zu pcm bytes, %zu mouth events\n", audio->pcm.size(), events.size());
  return 0;
}
