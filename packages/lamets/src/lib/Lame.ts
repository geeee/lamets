declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

import { new_float, new_int_n, new_short_n, assert } from './common.js';
import {
  ENCDELAY,
  POSTDELAY,
  MDCTDELAY,
  FFTOFFSET,
  BLKSIZE,
  SBMAX_l,
  SBMAX_s,
  PSFB21,
  PSFB12,
  MPG_MD_MS_LR,
} from './constants.js';
import { LameGlobalFlags } from './LameGlobalFlags.js';
import { LameInternalFlags } from './LameInternalFlags.js';
import { Tables } from './Tables.js';
import { VbrMode } from './VbrMode.js';
import { MPEGMode } from './MPEGMode.js';
import { ShortBlock } from './ShortBlock.js';
import { ATH } from './ATH.js';
import { PSY } from './PSY.js';
import { ReplayGain } from './ReplayGain.js';
import { GainAnalysis } from './GainAnalysis.js';
import { PsyModel } from './PsyModel.js';
import { CBRNewIterationLoop } from './CBRNewIterationLoop.js';
import { Encoder } from './Encoder.js';
import { EQ, NEQ } from './BitStream.js';
import type { BitStream } from './BitStream.js';
import type { Presets } from './Presets.js';
import type { QuantizePVT } from './QuantizePVT.js';
import type { Quantize } from './Quantize.js';
import type { VBRTag } from './VBRTag.js';
import type { Version } from './Version.js';

// -----------------------------------------------------------------
// Quality presets
// -----------------------------------------------------------------
const LAME_DEFAULT_QUALITY = 3;

// -----------------------------------------------------------------
// Inner helper classes (not exported)
// -----------------------------------------------------------------

class LowPassHighPass {
  lowerlimit = 0;
}

class BandPass {
  lowpass: number;
  constructor(_bitrate: number, lPass: number) {
    this.lowpass = lPass;
  }
}

class InOut {
  n_in = 0;
  n_out = 0;
}

class NumUsed {
  num_used = 0;
}

// -----------------------------------------------------------------
// Main class
// -----------------------------------------------------------------

export class Lame {
  // ---------------------------------------------------------------
  // Static constants
  // ---------------------------------------------------------------
  static readonly V9 = 410;
  static readonly V8 = 420;
  static readonly V7 = 430;
  static readonly V6 = 440;
  static readonly V5 = 450;
  static readonly V4 = 460;
  static readonly V3 = 470;
  static readonly V2 = 480;
  static readonly V1 = 490;
  static readonly V0 = 500;

  static readonly R3MIX = 1000;
  static readonly STANDARD = 1001;
  static readonly EXTREME = 1002;
  static readonly INSANE = 1003;
  static readonly STANDARD_FAST = 1004;
  static readonly EXTREME_FAST = 1005;
  static readonly MEDIUM = 1006;
  static readonly MEDIUM_FAST = 1007;

  private static readonly LAME_MAXALBUMART = 128 * 1024;
  static readonly LAME_MAXMP3BUFFER = 16384 + Lame.LAME_MAXALBUMART;

  private static readonly LAME_ID = 0xFFF88E3B;

  // ---------------------------------------------------------------
  // Module references (late-bound via init())
  // ---------------------------------------------------------------
  private ga!: GainAnalysis;
  private bs!: BitStream;
  private p!: Presets;
  private qupvt!: QuantizePVT;
  private qu!: Quantize;
  private vbr!: VBRTag;
  private ver!: Version;
  private id3!: { id3tag_write_v2(gfp: LameGlobalFlags): void; id3tag_write_v1(gfp: LameGlobalFlags): void };
  psy: PsyModel = new PsyModel();
  enc: Encoder = new Encoder();

  // ---------------------------------------------------------------
  // init() -- replaces the Java setModules() pattern
  // ---------------------------------------------------------------
  init(
    ga: GainAnalysis,
    bs: BitStream,
    p: Presets,
    qupvt: QuantizePVT,
    qu: Quantize,
    vbr: VBRTag,
    ver: Version,
    id3: { id3tag_write_v2(gfp: LameGlobalFlags): void; id3tag_write_v1(gfp: LameGlobalFlags): void },
    _mpglib?: unknown,
  ): void {
    this.ga = ga;
    this.bs = bs;
    this.p = p;
    this.qupvt = qupvt;
    this.qu = qu;
    this.vbr = vbr;
    this.ver = ver;
    this.id3 = id3;
    this.enc.init(bs, this.psy, qupvt, vbr);
  }

  // ---------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------

  private filter_coef(x: number): number {
    if (x > 1.0) return 0.0;
    if (x <= 0.0) return 1.0;
    return Math.cos((Math.PI / 2) * x);
  }

  private linear_int(a: number, b: number, m: number): number {
    return a + m * (b - a);
  }

  // ---------------------------------------------------------------
  // Public utility methods
  // ---------------------------------------------------------------

  nearestBitrateFullIndex(bitrate: number): number {
    const full_bitrate_table = [
      8, 16, 24, 32, 40, 48, 56, 64, 80,
      96, 112, 128, 160, 192, 224, 256, 320,
    ];

    let lower_range = 0;
    let lower_range_kbps = 0;
    let upper_range = 0;
    let upper_range_kbps = 0;

    upper_range_kbps = full_bitrate_table[16];
    upper_range = 16;
    lower_range_kbps = full_bitrate_table[16];
    lower_range = 16;

    for (let b = 0; b < 16; b++) {
      if (Math.max(bitrate, full_bitrate_table[b + 1]) !== bitrate) {
        upper_range_kbps = full_bitrate_table[b + 1];
        upper_range = b + 1;
        lower_range_kbps = full_bitrate_table[b];
        lower_range = b;
        break;
      }
    }

    if (upper_range_kbps - bitrate > bitrate - lower_range_kbps) {
      return lower_range;
    }
    return upper_range;
  }

  // ---------------------------------------------------------------
  // Frequency / bitrate helpers
  // ---------------------------------------------------------------

  private optimum_samplefreq(lowpassfreq: number, input_samplefreq: number): number {
    let suggested_samplefreq = 44100;

    if (input_samplefreq >= 48000) suggested_samplefreq = 48000;
    else if (input_samplefreq >= 44100) suggested_samplefreq = 44100;
    else if (input_samplefreq >= 32000) suggested_samplefreq = 32000;
    else if (input_samplefreq >= 24000) suggested_samplefreq = 24000;
    else if (input_samplefreq >= 22050) suggested_samplefreq = 22050;
    else if (input_samplefreq >= 16000) suggested_samplefreq = 16000;
    else if (input_samplefreq >= 12000) suggested_samplefreq = 12000;
    else if (input_samplefreq >= 11025) suggested_samplefreq = 11025;
    else if (input_samplefreq >= 8000) suggested_samplefreq = 8000;

    if (lowpassfreq === -1) return suggested_samplefreq;

    if (lowpassfreq <= 15960) suggested_samplefreq = 44100;
    if (lowpassfreq <= 15250) suggested_samplefreq = 32000;
    if (lowpassfreq <= 11220) suggested_samplefreq = 24000;
    if (lowpassfreq <= 9970) suggested_samplefreq = 22050;
    if (lowpassfreq <= 7230) suggested_samplefreq = 16000;
    if (lowpassfreq <= 5420) suggested_samplefreq = 12000;
    if (lowpassfreq <= 4510) suggested_samplefreq = 11025;
    if (lowpassfreq <= 3970) suggested_samplefreq = 8000;

    if (input_samplefreq < suggested_samplefreq) {
      if (input_samplefreq > 44100) return 48000;
      if (input_samplefreq > 32000) return 44100;
      if (input_samplefreq > 24000) return 32000;
      if (input_samplefreq > 22050) return 24000;
      if (input_samplefreq > 16000) return 22050;
      if (input_samplefreq > 12000) return 16000;
      if (input_samplefreq > 11025) return 12000;
      if (input_samplefreq > 8000) return 11025;
      return 8000;
    }
    return suggested_samplefreq;
  }

