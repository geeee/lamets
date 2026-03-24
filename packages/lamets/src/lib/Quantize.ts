import { new_float, new_int, arraycopy, fill, assert } from './common.js';
import {
  SBPSY_l,
  SBPSY_s,
  SBMAX_l,
  SBMAX_s,
  PSFB21,
  PSFB12,
  SHORT_TYPE,
  MPG_MD_MS_LR,
} from './constants.js';
import { GrInfo } from './GrInfo.js';
import { LameInternalFlags } from './LameInternalFlags.js';
import type { LameGlobalFlags } from './LameGlobalFlags.js';
import type { III_psy_xmin } from './III_psy_xmin.js';
import type { III_psy_ratio } from './III_psy_ratio.js';
import { CalcNoiseResult } from './CalcNoiseResult.js';
import { CalcNoiseData } from './CalcNoiseData.js';
import { MeanBits } from './MeanBits.js';
import { VbrMode } from './VbrMode.js';
import type { MPEGMode } from './MPEGMode.js';
import { L3Side } from './L3Side.js';
import type { ScaleFac } from './ScaleFac.js';
import type { BitStream } from './BitStream.js';
import type { Reservoir } from './Reservoir.js';
import type { QuantizePVT } from './QuantizePVT.js';
import type { Takehiro } from './Takehiro.js';
import { VBRQuantize } from './VBRQuantize.js';

const SQRT2 = Math.SQRT2;

/**
 * Floating point comparison
 */
function EQ(a: number, b: number): boolean {
  return Math.abs(a) > Math.abs(b)
    ? Math.abs((a - b) / a) <= 1e-6
    : Math.abs(a - b) <= 1e-6;
}

function NEQ(a: number, b: number): boolean {
  return !EQ(a, b);
}

function FAST_LOG10(x: number): number {
  return Math.log10(x);
}

const enum BinSearchDirection {
  BINSEARCH_NONE = 0,
  BINSEARCH_UP = 1,
  BINSEARCH_DOWN = 2,
}

export class Quantize {
  bs!: BitStream;
  rv!: Reservoir;
  qupvt!: QuantizePVT;
  vbr: VBRQuantize = new VBRQuantize();
  tk!: Takehiro;

  init(bs: BitStream, rv: Reservoir, qupvt: QuantizePVT, tk: Takehiro): void {
    this.bs = bs;
    this.rv = rv;
    this.qupvt = qupvt;
    this.tk = tk;
    this.vbr.init(qupvt, tk);
  }

  /**
   * convert from L/R <-> Mid/Side
   */
  ms_convert(l3_side: { tt: GrInfo[][] }, gr: number): void {
    for (let i = 0; i < 576; ++i) {
      let l = l3_side.tt[gr][0].xr[i];
      let r = l3_side.tt[gr][1].xr[i];
      l3_side.tt[gr][0].xr[i] = (l + r) * (SQRT2 * 0.5);
      l3_side.tt[gr][1].xr[i] = (l - r) * (SQRT2 * 0.5);
    }
  }

  /**
   * mt 6/99
   *
   * initializes cod_info, scalefac and xrpow
   *
   * returns 0 if all energies in xr are zero, else 1
   */
  private init_xrpow_core(
    cod_info: GrInfo,
    xrpow: Float32Array,
    upper: number,
    sum: number,
  ): number {
    sum = 0;
    for (let i = 0; i <= upper; ++i) {
      let tmp = Math.abs(cod_info.xr[i]);
      sum += tmp;
      xrpow[i] = Math.sqrt(tmp * Math.sqrt(tmp));

      if (xrpow[i] > cod_info.xrpow_max)
        cod_info.xrpow_max = xrpow[i];
    }
    return sum;
  }

  init_xrpow(
    gfc: LameInternalFlags,
    cod_info: GrInfo,
    xrpow: Float32Array,
  ): boolean {
    let sum = 0;
    let upper = cod_info.max_nonzero_coeff | 0;

    assert(xrpow != null);
    cod_info.xrpow_max = 0;

    /*
     * check if there is some energy we have to quantize and calculate xrpow
     * matching our fresh scalefactors
     */
    assert(0 <= upper && upper <= 575);

    fill(xrpow, 0, upper, 576);

    sum = this.init_xrpow_core(cod_info, xrpow, upper, sum);

    /*
     * return 1 if we have something to quantize, else 0
     */
    if (sum > 1e-20) {
      let j = 0;
      if ((gfc.substep_shaping & 2) !== 0) j = 1;

      for (let i = 0; i < cod_info.psymax; i++)
        gfc.pseudohalf[i] = j;

      return true;
    }

    fill(cod_info.l3_enc, 0, 0, 576);
    return false;
  }

  /**
   * Gabriel Bouvigne feb/apr 2003
   * Analog silence detection in partitioned sfb21 or sfb12 for short blocks
   *
   * From top to bottom of sfb, changes to 0 coeffs which are below ath. It
   * stops on the first coeff higher than ath.
   */
  private psfb21_analogsilence(gfc: LameInternalFlags, cod_info: GrInfo): void {
    let ath = gfc.ATH!;
    let xr = cod_info.xr;

    if (cod_info.block_type !== SHORT_TYPE) {
      /* NORM, START or STOP type, but not SHORT blocks */
      let stop = false;
      for (let gsfb = PSFB21 - 1; gsfb >= 0 && !stop; gsfb--) {
        let start = gfc.scalefac_band.psfb21[gsfb];
        let end = gfc.scalefac_band.psfb21[gsfb + 1];
        let ath21 = this.qupvt.athAdjust(ath.adjust, ath.psfb21[gsfb], ath.floor);

        if (gfc.nsPsy.longfact[21] > 1e-12)
          ath21 *= gfc.nsPsy.longfact[21];

        for (let j = end - 1; j >= start; j--) {
          if (Math.abs(xr[j]) < ath21)
            xr[j] = 0;
          else {
            stop = true;
            break;
          }
        }
      }
    } else {
      /* note: short blocks coeffs are reordered */
      for (let block = 0; block < 3; block++) {
        let stop = false;
        for (let gsfb = PSFB12 - 1; gsfb >= 0 && !stop; gsfb--) {
          let start =
            gfc.scalefac_band.s[12] * 3 +
            (gfc.scalefac_band.s[13] - gfc.scalefac_band.s[12]) * block +
            (gfc.scalefac_band.psfb12[gsfb] - gfc.scalefac_band.psfb12[0]);
          let end =
            start +
            (gfc.scalefac_band.psfb12[gsfb + 1] - gfc.scalefac_band.psfb12[gsfb]);
          let ath12 = this.qupvt.athAdjust(ath.adjust, ath.psfb12[gsfb], ath.floor);

          if (gfc.nsPsy.shortfact[12] > 1e-12)
            ath12 *= gfc.nsPsy.shortfact[12];

          for (let j = end - 1; j >= start; j--) {
            if (Math.abs(xr[j]) < ath12)
              xr[j] = 0;
            else {
              stop = true;
              break;
            }
          }
        }
      }
    }
  }

