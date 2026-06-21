// Little-endian binary reader for the .acs format. Cursor-based; all multi-byte
// reads are little-endian (the .acs format is LE). See docs/cycles/cycle-1-findings.md.

export class BinaryReader {
  readonly bytes: Uint8Array;
  private readonly view: DataView;
  pos: number;

  constructor(input: ArrayBuffer | Uint8Array, start = 0) {
    this.bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.pos = start;
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  seek(p: number): void {
    this.pos = p;
  }

  skip(n: number): void {
    this.pos += n;
  }

  u8(): number {
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  i32(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Read `n` raw bytes and advance. */
  take(n: number): Uint8Array {
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }

  /** A 16-byte GUID, formatted `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`. */
  guid(): string {
    const d1 = this.u32();
    const d2 = this.u16();
    const d3 = this.u16();
    const rest: number[] = [];
    for (let i = 0; i < 8; i++) rest.push(this.u8());
    const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');
    const tail = rest.map((b) => hex(b, 2)).join('');
    return `{${hex(d1, 8)}-${hex(d2, 4)}-${hex(d3, 4)}-${tail.slice(0, 4)}-${tail.slice(4)}}`;
  }

  /**
   * Length-prefixed UTF-16LE string: `u32 charLen` + `charLen` UTF-16 code units.
   * A non-empty string is followed by a NUL code unit when `nullTerminated`.
   */
  string(nullTerminated = true): string {
    const charLen = this.u32();
    if (charLen === 0) return '';
    let s = '';
    for (let i = 0; i < charLen; i++) {
      s += String.fromCharCode(this.view.getUint16(this.pos, true));
      this.pos += 2;
    }
    if (nullTerminated) this.pos += 2;
    return s;
  }
}