  /**
   * Convert samp freq in Hz to index
   */
  SmpFrqIndex(sample_freq: number, gpf: LameGlobalFlags): number {
    switch (sample_freq) {
      case 44100:
        gpf.setMpegVersion(1);
        return 0;
      case 48000:
        gpf.setMpegVersion(1);
        return 1;
      case 32000:
        gpf.setMpegVersion(1);
        return 2;
      case 22050:
        gpf.setMpegVersion(0);
        return 0;
      case 24000:
        gpf.setMpegVersion(0);
        return 1;
      case 16000:
        gpf.setMpegVersion(0);
        return 2;
      case 11025:
        gpf.setMpegVersion(0);
        return 0;
      case 12000:
        gpf.setMpegVersion(0);
        return 1;
      case 8000:
        gpf.setMpegVersion(0);
        return 2;
      default:
        gpf.setMpegVersion(0);
        return -1;
    }
  }

  private FindNearestBitrate(bRate: number, version: number, samplerate: number): number {
    if (samplerate < 16000) version = 2;

    let bitrate = Tables.bitrate_table[version][1];

    for (let i = 2; i <= 14; i++) {
      if (Tables.bitrate_table[version][i] > 0) {
        if (Math.abs(Tables.bitrate_table[version][i] - bRate) < Math.abs(bitrate - bRate)) {
          bitrate = Tables.bitrate_table[version][i];
        }
      }
    }
    return bitrate;
  }

  BitrateIndex(bRate: number, version: number, samplerate: number): number {
    if (samplerate < 16000) version = 2;
    for (let i = 0; i <= 14; i++) {
      if (Tables.bitrate_table[version][i] > 0) {
        if (Tables.bitrate_table[version][i] === bRate) {
          return i;
        }
      }
    }
    return -1;
  }

  private map2MP3Frequency(freq: number): number {
    if (freq <= 8000) return 8000;
    if (freq <= 11025) return 11025;
    if (freq <= 12000) return 12000;
    if (freq <= 16000) return 16000;
    if (freq <= 22050) return 22050;
    if (freq <= 24000) return 24000;
    if (freq <= 32000) return 32000;
    if (freq <= 44100) return 44100;
    return 48000;
  }

  private optimum_bandwidth(lh: LowPassHighPass, bitrate: number): void {
    const freq_map: BandPass[] = [
      new BandPass(8, 2000),
      new BandPass(16, 3700),
      new BandPass(24, 3900),
      new BandPass(32, 5500),
      new BandPass(40, 7000),
      new BandPass(48, 7500),
      new BandPass(56, 10000),
      new BandPass(64, 11000),
      new BandPass(80, 13500),
      new BandPass(96, 15100),
      new BandPass(112, 15600),
      new BandPass(128, 17000),
      new BandPass(160, 17500),
      new BandPass(192, 18600),
      new BandPass(224, 19400),
      new BandPass(256, 19700),
      new BandPass(320, 20500),
    ];

    const table_index = this.nearestBitrateFullIndex(bitrate);
    lh.lowerlimit = freq_map[table_index].lowpass;
  }

  // ---------------------------------------------------------------
  // Polyphase filter parameter init
  // ---------------------------------------------------------------

  private lame_init_params_ppflt(gfp: LameGlobalFlags): void {
    const gfc = gfp.internal_flags!;

    let lowpass_band = 32;
    let highpass_band = -1;

    if (gfc.lowpass1 > 0) {
      let minband = 999;
      for (let band = 0; band <= 31; band++) {
        const freq = band / 31.0;
        if (freq >= gfc.lowpass2) {
          lowpass_band = Math.min(lowpass_band, band);
        }
        if (gfc.lowpass1 < freq && freq < gfc.lowpass2) {
          minband = Math.min(minband, band);
        }
      }

      if (minband === 999) {
        gfc.lowpass1 = (lowpass_band - 0.75) / 31.0;
      } else {
        gfc.lowpass1 = (minband - 0.75) / 31.0;
      }
      gfc.lowpass2 = lowpass_band / 31.0;
    }

    if (gfc.highpass2 > 0) {
      if (gfc.highpass2 < 0.9 * (0.75 / 31.0)) {
        gfc.highpass1 = 0;
        gfc.highpass2 = 0;
        console.error("Warning: highpass filter disabled.  highpass frequency too small\n");
      }
    }

    if (gfc.highpass2 > 0) {
      let maxband = -1;
      for (let band = 0; band <= 31; band++) {
        const freq = band / 31.0;
        if (freq <= gfc.highpass1) {
          highpass_band = Math.max(highpass_band, band);
        }
        if (gfc.highpass1 < freq && freq < gfc.highpass2) {
          maxband = Math.max(maxband, band);
        }
      }

      gfc.highpass1 = highpass_band / 31.0;
      if (maxband === -1) {
        gfc.highpass2 = (highpass_band + 0.75) / 31.0;
      } else {
        gfc.highpass2 = (maxband + 0.75) / 31.0;
      }
    }

    for (let band = 0; band < 32; band++) {
      let fc1: number;
      let fc2: number;
      const freq = band / 31.0;
      if (gfc.highpass2 > gfc.highpass1) {
        fc1 = this.filter_coef(
          (gfc.highpass2 - freq) / (gfc.highpass2 - gfc.highpass1 + 1e-20),
        );
      } else {
        fc1 = 1.0;
      }
      if (gfc.lowpass2 > gfc.lowpass1) {
        fc2 = this.filter_coef(
          (freq - gfc.lowpass1) / (gfc.lowpass2 - gfc.lowpass1 + 1e-20),
        );
      } else {
        fc2 = 1.0;
      }
      gfc.amp_filter[band] = fc1 * fc2;
    }
  }

  // ---------------------------------------------------------------
  // Quality settings
  // ---------------------------------------------------------------