  init_outer_loop(gfc: LameInternalFlags, cod_info: GrInfo): void {
    /*
     * initialize fresh cod_info
     */
    cod_info.part2_3_length = 0;
    cod_info.big_values = 0;
    cod_info.count1 = 0;
    cod_info.global_gain = 210;
    cod_info.scalefac_compress = 0;
    /* mixed_block_flag, block_type was set in psymodel.c */
    cod_info.table_select[0] = 0;
    cod_info.table_select[1] = 0;
    cod_info.table_select[2] = 0;
    cod_info.subblock_gain[0] = 0;
    cod_info.subblock_gain[1] = 0;
    cod_info.subblock_gain[2] = 0;
    cod_info.subblock_gain[3] = 0; /* this one is always 0 */
    cod_info.region0_count = 0;
    cod_info.region1_count = 0;
    cod_info.preflag = 0;
    cod_info.scalefac_scale = 0;
    cod_info.count1table_select = 0;
    cod_info.part2_length = 0;
    cod_info.sfb_lmax = SBPSY_l;
    cod_info.sfb_smin = SBPSY_s;
    cod_info.psy_lmax = gfc.sfb21_extra ? SBMAX_l : SBPSY_l;
    cod_info.psymax = cod_info.psy_lmax;
    cod_info.sfbmax = cod_info.sfb_lmax;
    cod_info.sfbdivide = 11;
    for (let sfb = 0; sfb < SBMAX_l; sfb++) {
      cod_info.width[sfb] =
        gfc.scalefac_band.l[sfb + 1] - gfc.scalefac_band.l[sfb];
      /* which is always 0. */
      cod_info.window[sfb] = 3;
    }
    if (cod_info.block_type === SHORT_TYPE) {
      let ixwork = new_float(576);

      cod_info.sfb_smin = 0;
      cod_info.sfb_lmax = 0;
      if (cod_info.mixed_block_flag !== 0) {
        /*
         * MPEG-1: sfbs 0-7 long block, 3-12 short blocks MPEG-2(.5):
         * sfbs 0-5 long block, 3-12 short blocks
         */
        cod_info.sfb_smin = 3;
        cod_info.sfb_lmax = gfc.mode_gr * 2 + 4;
      }
      cod_info.psymax =
        cod_info.sfb_lmax +
        3 *
          ((gfc.sfb21_extra ? SBMAX_s : SBPSY_s) - cod_info.sfb_smin);
      cod_info.sfbmax =
        cod_info.sfb_lmax + 3 * (SBPSY_s - cod_info.sfb_smin);
      cod_info.sfbdivide = cod_info.sfbmax - 18;
      cod_info.psy_lmax = cod_info.sfb_lmax;
      /* re-order the short blocks, for more efficient encoding below */
      /* By Takehiro TOMINAGA */
      /*
       * Within each scalefactor band, data is given for successive time
       * windows, beginning with window 0 and ending with window 2. Within
       * each window, the quantized values are then arranged in order of
       * increasing frequency...
       */
      let ix = gfc.scalefac_band.l[cod_info.sfb_lmax];
      arraycopy(cod_info.xr, 0, ixwork, 0, 576);
      for (let sfb = cod_info.sfb_smin; sfb < SBMAX_s; sfb++) {
        let start = gfc.scalefac_band.s[sfb];
        let end = gfc.scalefac_band.s[sfb + 1];
        for (let window = 0; window < 3; window++) {
          for (let l = start; l < end; l++) {
            cod_info.xr[ix++] = ixwork[3 * l + window];
          }
        }
      }

      let j = cod_info.sfb_lmax;
      for (let sfb = cod_info.sfb_smin; sfb < SBMAX_s; sfb++) {
        cod_info.width[j] =
          cod_info.width[j + 1] =
          cod_info.width[j + 2] =
            gfc.scalefac_band.s[sfb + 1] - gfc.scalefac_band.s[sfb];
        cod_info.window[j] = 0;
        cod_info.window[j + 1] = 1;
        cod_info.window[j + 2] = 2;
        j += 3;
      }
    }

    cod_info.count1bits = 0;
    cod_info.sfb_partition_table = this.qupvt.nr_of_sfb_block[0][0];
    cod_info.slen[0] = 0;
    cod_info.slen[1] = 0;
    cod_info.slen[2] = 0;
    cod_info.slen[3] = 0;

    cod_info.max_nonzero_coeff = 575;

    /*
     * fresh scalefactors are all zero
     */
    fill(cod_info.scalefac, 0);

    this.psfb21_analogsilence(gfc, cod_info);
  }

  /**
   * binary step size search used by outer_loop to get a quantizer step size
   * to start with
   */
  private bin_search_StepSize(
    gfc: LameInternalFlags,
    cod_info: GrInfo,
    desired_rate: number,
    ch: number,
    xrpow: Float32Array,
  ): number {
    let nBits: number;
    let CurrentStep = gfc.CurrentStep[ch];
    let flagGoneOver = false;
    let start = gfc.OldValue[ch];
    let Direction: BinSearchDirection = BinSearchDirection.BINSEARCH_NONE;
    cod_info.global_gain = start;
    desired_rate -= cod_info.part2_length;

    assert(CurrentStep !== 0);
    for (;;) {
      let step: number;
      nBits = this.tk.count_bits(gfc, xrpow, cod_info, null);

      if (CurrentStep === 1 || nBits === desired_rate)
        break; /* nothing to adjust anymore */

      if (nBits > desired_rate) {
        /* increase Quantize_StepSize */
        if (Direction === BinSearchDirection.BINSEARCH_DOWN)
          flagGoneOver = true;

        if (flagGoneOver) CurrentStep /= 2;
        Direction = BinSearchDirection.BINSEARCH_UP;
        step = CurrentStep;
      } else {
        /* decrease Quantize_StepSize */
        if (Direction === BinSearchDirection.BINSEARCH_UP)
          flagGoneOver = true;

        if (flagGoneOver) CurrentStep /= 2;
        Direction = BinSearchDirection.BINSEARCH_DOWN;
        step = -CurrentStep;
      }
      cod_info.global_gain += step;
      if (cod_info.global_gain < 0) {
        cod_info.global_gain = 0;
        flagGoneOver = true;
      }
      if (cod_info.global_gain > 255) {
        cod_info.global_gain = 255;
        flagGoneOver = true;
      }
    }

    assert(cod_info.global_gain >= 0);
    assert(cod_info.global_gain < 256);

    while (nBits! > desired_rate && cod_info.global_gain < 255) {
      cod_info.global_gain++;
      nBits = this.tk.count_bits(gfc, xrpow, cod_info, null);
    }
    gfc.CurrentStep[ch] = start - cod_info.global_gain >= 4 ? 4 : 2;
    gfc.OldValue[ch] = cod_info.global_gain;
    cod_info.part2_3_length = nBits!;
    return nBits!;
  }

