/// <reference types="vite/client" />

// Build-time config baked into the bundle by Vite (Cycle 9). VITE_VOICE_SERVER_URL
// overrides the default voice service URL the MASH demo pre-fills; see characters.ts
// (resolveVoiceServerUrl) and the Dockerfile's ARG of the same name.
interface ImportMetaEnv {
  readonly VITE_VOICE_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