  private lame_init_qval(gfp: LameGlobalFlags): void {
    const gfc = gfp.internal_flags!;

    switch (gfp.getQuality()) {
      default:
      case 9:
        gfc.psymodel = 0;
        gfc.noise_shaping = 0;
        gfc.noise_shaping_amp = 0;
        gfc.noise_shaping_stop = 0;
        gfc.use_best_huffman = 0;
        gfc.full_outer_loop = 0;
        break;

      case 8:
        gfp.setQuality(7);
      // falls through
      case 7:
        gfc.psymodel = 1;
        gfc.noise_shaping = 0;
        gfc.noise_shaping_amp = 0;
        gfc.noise_shaping_stop = 0;
        gfc.use_best_huffman = 0;
        gfc.full_outer_loop = 0;
        break;

      case 6:
        gfc.psymodel = 1;
        if (gfc.noise_shaping === 0) gfc.noise_shaping = 1;
        gfc.noise_shaping_amp = 0;
        gfc.noise_shaping_stop = 0;
        if (gfc.subblock_gain === -1) gfc.subblock_gain = 1;
        gfc.use_best_huffman = 0;
        gfc.full_outer_loop = 0;
        break;

      case 5:
        gfc.psymodel = 1;
        if (gfc.noise_shaping === 0) gfc.noise_shaping = 1;
        gfc.noise_shaping_amp = 0;
        gfc.noise_shaping_stop = 0;
        if (gfc.subblock_gain === -1) gfc.subblock_gain = 1;
        gfc.use_best_huffman = 0;
        gfc.full_outer_loop = 0;
        break;

      case 4:
        gfc.psymodel = 1;
        if (gfc.noise_shaping === 0) gfc.noise_shaping = 1;
        gfc.noise_shaping_amp = 0;
        gfc.noise_shaping_stop = 0;
        if (gfc.subblock_gain === -1) gfc.subblock_gain = 1;
        gfc.use_best_huffman = 1;
        gfc.full_outer_loop = 0;
        break;

      case 3:
        gfc.psymodel = 1;
        if (gfc.noise_shaping === 0) gfc.noise_shaping = 1;
        gfc.noise_shaping_amp = 1;
        gfc.noise_shaping_stop = 1;
        if (gfc.subblock_gain === -1) gfc.subblock_gain = 1;
        gfc.use_best_huffman = 1;
        gfc.full_outer_loop = 0;
        break;

      case 2:
        gfc.psymodel = 1;
        if (gfc.noise_shaping === 0) gfc.noise_shaping = 1;
        if (gfc.substep_shaping === 0) gfc.substep_shaping = 2;
        gfc.noise_shaping_amp = 1;
        gfc.noise_shaping_stop = 1;
        if (gfc.subblock_gain === -1) gfc.subblock_gain = 1;
        gfc.use_best_huffman = 1;
        gfc.full_outer_loop = 0;
        break;

      case 1:
        gfc.psymodel = 1;
        if (gfc.noise_shaping === 0) gfc.noise_shaping = 1;
        if (gfc.substep_shaping === 0) gfc.substep_shaping = 2;
        gfc.noise_shaping_amp = 2;
        gfc.noise_shaping_stop = 1;
        if (gfc.subblock_gain === -1) gfc.subblock_gain = 1;
        gfc.use_best_huffman = 1;
        gfc.full_outer_loop = 0;
        break;

      case 0:
        gfc.psymodel = 1;
        if (gfc.noise_shaping === 0) gfc.noise_shaping = 1;
        if (gfc.substep_shaping === 0) gfc.substep_shaping = 2;
        gfc.noise_shaping_amp = 2;
        gfc.noise_shaping_stop = 1;
        if (gfc.subblock_gain === -1) gfc.subblock_gain = 1;
        gfc.use_best_huffman = 1;
        gfc.full_outer_loop = 0;
        break;
    }
  }

  // ---------------------------------------------------------------
  // Bitstream init
  // ---------------------------------------------------------------

  private lame_init_bitstream(gfp: LameGlobalFlags): void {
    const gfc = gfp.internal_flags!;
    gfp.frameNum = 0;

    if (gfp.isWriteId3tagAutomatic()) {
      this.id3.id3tag_write_v2(gfp);
    }

    gfc.bitrate_stereoMode_Hist = new_int_n(16, 4 + 1) as Int32Array[];
    gfc.bitrate_blockType_Hist = new_int_n(16, 4 + 1 + 1) as Int32Array[];

    gfc.PeakSample = 0.0;

    if (gfp.bWriteVbrTag) this.vbr.InitVbrTag(gfp);
  }

  // ---------------------------------------------------------------
  // lame_init_old -- set all defaults
  // ---------------------------------------------------------------

  private lame_init_old(gfp: LameGlobalFlags): number {
    let gfc: LameInternalFlags;

    gfp.class_id = Lame.LAME_ID;

    gfc = gfp.internal_flags = new LameInternalFlags();

    gfp.setMode(MPEGMode.NOT_SET);
    gfp.original = 1;
    gfp.setInSampleRate(44100);
    gfp.setInNumChannels(2);
    gfp.num_samples = -1;

    gfp.bWriteVbrTag = true;
    gfp.setQuality(-1);
    gfp.short_blocks = null;
    gfc.subblock_gain = -1;

    gfp.lowpassfreq = 0;
    gfp.highpassfreq = 0;
    gfp.lowpasswidth = -1;
    gfp.highpasswidth = -1;

    gfp.setVBR(VbrMode.vbr_off);
    gfp.setVBRQuality(4);
    gfp.ATHcurve = -1;
    gfp.VBR_mean_bitrate_kbps = 128;
    gfp.VBR_min_bitrate_kbps = 0;
    gfp.VBR_max_bitrate_kbps = 0;
    gfp.VBR_hard_min = 0;
    gfc.VBR_min_bitrate = 1;
    gfc.VBR_max_bitrate = 13;

    gfp.quant_comp = -1;
    gfp.quant_comp_short = -1;

    gfp.msfix = -1;

    gfc.resample_ratio = 1;

    gfc.OldValue[0] = 180;
    gfc.OldValue[1] = 180;
    gfc.CurrentStep[0] = 4;
    gfc.CurrentStep[1] = 4;
    gfc.masking_lower = 1;
    gfc.nsPsy.attackthre = -1;
    gfc.nsPsy.attackthre_s = -1;

    gfp.scale = -1;

    gfp.athaa_type = -1;
    gfp.ATHtype = -1;
    gfp.athaa_loudapprox = -1;
    gfp.athaa_sensitivity = 0.0;
    gfp.useTemporal = null;
    gfp.interChRatio = -1;

    gfc.mf_samples_to_encode = ENCDELAY + POSTDELAY;
    gfp.encoder_padding = 0;
    gfc.mf_size = ENCDELAY - MDCTDELAY;

    gfp.setFindReplayGain(false);
    gfp.decode_on_the_fly = false;

    gfc.decode_on_the_fly = false;
    gfc.findReplayGain = false;
    gfc.findPeakSample = false;

    gfc.RadioGain = 0;
    gfc.AudiophileGain = 0;
    gfc.noclipGainChange = 0;
    gfc.noclipScale = -1.0;

    gfp.preset = 0;

    gfp.setWriteId3tagAutomatic(true);
    return 0;
  }

  // ---------------------------------------------------------------
  // lame_init -- public entry: create & return new LameGlobalFlags
  // ---------------------------------------------------------------

  lame_init(): LameGlobalFlags {
    const gfp = new LameGlobalFlags();

    const ret = this.lame_init_old(gfp);
    if (ret !== 0) {
      return null!;
    }

    gfp.lame_allocated_gfp = 1;
    return gfp;
  }

  // ---------------------------------------------------------------
  // lame_init_params -- the big param configuration method
  // ---------------------------------------------------------------