  trancate_smallspectrums(
    gfc: LameInternalFlags,
    gi: GrInfo,
    l3_xmin: Float32Array,
    work: Float32Array,
  ): void {
    let distort = new_float(L3Side.SFBMAX);

    if (
      (0 === (gfc.substep_shaping & 4) && gi.block_type === SHORT_TYPE) ||
      (gfc.substep_shaping & 0x80) !== 0
    )
      return;
    this.qupvt.calc_noise(gi, l3_xmin, distort, new CalcNoiseResult(), null);
    for (let j = 0; j < 576; j++) {
      let xr = 0.0;
      if (gi.l3_enc[j] !== 0) xr = Math.abs(gi.xr[j]);
      work[j] = xr;
    }

    let j = 0;
    let sfb = 8;
    if (gi.block_type === SHORT_TYPE) sfb = 6;
    do {
      let allowedNoise: number;
      let trancateThreshold: number;
      let nsame: number;
      let start: number;

      let width = gi.width[sfb];
      j += width;
      if (distort[sfb] >= 1.0) continue;

      Arrays_sort(work, j - width, j);
      if (EQ(work[j - 1], 0.0)) continue; /* all zero sfb */

      allowedNoise = (1.0 - distort[sfb]) * l3_xmin[sfb];
      trancateThreshold = 0.0;
      start = 0;
      do {
        let noise: number;
        for (nsame = 1; start + nsame < width; nsame++)
          if (NEQ(work[start + j - width], work[start + j + nsame - width]))
            break;

        noise =
          work[start + j - width] * work[start + j - width] * nsame;
        if (allowedNoise < noise) {
          if (start !== 0)
            trancateThreshold = work[start + j - width - 1];
          break;
        }
        allowedNoise -= noise;
        start += nsame;
      } while (start < width);
      if (EQ(trancateThreshold, 0.0)) continue;

      do {
        if (Math.abs(gi.xr[j - width]) <= trancateThreshold)
          gi.l3_enc[j - width] = 0;
      } while (--width > 0);
    } while (++sfb < gi.psymax);

    gi.part2_3_length = this.tk.noquant_count_bits(gfc, gi, null);
  }

  /**
   * Function: Returns zero if there is a scalefac which has not been
   * amplified. Otherwise it returns one.
   */
  private loop_break(cod_info: GrInfo): boolean {
    for (let sfb = 0; sfb < cod_info.sfbmax; sfb++)
      if (
        cod_info.scalefac[sfb] +
          cod_info.subblock_gain[cod_info.window[sfb]] ===
        0
      )
        return false;

    return true;
  }

  private penalties(noise: number): number {
    return FAST_LOG10(0.368 + 0.632 * noise * noise * noise);
  }

  /* mt 5/99: Function: Improved calc_noise for a single channel */

  /**
   * several different codes to decide which quantization is better
   */
  private get_klemm_noise(distort: Float32Array, gi: GrInfo): number {
    let klemm_noise = 1e-37;
    for (let sfb = 0; sfb < gi.psymax; sfb++)
      klemm_noise += this.penalties(distort[sfb]);

    return Math.max(1e-20, klemm_noise);
  }

  private quant_compare(
    quant_comp: number,
    best: CalcNoiseResult,
    calc: CalcNoiseResult,
    gi: GrInfo,
    distort: Float32Array,
  ): boolean {
    /**
     * noise is given in decibels (dB) relative to masking thresholds.
     *
     * over_noise: ??? (the previous comment is fully wrong)
     * tot_noise: ??? (the previous comment is fully wrong)
     * max_noise: max quantization noise
     */
    let better: boolean;

    switch (quant_comp) {
      default:
      case 9: {
        if (best.over_count > 0) {
          /* there are distorted sfb */
          better = calc.over_SSD <= best.over_SSD;
          if (calc.over_SSD === best.over_SSD) better = calc.bits < best.bits;
        } else {
          /* no distorted sfb */
          better =
            calc.max_noise < 0 &&
            calc.max_noise * 10 + calc.bits <=
              best.max_noise * 10 + best.bits;
        }
        break;
      }

      case 0:
        better =
          calc.over_count < best.over_count ||
          (calc.over_count === best.over_count &&
            calc.over_noise < best.over_noise) ||
          (calc.over_count === best.over_count &&
            EQ(calc.over_noise, best.over_noise) &&
            calc.tot_noise < best.tot_noise);
        break;

      case 8:
        calc.max_noise = this.get_klemm_noise(distort, gi);
      /* falls through */
      case 1:
        better = calc.max_noise < best.max_noise;
        break;
      case 2:
        better = calc.tot_noise < best.tot_noise;
        break;
      case 3:
        better =
          calc.tot_noise < best.tot_noise &&
          calc.max_noise < best.max_noise;
        break;
      case 4:
        better =
          (calc.max_noise <= 0.0 && best.max_noise > 0.2) ||
          (calc.max_noise <= 0.0 &&
            best.max_noise < 0.0 &&
            best.max_noise > calc.max_noise - 0.2 &&
            calc.tot_noise < best.tot_noise) ||
          (calc.max_noise <= 0.0 &&
            best.max_noise > 0.0 &&
            best.max_noise > calc.max_noise - 0.2 &&
            calc.tot_noise < best.tot_noise + best.over_noise) ||
          (calc.max_noise > 0.0 &&
            best.max_noise > -0.05 &&
            best.max_noise > calc.max_noise - 0.1 &&
            calc.tot_noise + calc.over_noise <
              best.tot_noise + best.over_noise) ||
          (calc.max_noise > 0.0 &&
            best.max_noise > -0.1 &&
            best.max_noise > calc.max_noise - 0.15 &&
            calc.tot_noise + calc.over_noise + calc.over_noise <
              best.tot_noise + best.over_noise + best.over_noise);
        break;
      case 5:
        better =
          calc.over_noise < best.over_noise ||
          (EQ(calc.over_noise, best.over_noise) &&
            calc.tot_noise < best.tot_noise);
        break;
      case 6:
        better =
          calc.over_noise < best.over_noise ||
          (EQ(calc.over_noise, best.over_noise) &&
            (calc.max_noise < best.max_noise ||
              (EQ(calc.max_noise, best.max_noise) &&
                calc.tot_noise <= best.tot_noise)));
        break;
      case 7:
        better =
          calc.over_count < best.over_count ||
          calc.over_noise < best.over_noise;
        break;
    }

    if (best.over_count === 0) {
      /*
       * If no distorted bands, only use this quantization if it is
       * better, and if it uses less bits. Unfortunately, part2_3_length
       * is sometimes a poor estimator of the final size at low bitrates.
       */
      better = better && calc.bits < best.bits;
    }

    return better;
  }

