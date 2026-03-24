// ID3Tag - minimal implementation for encoder support
import type { LameGlobalFlags } from './LameGlobalFlags.js';
import type { BitStream } from './BitStream.js';
import type { Version } from './Version.js';

export class ID3Tag {
  private bs!: BitStream;
  private ver!: Version;

  init(bs: BitStream, ver: Version): void {
    this.bs = bs;
    this.ver = ver;
  }

  id3tag_init(_gfp: LameGlobalFlags): void {
    // Initialize ID3 tag spec
    const gfc = _gfp.internal_flags!;
    gfc.tag_spec = null;
  }

  id3tag_write_v2(_gfp: LameGlobalFlags): number {
    // Not implemented for now - returns 0 bytes written
    return 0;
  }

  id3tag_write_v1(_gfp: LameGlobalFlags): number {
    // Not implemented for now - returns 0 bytes written
    return 0;
  }
}