  lame_init_params(gfp: LameGlobalFlags): number {
    const gfc = gfp.internal_flags!;

    gfc.Class_ID = 0;
    if (gfc.ATH == null) gfc.ATH = new ATH();
    if (gfc.PSY == null) gfc.PSY = new PSY();
    if (gfc.rgdata == null) gfc.rgdata = new ReplayGain();

    gfc.channels_in = gfp.getInNumChannels();
    if (gfc.channels_in === 1) gfp.setMode(MPEGMode.MONO);
    gfc.channels_out = gfp.getMode() === MPEGMode.MONO ? 1 : 2;
    gfc.mode_ext = MPG_MD_MS_LR;
    if (gfp.getMode() === MPEGMode.MONO) gfp.force_ms = false;

    if (
      gfp.getVBR() === VbrMode.vbr_off &&
      gfp.VBR_mean_bitrate_kbps !== 128 &&
      gfp.getBitRate() === 0
    ) {
      gfp.setBitRate(gfp.VBR_mean_bitrate_kbps);
    }

    if (
      gfp.getVBR() === VbrMode.vbr_off ||
      gfp.getVBR() === VbrMode.vbr_mtrh ||
      gfp.getVBR() === VbrMode.vbr_mt
    ) {
      /* these modes can handle free format condition */
    } else {
      gfp.free_format = false;
    }

    if (gfp.getVBR() === VbrMode.vbr_off && gfp.getBitRate() === 0) {
      if (EQ(gfp.compression_ratio, 0)) gfp.compression_ratio = 11.025;
    }

    if (gfp.getVBR() === VbrMode.vbr_off && gfp.compression_ratio > 0) {
      if (gfp.getOutSampleRate() === 0) {
        gfp.setOutSampleRate(
          this.map2MP3Frequency((0.97 * gfp.getInSampleRate()) | 0),
        );
      }

      gfp.setBitRate(
        (gfp.getOutSampleRate() * 16 * gfc.channels_out /
          (1.0e3 * gfp.compression_ratio)) |
          0,
      );

      gfc.samplerate_index = this.SmpFrqIndex(gfp.getOutSampleRate(), gfp);

      if (!gfp.free_format) {
        gfp.setBitRate(
          this.FindNearestBitrate(
            gfp.getBitRate(),
            gfp.getMpegVersion(),
            gfp.getOutSampleRate(),
          ),
        );
      }
    }

    if (gfp.getOutSampleRate() !== 0) {
      if (gfp.getOutSampleRate() < 16000) {
        gfp.VBR_mean_bitrate_kbps = Math.max(gfp.VBR_mean_bitrate_kbps, 8);
        gfp.VBR_mean_bitrate_kbps = Math.min(gfp.VBR_mean_bitrate_kbps, 64);
      } else if (gfp.getOutSampleRate() < 32000) {
        gfp.VBR_mean_bitrate_kbps = Math.max(gfp.VBR_mean_bitrate_kbps, 8);
        gfp.VBR_mean_bitrate_kbps = Math.min(gfp.VBR_mean_bitrate_kbps, 160);
      } else {
        gfp.VBR_mean_bitrate_kbps = Math.max(gfp.VBR_mean_bitrate_kbps, 32);
        gfp.VBR_mean_bitrate_kbps = Math.min(gfp.VBR_mean_bitrate_kbps, 320);
      }
    }

    /* ************************************************************
     * if a filter has not been enabled, see if we should add one
     * ************************************************************/
    if (gfp.lowpassfreq === 0) {
      let lowpass = 16000;

      switch (gfp.getVBR()) {
        case VbrMode.vbr_off: {
          const lh = new LowPassHighPass();
          this.optimum_bandwidth(lh, gfp.getBitRate());
          lowpass = lh.lowerlimit;
          break;
        }
        case VbrMode.vbr_abr: {
          const lh = new LowPassHighPass();
          this.optimum_bandwidth(lh, gfp.VBR_mean_bitrate_kbps);
          lowpass = lh.lowerlimit;
          break;
        }
        case VbrMode.vbr_rh: {
          const x = [
            19500, 19000, 18600, 18000, 17500, 16000, 15600, 14900, 12500,
            10000, 3950,
          ];
          if (0 <= gfp.getVBRQuality() && gfp.getVBRQuality() <= 9) {
            const a = x[gfp.getVBRQuality()];
            const b = x[gfp.getVBRQuality() + 1];
            const m = gfp.VBR_q_frac;
            lowpass = this.linear_int(a, b, m);
          } else {
            lowpass = 19500;
          }
          break;
        }
        default: {
          const x = [
            19500, 19000, 18500, 18000, 17500, 16500, 15500, 14500, 12500,
            9500, 3950,
          ];
          if (0 <= gfp.getVBRQuality() && gfp.getVBRQuality() <= 9) {
            const a = x[gfp.getVBRQuality()];
            const b = x[gfp.getVBRQuality() + 1];
            const m = gfp.VBR_q_frac;
            lowpass = this.linear_int(a, b, m);
          } else {
            lowpass = 19500;
          }
        }
      }
      if (
        gfp.getMode() === MPEGMode.MONO &&
        (gfp.getVBR() === VbrMode.vbr_off || gfp.getVBR() === VbrMode.vbr_abr)
      ) {
        lowpass *= 1.5;
      }

      gfp.lowpassfreq = lowpass | 0;
    }

    if (gfp.getOutSampleRate() === 0) {
      if (2 * gfp.lowpassfreq > gfp.getInSampleRate()) {
        gfp.lowpassfreq = (gfp.getInSampleRate() / 2) | 0;
      }
      gfp.setOutSampleRate(
        this.optimum_samplefreq(gfp.lowpassfreq | 0, gfp.getInSampleRate()),
      );
    }

    gfp.lowpassfreq = Math.min(20500, gfp.lowpassfreq);
    gfp.lowpassfreq = Math.min((gfp.getOutSampleRate() / 2) | 0, gfp.lowpassfreq);

    if (gfp.getVBR() === VbrMode.vbr_off) {
      gfp.compression_ratio =
        (gfp.getOutSampleRate() * 16 * gfc.channels_out) /
        (1.0e3 * gfp.getBitRate());
    }
    if (gfp.getVBR() === VbrMode.vbr_abr) {
      gfp.compression_ratio =
        (gfp.getOutSampleRate() * 16 * gfc.channels_out) /
        (1.0e3 * gfp.VBR_mean_bitrate_kbps);
    }

    if (!gfp.bWriteVbrTag) {
      gfp.setFindReplayGain(false);
      gfp.decode_on_the_fly = false;
      gfc.findPeakSample = false;
    }
    gfc.findReplayGain = gfp.isFindReplayGain();
    gfc.decode_on_the_fly = gfp.decode_on_the_fly;

    if (gfc.decode_on_the_fly) gfc.findPeakSample = true;

    if (gfc.findReplayGain) {
      if (
        this.ga.InitGainAnalysis(gfc.rgdata!, gfp.getOutSampleRate()) ===
        GainAnalysis.INIT_GAIN_ANALYSIS_ERROR
      ) {
        gfp.internal_flags = null;
        return -6;
      }
    }

    if (gfc.decode_on_the_fly && !gfp.decode_only) {
      /* mpglib decoder not ported -- stub */
    }

    gfc.mode_gr = gfp.getOutSampleRate() <= 24000 ? 1 : 2;
    gfp.setFrameSize(576 * gfc.mode_gr);
    gfp.setEncoderDelay(ENCDELAY);

    gfc.resample_ratio = gfp.getInSampleRate() / gfp.getOutSampleRate();

    /* For VBR, take a guess at the compression_ratio */
    switch (gfp.getVBR()) {
      case VbrMode.vbr_mt:
      case VbrMode.vbr_rh:
      case VbrMode.vbr_mtrh: {
        const cmp = [5.7, 6.5, 7.3, 8.2, 10, 11.9, 13, 14, 15, 16.5];
        gfp.compression_ratio = cmp[gfp.getVBRQuality()];
        break;
      }
      case VbrMode.vbr_abr:
        gfp.compression_ratio =
          (gfp.getOutSampleRate() * 16 * gfc.channels_out) /
          (1.0e3 * gfp.VBR_mean_bitrate_kbps);
        break;
      default:
        gfp.compression_ratio =
          (gfp.getOutSampleRate() * 16 * gfc.channels_out) /
          (1.0e3 * gfp.getBitRate());
        break;
    }

    if (gfp.getMode() === MPEGMode.NOT_SET) {
      gfp.setMode(MPEGMode.JOINT_STEREO);
    }

    /* apply user driven high pass filter */
    if (gfp.highpassfreq > 0) {
      gfc.highpass1 = 2.0 * gfp.highpassfreq;

      if (gfp.highpasswidth >= 0) {
        gfc.highpass2 = 2.0 * (gfp.highpassfreq + gfp.highpasswidth);
      } else {
        gfc.highpass2 = (1 + 0.0) * 2.0 * gfp.highpassfreq;
      }

      gfc.highpass1 /= gfp.getOutSampleRate();
      gfc.highpass2 /= gfp.getOutSampleRate();
    } else {
      gfc.highpass1 = 0;
      gfc.highpass2 = 0;
    }

    /* apply user driven low pass filter */
    if (gfp.lowpassfreq > 0) {
      gfc.lowpass2 = 2.0 * gfp.lowpassfreq;
      if (gfp.lowpasswidth >= 0) {
        gfc.lowpass1 = 2.0 * (gfp.lowpassfreq - gfp.lowpasswidth);
        if (gfc.lowpass1 < 0) gfc.lowpass1 = 0;
      } else {
        gfc.lowpass1 = (1 - 0.0) * 2.0 * gfp.lowpassfreq;
      }
      gfc.lowpass1 /= gfp.getOutSampleRate();
      gfc.lowpass2 /= gfp.getOutSampleRate();
    } else {
      gfc.lowpass1 = 0;
      gfc.lowpass2 = 0;
    }

    /* ************************************************************
     * compute info needed for polyphase filter
     * ************************************************************/
    this.lame_init_params_ppflt(gfp);

    /* *****************************************************
     * samplerate and bitrate index
     * *****************************************************/
    gfc.samplerate_index = this.SmpFrqIndex(gfp.getOutSampleRate(), gfp);
    if (gfc.samplerate_index < 0) {
      gfp.internal_flags = null;
      return -1;
    }

    if (gfp.getVBR() === VbrMode.vbr_off) {
      if (gfp.free_format) {
        gfc.bitrate_index = 0;
      } else {
        gfp.setBitRate(
          this.FindNearestBitrate(
            gfp.getBitRate(),
            gfp.getMpegVersion(),
            gfp.getOutSampleRate(),
          ),
        );
        gfc.bitrate_index = this.BitrateIndex(
          gfp.getBitRate(),
          gfp.getMpegVersion(),
          gfp.getOutSampleRate(),
        );
        if (gfc.bitrate_index <= 0) {
          gfp.internal_flags = null;
          return -1;
        }
      }
    } else {
      gfc.bitrate_index = 1;
    }

    /* for CBR, we will write an "info" tag. */
    if (gfp.analysis) gfp.bWriteVbrTag = false;

    if (gfc.pinfo != null) gfp.bWriteVbrTag = false;

    this.bs.init_bit_stream_w(gfc);

    const j =
      gfc.samplerate_index +
      3 * gfp.getMpegVersion() +
      6 * (gfp.getOutSampleRate() < 16000 ? 1 : 0);
    for (let i = 0; i < SBMAX_l + 1; i++) {
      gfc.scalefac_band.l[i] = this.qupvt.sfBandIndex[j].l[i];
    }

    for (let i = 0; i < PSFB21 + 1; i++) {
      const size =
        ((gfc.scalefac_band.l[22] - gfc.scalefac_band.l[21]) / PSFB21) | 0;
      const start = gfc.scalefac_band.l[21] + i * size;
      gfc.scalefac_band.psfb21[i] = start;
    }
    gfc.scalefac_band.psfb21[PSFB21] = 576;

    for (let i = 0; i < SBMAX_s + 1; i++) {
      gfc.scalefac_band.s[i] = this.qupvt.sfBandIndex[j].s[i];
    }

    for (let i = 0; i < PSFB12 + 1; i++) {
      const size =
        ((gfc.scalefac_band.s[13] - gfc.scalefac_band.s[12]) / PSFB12) | 0;
      const start = gfc.scalefac_band.s[12] + i * size;
      gfc.scalefac_band.psfb12[i] = start;
    }
    gfc.scalefac_band.psfb12[PSFB12] = 192;

    /* determine the mean bitrate for main data */
    if (gfp.getMpegVersion() === 1) {
      /* MPEG 1 */
      gfc.sideinfo_len = gfc.channels_out === 1 ? 4 + 17 : 4 + 32;
    } else {
      /* MPEG 2 */
      gfc.sideinfo_len = gfc.channels_out === 1 ? 4 + 9 : 4 + 17;
    }

    if (gfp.error_protection) gfc.sideinfo_len += 2;

    this.lame_init_bitstream(gfp);

    gfc.Class_ID = Lame.LAME_ID;

    {
      let k: number;
      for (k = 0; k < 19; k++) {
        gfc.nsPsy.pefirbuf[k] = 700 * gfc.mode_gr * gfc.channels_out;
      }

      if (gfp.ATHtype === -1) gfp.ATHtype = 4;
    }

    assert(gfp.getVBRQuality() <= 9);
    assert(gfp.getVBRQuality() >= 0);

    switch (gfp.getVBR()) {
      case VbrMode.vbr_mt:
        gfp.setVBR(VbrMode.vbr_mtrh);
      // falls through
      case VbrMode.vbr_mtrh: {
        if (gfp.useTemporal == null) {
          gfp.useTemporal = false;
        }

        this.p.apply_preset(gfp, 500 - gfp.getVBRQuality() * 10, 0);

        if (gfp.getQuality() < 0) gfp.setQuality(LAME_DEFAULT_QUALITY);
        if (gfp.getQuality() < 5) gfp.setQuality(0);
        if (gfp.getQuality() > 5) gfp.setQuality(5);

        gfc.PSY!.mask_adjust = gfp.maskingadjust;
        gfc.PSY!.mask_adjust_short = gfp.maskingadjust_short;

        if (gfp.experimentalY) gfc.sfb21_extra = false;
        else gfc.sfb21_extra = gfp.getOutSampleRate() > 44000;

        /* VBRNewIterationLoop not yet ported -- use CBR as fallback */
        gfc.iteration_loop = new CBRNewIterationLoop(this.qu);
        break;
      }

      case VbrMode.vbr_rh: {
        this.p.apply_preset(gfp, 500 - gfp.getVBRQuality() * 10, 0);

        gfc.PSY!.mask_adjust = gfp.maskingadjust;
        gfc.PSY!.mask_adjust_short = gfp.maskingadjust_short;

        if (gfp.experimentalY) gfc.sfb21_extra = false;
        else gfc.sfb21_extra = gfp.getOutSampleRate() > 44000;

        if (gfp.getQuality() > 6) gfp.setQuality(6);
        if (gfp.getQuality() < 0) gfp.setQuality(LAME_DEFAULT_QUALITY);

        /* VBROldIterationLoop not yet ported -- use CBR as fallback */
        gfc.iteration_loop = new CBRNewIterationLoop(this.qu);
        break;
      }

      default: {
        /* cbr / abr */
        gfc.sfb21_extra = false;

        if (gfp.getQuality() < 0) gfp.setQuality(LAME_DEFAULT_QUALITY);

        const vbrmode = gfp.getVBR();
        if (vbrmode === VbrMode.vbr_off) {
          gfp.VBR_mean_bitrate_kbps = gfp.getBitRate();
        }
        this.p.apply_preset(gfp, gfp.VBR_mean_bitrate_kbps, 0);
        gfp.setVBR(vbrmode);

        gfc.PSY!.mask_adjust = gfp.maskingadjust;
        gfc.PSY!.mask_adjust_short = gfp.maskingadjust_short;

        if (vbrmode === VbrMode.vbr_off) {
          gfc.iteration_loop = new CBRNewIterationLoop(this.qu);
        } else {
          /* ABRIterationLoop not yet ported -- use CBR as fallback */
          gfc.iteration_loop = new CBRNewIterationLoop(this.qu);
        }
        break;
      }
    }

    /* initialize default values common for all modes */
    if (gfp.getVBR() !== VbrMode.vbr_off) {
      gfc.VBR_min_bitrate = 1;
      gfc.VBR_max_bitrate = 14;
      if (gfp.getOutSampleRate() < 16000) gfc.VBR_max_bitrate = 8;

      if (gfp.VBR_min_bitrate_kbps !== 0) {
        gfp.VBR_min_bitrate_kbps = this.FindNearestBitrate(
          gfp.VBR_min_bitrate_kbps,
          gfp.getMpegVersion(),
          gfp.getOutSampleRate(),
        );
        gfc.VBR_min_bitrate = this.BitrateIndex(
          gfp.VBR_min_bitrate_kbps,
          gfp.getMpegVersion(),
          gfp.getOutSampleRate(),
        );
        if (gfc.VBR_min_bitrate < 0) return -1;
      }
      if (gfp.VBR_max_bitrate_kbps !== 0) {
        gfp.VBR_max_bitrate_kbps = this.FindNearestBitrate(
          gfp.VBR_max_bitrate_kbps,
          gfp.getMpegVersion(),
          gfp.getOutSampleRate(),
        );
        gfc.VBR_max_bitrate = this.BitrateIndex(
          gfp.VBR_max_bitrate_kbps,
          gfp.getMpegVersion(),
          gfp.getOutSampleRate(),
        );
        if (gfc.VBR_max_bitrate < 0) return -1;
      }
      gfp.VBR_min_bitrate_kbps =
        Tables.bitrate_table[gfp.getMpegVersion()][gfc.VBR_min_bitrate];
      gfp.VBR_max_bitrate_kbps =
        Tables.bitrate_table[gfp.getMpegVersion()][gfc.VBR_max_bitrate];
      gfp.VBR_mean_bitrate_kbps = Math.min(
        Tables.bitrate_table[gfp.getMpegVersion()][gfc.VBR_max_bitrate],
        gfp.VBR_mean_bitrate_kbps,
      );
      gfp.VBR_mean_bitrate_kbps = Math.max(
        Tables.bitrate_table[gfp.getMpegVersion()][gfc.VBR_min_bitrate],
        gfp.VBR_mean_bitrate_kbps,
      );
    }

    /* developer tune */
    if (gfp.tune) {
      gfc.PSY!.mask_adjust += gfp.tune_value_a;
      gfc.PSY!.mask_adjust_short += gfp.tune_value_a;
    }

    /* initialize internal qval settings */
    this.lame_init_qval(gfp);

    if (gfp.athaa_type < 0) gfc.ATH!.useAdjust = 3;
    else gfc.ATH!.useAdjust = gfp.athaa_type;

    /* initialize internal adaptive ATH settings */
    gfc.ATH!.aaSensitivityP = Math.pow(10.0, gfp.athaa_sensitivity / -10.0);

    if (gfp.short_blocks == null) {
      gfp.short_blocks = ShortBlock.short_block_allowed;
    }

    if (
      gfp.short_blocks === ShortBlock.short_block_allowed &&
      (gfp.getMode() === MPEGMode.JOINT_STEREO ||
        gfp.getMode() === MPEGMode.STEREO)
    ) {
      gfp.short_blocks = ShortBlock.short_block_coupled;
    }

    if (gfp.quant_comp < 0) gfp.quant_comp = 1;
    if (gfp.quant_comp_short < 0) gfp.quant_comp_short = 0;

    if (gfp.msfix < 0) gfp.msfix = 0;

    /* select psychoacoustic model */
    gfp.exp_nspsytune = gfp.exp_nspsytune | 1;

    if (gfp.internal_flags!.nsPsy.attackthre < 0)
      gfp.internal_flags!.nsPsy.attackthre = PsyModel.NSATTACKTHRE;
    if (gfp.internal_flags!.nsPsy.attackthre_s < 0)
      gfp.internal_flags!.nsPsy.attackthre_s = PsyModel.NSATTACKTHRE_S;

    if (gfp.scale < 0) gfp.scale = 1;

    if (gfp.ATHtype < 0) gfp.ATHtype = 4;

    if (gfp.ATHcurve < 0) gfp.ATHcurve = 4;

    if (gfp.athaa_loudapprox < 0) gfp.athaa_loudapprox = 2;

    if (gfp.interChRatio < 0) gfp.interChRatio = 0;

    if (gfp.useTemporal == null) gfp.useTemporal = true;

    /* padding method */
    gfc.slot_lag = gfc.frac_SpF = 0;
    if (gfp.getVBR() === VbrMode.vbr_off) {
      gfc.slot_lag = gfc.frac_SpF =
        (((gfp.getMpegVersion() + 1) * 72000 * gfp.getBitRate()) %
          gfp.getOutSampleRate()) |
        0;
    }

    this.qupvt.iteration_init(gfp);
    this.psy.psymodel_init(gfp);

    return 0;
  }