  /**
   * Amplify the scalefactor bands that violate the masking threshold.
   * See ISO 11172-3 Section C.1.5.4.3.5
   */
  private amp_scalefac_bands(
    gfp: LameGlobalFlags,
    cod_info: GrInfo,
    distort: Float32Array,
    xrpow: Float32Array,
    bRefine: boolean,
  ): void {
    let gfc = gfp.internal_flags!;
    let ifqstep34: number;

    if (cod_info.scalefac_scale === 0) {
      ifqstep34 = 1.29683955465100964055; /* 2**(.75*.5) */
    } else {
      ifqstep34 = 1.68179283050742922612; /* 2**(.75*1) */
    }

    /* compute maximum value of distort[] */
    let trigger = 0;
    for (let sfb = 0; sfb < cod_info.sfbmax; sfb++) {
      if (trigger < distort[sfb]) trigger = distort[sfb];
    }

    let noise_shaping_amp = gfc.noise_shaping_amp;
    if (noise_shaping_amp === 3) {
      if (bRefine) noise_shaping_amp = 2;
      else noise_shaping_amp = 1;
    }
    switch (noise_shaping_amp) {
      case 2:
        /* amplify exactly 1 band */
        break;

      case 1:
        /* amplify bands within 50% of max (on db scale) */
        if (trigger > 1.0) trigger = Math.pow(trigger, 0.5);
        else trigger *= 0.95;
        break;

      case 0:
      default:
        /* ISO algorithm. amplify all bands with distort>1 */
        if (trigger > 1.0) trigger = 1.0;
        else trigger *= 0.95;
        break;
    }

    let j = 0;
    for (let sfb = 0; sfb < cod_info.sfbmax; sfb++) {
      let width = cod_info.width[sfb];
      j += width;
      if (distort[sfb] < trigger) continue;

      if ((gfc.substep_shaping & 2) !== 0) {
        gfc.pseudohalf[sfb] = gfc.pseudohalf[sfb] === 0 ? 1 : 0;
        if (gfc.pseudohalf[sfb] === 0 && gfc.noise_shaping_amp === 2)
          return;
      }
      cod_info.scalefac[sfb]++;
      for (let l = -width; l < 0; l++) {
        xrpow[j + l] *= ifqstep34;
        if (xrpow[j + l] > cod_info.xrpow_max)
          cod_info.xrpow_max = xrpow[j + l];
      }

      if (gfc.noise_shaping_amp === 2) return;
    }
  }

  /**
   * Takehiro Tominaga 2000-xx-xx
   *
   * turns on scalefac scale and adjusts scalefactors
   */
  private inc_scalefac_scale(cod_info: GrInfo, xrpow: Float32Array): void {
    let ifqstep34 = 1.29683955465100964055;

    let j = 0;
    for (let sfb = 0; sfb < cod_info.sfbmax; sfb++) {
      let width = cod_info.width[sfb];
      let s = cod_info.scalefac[sfb];
      if (cod_info.preflag !== 0) s += this.qupvt.pretab[sfb];
      j += width;
      if ((s & 1) !== 0) {
        s++;
        for (let l = -width; l < 0; l++) {
          xrpow[j + l] *= ifqstep34;
          if (xrpow[j + l] > cod_info.xrpow_max)
            cod_info.xrpow_max = xrpow[j + l];
        }
      }
      cod_info.scalefac[sfb] = s >> 1;
    }
    cod_info.preflag = 0;
    cod_info.scalefac_scale = 1;
  }

  /**
   * Takehiro Tominaga 2000-xx-xx
   *
   * increases the subblock gain and adjusts scalefactors
   */
  private inc_subblock_gain(
    gfc: LameInternalFlags,
    cod_info: GrInfo,
    xrpow: Float32Array,
  ): boolean {
    let sfb: number;
    let scalefac = cod_info.scalefac;

    /* subbloc_gain can't do anything in the long block region */
    for (sfb = 0; sfb < cod_info.sfb_lmax; sfb++) {
      if (scalefac[sfb] >= 16) return true;
    }

    for (let window = 0; window < 3; window++) {
      let s1 = 0;
      let s2 = 0;

      for (
        sfb = cod_info.sfb_lmax + window;
        sfb < cod_info.sfbdivide;
        sfb += 3
      ) {
        if (s1 < scalefac[sfb]) s1 = scalefac[sfb];
      }
      for (; sfb < cod_info.sfbmax; sfb += 3) {
        if (s2 < scalefac[sfb]) s2 = scalefac[sfb];
      }

      if (s1 < 16 && s2 < 8) continue;

      if (cod_info.subblock_gain[window] >= 7) return true;

      /*
       * even though there is no scalefactor for sfb12 subblock gain
       * affects upper frequencies too, that's why we have to go up to
       * SBMAX_s
       */
      cod_info.subblock_gain[window]++;
      let j = gfc.scalefac_band.l[cod_info.sfb_lmax];
      for (
        sfb = cod_info.sfb_lmax + window;
        sfb < cod_info.sfbmax;
        sfb += 3
      ) {
        let amp: number;
        let width = cod_info.width[sfb];
        let s = scalefac[sfb];
        assert(s >= 0);
        s = s - (4 >> cod_info.scalefac_scale);
        if (s >= 0) {
          scalefac[sfb] = s;
          j += width * 3;
          continue;
        }

        scalefac[sfb] = 0;
        {
          let gain = 210 + (s << (cod_info.scalefac_scale + 1));
          amp = this.qupvt.IPOW20(gain);
        }
        j += width * (window + 1);
        for (let l = -width; l < 0; l++) {
          xrpow[j + l] *= amp;
          if (xrpow[j + l] > cod_info.xrpow_max)
            cod_info.xrpow_max = xrpow[j + l];
        }
        j += width * (3 - window - 1);
      }

      {
        let amp = this.qupvt.IPOW20(202);
        j += cod_info.width[sfb] * (window + 1);
        for (let l = -cod_info.width[sfb]; l < 0; l++) {
          xrpow[j + l] *= amp;
          if (xrpow[j + l] > cod_info.xrpow_max)
            cod_info.xrpow_max = xrpow[j + l];
        }
      }
    }
    return false;
  }

