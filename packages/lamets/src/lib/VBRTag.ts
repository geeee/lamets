import { new_byte, new_int, arraycopy, assert } from './common.js';
import type { LameGlobalFlags } from './LameGlobalFlags.js';
import type { LameInternalFlags } from './LameInternalFlags.js';
import type { VBRSeekInfo } from './VBRSeekInfo.js';
import { Tables } from './Tables.js';
import { Version } from './Version.js';
import { VbrMode } from './VbrMode.js';
import { MPEGMode } from './MPEGMode.js';
import { ShortBlock } from './ShortBlock.js';
import type { BitStream } from './BitStream.js';
import type { Lame } from './Lame.js';

/**
 * Structure to receive extracted header (toc may be null).
 */
export class VBRTagData {
  /** Total bit stream frames from Vbr header data. */
  frames = 0;
  /** Size of VBR header, in bytes. */
  headersize = 0;
  /** Encoder delay. */
  encDelay = 0;
  /** Encoder padding added at end of stream. */
  encPadding = 0;
  /** From MPEG header 0=MPEG2, 1=MPEG1. */
  hId = 0;
  /** Sample rate determined from MPEG header. */
  samprate = 0;
  /** From Vbr header data. */
  flags = 0;
  /** Total bit stream bytes from Vbr header data. */
  bytes = 0;
  /** Encoded vbr scale from Vbr header data. */
  vbrScale = 0;
  /** May be null if toc not desired. */
  toc: Uint8Array | null = new Uint8Array(VBRTag.NUMTOCENTRIES);
}

/**
 * A Vbr header may be present in the ancillary data field of the first frame of
 * an mp3 bitstream.
 *
 * The Vbr header (optionally) contains:
 *   - frames: total number of audio frames in the bitstream
 *   - bytes: total number of bytes in the bitstream
 *   - toc: table of contents
 *
 * toc (table of contents) gives seek points for random access.
 * The ith entry determines the seek point for i-percent duration.
 * seek point in bytes = (toc[i]/256.0) * total_bitstream_bytes
 * e.g. half duration seek point = (toc[50]/256.0) * total_bitstream_bytes
 */
export class VBRTag {
  static readonly NUMTOCENTRIES = 100;

  /**
   * (0xB40) the max freeformat 640 32kHz framesize.
   */
  static readonly MAXFRAMESIZE = 2880;

  /**
   *    4 bytes for Header Tag
   *    4 bytes for Header Flags
   *  100 bytes for entry (toc)
   *    4 bytes for frame size
   *    4 bytes for stream size
   *    4 bytes for VBR scale. a VBR quality indicator: 0=best 100=worst
   *   20 bytes for LAME tag.  for example, "LAME3.12 (beta 6)"
   * ___________
   *  140 bytes
   */
  private static readonly VBRHEADERSIZE =
    VBRTag.NUMTOCENTRIES + 4 + 4 + 4 + 4 + 4;

  private static readonly LAMEHEADERSIZE =
    VBRTag.VBRHEADERSIZE + 9 + 1 + 1 + 8 + 1 + 1 + 3 + 1 + 1 + 2 + 4 + 2 + 2;

  private static readonly FRAMES_FLAG = 0x0001;
  private static readonly BYTES_FLAG = 0x0002;
  private static readonly TOC_FLAG = 0x0004;
  private static readonly VBR_SCALE_FLAG = 0x0008;

  /** The size of the Xing header MPEG-1, bit rate in kbps. */
  private static readonly XING_BITRATE1 = 128;
  /** The size of the Xing header MPEG-2, bit rate in kbps. */
  private static readonly XING_BITRATE2 = 64;
  /** The size of the Xing header MPEG-2.5, bit rate in kbps. */
  private static readonly XING_BITRATE25 = 32;

  /** VBR header magic string. */
  private static readonly VBRTag0 = 'Xing';
  /** VBR header magic string (VBR == VbrMode.vbr_off). */
  private static readonly VBRTag1 = 'Info';