  // ---------------------------------------------------------------
  // Resampling helpers
  // ---------------------------------------------------------------

  private gcd(i: number, j: number): number {
    return j !== 0 ? this.gcd(j, i % j) : i;
  }

  private blackman(x: number, fcn: number, l: number): number {
    const wcn = Math.PI * fcn;

    x /= l;
    if (x < 0) x = 0;
    if (x > 1) x = 1;
    const x2 = x - 0.5;

    const bkwn =
      0.42 - 0.5 * Math.cos(2 * x * Math.PI) + 0.08 * Math.cos(4 * x * Math.PI);
    if (Math.abs(x2) < 1e-9) return wcn / Math.PI;
    else return (bkwn * Math.sin(l * wcn * x2)) / (Math.PI * l * x2);
  }

  private fill_buffer_resample(
    gfp: LameGlobalFlags,
    outbuf: Float32Array,
    outbufPos: number,
    desired_len: number,
    inbuf: Float32Array,
    in_bufferPos: number,
    len: number,
    num_used: NumUsed,
    ch: number,
  ): number {
    const gfc = gfp.internal_flags!;
    let i: number;
    let j = 0;
    let k: number;

    let bpc =
      (gfp.getOutSampleRate() /
        this.gcd(gfp.getOutSampleRate(), gfp.getInSampleRate())) |
      0;
    if (bpc > LameInternalFlags.BPC) bpc = LameInternalFlags.BPC;

    const intratio =
      Math.abs(gfc.resample_ratio - Math.floor(0.5 + gfc.resample_ratio)) <
      0.0001
        ? 1
        : 0;
    let fcn = 1.0 / gfc.resample_ratio;
    if (fcn > 1.0) fcn = 1.0;
    let filter_l = 31;
    if (filter_l % 2 === 0) --filter_l;
    filter_l += intratio;

    const BLACKSIZE = filter_l + 1;

    if (gfc.fill_buffer_resample_init === 0) {
      gfc.inbuf_old[0] = new_float(BLACKSIZE);
      gfc.inbuf_old[1] = new_float(BLACKSIZE);
      for (i = 0; i <= 2 * bpc; ++i) {
        gfc.blackfilt[i] = new_float(BLACKSIZE);
      }

      gfc.itime[0] = 0;
      gfc.itime[1] = 0;

      for (j = 0; j <= 2 * bpc; j++) {
        let sum = 0;
        const offset = (j - bpc) / (2.0 * bpc);
        for (i = 0; i <= filter_l; i++) {
          sum += gfc.blackfilt[j]![i] = this.blackman(i - offset, fcn, filter_l);
        }
        for (i = 0; i <= filter_l; i++) {
          gfc.blackfilt[j]![i] /= sum;
        }
      }
      gfc.fill_buffer_resample_init = 1;
    }

    const inbuf_old = gfc.inbuf_old[ch]!;

    for (k = 0; k < desired_len; k++) {
      let time0: number;
      let joff: number;

      time0 = k * gfc.resample_ratio;
      j = Math.floor(time0 - gfc.itime[ch]) | 0;

      if (filter_l + j - ((filter_l / 2) | 0) >= len) break;

      const offset = time0 - gfc.itime[ch] - (j + 0.5 * (filter_l % 2));
      assert(Math.abs(offset) <= 0.501);

      joff = Math.floor(offset * 2 * bpc + bpc + 0.5) | 0;

      let xvalue = 0;
      for (i = 0; i <= filter_l; ++i) {
        const j2 = (i + j - ((filter_l / 2) | 0)) | 0;
        let y: number;
        assert(j2 < len);
        assert(j2 + BLACKSIZE >= 0);
        y =
          j2 < 0
            ? inbuf_old[BLACKSIZE + j2]
            : inbuf[in_bufferPos + j2];
        xvalue += y * gfc.blackfilt[joff]![i];
      }
      outbuf[outbufPos + k] = xvalue;
    }

    num_used.num_used = Math.min(len, filter_l + j - ((filter_l / 2) | 0));

    gfc.itime[ch] += num_used.num_used - k * gfc.resample_ratio;

    if (num_used.num_used >= BLACKSIZE) {
      for (i = 0; i < BLACKSIZE; i++) {
        inbuf_old[i] = inbuf[in_bufferPos + num_used.num_used + i - BLACKSIZE];
      }
    } else {
      const n_shift = BLACKSIZE - num_used.num_used;

      for (i = 0; i < n_shift; ++i) {
        inbuf_old[i] = inbuf_old[i + num_used.num_used];
      }

      for (j = 0; i < BLACKSIZE; ++i, ++j) {
        inbuf_old[i] = inbuf[in_bufferPos + j];
      }

      assert(j === num_used.num_used);
    }
    return k;
  }