  /**
   * amplifies scalefactor bands,
   *  - if all are already amplified returns false
   *  - if some bands are amplified too much:
   *     * try to increase scalefac_scale
   *     * if already scalefac_scale was set
   *         try on short blocks to increase subblock gain
   */
  private balance_noise(
    gfp: LameGlobalFlags,
    cod_info: GrInfo,
    distort: Float32Array,
    xrpow: Float32Array,
    bRefine: boolean,
  ): boolean {
    let gfc = gfp.internal_flags!;

    this.amp_scalefac_bands(gfp, cod_info, distort, xrpow, bRefine);

    /*
     * check to make sure we have not amplified too much loop_break returns
     * 0 if there is an unamplified scalefac scale_bitcount returns 0 if no
     * scalefactors are too large
     */

    let status = this.loop_break(cod_info);

    if (status) return false; /* all bands amplified */

    /*
     * not all scalefactors have been amplified. so these scalefacs are
     * possibly valid. encode them:
     */
    if (gfc.mode_gr === 2) status = this.tk.scale_bitcount(cod_info);
    else status = this.tk.scale_bitcount_lsf(gfc, cod_info);

    if (!status) return true; /* amplified some bands not exceeding limits */

    /*
     * some scalefactors are too large. lets try setting scalefac_scale=1
     */
    if (gfc.noise_shaping > 1) {
      fill(gfc.pseudohalf, 0);
      if (cod_info.scalefac_scale === 0) {
        this.inc_scalefac_scale(cod_info, xrpow);
        status = false;
      } else {
        if (
          cod_info.block_type === SHORT_TYPE &&
          gfc.subblock_gain > 0
        ) {
          status =
            this.inc_subblock_gain(gfc, cod_info, xrpow) ||
            this.loop_break(cod_info);
        }
      }
    }

    if (!status) {
      if (gfc.mode_gr === 2) status = this.tk.scale_bitcount(cod_info);
      else status = this.tk.scale_bitcount_lsf(gfc, cod_info);
    }
    return !status;
  }

  /**
   * The outer iteration loop controls the masking conditions
   * of all scalefactorbands. It computes the best scalefac and
   * global gain. This module calls the inner iteration loop.
   *
   * @param l3_xmin   allowed distortion
   * @param xrpow     coloured magnitudes of spectral
   * @param targ_bits maximum allowed bits
   */
  outer_loop(
    gfp: LameGlobalFlags,
    cod_info: GrInfo,
    l3_xmin: Float32Array,
    xrpow: Float32Array,
    ch: number,
    targ_bits: number,
  ): number {
    let gfc = gfp.internal_flags!;
    let cod_info_w = new GrInfo();
    let save_xrpow = new_float(576);
    let distort = new_float(L3Side.SFBMAX);
    let best_noise_info = new CalcNoiseResult();
    let better: number;
    let prev_noise = new CalcNoiseData();
    let best_part2_3_length = 9999999;
    let bEndOfSearch = false;
    let bRefine = false;
    let best_ggain_pass1 = 0;

    this.bin_search_StepSize(gfc, cod_info, targ_bits, ch, xrpow);

    if (gfc.noise_shaping === 0)
      /* fast mode, no noise shaping, we are ready */
      return 100; /* default noise_info.over_count */

    /* compute the distortion in this quantization */
    /* coefficients and thresholds both l/r (or both mid/side) */
    this.qupvt.calc_noise(cod_info, l3_xmin, distort, best_noise_info, prev_noise);
    best_noise_info.bits = cod_info.part2_3_length;

    cod_info_w.assign(cod_info);
    let age = 0;
    arraycopy(xrpow, 0, save_xrpow, 0, 576);

    while (!bEndOfSearch) {
      /* BEGIN MAIN LOOP */
      do {
        let noise_info = new CalcNoiseResult();
        let search_limit: number;
        let maxggain = 255;

        /*
         * When quantization with no distorted bands is found, allow up
         * to X new unsuccessful tries in serial. This gives us more
         * possibilities for different quant_compare modes. Much more
         * than 3 makes not a big difference, it is only slower.
         */

        if ((gfc.substep_shaping & 2) !== 0) {
          search_limit = 20;
        } else {
          search_limit = 3;
        }

        /*
         * Check if the last scalefactor band is distorted. in VBR mode
         * we can't get rid of the distortion, so quit now and VBR mode
         * will try again with more bits. (makes a 10% speed increase,
         * the files I tested were binary identical, 2000/05/20 Robert
         * Hegemann) distort[] > 1 means noise > allowed noise
         */
        if (gfc.sfb21_extra) {
          if (distort[cod_info_w.sfbmax] > 1.0) break;
          if (
            cod_info_w.block_type === SHORT_TYPE &&
            (distort[cod_info_w.sfbmax + 1] > 1.0 ||
              distort[cod_info_w.sfbmax + 2] > 1.0)
          )
            break;
        }

        /* try a new scalefactor combination on cod_info_w */
        if (!this.balance_noise(gfp, cod_info_w, distort, xrpow, bRefine))
          break;
        if (cod_info_w.scalefac_scale !== 0) maxggain = 254;

        /*
         * inner_loop starts with the initial quantization step computed
         * above and slowly increases until the bits < huff_bits. Thus
         * it is important not to start with too large of an initial
         * quantization step. Too small is ok, but inner_loop will take
         * longer
         */
        let huff_bits = targ_bits - cod_info_w.part2_length;
        if (huff_bits <= 0) break;

        /*
         * increase quantizer stepsize until needed bits are below
         * maximum
         */
        while (
          (cod_info_w.part2_3_length = this.tk.count_bits(
            gfc,
            xrpow,
            cod_info_w,
            prev_noise,
          )) > huff_bits &&
          cod_info_w.global_gain <= maxggain
        )
          cod_info_w.global_gain++;

        if (cod_info_w.global_gain > maxggain) break;

        if (best_noise_info.over_count === 0) {
          while (
            (cod_info_w.part2_3_length = this.tk.count_bits(
              gfc,
              xrpow,
              cod_info_w,
              prev_noise,
            )) > best_part2_3_length &&
            cod_info_w.global_gain <= maxggain
          )
            cod_info_w.global_gain++;

          if (cod_info_w.global_gain > maxggain) break;
        }

        /* compute the distortion in this quantization */
        this.qupvt.calc_noise(
          cod_info_w,
          l3_xmin,
          distort,
          noise_info,
          prev_noise,
        );
        noise_info.bits = cod_info_w.part2_3_length;

        /*
         * check if this quantization is better than our saved
         * quantization
         */
        if (cod_info.block_type !== SHORT_TYPE) {
          // NORM, START or STOP type
          better = gfp.quant_comp;
        } else better = gfp.quant_comp_short;

        better = this.quant_compare(
          better,
          best_noise_info,
          noise_info,
          cod_info_w,
          distort,
        )
          ? 1
          : 0;

        /* save data so we can restore this quantization later */
        if (better !== 0) {
          best_part2_3_length = cod_info.part2_3_length;
          best_noise_info = noise_info;
          cod_info.assign(cod_info_w);
          age = 0;
          /* save data so we can restore this quantization later */
          /* store for later reuse */
          arraycopy(xrpow, 0, save_xrpow, 0, 576);
        } else {
          /* early stop? */
          if (gfc.full_outer_loop === 0) {
            if (++age > search_limit && best_noise_info.over_count === 0)
              break;
            if (gfc.noise_shaping_amp === 3 && bRefine && age > 30)
              break;
            if (
              gfc.noise_shaping_amp === 3 &&
              bRefine &&
              cod_info_w.global_gain - best_ggain_pass1 > 15
            )
              break;
          }
        }
      } while (cod_info_w.global_gain + cod_info_w.scalefac_scale < 255);

      if (gfc.noise_shaping_amp === 3) {
        if (!bRefine) {
          /* refine search */
          cod_info_w.assign(cod_info);
          arraycopy(save_xrpow, 0, xrpow, 0, 576);
          age = 0;
          best_ggain_pass1 = cod_info_w.global_gain;

          bRefine = true;
        } else {
          /* search already refined, stop */
          bEndOfSearch = true;
        }
      } else {
        bEndOfSearch = true;
      }
    }

    assert(cod_info.global_gain + cod_info.scalefac_scale <= 255);
    /*
     * finish up
     */
    if (
      gfp.getVBR() === VbrMode.vbr_rh ||
      gfp.getVBR() === VbrMode.vbr_mtrh
    )
      /* restore for reuse on next try */
      arraycopy(save_xrpow, 0, xrpow, 0, 576);
    else if ((gfc.substep_shaping & 1) !== 0)
      /* do the 'substep shaping' */
      this.trancate_smallspectrums(gfc, cod_info, l3_xmin, xrpow);

    return best_noise_info.over_count;
  }