  /**
   * Lookup table for fast CRC-16 computation. Uses the polynomial
   * x^16+x^15+x^2+1
   */
  private static readonly crc16Lookup: readonly number[] = [
    0x0000, 0xc0c1, 0xc181, 0x0140, 0xc301, 0x03c0, 0x0280, 0xc241,
    0xc601, 0x06c0, 0x0780, 0xc741, 0x0500, 0xc5c1, 0xc481, 0x0440,
    0xcc01, 0x0cc0, 0x0d80, 0xcd41, 0x0f00, 0xcfc1, 0xce81, 0x0e40,
    0x0a00, 0xcac1, 0xcb81, 0x0b40, 0xc901, 0x09c0, 0x0880, 0xc841,
    0xd801, 0x18c0, 0x1980, 0xd941, 0x1b00, 0xdbc1, 0xda81, 0x1a40,
    0x1e00, 0xdec1, 0xdf81, 0x1f40, 0xdd01, 0x1dc0, 0x1c80, 0xdc41,
    0x1400, 0xd4c1, 0xd581, 0x1540, 0xd701, 0x17c0, 0x1680, 0xd641,
    0xd201, 0x12c0, 0x1380, 0xd341, 0x1100, 0xd1c1, 0xd081, 0x1040,
    0xf001, 0x30c0, 0x3180, 0xf141, 0x3300, 0xf3c1, 0xf281, 0x3240,
    0x3600, 0xf6c1, 0xf781, 0x3740, 0xf501, 0x35c0, 0x3480, 0xf441,
    0x3c00, 0xfcc1, 0xfd81, 0x3d40, 0xff01, 0x3fc0, 0x3e80, 0xfe41,
    0xfa01, 0x3ac0, 0x3b80, 0xfb41, 0x3900, 0xf9c1, 0xf881, 0x3840,
    0x2800, 0xe8c1, 0xe981, 0x2940, 0xeb01, 0x2bc0, 0x2a80, 0xea41,
    0xee01, 0x2ec0, 0x2f80, 0xef41, 0x2d00, 0xedc1, 0xec81, 0x2c40,
    0xe401, 0x24c0, 0x2580, 0xe541, 0x2700, 0xe7c1, 0xe681, 0x2640,
    0x2200, 0xe2c1, 0xe381, 0x2340, 0xe101, 0x21c0, 0x2080, 0xe041,
    0xa001, 0x60c0, 0x6180, 0xa141, 0x6300, 0xa3c1, 0xa281, 0x6240,
    0x6600, 0xa6c1, 0xa781, 0x6740, 0xa501, 0x65c0, 0x6480, 0xa441,
    0x6c00, 0xacc1, 0xad81, 0x6d40, 0xaf01, 0x6fc0, 0x6e80, 0xae41,
    0xaa01, 0x6ac0, 0x6b80, 0xab41, 0x6900, 0xa9c1, 0xa881, 0x6840,
    0x7800, 0xb8c1, 0xb981, 0x7940, 0xbb01, 0x7bc0, 0x7a80, 0xba41,
    0xbe01, 0x7ec0, 0x7f80, 0xbf41, 0x7d00, 0xbdc1, 0xbc81, 0x7c40,
    0xb401, 0x74c0, 0x7580, 0xb541, 0x7700, 0xb7c1, 0xb681, 0x7640,
    0x7200, 0xb2c1, 0xb381, 0x7340, 0xb101, 0x71c0, 0x7080, 0xb041,
    0x5000, 0x90c1, 0x9181, 0x5140, 0x9301, 0x53c0, 0x5280, 0x9241,
    0x9601, 0x56c0, 0x5780, 0x9741, 0x5500, 0x95c1, 0x9481, 0x5440,
    0x9c01, 0x5cc0, 0x5d80, 0x9d41, 0x5f00, 0x9fc1, 0x9e81, 0x5e40,
    0x5a00, 0x9ac1, 0x9b81, 0x5b40, 0x9901, 0x59c0, 0x5880, 0x9841,
    0x8801, 0x48c0, 0x4980, 0x8941, 0x4b00, 0x8bc1, 0x8a81, 0x4a40,
    0x4e00, 0x8ec1, 0x8f81, 0x4f40, 0x8d01, 0x4dc0, 0x4c80, 0x8c41,
    0x4400, 0x84c1, 0x8581, 0x4540, 0x8701, 0x47c0, 0x4680, 0x8641,
    0x8201, 0x42c0, 0x4380, 0x8341, 0x4100, 0x81c1, 0x8081, 0x4040,
  ];

  lame!: Lame;
  bs!: BitStream;
  private version = new Version();

  init(lame: Lame, bs: BitStream): void {
    this.lame = lame;
    this.bs = bs;
  }

  // -------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------

  private addVbr(v: VBRSeekInfo, bitrate: number): void {
    v.nVbrNumFrames++;
    v.sum += bitrate;
    v.seen++;

    if (v.seen < v.want) {
      return;
    }

    if (v.pos < v.size) {
      v.bag![v.pos] = v.sum;
      v.pos++;
      v.seen = 0;
    }
    if (v.pos === v.size) {
      for (let i = 1; i < v.size; i += 2) {
        v.bag![(i / 2) | 0] = v.bag![i];
      }
      v.want *= 2;
      v.pos = (v.pos / 2) | 0;
    }
  }