  private fill_buffer(
    gfp: LameGlobalFlags,
    mfbuf: Float32Array[],
    in_buffer: Float32Array[],
    in_bufferPos: number,
    nsamples: number,
    io: InOut,
  ): void {
    const gfc = gfp.internal_flags!;

    if (gfc.resample_ratio < 0.9999 || gfc.resample_ratio > 1.0001) {
      for (let ch = 0; ch < gfc.channels_out; ch++) {
        const numUsed = new NumUsed();
        io.n_out = this.fill_buffer_resample(
          gfp,
          mfbuf[ch],
          gfc.mf_size,
          gfp.getFrameSize(),
          in_buffer[ch],
          in_bufferPos,
          nsamples,
          numUsed,
          ch,
        );
        io.n_in = numUsed.num_used;
      }
    } else {
      io.n_out = Math.min(gfp.getFrameSize(), nsamples);
      io.n_in = io.n_out;
      for (let i = 0; i < io.n_out; ++i) {
        mfbuf[0][gfc.mf_size + i] = in_buffer[0][in_bufferPos + i];
        if (gfc.channels_out === 2) {
          mfbuf[1][gfc.mf_size + i] = in_buffer[1][in_bufferPos + i];
        }
      }
    }
  }

  // ---------------------------------------------------------------
  // Internal buffer management
  // ---------------------------------------------------------------

