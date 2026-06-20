// Compositor logic under a fake Document (no real canvas needed). Verifies the
// compositing decisions that back the "plays composited" acceptance: clear then
// drawImage each frame image at its offset; a zero-image frame holds the previous
// pose (no clear/draw); 0x0 referenced images are skipped.

import { describe, it, expect } from 'vitest';
import type { CharacterModel, FrameModel, ImageModel } from '@vivify/types';
import { Compositor } from '../src/compositor.js';

interface DrawCall {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface FakeCanvas {
  width: number;
  height: number;
  getContext(id: string): FakeCtx;
}

interface FakeCtx {
  clearRect(): void;
  drawImage(src: FakeCanvas, x: number, y: number): void;
  createImageData(w: number, h: number): { data: Uint8ClampedArray; width: number; height: number };
  putImageData(): void;
}

function fakeDoc(): { doc: Document; draws: DrawCall[]; clears: () => number } {
  const draws: DrawCall[] = [];
  let clears = 0;
  const makeCtx = (): FakeCtx => ({
    clearRect: () => {
      clears += 1;
    },
    drawImage: (src, x, y) => {
      draws.push({ x, y, w: src.width, h: src.height });
    },
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h }),
    putImageData: () => {},
  });
  const doc = {
    createElement: (): FakeCanvas => {
      const canvas: FakeCanvas = { width: 0, height: 0, getContext: () => makeCtx() };
      return canvas;
    },
  };
  return { doc: doc as unknown as Document, draws, clears: () => clears };
}

function img(w: number, h: number): ImageModel {
  return { width: w, height: h, rgba: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
}

function model(): CharacterModel {
  return {
    info: { guid: '{x}', width: 128, height: 128 },
    palette: [],
    transparentIndex: 0,
    images: [img(10, 10), img(20, 5), img(0, 0)],
    animations: [],
    sounds: [],
    balloon: {
      numLines: 0,
      charsPerLine: 0,
      fontName: '',
      fontHeight: 0,
      fg: [0, 0, 0],
      bg: [0, 0, 0],
      border: [0, 0, 0],
    },
    voice: {},
    states: {},
  };
}

const frame = (images: FrameModel['images']): FrameModel => ({
  images,
  durationMs: 100,
  branches: [],
});

describe('Compositor', () => {
  it('composites images at their offsets after a single clear', () => {
    const { doc, draws, clears } = fakeDoc();
    const c = new Compositor(model(), doc);
    c.renderFrame(
      frame([
        { imageIndex: 0, x: 5, y: 7 },
        { imageIndex: 1, x: 0, y: 0 },
      ]),
    );
    expect(clears()).toBe(1);
    expect(draws).toEqual([
      { x: 5, y: 7, w: 10, h: 10 },
      { x: 0, y: 0, w: 20, h: 5 },
    ]);
  });

  it('holds the previous pose on a zero-image frame (no clear, no draw)', () => {
    const { doc, draws, clears } = fakeDoc();
    const c = new Compositor(model(), doc);
    c.renderFrame(frame([]));
    expect(clears()).toBe(0);
    expect(draws).toEqual([]);
  });

  it('skips 0x0 referenced images', () => {
    const { doc, draws } = fakeDoc();
    const c = new Compositor(model(), doc);
    c.renderFrame(frame([{ imageIndex: 2, x: 0, y: 0 }]));
    expect(draws).toEqual([]);
  });
});