  /**
   * Xing seek table – maps percentage positions to byte offsets.
   */
  private Xing_seek_table(v: VBRSeekInfo, t: Uint8Array): void {
    if (v.pos <= 0) return;

    for (let i = 1; i < VBRTag.NUMTOCENTRIES; ++i) {
      let j = i / VBRTag.NUMTOCENTRIES;
      let indx = (Math.floor(j * v.pos)) | 0;
      if (indx > v.pos - 1) indx = v.pos - 1;
      let act = v.bag![indx];
      let sum = v.sum;
      let seek_point = (256.0 * act / sum) | 0;
      if (seek_point > 255) seek_point = 255;
      t[i] = 0xff & seek_point;
    }
  }

  // -------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------

  /**
   * Add VBR entry, used to fill the VBR TOC entries.
   */
  addVbrFrame(gfp: LameGlobalFlags): void {
    let gfc = gfp.internal_flags!;
    let kbps =
      Tables.bitrate_table[gfp.getMpegVersion()][gfc.bitrate_index];
    assert(gfc.VBR_seek_table.bag != null);
    this.addVbr(gfc.VBR_seek_table, kbps);
  }

  // -------------------------------------------------------------------
  // Big-endian I/O helpers
  // -------------------------------------------------------------------

  /**
   * Read big endian integer (4-bytes) from header.
   */
  private extractInteger(buf: Uint8Array, bufPos: number): number {
    let x = buf[bufPos + 0] & 0xff;
    x <<= 8;
    x |= buf[bufPos + 1] & 0xff;
    x <<= 8;
    x |= buf[bufPos + 2] & 0xff;
    x <<= 8;
    x |= buf[bufPos + 3] & 0xff;
    return x;
  }

  /**
   * Write big endian integer (4-bytes) in the header.
   */
  private CreateI4(buf: Uint8Array, bufPos: number, value: number): void {
    buf[bufPos + 0] = 0xff & ((value >> 24) & 0xff);
    buf[bufPos + 1] = 0xff & ((value >> 16) & 0xff);
    buf[bufPos + 2] = 0xff & ((value >> 8) & 0xff);
    buf[bufPos + 3] = 0xff & (value & 0xff);
  }

  /**
   * Write big endian short (2-bytes) in the header.
   */
  private CreateI2(buf: Uint8Array, bufPos: number, value: number): void {
    buf[bufPos + 0] = 0xff & ((value >> 8) & 0xff);
    buf[bufPos + 1] = 0xff & (value & 0xff);
  }

  /**
   * Check for magic strings (Xing/Info).
   */
  private isVbrTag(buf: Uint8Array, bufPos: number): boolean {
    let tag = String.fromCharCode(
      buf[bufPos],
      buf[bufPos + 1],
      buf[bufPos + 2],
      buf[bufPos + 3],
    );
    return tag === VBRTag.VBRTag0 || tag === VBRTag.VBRTag1;
  }

  private shiftInBitsValue(x: number, n: number, v: number): number {
    return 0xff & ((x << n) | (v & ~(-1 << n)));
  }

  // -------------------------------------------------------------------
  // Frame header construction
  // -------------------------------------------------------------------