  private update_inbuffer_size(gfc: LameInternalFlags, nsamples: number): void {
    if (gfc.in_buffer_0 == null || gfc.in_buffer_nsamples < nsamples) {
      gfc.in_buffer_0 = new_float(nsamples);
      gfc.in_buffer_1 = new_float(nsamples);
      gfc.in_buffer_nsamples = nsamples;
    }
  }

  private calcNeeded(gfp: LameGlobalFlags): number {
    let mf_needed = BLKSIZE + gfp.getFrameSize() - FFTOFFSET;
    mf_needed = Math.max(mf_needed, 512 + gfp.getFrameSize() - 32);
    assert(LameInternalFlags.MFSIZE >= mf_needed);
    return mf_needed;
  }

  // ---------------------------------------------------------------
  // Frame encoding
  // ---------------------------------------------------------------

  private lame_encode_frame(
    gfp: LameGlobalFlags,
    inbuf_l: Float32Array,
    inbuf_r: Float32Array,
    mp3buf: Uint8Array,
    mp3bufPos: number,
    mp3buf_size: number,
  ): number {
    const ret = this.enc.lame_encode_mp3_frame(
      gfp,
      inbuf_l,
      inbuf_r,
      mp3buf,
      mp3bufPos,
      mp3buf_size,
    );
    gfp.frameNum++;
    return ret;
  }

  // ---------------------------------------------------------------
  // lame_encode_buffer_sample -- the main internal encode loop
  // ---------------------------------------------------------------

  private lame_encode_buffer_sample(
    gfp: LameGlobalFlags,
    buffer_l: Float32Array,
    buffer_r: Float32Array,
    nsamples: number,
    mp3buf: Uint8Array,
    mp3bufPos: number,
    mp3buf_size: number,
  ): number {
    const gfc = gfp.internal_flags!;
    let mp3size = 0;
    let ret: number;
    let i: number;
    let ch: number;
    let mf_needed: number;
    let mp3out: number;
    const mfbuf: Float32Array[] = [null!, null!];
    const in_buffer: Float32Array[] = [null!, null!];

    if (gfc.Class_ID !== Lame.LAME_ID) return -3;

    if (nsamples === 0) return 0;

    /* copy out any tags that may have been written into bitstream */
    mp3out = this.bs.copy_buffer(gfc, mp3buf, mp3bufPos, mp3buf_size, 0);
    if (mp3out < 0) return mp3out;
    mp3bufPos += mp3out;
    mp3size += mp3out;

    in_buffer[0] = buffer_l;
    in_buffer[1] = buffer_r;

    /* Apply user defined re-scaling */
    if (NEQ(gfp.scale, 0) && NEQ(gfp.scale, 1.0)) {
      for (i = 0; i < nsamples; ++i) {
        in_buffer[0][i] *= gfp.scale;
        if (gfc.channels_out === 2) in_buffer[1][i] *= gfp.scale;
      }
    }

    if (NEQ(gfp.scale_left, 0) && NEQ(gfp.scale_left, 1.0)) {
      for (i = 0; i < nsamples; ++i) {
        in_buffer[0][i] *= gfp.scale_left;
      }
    }

    if (NEQ(gfp.scale_right, 0) && NEQ(gfp.scale_right, 1.0)) {
      for (i = 0; i < nsamples; ++i) {
        in_buffer[1][i] *= gfp.scale_right;
      }
    }

    /* Downsample to Mono if 2 channels in and 1 channel out */
    if (gfp.getInNumChannels() === 2 && gfc.channels_out === 1) {
      for (i = 0; i < nsamples; ++i) {
        in_buffer[0][i] = 0.5 * (in_buffer[0][i] + in_buffer[1][i]);
        in_buffer[1][i] = 0.0;
      }
    }

    mf_needed = this.calcNeeded(gfp);

    mfbuf[0] = gfc.mfbuf[0];
    mfbuf[1] = gfc.mfbuf[1];

    let in_bufferPos = 0;
    while (nsamples > 0) {
      const in_buffer_ptr: Float32Array[] = [null!, null!];
      let n_in = 0;
      let n_out = 0;

      in_buffer_ptr[0] = in_buffer[0];
      in_buffer_ptr[1] = in_buffer[1];

      const inOut = new InOut();
      this.fill_buffer(gfp, mfbuf, in_buffer_ptr, in_bufferPos, nsamples, inOut);
      n_in = inOut.n_in;
      n_out = inOut.n_out;

      /* compute ReplayGain of resampled input if requested */
      if (gfc.findReplayGain && !gfc.decode_on_the_fly) {
        if (
          this.ga.AnalyzeSamples(
            gfc.rgdata!,
            mfbuf[0],
            gfc.mf_size,
            mfbuf[1],
            gfc.mf_size,
            n_out,
            gfc.channels_out,
          ) === GainAnalysis.GAIN_ANALYSIS_ERROR
        ) {
          return -6;
        }
      }

      /* update in_buffer counters */
      nsamples -= n_in;
      in_bufferPos += n_in;
      if (gfc.channels_out === 2) {
        // in_bufferPos += n_in; -- already counted above
      }

      /* update mfbuf[] counters */
      gfc.mf_size += n_out;
      assert(gfc.mf_size <= LameInternalFlags.MFSIZE);

      if (gfc.mf_samples_to_encode < 1) {
        gfc.mf_samples_to_encode = ENCDELAY + POSTDELAY;
      }
      gfc.mf_samples_to_encode += n_out;

      if (gfc.mf_size >= mf_needed) {
        let buf_size = mp3buf_size - mp3size;
        if (mp3buf_size === 0) buf_size = 0;

        ret = this.lame_encode_frame(
          gfp,
          mfbuf[0],
          mfbuf[1],
          mp3buf,
          mp3bufPos,
          buf_size,
        );

        if (ret < 0) return ret;
        mp3bufPos += ret;
        mp3size += ret;

        /* shift out old samples */
        gfc.mf_size -= gfp.getFrameSize();
        gfc.mf_samples_to_encode -= gfp.getFrameSize();
        for (ch = 0; ch < gfc.channels_out; ch++) {
          for (i = 0; i < gfc.mf_size; i++) {
            mfbuf[ch][i] = mfbuf[ch][i + gfp.getFrameSize()];
          }
        }
      }
    }
    assert(nsamples === 0);

    return mp3size;
  }

