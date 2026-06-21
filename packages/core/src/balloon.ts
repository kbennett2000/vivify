// The speech balloon (text only — no audio this cycle). A DOM element styled
// from the character's BalloonConfig; text is word-wrapped via wrap.ts.
// Browser-only (harness-validated).

import type { BalloonConfig, Rgb } from '@vivify/types';
import { wrapText } from './wrap.js';

const css = (c: Rgb): string => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

export class Balloon {
  readonly el: HTMLDivElement;

  constructor(
    private readonly cfg: BalloonConfig,
    doc: Document = document,
  ) {
    const el = doc.createElement('div');
    const s = el.style;
    s.position = 'absolute';
    s.display = 'none';
    s.whiteSpace = 'pre';
    s.fontFamily = cfg.fontName ? `"${cfg.fontName}", sans-serif` : 'sans-serif';
    s.fontSize = `${cfg.fontHeight > 0 ? cfg.fontHeight : 12}px`;
    s.color = css(cfg.fg);
    s.background = css(cfg.bg);
    s.border = `1px solid ${css(cfg.border)}`;
    s.padding = '6px 8px';
    s.borderRadius = '6px';
    s.pointerEvents = 'none';
    s.maxWidth = 'max-content';
    this.el = el;
  }

  setText(text: string): void {
    const lines = wrapText(
      text,
      this.cfg.charsPerLine > 0 ? this.cfg.charsPerLine : 32,
      this.cfg.numLines > 0 ? this.cfg.numLines : undefined,
    );
    this.el.textContent = lines.join('\n');
  }

  show(): void {
    this.el.style.display = 'block';
  }

  hide(): void {
    this.el.style.display = 'none';
  }
}