  /**
   * Construct the MP3 header using the settings of the global flags.
   */
  private setLameTagFrameHeader(
    gfp: LameGlobalFlags,
    buffer: Uint8Array,
  ): void {
    let gfc = gfp.internal_flags!;

    // MP3 Sync Word
    buffer[0] = this.shiftInBitsValue(buffer[0], 8, 0xff);

    buffer[1] = this.shiftInBitsValue(buffer[1], 3, 7);
    buffer[1] = this.shiftInBitsValue(
      buffer[1],
      1,
      gfp.getOutSampleRate() < 16000 ? 0 : 1,
    );
    // Version
    buffer[1] = this.shiftInBitsValue(buffer[1], 1, gfp.getMpegVersion());
    // 01 == Layer 3
    buffer[1] = this.shiftInBitsValue(buffer[1], 2, 4 - 3);
    // Error protection
    buffer[1] = this.shiftInBitsValue(
      buffer[1],
      1,
      !gfp.error_protection ? 1 : 0,
    );

    // Bit rate
    buffer[2] = this.shiftInBitsValue(buffer[2], 4, gfc.bitrate_index);
    // Frequency
    buffer[2] = this.shiftInBitsValue(buffer[2], 2, gfc.samplerate_index);
    // Pad. Bit
    buffer[2] = this.shiftInBitsValue(buffer[2], 1, 0);
    // Priv. Bit
    buffer[2] = this.shiftInBitsValue(buffer[2], 1, gfp.extension);

    // Mode
    buffer[3] = this.shiftInBitsValue(buffer[3], 2, gfp.getMode());
    // Mode extension (Used with Joint Stereo)
    buffer[3] = this.shiftInBitsValue(buffer[3], 2, gfc.mode_ext);
    // Copy
    buffer[3] = this.shiftInBitsValue(buffer[3], 1, gfp.copyright);
    // Original
    buffer[3] = this.shiftInBitsValue(buffer[3], 1, gfp.original);
    // Emphasis
    buffer[3] = this.shiftInBitsValue(buffer[3], 2, gfp.emphasis);

    /* the default VBR header. 48 kbps layer III, no padding, no crc */
    /* but sampling freq, mode and copyright/copy protection taken */
    /* from first valid frame */
    buffer[0] = 0xff;
    let abyte = 0xff & (buffer[1] & 0xf1);

    let bitrate: number;
    if (1 === gfp.getMpegVersion()) {
      bitrate = VBRTag.XING_BITRATE1;
    } else {
      if (gfp.getOutSampleRate() < 16000) {
        bitrate = VBRTag.XING_BITRATE25;
      } else {
        bitrate = VBRTag.XING_BITRATE2;
      }
    }

    if (gfp.getVBR() === VbrMode.vbr_off) {
      bitrate = gfp.getBitRate();
    }

    let bbyte: number;
    if (gfp.free_format) {
      bbyte = 0x00;
    } else {
      bbyte =
        0xff &
        (16 *
          this.lame.BitrateIndex(
            bitrate,
            gfp.getMpegVersion(),
            gfp.getOutSampleRate(),
          ));
    }

    /*
     * Use as much of the info from the real frames in the Xing header:
     * samplerate, channels, crc, etc...
     */
    if (gfp.getMpegVersion() === 1) {
      /* MPEG1 */
      buffer[1] = 0xff & (abyte | 0x0a); /* was 0x0b; */
      abyte = 0xff & (buffer[2] & 0x0d); /* AF keep also private bit */
      buffer[2] = 0xff & (bbyte | abyte); /* 64kbs MPEG1 frame */
    } else {
      /* MPEG2 */
      buffer[1] = 0xff & (abyte | 0x02); /* was 0x03; */
      abyte = 0xff & (buffer[2] & 0x0d); /* AF keep also private bit */
      buffer[2] = 0xff & (bbyte | abyte); /* 64kbs MPEG2 frame */
    }
  }

  // -------------------------------------------------------------------
  // getVbrTag – parse existing VBR header
  // -------------------------------------------------------------------

  /**
   * Get VBR tag information.
   */
  getVbrTag(buf: Uint8Array): VBRTagData | null {
    let pTagData = new VBRTagData();
    let bufPos = 0;

    /* get Vbr header data */
    pTagData.flags = 0;

    /* get selected MPEG header data */
    let hId = (buf[bufPos + 1] >> 3) & 1;
    let hSrIndex = (buf[bufPos + 2] >> 2) & 3;
    let hMode = (buf[bufPos + 3] >> 6) & 3;
    let hBitrate = (buf[bufPos + 2] >> 4) & 0xf;
    hBitrate = Tables.bitrate_table[hId][hBitrate];

    /* check for FFE syncword */
    if ((buf[bufPos + 1] >> 4) === 0xe) {
      pTagData.samprate = Tables.samplerate_table[2][hSrIndex];
    } else {
      pTagData.samprate = Tables.samplerate_table[hId][hSrIndex];
    }

    /* determine offset of header */
    if (hId !== 0) {
      /* mpeg1 */
      if (hMode !== 3) {
        bufPos += 32 + 4;
      } else {
        bufPos += 17 + 4;
      }
    } else {
      /* mpeg2 */
      if (hMode !== 3) {
        bufPos += 17 + 4;
      } else {
        bufPos += 9 + 4;
      }
    }

    if (!this.isVbrTag(buf, bufPos)) return null;

    bufPos += 4;

    pTagData.hId = hId;

    /* get flags */
    let head_flags = (pTagData.flags = this.extractInteger(buf, bufPos));
    bufPos += 4;

    if ((head_flags & VBRTag.FRAMES_FLAG) !== 0) {
      pTagData.frames = this.extractInteger(buf, bufPos);
      bufPos += 4;
    }

    if ((head_flags & VBRTag.BYTES_FLAG) !== 0) {
      pTagData.bytes = this.extractInteger(buf, bufPos);
      bufPos += 4;
    }

    if ((head_flags & VBRTag.TOC_FLAG) !== 0) {
      if (pTagData.toc != null) {
        for (let i = 0; i < VBRTag.NUMTOCENTRIES; i++) {
          pTagData.toc[i] = buf[bufPos + i];
        }
      }
      bufPos += VBRTag.NUMTOCENTRIES;
    }

    pTagData.vbrScale = -1;

    if ((head_flags & VBRTag.VBR_SCALE_FLAG) !== 0) {
      pTagData.vbrScale = this.extractInteger(buf, bufPos);
      bufPos += 4;
    }

    pTagData.headersize =
      (((hId + 1) * 72000 * hBitrate) / pTagData.samprate) | 0;

    bufPos += 21;
    let encDelay = buf[bufPos + 0] << 4;
    encDelay += buf[bufPos + 1] >> 4;
    let encPadding = (buf[bufPos + 1] & 0x0f) << 8;
    encPadding += buf[bufPos + 2] & 0xff;
    /* check for reasonable values (this may be an old Xing header, */
    /* not a INFO tag) */
    if (encDelay < 0 || encDelay > 3000) encDelay = -1;
    if (encPadding < 0 || encPadding > 3000) encPadding = -1;

    pTagData.encDelay = encDelay;
    pTagData.encPadding = encPadding;

    /* success */
    return pTagData;
  }