  // ---------------------------------------------------------------
  // lame_encode_buffer -- public entry point
  // ---------------------------------------------------------------

  lame_encode_buffer(
    gfp: LameGlobalFlags,
    buffer_l: Int16Array,
    buffer_r: Int16Array,
    nsamples: number,
    mp3buf: Uint8Array,
    mp3bufPos: number,
    mp3buf_size: number,
  ): number {
    const gfc = gfp.internal_flags!;
    const in_buffer: Float32Array[] = [null!, null!];

    if (gfc.Class_ID !== Lame.LAME_ID) return -3;

    if (nsamples === 0) return 0;

    this.update_inbuffer_size(gfc, nsamples);

    in_buffer[0] = gfc.in_buffer_0!;
    in_buffer[1] = gfc.in_buffer_1!;

    /* make a copy of input buffer, changing type to sample_t */
    for (let i = 0; i < nsamples; i++) {
      in_buffer[0][i] = buffer_l[i];
      if (gfc.channels_in > 1) in_buffer[1][i] = buffer_r[i];
    }

    return this.lame_encode_buffer_sample(
      gfp,
      in_buffer[0],
      in_buffer[1],
      nsamples,
      mp3buf,
      mp3bufPos,
      mp3buf_size,
    );
  }

  // ---------------------------------------------------------------
  // lame_encode_flush -- finalize encoding
  // ---------------------------------------------------------------

  lame_encode_flush(
    gfp: LameGlobalFlags,
    mp3buffer: Uint8Array,
    mp3bufferPos: number,
    mp3buffer_size: number,
  ): number {
    const gfc = gfp.internal_flags!;
    const buffer = new_short_n(2, 1152) as Int16Array[];
    let imp3 = 0;
    let mp3count: number;
    let mp3buffer_size_remaining: number;

    let end_padding: number;
    let frames_left: number;
    let samples_to_encode = gfc.mf_samples_to_encode - POSTDELAY;
    const mf_needed = this.calcNeeded(gfp);

    /* Was flush already called? */
    if (gfc.mf_samples_to_encode < 1) {
      return 0;
    }
    mp3count = 0;

    if (gfp.getInSampleRate() !== gfp.getOutSampleRate()) {
      samples_to_encode +=
        (16.0 * gfp.getOutSampleRate()) / gfp.getInSampleRate();
    }
    end_padding =
      gfp.getFrameSize() - (samples_to_encode % gfp.getFrameSize());
    if (end_padding < 576) end_padding += gfp.getFrameSize();
    gfp.encoder_padding = end_padding;

    frames_left =
      ((samples_to_encode + end_padding) / gfp.getFrameSize()) | 0;

    while (frames_left > 0 && imp3 >= 0) {
      let bunch = mf_needed - gfc.mf_size;
      const frame_num = gfp.frameNum;

      bunch *= gfp.getInSampleRate();
      bunch = (bunch / gfp.getOutSampleRate()) | 0;
      if (bunch > 1152) bunch = 1152;
      if (bunch < 1) bunch = 1;

      mp3buffer_size_remaining = mp3buffer_size - mp3count;

      if (mp3buffer_size === 0) mp3buffer_size_remaining = 0;

      imp3 = this.lame_encode_buffer(
        gfp,
        buffer[0],
        buffer[1],
        bunch,
        mp3buffer,
        mp3bufferPos,
        mp3buffer_size_remaining,
      );

      mp3bufferPos += imp3;
      mp3count += imp3;
      frames_left -= frame_num !== gfp.frameNum ? 1 : 0;
    }

    gfc.mf_samples_to_encode = 0;

    if (imp3 < 0) {
      return imp3;
    }

    mp3buffer_size_remaining = mp3buffer_size - mp3count;
    if (mp3buffer_size === 0) mp3buffer_size_remaining = 0;

    /* mp3 related stuff. bit buffer might still contain some mp3 data */
    this.bs.flush_bitstream(gfp);
    imp3 = this.bs.copy_buffer(
      gfc,
      mp3buffer,
      mp3bufferPos,
      mp3buffer_size_remaining,
      1,
    );
    if (imp3 < 0) {
      return imp3;
    }
    mp3bufferPos += imp3;
    mp3count += imp3;
    mp3buffer_size_remaining = mp3buffer_size - mp3count;
    if (mp3buffer_size === 0) mp3buffer_size_remaining = 0;

    if (gfp.isWriteId3tagAutomatic()) {
      /* write a id3 tag to the bitstream */
      this.id3.id3tag_write_v1(gfp);

      imp3 = this.bs.copy_buffer(
        gfc,
        mp3buffer,
        mp3bufferPos,
        mp3buffer_size_remaining,
        0,
      );

      if (imp3 < 0) {
        return imp3;
      }
      mp3count += imp3;
    }
    return mp3count;
  }

  // ---------------------------------------------------------------
  // lame_encode_flush_nogap
  // ---------------------------------------------------------------

  lame_encode_flush_nogap(
    gfp: LameGlobalFlags,
    mp3buffer: Uint8Array,
    mp3bufferPos: number,
    mp3buffer_size: number,
  ): number {
    const gfc = gfp.internal_flags!;
    this.bs.flush_bitstream(gfp);
    return this.bs.copy_buffer(gfc, mp3buffer, mp3bufferPos, mp3buffer_size, 1);
  }
}