  /**
   * Robert Hegemann 2000-09-06
   *
   * update reservoir status after FINAL quantization/bitrate
   */
  iteration_finish_one(gfc: LameInternalFlags, gr: number, ch: number): void {
    let l3_side = gfc.l3_side;
    let cod_info = l3_side.tt[gr][ch];

    /*
     * try some better scalefac storage
     */
    this.tk.best_scalefac_store(gfc, gr, ch, l3_side);

    /*
     * best huffman_divide may save some bits too
     */
    if (gfc.use_best_huffman === 1)
      this.tk.best_huffman_divide(gfc, cod_info);

    /*
     * update reservoir status after FINAL quantization/bitrate
     */
    this.rv.ResvAdjust(gfc, cod_info);
  }

  /**
   * 2000-09-04 Robert Hegemann
   *
   * @param l3_xmin allowed distortion of the scalefactor
   * @param xrpow   coloured magnitudes of spectral values
   */
  VBR_encode_granule(
    gfp: LameGlobalFlags,
    cod_info: GrInfo,
    l3_xmin: Float32Array,
    xrpow: Float32Array,
    ch: number,
    min_bits: number,
    max_bits: number,
  ): void {
    let gfc = gfp.internal_flags!;
    let bst_cod_info = new GrInfo();
    let bst_xrpow = new_float(576);
    let Max_bits = max_bits;
    let real_bits = max_bits + 1;
    let this_bits = ((max_bits + min_bits) / 2) | 0;
    let dbits: number;
    let over: number;
    let found = 0;
    let sfb21_extra = gfc.sfb21_extra;

    assert(Max_bits <= LameInternalFlags.MAX_BITS_PER_CHANNEL);
    fill(bst_cod_info.l3_enc, 0);

    /*
     * search within round about 40 bits of optimal
     */
    do {
      assert(this_bits >= min_bits);
      assert(this_bits <= max_bits);
      assert(min_bits <= max_bits);

      if (this_bits > Max_bits - 42) gfc.sfb21_extra = false;
      else gfc.sfb21_extra = sfb21_extra;

      over = this.outer_loop(gfp, cod_info, l3_xmin, xrpow, ch, this_bits);

      /*
       * is quantization as good as we are looking for ? in this case: is
       * no scalefactor band distorted?
       */
      if (over <= 0) {
        found = 1;
        /*
         * now we know it can be done with "real_bits" and maybe we can
         * skip some iterations
         */
        real_bits = cod_info.part2_3_length;

        /*
         * store best quantization so far
         */
        bst_cod_info.assign(cod_info);
        arraycopy(xrpow, 0, bst_xrpow, 0, 576);

        /*
         * try with fewer bits
         */
        max_bits = real_bits - 32;
        dbits = max_bits - min_bits;
        this_bits = ((max_bits + min_bits) / 2) | 0;
      } else {
        /*
         * try with more bits
         */
        min_bits = this_bits + 32;
        dbits = max_bits - min_bits;
        this_bits = ((max_bits + min_bits) / 2) | 0;

        if (found !== 0) {
          found = 2;
          /*
           * start again with best quantization so far
           */
          cod_info.assign(bst_cod_info);
          arraycopy(bst_xrpow, 0, xrpow, 0, 576);
        }
      }
    } while (dbits > 12);

    gfc.sfb21_extra = sfb21_extra;

    /*
     * found=0 => nothing found, use last one found=1 => we just found the
     * best and left the loop found=2 => we restored a good one and have now
     * l3_enc to restore too
     */
    if (found === 2) {
      arraycopy(bst_cod_info.l3_enc, 0, cod_info.l3_enc, 0, 576);
    }
    assert(cod_info.part2_3_length <= Max_bits);
  }

  /**
   * Robert Hegemann 2000-09-05
   *
   * calculates how many bits are available for analog silent granules,
   * how many bits to use for the lowest allowed bitrate,
   * how many bits each bitrate would provide.
   */
  get_framebits(
    gfp: LameGlobalFlags,
    frameBits: Int32Array,
  ): void {
    let gfc = gfp.internal_flags!;

    /*
     * always use at least this many bits per granule per channel unless we
     * detect analog silence, see below
     */
    gfc.bitrate_index = gfc.VBR_min_bitrate;
    let bitsPerFrame = this.bs.getframebits(gfp);

    /*
     * bits for analog silence
     */
    gfc.bitrate_index = 1;
    bitsPerFrame = this.bs.getframebits(gfp);

    for (let i = 1; i <= gfc.VBR_max_bitrate; i++) {
      gfc.bitrate_index = i;
      let mb = new MeanBits(bitsPerFrame);
      frameBits[i] = this.rv.ResvFrameBegin(gfp, mb);
      bitsPerFrame = mb.bits;
    }
  }