  // -------------------------------------------------------------------
  // InitVbrTag
  // -------------------------------------------------------------------

  /**
   * Initializes the header.
   */
  InitVbrTag(gfp: LameGlobalFlags): void {
    let gfc = gfp.internal_flags!;

    /*
     * Xing VBR pretends to be a 48kbs layer III frame.  (at 44.1kHz).
     * (at 48kHz they use 56kbs since 48kbs frame not big enough for
     * table of contents)
     * let's always embed Xing header inside a 64kbs layer III frame.
     * this gives us enough room for a LAME version string too.
     * size determined by sampling frequency (MPEG1)
     * 32kHz:    216 bytes@48kbs    288bytes@ 64kbs
     * 44.1kHz:  156 bytes          208bytes@64kbs     (+1 if padding = 1)
     * 48kHz:    144 bytes          192
     *
     * MPEG 2 values are the same since the framesize and samplerate
     * are each reduced by a factor of 2.
     */
    let kbps_header: number;
    if (1 === gfp.getMpegVersion()) {
      kbps_header = VBRTag.XING_BITRATE1;
    } else {
      if (gfp.getOutSampleRate() < 16000) {
        kbps_header = VBRTag.XING_BITRATE25;
      } else {
        kbps_header = VBRTag.XING_BITRATE2;
      }
    }

    if (gfp.getVBR() === VbrMode.vbr_off) {
      kbps_header = gfp.getBitRate();
    }

    // make sure LAME Header fits into Frame
    let totalFrameSize =
      (((gfp.getMpegVersion() + 1) * 72000 * kbps_header) /
        gfp.getOutSampleRate()) |
      0;
    let headerSize = gfc.sideinfo_len + VBRTag.LAMEHEADERSIZE;
    gfc.VBR_seek_table.TotalFrameSize = totalFrameSize;
    if (totalFrameSize < headerSize || totalFrameSize > VBRTag.MAXFRAMESIZE) {
      /* disable tag, it wont fit */
      gfp.bWriteVbrTag = false;
      return;
    }

    gfc.VBR_seek_table.nVbrNumFrames = 0;
    gfc.VBR_seek_table.nBytesWritten = 0;
    gfc.VBR_seek_table.sum = 0;

    gfc.VBR_seek_table.seen = 0;
    gfc.VBR_seek_table.want = 1;
    gfc.VBR_seek_table.pos = 0;

    if (gfc.VBR_seek_table.bag == null) {
      gfc.VBR_seek_table.bag = new_int(400);
      gfc.VBR_seek_table.size = 400;
    }

    // write dummy VBR tag of all 0's into bitstream
    let buffer = new_byte(VBRTag.MAXFRAMESIZE);

    this.setLameTagFrameHeader(gfp, buffer);
    let n = gfc.VBR_seek_table.TotalFrameSize;
    for (let i = 0; i < n; ++i) {
      this.bs.add_dummy_byte(gfp, buffer[i] & 0xff, 1);
    }
  }

