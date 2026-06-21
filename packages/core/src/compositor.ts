// Canvas compositor: owns a <canvas> sized to the character and draws a frame by
// compositing its images at their per-image offsets, honoring transparency.
// Per-image offscreen canvases (from ImageModel.rgba) are cached and drawImage'd
// so multi-image frames alpha-blend correctly. Browser-only (harness-validated).

import type { CharacterModel, FrameModel, FrameMouthOverlay } from '@vivify/types';

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly doc: Document;
  private readonly cache = new Map<number, HTMLCanvasElement>();
  private lastFrame: FrameModel | null = null;
  private mouthOverlay: FrameMouthOverlay | null = null;

  constructor(
    private readonly model: CharacterModel,
    doc: Document = document,
  ) {
    this.doc = doc;
    this.canvas = doc.createElement('canvas');
    this.canvas.width = Math.max(1, model.info.width);
    this.canvas.height = Math.max(1, model.info.height);
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('Compositor: 2D canvas context unavailable');
    this.ctx = ctx;
  }

  /**
   * Draw a frame: clear, then composite its images in order at their offsets,
   * then the current mouth overlay (if any) on top. A zero-image frame holds the
   * previous pose (does not clear) — ADR-0011.
   */
  renderFrame(frame: FrameModel): void {
    if (frame.images.length === 0) return;
    this.lastFrame = frame;
    this.draw();
  }

  /**
   * Set (or clear) the mouth overlay composited on top of the current frame and
   * redraw. Driven by the lip-sync timeline during speech (Cycle 6).
   */
  setMouthOverlay(overlay: FrameMouthOverlay | null): void {
    this.mouthOverlay = overlay;
    this.draw();
  }

  clear(): void {
    this.lastFrame = null;
    this.mouthOverlay = null;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(): void {
    const frame = this.lastFrame;
    if (!frame) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const ref of frame.images) {
      const src = this.imageCanvas(ref.imageIndex);
      if (src) this.ctx.drawImage(src, ref.x, ref.y);
    }
    const overlay = this.mouthOverlay;
    if (overlay) {
      const src = this.imageCanvas(overlay.imageIndex);
      if (src) this.ctx.drawImage(src, overlay.x, overlay.y);
    }
  }

  private imageCanvas(index: number): HTMLCanvasElement | undefined {
    const cached = this.cache.get(index);
    if (cached) return cached;
    const img = this.model.images[index];
    if (!img || img.width === 0 || img.height === 0) return undefined;
    const off = this.doc.createElement('canvas');
    off.width = img.width;
    off.height = img.height;
    const octx = off.getContext('2d');
    if (!octx) return undefined;
    const imageData = octx.createImageData(img.width, img.height);
    imageData.data.set(img.rgba);
    octx.putImageData(imageData, 0, 0);
    this.cache.set(index, off);
    return off;
  }
}
