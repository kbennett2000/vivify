// MASH demo controller — built ONLY on @vivify/core's public API (createAgent +
// the Agent control). No @vivify/acs, no engine internals. DOM glue; the engine's
// own logic is covered by @vivify/core's tests, the pure helpers here by characters.test.ts.

import { createAgent, type Agent } from '@vivify/core';
import {
  builtinManifestUrl,
  isAcsFile,
  parseBuiltinIndex,
  type BuiltinCharacter,
} from './characters.js';

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`MASH: missing #${id}`);
  return node as T;
}

export function initApp(): void {
  const stage = el<HTMLDivElement>('stage');
  const builtinSel = el<HTMLSelectElement>('builtin');
  const fileInput = el<HTMLInputElement>('file');
  const dropZone = el<HTMLDivElement>('drop');
  const animList = el<HTMLDivElement>('animations');
  const speakInput = el<HTMLInputElement>('speak');
  const status = el<HTMLDivElement>('status');

  let agent: Agent | null = null;
  let lastAnimation: string | null = null;

  const setStatus = (msg: string): void => {
    status.textContent = msg;
  };

  async function load(source: ArrayBuffer | { manifestUrl: string }, label: string): Promise<void> {
    try {
      agent?.dispose();
      agent = null;
      animList.replaceChildren();
      lastAnimation = null;
      setStatus(`Loading ${label}…`);
      agent = await createAgent(source, stage);
      await agent.show();
      buildAnimationList(agent.animations());
      setStatus(`Loaded ${label} — ${agent.animations().length} animations. Click one to play.`);
    } catch (err) {
      agent = null;
      setStatus(`Couldn't load ${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  function buildAnimationList(names: string[]): void {
    animList.replaceChildren();
    for (const name of [...names].sort()) {
      const btn = document.createElement('button');
      btn.className = 'anim';
      btn.textContent = name;
      btn.addEventListener('click', () => {
        lastAnimation = name;
        void agent?.play(name);
      });
      animList.appendChild(btn);
    }
  }

  // --- upload path ---
  async function loadUpload(file: File): Promise<void> {
    if (!isAcsFile(file)) {
      setStatus('Please choose a .acs character file.');
      return;
    }
    await load(await file.arrayBuffer(), file.name);
  }

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) void loadUpload(file);
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('over');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('over'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('over');
    const file = e.dataTransfer?.files?.[0];
    if (file) void loadUpload(file);
  });

  // --- built-in bundles (local only; none shipped) ---
  builtinSel.addEventListener('change', () => {
    const id = builtinSel.value;
    if (id)
      void load({ manifestUrl: builtinManifestUrl(id) }, builtinSel.selectedOptions[0]?.text ?? id);
  });

  void loadBuiltins();
  async function loadBuiltins(): Promise<void> {
    let list: BuiltinCharacter[] = [];
    try {
      const res = await fetch('/characters/index.json');
      // Only parse a real JSON response — a dev server's SPA fallback returns
      // index.html (text/html) for a missing file, which means "no built-ins".
      const contentType = res.headers.get('content-type') ?? '';
      if (res.ok && contentType.includes('json')) {
        list = parseBuiltinIndex(await res.json());
      }
    } catch {
      list = [];
    }
    if (list.length === 0) {
      builtinSel.disabled = true;
      const opt = document.createElement('option');
      opt.textContent = 'No bundled characters — drop a .acs →';
      builtinSel.replaceChildren(opt);
      return;
    }
    builtinSel.disabled = false;
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Pick a built-in character…';
    builtinSel.replaceChildren(placeholder);
    for (const c of list) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.label;
      builtinSel.appendChild(opt);
    }
  }

  // --- controls ---
  el<HTMLButtonElement>('speakBtn').addEventListener('click', () => {
    if (!agent) return;
    void agent.speak(speakInput.value.trim() || 'Hello! I am alive in your browser.');
  });
  el<HTMLButtonElement>('stopBtn').addEventListener('click', () => agent?.stop());
  el<HTMLButtonElement>('hideBtn').addEventListener('click', () => void agent?.hide());
  el<HTMLButtonElement>('showBtn').addEventListener('click', () => void agent?.show());
  el<HTMLButtonElement>('replayBtn').addEventListener('click', () => {
    if (lastAnimation) void agent?.play(lastAnimation);
  });

  setStatus('Drop a .acs file (or pick a built-in) to begin.');
}