  // -------------------------------------------------------------------
  // CRC helpers
  // -------------------------------------------------------------------

  /**
   * Fast CRC-16 computation (uses table crc16Lookup).
   */
  private crcUpdateLookup(value: number, crc: number): number {
    let tmp = crc ^ value;
    crc = (crc >> 8) ^ VBRTag.crc16Lookup[tmp & 0xff];
    return crc;
  }

  updateMusicCRC(
    crc: Int32Array,
    buffer: Uint8Array,
    bufferPos: number,
    size: number,
  ): void {
    for (let i = 0; i < size; ++i) {
      crc[0] = this.crcUpdateLookup(buffer[bufferPos + i], crc[0]);
    }
  }

  // -------------------------------------------------------------------
  // putLameVBR – LAME info block inside Xing/Info header
  // -------------------------------------------------------------------

  /**
   * Write LAME info: mini version + info on various switches used
   * (Jonathan Dee 2001/08/31).
   */
  private putLameVBR(
    gfp: LameGlobalFlags,
    musicLength: number,
    streamBuffer: Uint8Array,
    streamBufferPos: number,
    crc: number,
  ): number {
    let gfc = gfp.internal_flags!;

    let bytesWritten = 0;

    /* encoder delay */
    let encDelay = gfp.getEncoderDelay();
    /* encoder padding */
    let encPadding = gfp.encoder_padding;

    /* recall: gfp.VBR_q is for example set by the switch -V */
    /* gfp.quality by -q, -h, -f, etc */
    let quality = 100 - 10 * gfp.getVBRQuality() - gfp.getQuality();

    let versionStr = this.version.getLameVeryShortVersion();
    let vbr: number;
    let revision = 0x00;
    let revMethod: number;
    // numbering different in vbr_mode vs. Lame tag
    let vbrTypeTranslator = [1, 5, 3, 2, 4, 0, 3];

    let lowpass =
      (((gfp.lowpassfreq / 100.0) + 0.5) > 255
        ? 255
        : ((gfp.lowpassfreq / 100.0) + 0.5)) | 0;

    let peakSignalAmplitude = 0;

    let radioReplayGain = 0;
    let audiophileReplayGain = 0;

    let noiseShaping = gfp.internal_flags!.noise_shaping;
    let stereoMode = 0;
    let nonOptimal = 0;
    let sourceFreq = 0;
    let misc = 0;
    let musicCRC = 0;

    // psy model type: Gpsycho or NsPsytune
    let expNPsyTune = (gfp.exp_nspsytune & 1) !== 0;
    let safeJoint = (gfp.exp_nspsytune & 2) !== 0;

    let noGapMore = false;
    let noGapPrevious = false;

    let noGapCount = gfp.internal_flags!.nogap_total;
    let noGapCurr = gfp.internal_flags!.nogap_current;

    // 4 bits
    let athType = gfp.ATHtype;

    let flags = 0;

    // vbr modes
    let abrBitrate: number;
    switch (gfp.getVBR()) {
      case VbrMode.vbr_abr:
        abrBitrate = gfp.VBR_mean_bitrate_kbps;
        break;
      case VbrMode.vbr_off:
        abrBitrate = gfp.getBitRate();
        break;
      default:
        abrBitrate = gfp.VBR_min_bitrate_kbps;
    }

    // revision and vbr method
    if ((gfp.getVBR() as number) < vbrTypeTranslator.length) {
      vbr = vbrTypeTranslator[gfp.getVBR() as number];
    } else {
      vbr = 0x00; // unknown
    }

    revMethod = 0x10 * revision + vbr;

    // ReplayGain
    if (gfc.findReplayGain) {
      if (gfc.RadioGain > 0x1fe) gfc.RadioGain = 0x1fe;
      if (gfc.RadioGain < -0x1fe) gfc.RadioGain = -0x1fe;

      // set name code
      radioReplayGain = 0x2000;
      // set originator code to `determined automatically'
      radioReplayGain |= 0xc00;

      if (gfc.RadioGain >= 0) {
        // set gain adjustment
        radioReplayGain |= gfc.RadioGain;
      } else {
        // set the sign bit
        radioReplayGain |= 0x200;
        // set gain adjustment
        radioReplayGain |= -gfc.RadioGain;
      }
    }

    // peak sample
    if (gfc.findPeakSample) {
      peakSignalAmplitude = Math.abs(
        ((gfc.PeakSample / 32767.0) * Math.pow(2, 23) + 0.5) | 0,
      );
    }

    // nogap
    if (noGapCount !== -1) {
      if (noGapCurr > 0) noGapPrevious = true;

      if (noGapCurr < noGapCount - 1) noGapMore = true;
    }

    // flags
    flags =
      athType +
      ((expNPsyTune ? 1 : 0) << 4) +
      ((safeJoint ? 1 : 0) << 5) +
      ((noGapMore ? 1 : 0) << 6) +
      ((noGapPrevious ? 1 : 0) << 7);

    if (quality < 0) quality = 0;

    // stereo mode field (Intensity stereo is not implemented)
    switch (gfp.getMode()) {
      case MPEGMode.MONO:
        stereoMode = 0;
        break;
      case MPEGMode.STEREO:
        stereoMode = 1;
        break;
      case MPEGMode.DUAL_CHANNEL:
        stereoMode = 2;
        break;
      case MPEGMode.JOINT_STEREO:
        if (gfp.force_ms) stereoMode = 4;
        else stereoMode = 3;
        break;
      case MPEGMode.NOT_SET:
      default:
        stereoMode = 7;
        break;
    }

    if (gfp.getInSampleRate() <= 32000) {
      sourceFreq = 0x00;
    } else if (gfp.getInSampleRate() === 48000) {
      sourceFreq = 0x02;
    } else if (gfp.getInSampleRate() > 48000) {
      sourceFreq = 0x03;
    } else {
      // default is 44100Hz
      sourceFreq = 0x01;
    }

    // Check if the user overrided the default LAME behavior with some
    // nasty options
    if (
      gfp.short_blocks === ShortBlock.short_block_forced ||
      gfp.short_blocks === ShortBlock.short_block_dispensed ||
      (gfp.lowpassfreq === -1 && gfp.highpassfreq === -1) /* "-k" */ ||
      gfp.scale_left < gfp.scale_right ||
      gfp.scale_left > gfp.scale_right ||
      (gfp.disable_reservoir && gfp.getBitRate() < 320) ||
      gfp.noATH ||
      gfp.ATHonly ||
      athType === 0 ||
      gfp.getInSampleRate() <= 32000
    ) {
      nonOptimal = 1;
    }

    misc =
      noiseShaping + (stereoMode << 2) + (nonOptimal << 5) + (sourceFreq << 6);

    musicCRC = gfc.nMusicCRC;

    // Write all this information into the stream

    this.CreateI4(streamBuffer, streamBufferPos + bytesWritten, quality);
    bytesWritten += 4;

    for (let j = 0; j < 9; j++) {
      streamBuffer[streamBufferPos + bytesWritten + j] =
        0xff & versionStr.charCodeAt(j);
    }
    bytesWritten += 9;

    streamBuffer[streamBufferPos + bytesWritten] = 0xff & revMethod;
    bytesWritten++;

    streamBuffer[streamBufferPos + bytesWritten] = 0xff & lowpass;
    bytesWritten++;

    this.CreateI4(
      streamBuffer,
      streamBufferPos + bytesWritten,
      peakSignalAmplitude,
    );
    bytesWritten += 4;

    this.CreateI2(
      streamBuffer,
      streamBufferPos + bytesWritten,
      radioReplayGain,
    );
    bytesWritten += 2;

    this.CreateI2(
      streamBuffer,
      streamBufferPos + bytesWritten,
      audiophileReplayGain,
    );
    bytesWritten += 2;

    streamBuffer[streamBufferPos + bytesWritten] = 0xff & flags;
    bytesWritten++;

    if (abrBitrate >= 255) {
      streamBuffer[streamBufferPos + bytesWritten] = 0xff;
    } else {
      streamBuffer[streamBufferPos + bytesWritten] = 0xff & abrBitrate;
    }
    bytesWritten++;

    streamBuffer[streamBufferPos + bytesWritten] = 0xff & (encDelay >> 4);
    streamBuffer[streamBufferPos + bytesWritten + 1] =
      0xff & ((encDelay << 4) + (encPadding >> 8));
    streamBuffer[streamBufferPos + bytesWritten + 2] = 0xff & encPadding;

    bytesWritten += 3;

    streamBuffer[streamBufferPos + bytesWritten] = 0xff & misc;
    bytesWritten++;

    // unused in rev0
    streamBuffer[streamBufferPos + bytesWritten++] = 0;

    this.CreateI2(streamBuffer, streamBufferPos + bytesWritten, gfp.preset);
    bytesWritten += 2;

    this.CreateI4(
      streamBuffer,
      streamBufferPos + bytesWritten,
      musicLength,
    );
    bytesWritten += 4;

    this.CreateI2(streamBuffer, streamBufferPos + bytesWritten, musicCRC);
    bytesWritten += 2;

    // Calculate tag CRC.... must be done here, since it includes previous
    // information

    for (let i = 0; i < bytesWritten; i++) {
      crc = this.crcUpdateLookup(streamBuffer[streamBufferPos + i], crc);
    }

    this.CreateI2(streamBuffer, streamBufferPos + bytesWritten, crc);
    bytesWritten += 2;

    return bytesWritten;
  }

