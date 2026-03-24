import { new_float, new_int, arraycopy, assert } from './common.js';
import {
  SBMAX_l,
  SBMAX_s,
  SBPSY_l,
  SBPSY_s,
  PSFB21,
  PSFB12,
  SHORT_TYPE,
} from './constants.js';
import type { GrInfo } from './GrInfo.js';
import { ScaleFac } from './ScaleFac.js';
import type { LameGlobalFlags } from './LameGlobalFlags.js';
import { LameInternalFlags } from './LameInternalFlags.js';
import type { III_psy_ratio } from './III_psy_ratio.js';
import { MeanBits } from './MeanBits.js';
import { VbrMode } from './VbrMode.js';
import { L3Side } from './L3Side.js';
import { CalcNoiseResult } from './CalcNoiseResult.js';
import type { CalcNoiseData } from './CalcNoiseData.js';
import type { Takehiro } from './Takehiro.js';
import type { Reservoir } from './Reservoir.js';
import type { PsyModel } from './PsyModel.js';

/**
 * FAST_LOG10 inline: log10(x)
 */
function FAST_LOG10(x: number): number {
  return Math.log10(x);
}

/**
 * FAST_LOG10_X inline: log10(x) * y
 */
function FAST_LOG10_X(x: number, y: number): number {
  return Math.log10(x) * y;
}

/**
 * Floating point comparison (BitStream.EQ equivalent)
 */
function EQ(a: number, b: number): boolean {
  return Math.abs(a) > Math.abs(b)
    ? Math.abs((a - b) / a) <= 1e-6
    : Math.abs(a - b) <= 1e-6;
}

class StartLine {
  s: number;
  constructor(j: number) {
    this.s = j;
  }
}

export class QuantizePVT {
  /* ---- static constants ---- */

  /** ix always <= 8191+15. see count_bits() */
  static readonly IXMAX_VAL = 8206;

  /**
   * minimum possible number of
   * -cod_info.global_gain + ((scalefac[] + (cod_info.preflag ? pretab[sfb] : 0))
   * << (cod_info.scalefac_scale + 1)) + cod_info.subblock_gain[cod_info.window[sfb]] * 8;
   *
   * for long block, 0+((15+3)<<2) = 18*4 = 72
   * for short block, 0+(15<<2)+7*8 = 15*4+56 = 116
   */
  static readonly Q_MAX2 = 116;

  static readonly LARGE_BITS = 100000;

  /* ---- private constants ---- */

  /** smallest such that 1.0+DBL_EPSILON != 1.0 */
  private static readonly DBL_EPSILON = 2.2204460492503131e-016;

  private static readonly Q_MAX = 256 + 1;

  private static readonly PRECALC_SIZE = QuantizePVT.IXMAX_VAL + 2;

  /** Assuming dynamic range = 96dB, this value should be 92 */
  private static readonly NSATHSCALE = 100;

  /* ---- public lookup tables ---- */

  pow43 = new_float(QuantizePVT.PRECALC_SIZE);
  adj43 = new_float(QuantizePVT.PRECALC_SIZE);
  pow20 = new_float(QuantizePVT.Q_MAX + QuantizePVT.Q_MAX2 + 1);
  ipow20 = new_float(QuantizePVT.Q_MAX);

  /**
   * The following table is used to implement the scalefactor partitioning for
   * MPEG2 as described in section 2.4.3.2 of the IS.
   *
   * [table_number][row_in_table][column of nr_of_sfb]
   */
  readonly nr_of_sfb_block: number[][][] = [
    [[6, 5, 5, 5], [9, 9, 9, 9], [6, 9, 9, 9]],
    [[6, 5, 7, 3], [9, 9, 12, 6], [6, 9, 12, 6]],
    [[11, 10, 0, 0], [18, 18, 0, 0], [15, 18, 0, 0]],
    [[7, 7, 7, 0], [12, 12, 12, 0], [6, 15, 12, 0]],
    [[6, 6, 6, 3], [12, 9, 9, 6], [6, 12, 9, 6]],
    [[8, 8, 5, 0], [15, 12, 9, 0], [6, 18, 9, 0]],
  ];

