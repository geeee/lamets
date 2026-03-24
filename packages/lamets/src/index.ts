/**
 * lamets - TypeScript port of LAME MP3 encoder
 *
 * @module lamets
 */

import { GainAnalysis } from './lib/GainAnalysis.js';
import { BitStream } from './lib/BitStream.js';
import { Presets } from './lib/Presets.js';
import { QuantizePVT } from './lib/QuantizePVT.js';
import { Quantize } from './lib/Quantize.js';
import { VBRTag } from './lib/VBRTag.js';
import { Version } from './lib/Version.js';
import { ID3Tag } from './lib/ID3Tag.js';
import { Reservoir } from './lib/Reservoir.js';
import { Takehiro } from './lib/Takehiro.js';
import { Encoder } from './lib/Encoder.js';
import { Lame } from './lib/Lame.js';
import { LameGlobalFlags } from './lib/LameGlobalFlags.js';
import { MPEGMode } from './lib/MPEGMode.js';

function createEncoder(): Lame {
  const ga = new GainAnalysis();
  const bs = new BitStream();
  const p = new Presets();
  const qupvt = new QuantizePVT();
  const qu = new Quantize();
  const vbr = new VBRTag();
  const ver = new Version();
  const id3 = new ID3Tag();
  const rv = new Reservoir();
  const tak = new Takehiro();
  const lame = new Lame();

  // Wire up modules
  lame.init(ga, bs, p, qupvt, qu, vbr, ver, id3);
  bs.init(ga, ver, vbr);
  id3.init(bs, ver);
  p.init(lame);
  qupvt.init(tak, rv, lame.psy);
  qu.init(bs, rv, qupvt, tak);
  rv.init(bs);
  tak.init(qupvt);
  vbr.init(lame, bs);

  return lame;
}

/**
 * MP3 Encoder.
 *
 * @example
 * ```ts
 * const encoder = new Mp3Encoder(1, 44100, 128);
 * const chunks: Int8Array[] = [];
 * for (let i = 0; i < samples.length; i += 1152) {
 *   const chunk = samples.subarray(i, Math.min(i + 1152, samples.length));
 *   const mp3 = encoder.encodeBuffer(chunk);
 *   if (mp3.length > 0) chunks.push(mp3);
 * }
 * const flush = encoder.flush();
 * if (flush.length > 0) chunks.push(flush);
 * ```
 */
export class Mp3Encoder {
  private lame: Lame;
  private gfp: LameGlobalFlags;
  private mp3buf: Uint8Array;
  private mp3bufSize: number;

  constructor(channels: number, sampleRate: number, kbps: number) {
    this.lame = createEncoder();
    this.gfp = this.lame.lame_init();

    this.gfp.setInNumChannels(channels);
    this.gfp.setInSampleRate(sampleRate);
    this.gfp.setBitRate(kbps);
    this.gfp.setMode(channels === 1 ? MPEGMode.MONO : MPEGMode.JOINT_STEREO);
    this.gfp.setQuality(3);
    this.gfp.bWriteVbrTag = false;
    this.gfp.disable_reservoir = true;
    this.gfp.setWriteId3tagAutomatic(false);

    const retcode = this.lame.lame_init_params(this.gfp);
    if (retcode !== 0) {
      throw new Error(`lame_init_params failed: ${retcode}`);
    }

    const maxSamples = 1152;
    this.mp3bufSize = Math.floor(1.25 * maxSamples + 7200);
    this.mp3buf = new Uint8Array(this.mp3bufSize);
  }

  /**
   * Encode PCM samples to MP3.
   *
   * @param left - Left channel PCM samples (Int16Array)
   * @param right - Right channel PCM samples (Int16Array, optional for mono)
   * @returns Encoded MP3 data
   */
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array {
    if (!right) right = left;

    // Grow buffer if needed
    const neededSize = Math.floor(1.25 * left.length + 7200);
    if (neededSize > this.mp3bufSize) {
      this.mp3bufSize = neededSize;
      this.mp3buf = new Uint8Array(this.mp3bufSize);
    }

    const sz = this.lame.lame_encode_buffer(
      this.gfp, left, right, left.length,
      this.mp3buf, 0, this.mp3bufSize,
    );

    return new Int8Array(this.mp3buf.buffer, 0, sz);
  }

  /**
   * Flush remaining MP3 data.
   *
   * @returns Remaining encoded MP3 data
   */
  flush(): Int8Array {
    const sz = this.lame.lame_encode_flush(
      this.gfp, this.mp3buf, 0, this.mp3bufSize,
    );

    return new Int8Array(this.mp3buf.buffer, 0, sz);
  }
}

/**
 * WAV file header parser.
 */
export class WavHeader {
  channels = 0;
  sampleRate = 0;
  dataLen = 0;
  dataOffset = 0;
  bitsPerSample = 0;

  /**
   * Parse a WAV file header from a DataView.
   *
   * @param dataView - DataView of WAV file data
   * @returns Parsed WavHeader
   */
  static readHeader(dataView: DataView): WavHeader {
    const header = new WavHeader();

    // Check RIFF header
    if (readString(dataView, 0, 4) !== 'RIFF') {
      throw new Error('Invalid WAV file: missing RIFF header');
    }
    if (readString(dataView, 8, 4) !== 'WAVE') {
      throw new Error('Invalid WAV file: missing WAVE header');
    }

    // Find fmt chunk
    let offset = 12;
    while (offset < dataView.byteLength) {
      const chunkId = readString(dataView, offset, 4);
      const chunkSize = dataView.getUint32(offset + 4, true);

      if (chunkId === 'fmt ') {
        header.channels = dataView.getUint16(offset + 10, true);
        header.sampleRate = dataView.getUint32(offset + 12, true);
        header.bitsPerSample = dataView.getUint16(offset + 22, true);
      } else if (chunkId === 'data') {
        header.dataLen = chunkSize;
        header.dataOffset = offset + 8;
        break;
      }

      offset += 8 + chunkSize;
    }

    return header;
  }
}

function readString(dataView: DataView, offset: number, length: number): string {
  let str = '';
  for (let i = 0; i < length; i++) {
    str += String.fromCharCode(dataView.getUint8(offset + i));
  }
  return str;
}