  /**
   * 2000-09-04 Robert Hegemann
   *
   *  * converts LR to MS coding when necessary
   *  * calculates allowed/adjusted quantization noise amounts
   *  * detects analog silent frames
   */
  VBR_old_prepare(
    gfp: LameGlobalFlags,
    pe: Float32Array[],
    ms_ener_ratio: Float32Array,
    ratio: III_psy_ratio[][],
    l3_xmin: Float32Array[][],
    frameBits: Int32Array,
    min_bits: Int32Array[],
    max_bits: Int32Array[],
    bands: Int32Array[],
  ): number {
    let gfc = gfp.internal_flags!;

    let masking_lower_db: number;
    let adjust = 0.0;
    let analog_silence = 1;
    let bits = 0;

    gfc.bitrate_index = gfc.VBR_max_bitrate;
    let avg =
      (this.rv.ResvFrameBegin(gfp, new MeanBits(0)) / gfc.mode_gr) | 0;

    this.get_framebits(gfp, frameBits);

    for (let gr = 0; gr < gfc.mode_gr; gr++) {
      let mxb = this.qupvt.on_pe(gfp, pe, max_bits[gr], avg, gr, 0);
      if (gfc.mode_ext === MPG_MD_MS_LR) {
        this.ms_convert(gfc.l3_side, gr);
        this.qupvt.reduce_side(max_bits[gr], ms_ener_ratio[gr], avg, mxb);
      }
      for (let ch = 0; ch < gfc.channels_out; ++ch) {
        let cod_info = gfc.l3_side.tt[gr][ch];

        if (cod_info.block_type !== SHORT_TYPE) {
          // NORM, START or STOP type
          adjust =
            1.28 / (1 + Math.exp(3.5 - pe[gr][ch] / 300.0)) - 0.05;
          masking_lower_db = gfc.PSY!.mask_adjust - adjust;
        } else {
          adjust =
            2.56 / (1 + Math.exp(3.5 - pe[gr][ch] / 300.0)) - 0.14;
          masking_lower_db = gfc.PSY!.mask_adjust_short - adjust;
        }
        gfc.masking_lower = Math.pow(10.0, masking_lower_db * 0.1);

        this.init_outer_loop(gfc, cod_info);
        bands[gr][ch] = this.qupvt.calc_xmin(
          gfp,
          ratio[gr][ch],
          cod_info,
          l3_xmin[gr][ch],
        );
        if (bands[gr][ch] !== 0) analog_silence = 0;

        min_bits[gr][ch] = 126;

        bits += max_bits[gr][ch];
      }
    }
    for (let gr = 0; gr < gfc.mode_gr; gr++) {
      for (let ch = 0; ch < gfc.channels_out; ch++) {
        if (bits > frameBits[gfc.VBR_max_bitrate]) {
          max_bits[gr][ch] *= frameBits[gfc.VBR_max_bitrate];
          max_bits[gr][ch] /= bits;
        }
        if (min_bits[gr][ch] > max_bits[gr][ch])
          min_bits[gr][ch] = max_bits[gr][ch];
      } /* for ch */
    } /* for gr */

    return analog_silence;
  }

  /* RH: this one needs to be overhauled sometime */

  bitpressure_strategy(
    gfc: LameInternalFlags,
    l3_xmin: Float32Array[][],
    min_bits: Int32Array[],
    max_bits: Int32Array[],
  ): void {
    for (let gr = 0; gr < gfc.mode_gr; gr++) {
      for (let ch = 0; ch < gfc.channels_out; ch++) {
        let gi = gfc.l3_side.tt[gr][ch];
        let pxmin = l3_xmin[gr][ch];
        let pxminPos = 0;
        for (let sfb = 0; sfb < gi.psy_lmax; sfb++)
          pxmin[pxminPos++] *=
            1.0 + (0.029 * sfb * sfb) / SBMAX_l / SBMAX_l;

        if (gi.block_type === SHORT_TYPE) {
          for (let sfb = gi.sfb_smin; sfb < SBMAX_s; sfb++) {
            pxmin[pxminPos++] *=
              1.0 + (0.029 * sfb * sfb) / SBMAX_s / SBMAX_s;
            pxmin[pxminPos++] *=
              1.0 + (0.029 * sfb * sfb) / SBMAX_s / SBMAX_s;
            pxmin[pxminPos++] *=
              1.0 + (0.029 * sfb * sfb) / SBMAX_s / SBMAX_s;
          }
        }
        max_bits[gr][ch] = Math.max(min_bits[gr][ch], 0.9 * max_bits[gr][ch]) | 0;
      }
    }
  }

  VBR_new_prepare(
    gfp: LameGlobalFlags,
    pe: Float32Array[],
    ratio: III_psy_ratio[][],
    l3_xmin: Float32Array[][],
    frameBits: Int32Array,
    max_bits: Int32Array[],
  ): number {
    let gfc = gfp.internal_flags!;

    let analog_silence = 1;
    let avg = 0;
    let bits = 0;
    let maximum_framebits: number;

    if (!gfp.free_format) {
      gfc.bitrate_index = gfc.VBR_max_bitrate;

      let mb = new MeanBits(avg);
      this.rv.ResvFrameBegin(gfp, mb);
      avg = mb.bits;

      this.get_framebits(gfp, frameBits);
      maximum_framebits = frameBits[gfc.VBR_max_bitrate];
    } else {
      gfc.bitrate_index = 0;
      let mb = new MeanBits(avg);
      maximum_framebits = this.rv.ResvFrameBegin(gfp, mb);
      avg = mb.bits;
      frameBits[0] = maximum_framebits;
    }

    for (let gr = 0; gr < gfc.mode_gr; gr++) {
      this.qupvt.on_pe(gfp, pe, max_bits[gr], avg, gr, 0);
      if (gfc.mode_ext === MPG_MD_MS_LR) {
        this.ms_convert(gfc.l3_side, gr);
      }
      for (let ch = 0; ch < gfc.channels_out; ++ch) {
        let cod_info = gfc.l3_side.tt[gr][ch];

        gfc.masking_lower = Math.pow(10.0, gfc.PSY!.mask_adjust * 0.1);

        this.init_outer_loop(gfc, cod_info);
        if (
          this.qupvt.calc_xmin(gfp, ratio[gr][ch], cod_info, l3_xmin[gr][ch]) !== 0
        )
          analog_silence = 0;

        bits += max_bits[gr][ch];
      }
    }
    for (let gr = 0; gr < gfc.mode_gr; gr++) {
      for (let ch = 0; ch < gfc.channels_out; ch++) {
        if (bits > maximum_framebits) {
          max_bits[gr][ch] *= maximum_framebits;
          max_bits[gr][ch] /= bits;
        }
      } /* for ch */
    } /* for gr */

    return analog_silence;
  }