  /** Table B.6: layer3 preemphasis */
  readonly pretab: number[] = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1,
    2, 2, 3, 3, 3, 2, 0,
  ];

  /**
   * Here are MPEG1 Table B.8 and MPEG2 Table B.1 -- Layer III scalefactor
   * bands.
   * Index into this using a method such as:
   * idx = fr_ps.header.sampling_frequency + (fr_ps.header.version * 3)
   */
  readonly sfBandIndex: ScaleFac[] = [
    // Table B.2.b: 22.05 kHz
    new ScaleFac(
      new Int32Array([0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576]),
      new Int32Array([0, 4, 8, 12, 18, 24, 32, 42, 56, 74, 100, 132, 174, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // Table B.2.c: 24 kHz  (docs: 332. mpg123(broken): 330)
    new ScaleFac(
      new Int32Array([0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 114, 136, 162, 194, 232, 278, 332, 394, 464, 540, 576]),
      new Int32Array([0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 136, 180, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // Table B.2.a: 16 kHz
    new ScaleFac(
      new Int32Array([0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576]),
      new Int32Array([0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 134, 174, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // Table B.8.b: 44.1 kHz
    new ScaleFac(
      new Int32Array([0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 52, 62, 74, 90, 110, 134, 162, 196, 238, 288, 342, 418, 576]),
      new Int32Array([0, 4, 8, 12, 16, 22, 30, 40, 52, 66, 84, 106, 136, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // Table B.8.c: 48 kHz
    new ScaleFac(
      new Int32Array([0, 4, 8, 12, 16, 20, 24, 30, 36, 42, 50, 60, 72, 88, 106, 128, 156, 190, 230, 276, 330, 384, 576]),
      new Int32Array([0, 4, 8, 12, 16, 22, 28, 38, 50, 64, 80, 100, 126, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // Table B.8.a: 32 kHz
    new ScaleFac(
      new Int32Array([0, 4, 8, 12, 16, 20, 24, 30, 36, 44, 54, 66, 82, 102, 126, 156, 194, 240, 296, 364, 448, 550, 576]),
      new Int32Array([0, 4, 8, 12, 16, 22, 30, 42, 58, 78, 104, 138, 180, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // MPEG-2.5 11.025 kHz
    new ScaleFac(
      new Int32Array([0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576]),
      new Int32Array([0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 134, 174, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // MPEG-2.5 12 kHz
    new ScaleFac(
      new Int32Array([0, 6, 12, 18, 24, 30, 36, 44, 54, 66, 80, 96, 116, 140, 168, 200, 238, 284, 336, 396, 464, 522, 576]),
      new Int32Array([0, 4, 8, 12, 18, 26, 36, 48, 62, 80, 104, 134, 174, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
    // MPEG-2.5 8 kHz
    new ScaleFac(
      new Int32Array([0, 12, 24, 36, 48, 60, 72, 88, 108, 132, 160, 192, 232, 280, 336, 400, 476, 566, 568, 570, 572, 574, 576]),
      new Int32Array([0, 8, 16, 24, 36, 52, 72, 96, 124, 160, 162, 164, 166, 192]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
      new Int32Array([0, 0, 0, 0, 0, 0, 0]),
    ),
  ];

  /* ---- late-bound modules ---- */

  tak!: Takehiro;
  rv!: Reservoir;
  psy!: PsyModel;

  init(tk: Takehiro, rv: Reservoir, psy: PsyModel): void {
    this.tak = tk;
    this.rv = rv;
    this.psy = psy;
  }

  /* ---- public accessors ---- */

  POW20(x: number): number {
    assert(0 <= (x + QuantizePVT.Q_MAX2) && x < QuantizePVT.Q_MAX);
    return this.pow20[x + QuantizePVT.Q_MAX2];
  }

  IPOW20(x: number): number {
    assert(0 <= x && x < QuantizePVT.Q_MAX);
    return this.ipow20[x];
  }

  /* ---- ATH helpers ---- */

  /**
   * Compute the ATH for each scalefactor band cd range: 0..96db
   *
   * Input: 3.3kHz signal 32767 amplitude (3.3kHz is where ATH is smallest =
   * -5db) longblocks: sfb=12 en0/bw=-11db max_en0 = 1.3db shortblocks: sfb=5
   * -9db 0db
   *
   * Input: 1 1 1 1 1 1 1 -1 -1 -1 -1 -1 -1 -1 (repeated) longblocks: amp=1
   * sfb=12 en0/bw=-103 db max_en0 = -92db amp=32767 sfb=12 -12 db -1.4db
   *
   * Input: 1 1 1 1 1 1 1 -1 -1 -1 -1 -1 -1 -1 (repeated) shortblocks: amp=1
   * sfb=5 en0/bw= -99 -86 amp=32767 sfb=5 -9 db 4db
   *
   * MAX energy of largest wave at 3.3kHz = 1db AVE energy of largest wave at
   * 3.3kHz = -11db Let's take AVE: -11db = maximum signal in sfb=12. Dynamic
   * range of CD: 96db. Therefor energy of smallest audible wave in sfb=12 =
   * -11 - 96 = -107db = ATH at 3.3kHz.
   *
   * ATH formula for this wave: -5db. To adjust to LAME scaling, we need ATH =
   * ATH_formula - 103 (db) ATH = ATH * 2.5e-10 (ener)
   */
  private ATHmdct(gfp: LameGlobalFlags, f: number): number {
    let ath = this.psy.ATHformula(f, gfp);

    ath -= QuantizePVT.NSATHSCALE;

    /* modify the MDCT scaling for the ATH and convert to energy */
    ath = Math.pow(10.0, ath / 10.0 + gfp.ATHlower);
    return ath;
  }

  private compute_ath(gfp: LameGlobalFlags): void {
    const gfc = gfp.internal_flags!;
    const ATH_l = gfc.ATH!.l;
    const ATH_psfb21 = gfc.ATH!.psfb21;
    const ATH_s = gfc.ATH!.s;
    const ATH_psfb12 = gfc.ATH!.psfb12;
    const samp_freq = gfp.getOutSampleRate();

    for (let sfb = 0; sfb < SBMAX_l; sfb++) {
      let start = gfc.scalefac_band.l[sfb];
      let end = gfc.scalefac_band.l[sfb + 1];
      ATH_l[sfb] = 3.4028235e+38; // Float.MAX_VALUE
      for (let i = start; i < end; i++) {
        let freq = i * samp_freq / (2 * 576);
        let ATH_f = this.ATHmdct(gfp, freq);
        ATH_l[sfb] = Math.min(ATH_l[sfb], ATH_f);
      }
    }

    for (let sfb = 0; sfb < PSFB21; sfb++) {
      let start = gfc.scalefac_band.psfb21[sfb];
      let end = gfc.scalefac_band.psfb21[sfb + 1];
      ATH_psfb21[sfb] = 3.4028235e+38;
      for (let i = start; i < end; i++) {
        let freq = i * samp_freq / (2 * 576);
        let ATH_f = this.ATHmdct(gfp, freq);
        ATH_psfb21[sfb] = Math.min(ATH_psfb21[sfb], ATH_f);
      }
    }

    for (let sfb = 0; sfb < SBMAX_s; sfb++) {
      let start = gfc.scalefac_band.s[sfb];
      let end = gfc.scalefac_band.s[sfb + 1];
      ATH_s[sfb] = 3.4028235e+38;
      for (let i = start; i < end; i++) {
        let freq = i * samp_freq / (2 * 192);
        let ATH_f = this.ATHmdct(gfp, freq);
        ATH_s[sfb] = Math.min(ATH_s[sfb], ATH_f);
      }
      ATH_s[sfb] *= (gfc.scalefac_band.s[sfb + 1] - gfc.scalefac_band.s[sfb]);
    }

    for (let sfb = 0; sfb < PSFB12; sfb++) {
      let start = gfc.scalefac_band.psfb12[sfb];
      let end = gfc.scalefac_band.psfb12[sfb + 1];
      ATH_psfb12[sfb] = 3.4028235e+38;
      for (let i = start; i < end; i++) {
        let freq = i * samp_freq / (2 * 192);
        let ATH_f = this.ATHmdct(gfp, freq);
        ATH_psfb12[sfb] = Math.min(ATH_psfb12[sfb], ATH_f);
      }
      /* not sure about the following */
      ATH_psfb12[sfb] *= (gfc.scalefac_band.s[13] - gfc.scalefac_band.s[12]);
    }

    /*
     * no-ATH mode: reduce ATH to -200 dB
     */
    if (gfp.noATH) {
      for (let sfb = 0; sfb < SBMAX_l; sfb++) {
        ATH_l[sfb] = 1e-20;
      }
      for (let sfb = 0; sfb < PSFB21; sfb++) {
        ATH_psfb21[sfb] = 1e-20;
      }
      for (let sfb = 0; sfb < SBMAX_s; sfb++) {
        ATH_s[sfb] = 1e-20;
      }
      for (let sfb = 0; sfb < PSFB12; sfb++) {
        ATH_psfb12[sfb] = 1e-20;
      }
    }

    /*
     * work in progress, don't rely on it too much
     */
    gfc.ATH!.floor = 10.0 * Math.log10(this.ATHmdct(gfp, -1.0));
  }

  /* ---- initialization for iteration_loop ---- */

  iteration_init(gfp: LameGlobalFlags): void {
    const gfc = gfp.internal_flags!;
    const l3_side = gfc.l3_side;
    let i: number;

    if (gfc.iteration_init_init === 0) {
      gfc.iteration_init_init = 1;

      l3_side.main_data_begin = 0;
      this.compute_ath(gfp);

      this.pow43[0] = 0.0;
      for (i = 1; i < QuantizePVT.PRECALC_SIZE; i++)
        this.pow43[i] = Math.pow(i, 4.0 / 3.0);

      for (i = 0; i < QuantizePVT.PRECALC_SIZE - 1; i++)
        this.adj43[i] = (i + 1) - Math.pow(
          0.5 * (this.pow43[i] + this.pow43[i + 1]), 0.75);
      this.adj43[i] = 0.5;

      for (i = 0; i < QuantizePVT.Q_MAX; i++)
        this.ipow20[i] = Math.pow(2.0, (i - 210) * -0.1875);
      for (i = 0; i <= QuantizePVT.Q_MAX + QuantizePVT.Q_MAX2; i++)
        this.pow20[i] = Math.pow(2.0, (i - 210 - QuantizePVT.Q_MAX2) * 0.25);

      this.tak.huffman_init(gfc);

      {
        let bass: number, alto: number, treble: number, sfb21: number;

        i = (gfp.exp_nspsytune >> 2) & 63;
        if (i >= 32)
          i -= 64;
        bass = Math.pow(10, i / 4.0 / 10.0);

        i = (gfp.exp_nspsytune >> 8) & 63;
        if (i >= 32)
          i -= 64;
        alto = Math.pow(10, i / 4.0 / 10.0);

        i = (gfp.exp_nspsytune >> 14) & 63;
        if (i >= 32)
          i -= 64;
        treble = Math.pow(10, i / 4.0 / 10.0);

        /*
         * to be compatible with Naoki's original code, the next 6 bits
         * define only the amount of changing treble for sfb21
         */
        i = (gfp.exp_nspsytune >> 20) & 63;
        if (i >= 32)
          i -= 64;
        sfb21 = treble * Math.pow(10, i / 4.0 / 10.0);

        for (i = 0; i < SBMAX_l; i++) {
          let f: number;
          if (i <= 6)
            f = bass;
          else if (i <= 13)
            f = alto;
          else if (i <= 20)
            f = treble;
          else
            f = sfb21;

          gfc.nsPsy.longfact[i] = f;
        }
        for (i = 0; i < SBMAX_s; i++) {
          let f: number;
          if (i <= 5)
            f = bass;
          else if (i <= 10)
            f = alto;
          else if (i <= 11)
            f = treble;
          else
            f = sfb21;

          gfc.nsPsy.shortfact[i] = f;
        }
      }
    }
  }

  /* ---- bit allocation ---- */

  /**
   * allocate bits among 2 channels based on PE
   * mt 6/99
   * bugfixes rh 8/01: often allocated more than the allowed 4095 bits
   */
  on_pe(
    gfp: LameGlobalFlags,
    pe: Float32Array[],
    targ_bits: Int32Array,
    mean_bits: number,
    gr: number,
    cbr: number,
  ): number {
    const gfc = gfp.internal_flags!;
    let tbits = 0;
    let bits: number;
    let add_bits = new_int(2);
    let ch: number;

    /* allocate targ_bits for granule */
    let mb = new MeanBits(tbits);
    let extra_bits = this.rv.ResvMaxBits(gfp, mean_bits, mb, cbr);
    tbits = mb.bits;
    /* maximum allowed bits for this granule */
    let max_bits = tbits + extra_bits;
    if (max_bits > LameInternalFlags.MAX_BITS_PER_GRANULE) {
      // hard limit per granule
      max_bits = LameInternalFlags.MAX_BITS_PER_GRANULE;
    }
    for (bits = 0, ch = 0; ch < gfc.channels_out; ++ch) {
      /******************************************************************
       * allocate bits for each channel
       ******************************************************************/
      targ_bits[ch] = Math.min(
        LameInternalFlags.MAX_BITS_PER_CHANNEL,
        (tbits / gfc.channels_out) | 0,
      );

      add_bits[ch] = (targ_bits[ch] * pe[gr][ch] / 700.0 - targ_bits[ch]) | 0;

      /* at most increase bits by 1.5*average */
      if (add_bits[ch] > ((mean_bits * 3 / 4) | 0))
        add_bits[ch] = (mean_bits * 3 / 4) | 0;
      if (add_bits[ch] < 0)
        add_bits[ch] = 0;

      if (add_bits[ch] + targ_bits[ch] > LameInternalFlags.MAX_BITS_PER_CHANNEL)
        add_bits[ch] = Math.max(
          0,
          LameInternalFlags.MAX_BITS_PER_CHANNEL - targ_bits[ch],
        );

      bits += add_bits[ch];
    }
    if (bits > extra_bits) {
      for (ch = 0; ch < gfc.channels_out; ++ch) {
        add_bits[ch] = (extra_bits * add_bits[ch] / bits) | 0;
      }
    }

    for (ch = 0; ch < gfc.channels_out; ++ch) {
      targ_bits[ch] += add_bits[ch];
      extra_bits -= add_bits[ch];
    }

    for (bits = 0, ch = 0; ch < gfc.channels_out; ++ch) {
      bits += targ_bits[ch];
    }
    if (bits > LameInternalFlags.MAX_BITS_PER_GRANULE) {
      let sum = 0;
      for (ch = 0; ch < gfc.channels_out; ++ch) {
        targ_bits[ch] *= LameInternalFlags.MAX_BITS_PER_GRANULE;
        targ_bits[ch] = (targ_bits[ch] / bits) | 0;
        sum += targ_bits[ch];
      }
      assert(sum <= LameInternalFlags.MAX_BITS_PER_GRANULE);
    }

    return max_bits;
  }

  reduce_side(
    targ_bits: Int32Array,
    ms_ener_ratio: number,
    mean_bits: number,
    max_bits: number,
  ): void {
    assert(max_bits <= LameInternalFlags.MAX_BITS_PER_GRANULE);
    assert(targ_bits[0] + targ_bits[1] <= LameInternalFlags.MAX_BITS_PER_GRANULE);

    /*
     * ms_ener_ratio = 0: allocate 66/33 mid/side fac=.33
     * ms_ener_ratio =.5: allocate 50/50 mid/side fac= 0
     */
    /* 75/25 split is fac=.5 */
    let fac = 0.33 * (0.5 - ms_ener_ratio) / 0.5;
    if (fac < 0)
      fac = 0;
    if (fac > 0.5)
      fac = 0.5;

    /* number of bits to move from side channel to mid channel */
    /* move_bits = fac*targ_bits[1]; */
    let move_bits = (fac * 0.5 * (targ_bits[0] + targ_bits[1])) | 0;

    if (move_bits > LameInternalFlags.MAX_BITS_PER_CHANNEL - targ_bits[0]) {
      move_bits = LameInternalFlags.MAX_BITS_PER_CHANNEL - targ_bits[0];
    }
    if (move_bits < 0)
      move_bits = 0;

    if (targ_bits[1] >= 125) {
      /* dont reduce side channel below 125 bits */
      if (targ_bits[1] - move_bits > 125) {

        /* if mid channel already has 2x more than average, dont bother */
        /* mean_bits = bits per granule (for both channels) */
        if (targ_bits[0] < mean_bits)
          targ_bits[0] += move_bits;
        targ_bits[1] -= move_bits;
      } else {
        targ_bits[0] += targ_bits[1] - 125;
        targ_bits[1] = 125;
      }
    }

    move_bits = targ_bits[0] + targ_bits[1];
    if (move_bits > max_bits) {
      targ_bits[0] = ((max_bits * targ_bits[0]) / move_bits) | 0;
      targ_bits[1] = ((max_bits * targ_bits[1]) / move_bits) | 0;
    }
    assert(targ_bits[0] <= LameInternalFlags.MAX_BITS_PER_CHANNEL);
    assert(targ_bits[1] <= LameInternalFlags.MAX_BITS_PER_CHANNEL);
    assert(targ_bits[0] + targ_bits[1] <= LameInternalFlags.MAX_BITS_PER_GRANULE);
  }

  /**
   * Robert Hegemann 2001-04-27:
   * this adjusts the ATH, keeping the original noise floor
   * affects the higher frequencies more than the lower ones
   */
  athAdjust(a: number, x: number, athFloor: number): number {
    /*
     * work in progress
     */
    const o = 90.30873362;
    const p = 94.82444863;
    let u = FAST_LOG10_X(x, 10.0);
    const v = a * a;
    let w = 0.0;
    u -= athFloor; /* undo scaling */
    if (v > 1e-20)
      w = 1.0 + FAST_LOG10_X(v, 10.0 / o);
    if (w < 0)
      w = 0.0;
    u *= w;
    u += athFloor + o - p; /* redo scaling */

    return Math.pow(10.0, 0.1 * u);
  }

  /**
   * Calculate the allowed distortion for each scalefactor band, as determined
   * by the psychoacoustic model. xmin(sb) = ratio(sb) * en(sb) / bw(sb)
   *
   * returns number of sfb's with energy > ATH
   */
  calc_xmin(
    gfp: LameGlobalFlags,
    ratio: III_psy_ratio,
    cod_info: GrInfo,
    pxmin: Float32Array,
  ): number {
    let pxminPos = 0;
    const gfc = gfp.internal_flags!;
    let gsfb: number;
    let j = 0;
    let ath_over = 0;
    const ATH = gfc.ATH!;
    const xr = cod_info.xr;
    const enable_athaa_fix = (gfp.getVBR() === VbrMode.vbr_mtrh) ? 1 : 0;
    let masking_lower = gfc.masking_lower;

    if (gfp.getVBR() === VbrMode.vbr_mtrh || gfp.getVBR() === VbrMode.vbr_mt) {
      /* was already done in PSY-Model */
      masking_lower = 1.0;
    }

    for (gsfb = 0; gsfb < cod_info.psy_lmax; gsfb++) {
      let en0: number, xmin: number;
      let rh1: number, rh2: number;
      let width: number, l: number;

      if (gfp.getVBR() === VbrMode.vbr_rh || gfp.getVBR() === VbrMode.vbr_mtrh)
        xmin = this.athAdjust(ATH.adjust, ATH.l[gsfb], ATH.floor);
      else
        xmin = ATH.adjust * ATH.l[gsfb];

      width = cod_info.width[gsfb];
      rh1 = xmin / width;
      rh2 = QuantizePVT.DBL_EPSILON;
      l = width >> 1;
      en0 = 0.0;
      do {
        let xa: number, xb: number;
        xa = xr[j] * xr[j];
        en0 += xa;
        rh2 += (xa < rh1) ? xa : rh1;
        j++;
        xb = xr[j] * xr[j];
        en0 += xb;
        rh2 += (xb < rh1) ? xb : rh1;
        j++;
      } while (--l > 0);
      if (en0 > xmin)
        ath_over++;

      if (gsfb === SBPSY_l) {
        let x = xmin * gfc.nsPsy.longfact[gsfb];
        if (rh2 < x) {
          rh2 = x;
        }
      }
      if (enable_athaa_fix !== 0) {
        xmin = rh2;
      }
      if (!gfp.ATHonly) {
        let e = ratio.en.l[gsfb];
        if (e > 0.0) {
          let x: number;
          x = en0 * ratio.thm.l[gsfb] * masking_lower / e;
          if (enable_athaa_fix !== 0)
            x *= gfc.nsPsy.longfact[gsfb];
          if (xmin < x)
            xmin = x;
        }
      }
      if (enable_athaa_fix !== 0)
        pxmin[pxminPos++] = xmin;
      else
        pxmin[pxminPos++] = xmin * gfc.nsPsy.longfact[gsfb];
    } /* end of long block loop */

    /* use this function to determine the highest non-zero coeff */
    let max_nonzero = 575;
    if (cod_info.block_type !== SHORT_TYPE) {
      // NORM, START or STOP type, but not SHORT
      let k = 576;
      while (k-- !== 0 && EQ(xr[k], 0)) {
        max_nonzero = k;
      }
    }
    cod_info.max_nonzero_coeff = max_nonzero;

    for (let sfb = cod_info.sfb_smin; gsfb < cod_info.psymax; sfb++, gsfb += 3) {
      let width: number, b: number;
      let tmpATH: number;
      if (gfp.getVBR() === VbrMode.vbr_rh || gfp.getVBR() === VbrMode.vbr_mtrh)
        tmpATH = this.athAdjust(ATH.adjust, ATH.s[sfb], ATH.floor);
      else
        tmpATH = ATH.adjust * ATH.s[sfb];

      width = cod_info.width[gsfb];
      for (b = 0; b < 3; b++) {
        let en0 = 0.0;
        let xmin: number;
        let rh1: number, rh2: number;
        let l = width >> 1;

        rh1 = tmpATH / width;
        rh2 = QuantizePVT.DBL_EPSILON;
        do {
          let xa: number, xb: number;
          xa = xr[j] * xr[j];
          en0 += xa;
          rh2 += (xa < rh1) ? xa : rh1;
          j++;
          xb = xr[j] * xr[j];
          en0 += xb;
          rh2 += (xb < rh1) ? xb : rh1;
          j++;
        } while (--l > 0);
        if (en0 > tmpATH)
          ath_over++;
        if (sfb === SBPSY_s) {
          let x = tmpATH * gfc.nsPsy.shortfact[sfb];
          if (rh2 < x) {
            rh2 = x;
          }
        }
        if (enable_athaa_fix !== 0)
          xmin = rh2;
        else
          xmin = tmpATH;

        if (!gfp.ATHonly && !gfp.ATHshort) {
          let e = ratio.en.s[sfb][b];
          if (e > 0.0) {
            let x: number;
            x = en0 * ratio.thm.s[sfb][b] * masking_lower / e;
            if (enable_athaa_fix !== 0)
              x *= gfc.nsPsy.shortfact[sfb];
            if (xmin < x)
              xmin = x;
          }
        }
        if (enable_athaa_fix !== 0)
          pxmin[pxminPos++] = xmin;
        else
          pxmin[pxminPos++] = xmin * gfc.nsPsy.shortfact[sfb];
      } /* b */
      if (gfp.useTemporal) {
        if (pxmin[pxminPos - 3] > pxmin[pxminPos - 3 + 1])
          pxmin[pxminPos - 3 + 1] += (pxmin[pxminPos - 3] - pxmin[pxminPos - 3 + 1])
            * gfc.decay;
        if (pxmin[pxminPos - 3 + 1] > pxmin[pxminPos - 3 + 2])
          pxmin[pxminPos - 3 + 2] += (pxmin[pxminPos - 3 + 1] - pxmin[pxminPos - 3 + 2])
            * gfc.decay;
      }
    } /* end of short block sfb loop */

    return ath_over;
  }

  /* ---- noise calculation ---- */

  private calc_noise_core(
    cod_info: GrInfo,
    startline: StartLine,
    l: number,
    step: number,
  ): number {
    let noise = 0;
    let j = startline.s;
    const ix = cod_info.l3_enc;

    if (j > cod_info.count1) {
      while (l-- !== 0) {
        let temp: number;
        temp = cod_info.xr[j];
        j++;
        noise += temp * temp;
        temp = cod_info.xr[j];
        j++;
        noise += temp * temp;
      }
    } else if (j > cod_info.big_values) {
      let ix01 = new_float(2);
      ix01[0] = 0;
      ix01[1] = step;
      while (l-- !== 0) {
        let temp: number;
        temp = Math.abs(cod_info.xr[j]) - ix01[ix[j]];
        j++;
        noise += temp * temp;
        temp = Math.abs(cod_info.xr[j]) - ix01[ix[j]];
        j++;
        noise += temp * temp;
      }
    } else {
      while (l-- !== 0) {
        let temp: number;
        temp = Math.abs(cod_info.xr[j]) - this.pow43[ix[j]] * step;
        j++;
        noise += temp * temp;
        temp = Math.abs(cod_info.xr[j]) - this.pow43[ix[j]] * step;
        j++;
        noise += temp * temp;
      }
    }

    startline.s = j;
    return noise;
  }

  /**
   * -oo dB  =>  -1.00
   * - 6 dB  =>  -0.97
   * - 3 dB  =>  -0.80
   * - 2 dB  =>  -0.64
   * - 1 dB  =>  -0.38
   *   0 dB  =>   0.00
   * + 1 dB  =>  +0.49
   * + 2 dB  =>  +1.06
   * + 3 dB  =>  +1.68
   * + 6 dB  =>  +3.69
   * +10 dB  =>  +6.45
   */
  calc_noise(
    cod_info: GrInfo,
    l3_xmin: Float32Array,
    distort: Float32Array,
    res: CalcNoiseResult,
    prev_noise: CalcNoiseData | null,
  ): number {
    let distortPos = 0;
    let l3_xminPos = 0;
    let sfb: number;
    let l: number;
    let over = 0;
    let over_noise_db = 0;
    /* 0 dB relative to masking */
    let tot_noise_db = 0;
    /* -200 dB relative to masking */
    let max_noise = -20.0;
    let j = 0;
    const scalefac = cod_info.scalefac;
    let scalefacPos = 0;

    res.over_SSD = 0;

    for (sfb = 0; sfb < cod_info.psymax; sfb++) {
      let s =
        cod_info.global_gain
        - ((scalefac[scalefacPos++] + (cod_info.preflag !== 0 ? this.pretab[sfb] : 0))
          << (cod_info.scalefac_scale + 1))
        - cod_info.subblock_gain[cod_info.window[sfb]] * 8;
      let noise = 0.0;

      if (prev_noise !== null && prev_noise.step[sfb] === s) {

        /* use previously computed values */
        noise = prev_noise.noise[sfb];
        j += cod_info.width[sfb];
        distort[distortPos++] = noise / l3_xmin[l3_xminPos++];

        noise = prev_noise.noise_log[sfb];

      } else {
        let step = this.POW20(s);
        l = cod_info.width[sfb] >> 1;

        if ((j + cod_info.width[sfb]) > cod_info.max_nonzero_coeff) {
          let usefullsize: number;
          usefullsize = cod_info.max_nonzero_coeff - j + 1;

          if (usefullsize > 0)
            l = usefullsize >> 1;
          else
            l = 0;
        }

        let sl = new StartLine(j);
        noise = this.calc_noise_core(cod_info, sl, l, step);
        j = sl.s;

        if (prev_noise !== null) {
          /* save noise values */
          prev_noise.step[sfb] = s;
          prev_noise.noise[sfb] = noise;
        }

        noise = distort[distortPos++] = noise / l3_xmin[l3_xminPos++];

        /* multiplying here is adding in dB, but can overflow */
        noise = FAST_LOG10(Math.max(noise, 1e-20));

        if (prev_noise !== null) {
          /* save noise values */
          prev_noise.noise_log[sfb] = noise;
        }
      }

      if (prev_noise !== null) {
        /* save noise values */
        prev_noise.global_gain = cod_info.global_gain;
      }

      tot_noise_db += noise;

      if (noise > 0.0) {
        let tmp: number;

        tmp = Math.max((noise * 10 + 0.5) | 0, 1);
        res.over_SSD += tmp * tmp;

        over++;
        /* multiplying here is adding in dB -but can overflow */
        /* over_noise *= noise; */
        over_noise_db += noise;
      }
      max_noise = Math.max(max_noise, noise);

    }

    res.over_count = over;
    res.tot_noise = tot_noise_db;
    res.over_noise = over_noise_db;
    res.max_noise = max_noise;

    return over;
  }

  /* ---- plotting / debugging ---- */

  /**
   * updates plotting data
   *
   * Mark Taylor 2000-??-??
   *
   * Robert Hegemann: moved noise/distortion calc into it
   */
  set_pinfo(
    gfp: LameGlobalFlags,
    cod_info: GrInfo,
    ratio: III_psy_ratio,
    gr: number,
    ch: number,
  ): void {
    const gfc = gfp.internal_flags!;
    let sfb: number, sfb2: number;
    let l: number;
    let en0: number, en1: number;
    let ifqstep = (cod_info.scalefac_scale === 0) ? 0.5 : 1.0;
    let scalefac = cod_info.scalefac;

    let l3_xmin = new_float(L3Side.SFBMAX);
    let xfsf = new_float(L3Side.SFBMAX);
    let noise = new CalcNoiseResult();

    this.calc_xmin(gfp, ratio, cod_info, l3_xmin);
    this.calc_noise(cod_info, l3_xmin, xfsf, noise, null);

    let j = 0;
    sfb2 = cod_info.sfb_lmax;
    if (cod_info.block_type !== SHORT_TYPE
      && cod_info.mixed_block_flag === 0)
      sfb2 = 22;
    for (sfb = 0; sfb < sfb2; sfb++) {
      let start = gfc.scalefac_band.l[sfb];
      let end = gfc.scalefac_band.l[sfb + 1];
      let bw = end - start;
      for (en0 = 0.0; j < end; j++)
        en0 += cod_info.xr[j] * cod_info.xr[j];
      en0 /= bw;
      /* convert to MDCT units */
      /* scaling so it shows up on FFT plot */
      en1 = 1e15;
      gfc.pinfo!.en[gr][ch][sfb] = en1 * en0;
      gfc.pinfo!.xfsf[gr][ch][sfb] = en1 * l3_xmin[sfb] * xfsf[sfb] / bw;

      if (ratio.en.l[sfb] > 0 && !gfp.ATHonly)
        en0 = en0 / ratio.en.l[sfb];
      else
        en0 = 0.0;

      gfc.pinfo!.thr[gr][ch][sfb] = en1
        * Math.max(en0 * ratio.thm.l[sfb], gfc.ATH!.l[sfb]);

      /* there is no scalefactor bands >= SBPSY_l */
      gfc.pinfo!.LAMEsfb[gr][ch][sfb] = 0;
      if (cod_info.preflag !== 0 && sfb >= 11)
        gfc.pinfo!.LAMEsfb[gr][ch][sfb] = -ifqstep * this.pretab[sfb];

      if (sfb < SBPSY_l) {
        /* scfsi should be decoded by caller side */
        assert(scalefac[sfb] >= 0);
        gfc.pinfo!.LAMEsfb[gr][ch][sfb] -= ifqstep * scalefac[sfb];
      }
    } /* for sfb */

    if (cod_info.block_type === SHORT_TYPE) {
      sfb2 = sfb;
      for (sfb = cod_info.sfb_smin; sfb < SBMAX_s; sfb++) {
        let start = gfc.scalefac_band.s[sfb];
        let end = gfc.scalefac_band.s[sfb + 1];
        let bw = end - start;
        for (let i = 0; i < 3; i++) {
          for (en0 = 0.0, l = start; l < end; l++) {
            en0 += cod_info.xr[j] * cod_info.xr[j];
            j++;
          }
          en0 = Math.max(en0 / bw, 1e-20);
          /* convert to MDCT units */
          /* scaling so it shows up on FFT plot */
          en1 = 1e15;

          gfc.pinfo!.en_s[gr][ch][3 * sfb + i] = en1 * en0;
          gfc.pinfo!.xfsf_s[gr][ch][3 * sfb + i] = en1 * l3_xmin[sfb2]
            * xfsf[sfb2] / bw;
          if (ratio.en.s[sfb][i] > 0)
            en0 = en0 / ratio.en.s[sfb][i];
          else
            en0 = 0.0;
          if (gfp.ATHonly || gfp.ATHshort)
            en0 = 0;

          gfc.pinfo!.thr_s[gr][ch][3 * sfb + i] = en1
            * Math.max(en0 * ratio.thm.s[sfb][i], gfc.ATH!.s[sfb]);

          /* there is no scalefactor bands >= SBPSY_s */
          gfc.pinfo!.LAMEsfb_s[gr][ch][3 * sfb + i] = -2.0
            * cod_info.subblock_gain[i];
          if (sfb < SBPSY_s) {
            gfc.pinfo!.LAMEsfb_s[gr][ch][3 * sfb + i] -= ifqstep
              * scalefac[sfb2];
          }
          sfb2++;
        }
      }
    } /* block type short */
    gfc.pinfo!.LAMEqss[gr][ch] = cod_info.global_gain;
    gfc.pinfo!.LAMEmainbits[gr][ch] = cod_info.part2_3_length
      + cod_info.part2_length;
    gfc.pinfo!.LAMEsfbits[gr][ch] = cod_info.part2_length;

    gfc.pinfo!.over[gr][ch] = noise.over_count;
    gfc.pinfo!.max_noise[gr][ch] = noise.max_noise * 10.0;
    gfc.pinfo!.over_noise[gr][ch] = noise.over_noise * 10.0;
    gfc.pinfo!.tot_noise[gr][ch] = noise.tot_noise * 10.0;
    gfc.pinfo!.over_SSD[gr][ch] = noise.over_SSD;
  }

  /**
   * updates plotting data for a whole frame
   *
   * Robert Hegemann 2000-10-21
   */
  set_frame_pinfo(
    gfp: LameGlobalFlags,
    ratio: III_psy_ratio[][],
  ): void {
    const gfc = gfp.internal_flags!;

    gfc.masking_lower = 1.0;

    /*
     * for every granule and channel patch l3_enc and set info
     */
    for (let gr = 0; gr < gfc.mode_gr; gr++) {
      for (let ch = 0; ch < gfc.channels_out; ch++) {
        let cod_info = gfc.l3_side.tt[gr][ch];
        let scalefac_sav = new_int(L3Side.SFBMAX);
        arraycopy(cod_info.scalefac, 0, scalefac_sav, 0, scalefac_sav.length);

        /*
         * reconstruct the scalefactors in case SCFSI was used
         */
        if (gr === 1) {
          let sfb: number;
          for (sfb = 0; sfb < cod_info.sfb_lmax; sfb++) {
            if (cod_info.scalefac[sfb] < 0) /* scfsi */
              cod_info.scalefac[sfb] = gfc.l3_side.tt[0][ch].scalefac[sfb];
          }
        }

        this.set_pinfo(gfp, cod_info, ratio[gr][ch], gr, ch);
        arraycopy(scalefac_sav, 0, cod_info.scalefac, 0, scalefac_sav.length);
      } /* for ch */
    } /* for gr */
  }
}