  // -------------------------------------------------------------------
  // getLameTagFrame
  // -------------------------------------------------------------------

  getLameTagFrame(gfp: LameGlobalFlags, buffer: Uint8Array): number {
    let gfc = gfp.internal_flags!;

    if (!gfp.bWriteVbrTag) {
      return 0;
    }
    if (gfc.Class_ID !== 0xfff88e3b) {
      // Lame.LAME_ID – Lame class sets this at lame_init_params()
      return 0;
    }
    if (gfc.VBR_seek_table.pos <= 0) {
      return 0;
    }
    if (buffer.length < gfc.VBR_seek_table.TotalFrameSize) {
      return gfc.VBR_seek_table.TotalFrameSize;
    }

    buffer.fill(0, 0, gfc.VBR_seek_table.TotalFrameSize);

    // 4 bytes frame header
    this.setLameTagFrameHeader(gfp, buffer);

    // Create TOC entries
    let toc = new_byte(VBRTag.NUMTOCENTRIES);

    if (gfp.free_format) {
      for (let i = 1; i < VBRTag.NUMTOCENTRIES; ++i) {
        toc[i] = 0xff & (((255 * i) / 100) | 0);
      }
    } else {
      this.Xing_seek_table(gfc.VBR_seek_table, toc);
    }

    // Start writing the tag after the zero frame
    let streamIndex = gfc.sideinfo_len;
    /*
     * Note: Xing header specifies that Xing data goes in the ancillary data
     * with NO ERROR PROTECTION. If error protecton in enabled, the Xing
     * data still starts at the same offset, and now it is in sideinfo data
     * block, and thus will not decode correctly by non-Xing tag aware
     * players
     */
    if (gfp.error_protection) streamIndex -= 2;

    // Put Vbr tag
    if (gfp.getVBR() === VbrMode.vbr_off) {
      buffer[streamIndex++] = VBRTag.VBRTag1.charCodeAt(0);
      buffer[streamIndex++] = VBRTag.VBRTag1.charCodeAt(1);
      buffer[streamIndex++] = VBRTag.VBRTag1.charCodeAt(2);
      buffer[streamIndex++] = VBRTag.VBRTag1.charCodeAt(3);
    } else {
      buffer[streamIndex++] = VBRTag.VBRTag0.charCodeAt(0);
      buffer[streamIndex++] = VBRTag.VBRTag0.charCodeAt(1);
      buffer[streamIndex++] = VBRTag.VBRTag0.charCodeAt(2);
      buffer[streamIndex++] = VBRTag.VBRTag0.charCodeAt(3);
    }

    // Put header flags
    this.CreateI4(
      buffer,
      streamIndex,
      VBRTag.FRAMES_FLAG +
        VBRTag.BYTES_FLAG +
        VBRTag.TOC_FLAG +
        VBRTag.VBR_SCALE_FLAG,
    );
    streamIndex += 4;

    // Put Total Number of frames
    this.CreateI4(buffer, streamIndex, gfc.VBR_seek_table.nVbrNumFrames);
    streamIndex += 4;

    // Put total audio stream size, including Xing/LAME Header
    let streamSize =
      gfc.VBR_seek_table.nBytesWritten + gfc.VBR_seek_table.TotalFrameSize;
    this.CreateI4(buffer, streamIndex, streamSize | 0);
    streamIndex += 4;

    /* Put TOC */
    arraycopy(toc, 0, buffer, streamIndex, toc.length);
    streamIndex += toc.length;

    if (gfp.error_protection) {
      // (jo) error_protection: add crc16 information to header
      this.bs.CRC_writeheader(gfc, buffer);
    }

    // work out CRC so far: initially crc = 0
    let crc = 0x00;
    for (let i = 0; i < streamIndex; i++) {
      crc = this.crcUpdateLookup(buffer[i], crc);
    }
    // Put LAME VBR info
    streamIndex += this.putLameVBR(gfp, streamSize, buffer, streamIndex, crc);

    return gfc.VBR_seek_table.TotalFrameSize;
  }
}
