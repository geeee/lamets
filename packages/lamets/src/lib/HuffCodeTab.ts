export class HuffCodeTab {
  readonly xlen: number;
  readonly linmax: number;
  readonly table: Int32Array | null;
  readonly hlen: Int32Array | null;

  constructor(len: number, max: number, tab: Int32Array | null, hl: Int32Array | null) {
    this.xlen = len;
    this.linmax = max;
    this.table = tab;
    this.hlen = hl;
  }
}