  /**
   * calculates target bits for ABR encoding
   *
   * mt 2000/05/31
   */
  calc_target_bits(
    gfp: LameGlobalFlags,
    pe: Float32Array[],
    ms_ener_ratio: Float32Array,
    targ_bits: Int32Array[],
    analog_silence_bits: Int32Array,
    max_frame_bits: Int32Array,
  ): void {
    let gfc = gfp.internal_flags!;
    let l3_side = gfc.l3_side;
    let res_factor: number;
    let gr: number;
    let ch: number;
    let totbits: number;
    let mean_bits = 0;

    gfc.bitrate_index = gfc.VBR_max_bitrate;
    let mb = new MeanBits(mean_bits);
    max_frame_bits[0] = this.rv.ResvFrameBegin(gfp, mb);
    mean_bits = mb.bits;

    gfc.bitrate_index = 1;
    mean_bits = this.bs.getframebits(gfp) - gfc.sideinfo_len * 8;
    analog_silence_bits[0] =
      (mean_bits / (gfc.mode_gr * gfc.channels_out)) | 0;

    mean_bits = gfp.VBR_mean_bitrate_kbps * gfp.getFrameSize() * 1000;
    if ((gfc.substep_shaping & 1) !== 0) mean_bits = (mean_bits * 1.09) | 0;
    mean_bits = (mean_bits / gfp.getOutSampleRate()) | 0;
    mean_bits -= gfc.sideinfo_len * 8;
    mean_bits = (mean_bits / (gfc.mode_gr * gfc.channels_out)) | 0;

    /**
     * res_factor is the percentage of the target bitrate that should
     * be used on average.  the remaining bits are added to the
     * bitreservoir and used for difficult to encode frames.
     *
     * Since we are tracking the average bitrate, we should adjust
     * res_factor "on the fly", increasing it if the average bitrate
     * is greater than the requested bitrate, and decreasing it
     * otherwise.  Reasonable ranges are from .9 to 1.0
     *
     * Until we get the above suggestion working, we use the following
     * tuning:
     *   compression ratio    res_factor
     *   5.5  (256kbps)         1.0      no need for bitreservoir
     *   11   (128kbps)         .93      7% held for reservoir
     *
     * with linear interpolation for other values.
     */
    res_factor =
      0.93 + (0.07 * (11.0 - gfp.compression_ratio)) / (11.0 - 5.5);
    if (res_factor < 0.9) res_factor = 0.9;
    if (res_factor > 1.0) res_factor = 1.0;

    for (gr = 0; gr < gfc.mode_gr; gr++) {
      let sum = 0;
      for (ch = 0; ch < gfc.channels_out; ch++) {
        targ_bits[gr][ch] = (res_factor * mean_bits) | 0;

        if (pe[gr][ch] > 700) {
          let add_bits = ((pe[gr][ch] - 700) / 1.4) | 0;

          let cod_info = l3_side.tt[gr][ch];
          targ_bits[gr][ch] = (res_factor * mean_bits) | 0;

          /* short blocks use a little extra, no matter what the pe */
          if (cod_info.block_type === SHORT_TYPE) {
            if (add_bits < ((mean_bits / 2) | 0)) add_bits = (mean_bits / 2) | 0;
          }
          /* at most increase bits by 1.5*average */
          if (add_bits > (((mean_bits * 3) / 2) | 0))
            add_bits = ((mean_bits * 3) / 2) | 0;
          else if (add_bits < 0) add_bits = 0;

          targ_bits[gr][ch] += add_bits;
        }
        if (targ_bits[gr][ch] > LameInternalFlags.MAX_BITS_PER_CHANNEL) {
          targ_bits[gr][ch] = LameInternalFlags.MAX_BITS_PER_CHANNEL;
        }
        sum += targ_bits[gr][ch];
      } /* for ch */
      if (sum > LameInternalFlags.MAX_BITS_PER_GRANULE) {
        for (ch = 0; ch < gfc.channels_out; ++ch) {
          targ_bits[gr][ch] *= LameInternalFlags.MAX_BITS_PER_GRANULE;
          targ_bits[gr][ch] /= sum;
        }
      }
    } /* for gr */

    if (gfc.mode_ext === MPG_MD_MS_LR)
      for (gr = 0; gr < gfc.mode_gr; gr++) {
        this.qupvt.reduce_side(
          targ_bits[gr],
          ms_ener_ratio[gr],
          mean_bits * gfc.channels_out,
          LameInternalFlags.MAX_BITS_PER_GRANULE,
        );
      }

    /*
     * sum target bits
     */
    totbits = 0;
    for (gr = 0; gr < gfc.mode_gr; gr++) {
      for (ch = 0; ch < gfc.channels_out; ch++) {
        if (targ_bits[gr][ch] > LameInternalFlags.MAX_BITS_PER_CHANNEL)
          targ_bits[gr][ch] = LameInternalFlags.MAX_BITS_PER_CHANNEL;
        totbits += targ_bits[gr][ch];
      }
    }

    /*
     * repartition target bits if needed
     */
    if (totbits > max_frame_bits[0]) {
      for (gr = 0; gr < gfc.mode_gr; gr++) {
        for (ch = 0; ch < gfc.channels_out; ch++) {
          targ_bits[gr][ch] *= max_frame_bits[0];
          targ_bits[gr][ch] /= totbits;
        }
      }
    }
  }
}

/**
 * Sort a subrange of a Float32Array in place.
 * Java's Arrays.sort(arr, fromIndex, toIndex) sorts [fromIndex, toIndex).
 * The lamejs call passes (work, j - width, width) which is
 * Arrays.sort(array, offset, length) -- but Java Arrays.sort uses fromIndex and toIndex.
 * In the original Java code: Arrays.sort(work, j - width, width);
 * which actually sorts the slice [j-width, width) -- matching the lamejs behaviour.
 * We replicate the lamejs call semantics: sort(arr, from, to)
 */
function Arrays_sort(arr: Float32Array, from: number, to: number): void {
  // Extract, sort, write back
  let slice = Array.prototype.slice.call(arr, from, to) as number[];
  slice.sort((a: number, b: number) => a - b);
  for (let i = 0; i < slice.length; i++) {
    arr[from + i] = slice[i];
  }
}
