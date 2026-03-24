import { new_int, new_float, fill, assert } from './common.js';
import { SHORT_TYPE } from './constants.js';
import type { GrInfo } from './GrInfo.js';
import { LameInternalFlags } from './LameInternalFlags.js';
import { L3Side } from './L3Side.js';
import type { QuantizePVT } from './QuantizePVT.js';
import type { Takehiro } from './Takehiro.js';

/*
 * QuantizePVT constants inlined here to avoid circular dependency.
 * These match IXMAX_VAL, Q_MAX2, and LARGE_BITS.
 */
const IXMAX_VAL = 8206;
const Q_MAX2 = 116;
const LARGE_BITS = 100000;

/* ------------------------------------------------------------------ */
/*  helper types                                                       */
/* ------------------------------------------------------------------ */

interface AllocSfFunc {
  alloc(al: AlgoT, x: Int32Array, y: Int32Array, z: number): void;
}

class AlgoT {
  alloc!: AllocSfFunc;
  xr34orig!: Float32Array;
  gfc!: LameInternalFlags;
  cod_info!: GrInfo;
  mingain_l = 0;
  mingain_s = new_int(3);
}

class CalcNoiseCache {
  valid = 0;
  value = 0;
}

/* ------------------------------------------------------------------ */
/*  constraint strategy classes (inner classes in Java)                 */
/* ------------------------------------------------------------------ */

class ShortBlockConstrain implements AllocSfFunc {
  private readonly outer: VBRQuantize;
  constructor(outer: VBRQuantize) {
    this.outer = outer;
  }

  alloc(that: AlgoT, sf: Int32Array, vbrsfmin: Int32Array, vbrmax: number): void {
    const outer = this.outer;
    const cod_info = that.cod_info;

    outer.set_subblock_gain(cod_info, that.mingain_s, sf);
    outer.set_scalefacs(cod_info, vbrsfmin, sf, VBRQuantize.max_range_short);

    assert(outer.checkScalefactor(cod_info, vbrsfmin));

    /* -- global gain -- */
    let maxover0 = 0;
    for (let sfb = 0; sfb < cod_info.psymax; ++sfb) {
      const v = -(sf[sfb]);
      if (maxover0 < v) {
        maxover0 = v;
      }
    }
    vbrmax = -maxover0;
    if (vbrmax < 0) {
      vbrmax = 0;
    }
    if (vbrmax > 255) {
      vbrmax = 255;
    }
    cod_info.global_gain = vbrmax;
  }
}

class LongBlockConstrain implements AllocSfFunc {
  private readonly outer: VBRQuantize;
  constructor(outer: VBRQuantize) {
    this.outer = outer;
  }

  alloc(that: AlgoT, sf: Int32Array, vbrsfmin: Int32Array, vbrmax: number): void {
    const outer = this.outer;
    const cod_info = that.cod_info;
    const qupvt = outer.qupvt!;
    const max_rangep = (cod_info.preflag !== 0)
      ? VBRQuantize.max_range_long_lsf_pretab
      : VBRQuantize.max_range_long;

    outer.set_scalefacs(cod_info, vbrsfmin, sf, max_rangep);

    assert(outer.checkScalefactor(cod_info, vbrsfmin));

    /* -- global gain -- */
    let maxover0 = 0;
    for (let sfb = 0; sfb < cod_info.psymax; ++sfb) {
      const v = -(sf[sfb]);
      if (maxover0 < v) {
        maxover0 = v;
      }
    }
    vbrmax = -maxover0;
    if (vbrmax < 0) {
      vbrmax = 0;
    }
    if (vbrmax > 255) {
      vbrmax = 255;
    }
    cod_info.global_gain = vbrmax;
  }
}

/* ------------------------------------------------------------------ */
/*  main class                                                         */
/* ------------------------------------------------------------------ */

export class VBRQuantize {
  /* ---- static tables ---- */
  static readonly max_range_short: Int32Array = Int32Array.from([
    15, 15, 15, 15, 15, 15,
    15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15, 15,
    7, 7, 7, 7, 7, 7,
    7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
    0, 0, 0,
  ]);
  static readonly max_range_long: Int32Array = Int32Array.from([
    15, 15, 15, 15, 15, 15, 15,
    15, 15, 15, 15, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 0,
  ]);
  static readonly max_range_long_lsf_pretab: Int32Array = Int32Array.from([
    7, 7, 7, 7, 7,
    7, 3, 3, 3, 3, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);

  /* ---- module references (set via init) ---- */
  qupvt!: QuantizePVT;
  tak!: Takehiro;

  init(qupvt: QuantizePVT, tk: Takehiro): void {
    this.qupvt = qupvt;
    this.tak = tk;
  }

  /* ================================================================ */
  /*  private helpers                                                   */
  /* ================================================================ */

  private max_x34(xr34: Float32Array, x34Pos: number, bw: number): number {
    let xfsf = 0;
    let j = bw >> 1;
    const remaining = j & 0x01;

    for (j >>= 1; j > 0; --j) {
      if (xfsf < xr34[x34Pos + 0]) {
        xfsf = xr34[x34Pos + 0];
      }
      if (xfsf < xr34[x34Pos + 1]) {
        xfsf = xr34[x34Pos + 1];
      }
      if (xfsf < xr34[x34Pos + 2]) {
        xfsf = xr34[x34Pos + 2];
      }
      if (xfsf < xr34[x34Pos + 3]) {
        xfsf = xr34[x34Pos + 3];
      }
      x34Pos += 4;
    }
    if (remaining !== 0) {
      if (xfsf < xr34[x34Pos + 0]) {
        xfsf = xr34[x34Pos + 0];
      }
      if (xfsf < xr34[x34Pos + 1]) {
        xfsf = xr34[x34Pos + 1];
      }
    }
    return xfsf;
  }

  private findLowestScalefac(xr34: number): number {
    let sfOk = 255;
    let sf = 128;
    let delsf = 64;
    for (let i = 0; i < 8; ++i) {
      const xfsf = this.qupvt.ipow20[sf] * xr34;
      if (xfsf <= IXMAX_VAL) {
        sfOk = sf;
        sf -= delsf;
      } else {
        sf += delsf;
      }
      delsf >>= 1;
    }
    return sfOk;
  }

  private belowNoiseFloor(
    xr: Float32Array,
    xrPos: number,
    l3xmin: number,
    bw: number,
  ): number {
    let sum = 0.0;
    for (let i = 0, j = bw; j > 0; ++i, --j) {
      const x = xr[xrPos + i];
      sum += x * x;
    }
    return (l3xmin - sum) >= -1e-20 ? 1 : 0;
  }

  private k_34_4(x: Float64Array, l3: Int32Array, l3Pos: number): void {
    assert(
      x[0] <= IXMAX_VAL &&
      x[1] <= IXMAX_VAL &&
      x[2] <= IXMAX_VAL &&
      x[3] <= IXMAX_VAL,
    );
    l3[l3Pos + 0] = x[0] | 0;
    l3[l3Pos + 1] = x[1] | 0;
    l3[l3Pos + 2] = x[2] | 0;
    l3[l3Pos + 3] = x[3] | 0;
    x[0] += this.qupvt.adj43[l3[l3Pos + 0]];
    x[1] += this.qupvt.adj43[l3[l3Pos + 1]];
    x[2] += this.qupvt.adj43[l3[l3Pos + 2]];
    x[3] += this.qupvt.adj43[l3[l3Pos + 3]];
    l3[l3Pos + 0] = x[0] | 0;
    l3[l3Pos + 1] = x[1] | 0;
    l3[l3Pos + 2] = x[2] | 0;
    l3[l3Pos + 3] = x[3] | 0;
  }

  private k_34_2(x: Float64Array, l3: Int32Array, l3Pos: number): void {
    assert(
      x[0] <= IXMAX_VAL &&
      x[1] <= IXMAX_VAL,
    );
    l3[l3Pos + 0] = x[0] | 0;
    l3[l3Pos + 1] = x[1] | 0;
    x[0] += this.qupvt.adj43[l3[l3Pos + 0]];
    x[1] += this.qupvt.adj43[l3[l3Pos + 1]];
    l3[l3Pos + 0] = x[0] | 0;
    l3[l3Pos + 1] = x[1] | 0;
  }

  private calc_sfb_noise_x34(
    xr: Float32Array,
    xr34: Float32Array,
    xrPos: number,
    bw: number,
    sf: number,
  ): number {
    const x = new Float64Array(4);
    const l3 = new Int32Array(4);
    const sfpow = this.qupvt.pow20[sf + Q_MAX2];
    const sfpow34 = this.qupvt.ipow20[sf];

    let xfsf = 0;
    let j = bw >> 1;
    const remaining = j & 0x01;

    for (j >>= 1; j > 0; --j) {
      x[0] = sfpow34 * xr34[xrPos + 0];
      x[1] = sfpow34 * xr34[xrPos + 1];
      x[2] = sfpow34 * xr34[xrPos + 2];
      x[3] = sfpow34 * xr34[xrPos + 3];

      this.k_34_4(x, l3, 0);

      x[0] = Math.abs(xr[xrPos + 0]) - sfpow * this.qupvt.pow43[l3[0]];
      x[1] = Math.abs(xr[xrPos + 1]) - sfpow * this.qupvt.pow43[l3[1]];
      x[2] = Math.abs(xr[xrPos + 2]) - sfpow * this.qupvt.pow43[l3[2]];
      x[3] = Math.abs(xr[xrPos + 3]) - sfpow * this.qupvt.pow43[l3[3]];
      xfsf += (x[0] * x[0] + x[1] * x[1]) + (x[2] * x[2] + x[3] * x[3]);

      xrPos += 4;
    }
    if (remaining !== 0) {
      x[0] = sfpow34 * xr34[xrPos + 0];
      x[1] = sfpow34 * xr34[xrPos + 1];

      this.k_34_2(x, l3, 0);

      x[0] = Math.abs(xr[xrPos + 0]) - sfpow * this.qupvt.pow43[l3[0]];
      x[1] = Math.abs(xr[xrPos + 1]) - sfpow * this.qupvt.pow43[l3[1]];
      xfsf += x[0] * x[0] + x[1] * x[1];
    }
    return xfsf;
  }

  private tri_calc_sfb_noise_x34(
    xr: Float32Array,
    xr34: Float32Array,
    xrPos: number,
    l3_xmin: number,
    bw: number,
    sf: number,
    did_it: CalcNoiseCache[],
  ): boolean {
    if (did_it[sf].valid === 0) {
      did_it[sf].valid = 1;
      did_it[sf].value = this.calc_sfb_noise_x34(xr, xr34, xrPos, bw, sf);
    }
    if (l3_xmin < did_it[sf].value) {
      return true;
    }
    if (sf < 255) {
      const sf_x = sf + 1;
      if (did_it[sf_x].valid === 0) {
        did_it[sf_x].valid = 1;
        did_it[sf_x].value = this.calc_sfb_noise_x34(xr, xr34, xrPos, bw, sf_x);
      }
      if (l3_xmin < did_it[sf_x].value) {
        return true;
      }
    }
    if (sf > 0) {
      const sf_x = sf - 1;
      if (did_it[sf_x].valid === 0) {
        did_it[sf_x].valid = 1;
        did_it[sf_x].value = this.calc_sfb_noise_x34(xr, xr34, xrPos, bw, sf_x);
      }
      if (l3_xmin < did_it[sf_x].value) {
        return true;
      }
    }
    return false;
  }

  /**
   * the find_scalefac* routines calculate a quantization step size which
   * would introduce as much noise as is allowed. The larger the step size the
   * more quantization noise we'll get. The scalefactors are there to lower
   * the global step size, allowing limited differences in quantization step
   * sizes per band (shaping the noise).
   */
  private find_scalefac_x34(
    xr: Float32Array,
    xr34: Float32Array,
    xrPos: number,
    l3_xmin: number,
    bw: number,
    sf_min: number,
  ): number {
    const did_it: CalcNoiseCache[] = new Array(256);
    let sf = 128;
    let sf_ok = 255;
    let delsf = 128;
    let seen_good_one = 0;
    for (let j = 0; j < did_it.length; j++) {
      did_it[j] = new CalcNoiseCache();
    }
    for (let i = 0; i < 8; ++i) {
      delsf >>= 1;
      if (sf <= sf_min) {
        sf += delsf;
      } else {
        const bad = this.tri_calc_sfb_noise_x34(
          xr, xr34, xrPos, l3_xmin, bw, sf, did_it,
        );
        if (bad) {
          /* distortion. try a smaller scalefactor */
          sf -= delsf;
        } else {
          sf_ok = sf;
          sf += delsf;
          seen_good_one = 1;
        }
      }
    }
    /* returning a scalefac without distortion, if possible */
    if (seen_good_one > 0) {
      return sf_ok;
    }
    if (sf <= sf_min) {
      return sf_min;
    }
    return sf;
  }

  /**
   * calc_short_block_vbr_sf(), calc_long_block_vbr_sf()
   *
   * a variation for vbr-mtrh
   */
  private block_sf(
    that: AlgoT,
    l3_xmin: Float32Array,
    vbrsf: Int32Array,
    vbrsfmin: Int32Array,
  ): number {
    let max_xr34: number;
    const xr = that.cod_info.xr;
    const xr34_orig = that.xr34orig;
    const width = that.cod_info.width;
    const max_nonzero_coeff = that.cod_info.max_nonzero_coeff;
    let maxsf = 0;
    let sfb = 0;
    let j = 0;
    let i = 0;
    const psymax = that.cod_info.psymax;

    assert(that.cod_info.max_nonzero_coeff >= 0);

    that.mingain_l = 0;
    that.mingain_s[0] = 0;
    that.mingain_s[1] = 0;
    that.mingain_s[2] = 0;
    while (j <= max_nonzero_coeff) {
      const w = width[sfb];
      const m = max_nonzero_coeff - j + 1;
      let l = w;
      let m1: number;
      let m2: number;
      if (l > m) {
        l = m;
      }
      max_xr34 = this.max_x34(xr34_orig, j, l);

      m1 = this.findLowestScalefac(max_xr34);
      vbrsfmin[sfb] = m1;
      if (that.mingain_l < m1) {
        that.mingain_l = m1;
      }
      if (that.mingain_s[i] < m1) {
        that.mingain_s[i] = m1;
      }
      if (++i > 2) {
        i = 0;
      }
      if (sfb < psymax) {
        if (this.belowNoiseFloor(xr, j, l3_xmin[sfb], l) === 0) {
          m2 = this.find_scalefac_x34(xr, xr34_orig, j, l3_xmin[sfb], l, m1);
          if (maxsf < m2) {
            maxsf = m2;
          }
        } else {
          m2 = 255;
          maxsf = 255;
        }
      } else {
        if (maxsf < m1) {
          maxsf = m1;
        }
        m2 = maxsf;
      }
      vbrsf[sfb] = m2;
      ++sfb;
      j += w;
    }
    for (; sfb < L3Side.SFBMAX; ++sfb) {
      vbrsf[sfb] = maxsf;
      vbrsfmin[sfb] = 0;
    }
    return maxsf;
  }

  /**
   * quantize xr34 based on scalefactors
   *
   * block_xr34
   */
  private quantize_x34(that: AlgoT): void {
    const x = new Float64Array(4);
    let xr34_orig = 0;
    const cod_info = that.cod_info;
    const ifqstep = cod_info.scalefac_scale === 0 ? 2 : 4;
    let l3 = 0;
    let j = 0;
    let sfb = 0;
    const max_nonzero_coeff = cod_info.max_nonzero_coeff;

    assert(cod_info.max_nonzero_coeff >= 0);
    assert(cod_info.max_nonzero_coeff < 576);

    while (j <= max_nonzero_coeff) {
      const s =
        (cod_info.scalefac[sfb] +
          (cod_info.preflag !== 0 ? this.qupvt.pretab[sfb] : 0)) *
          ifqstep +
        cod_info.subblock_gain[cod_info.window[sfb]] * 8;
      const sfac = cod_info.global_gain - s;
      const sfpow34 = this.qupvt.ipow20[sfac];
      const w = cod_info.width[sfb];
      const m = max_nonzero_coeff - j + 1;
      let l = w;
      let remaining: number;

      assert(cod_info.global_gain - s >= 0);
      assert(cod_info.width[sfb] >= 0);

      if (l > m) {
        l = m;
      }
      j += w;
      ++sfb;
      l >>= 1;
      remaining = l & 1;

      for (l >>= 1; l > 0; --l) {
        x[0] = sfpow34 * that.xr34orig[xr34_orig + 0];
        x[1] = sfpow34 * that.xr34orig[xr34_orig + 1];
        x[2] = sfpow34 * that.xr34orig[xr34_orig + 2];
        x[3] = sfpow34 * that.xr34orig[xr34_orig + 3];

        this.k_34_4(x, cod_info.l3_enc, l3);

        l3 += 4;
        xr34_orig += 4;
      }
      if (remaining !== 0) {
        x[0] = sfpow34 * that.xr34orig[xr34_orig + 0];
        x[1] = sfpow34 * that.xr34orig[xr34_orig + 1];

        this.k_34_2(x, cod_info.l3_enc, l3);

        l3 += 2;
        xr34_orig += 2;
      }
    }
  }

  set_subblock_gain(
    cod_info: GrInfo,
    mingain_s: Int32Array,
    sf: Int32Array,
  ): void {
    const maxrange1 = 15;
    const maxrange2 = 7;
    const ifqstepShift = cod_info.scalefac_scale === 0 ? 1 : 2;
    const sbg = cod_info.subblock_gain;
    const psymax = cod_info.psymax | 0;
    let psydiv = 18;
    let sbg0: number;
    let sbg1: number;
    let sbg2: number;
    let sfb: number;
    let min_sbg = 7;

    if (psydiv > psymax) {
      psydiv = psymax;
    }
    for (let i = 0; i < 3; ++i) {
      let maxsf1 = 0;
      let maxsf2 = 0;
      let minsf = 1000;
      /* see if we should use subblock gain */
      for (sfb = i; sfb < psydiv; sfb += 3) {
        /* part 1 */
        const v = -sf[sfb];
        if (maxsf1 < v) {
          maxsf1 = v;
        }
        if (minsf > v) {
          minsf = v;
        }
      }
      for (; sfb < L3Side.SFBMAX; sfb += 3) {
        /* part 2 */
        const v = -sf[sfb];
        if (maxsf2 < v) {
          maxsf2 = v;
        }
        if (minsf > v) {
          minsf = v;
        }
      }

      /*
       * boost subblock gain as little as possible so we can reach maxsf1
       * with scalefactors 8*sbg >= maxsf1
       */
      {
        const m1 = maxsf1 - (maxrange1 << ifqstepShift);
        const m2 = maxsf2 - (maxrange2 << ifqstepShift);
        maxsf1 = Math.max(m1, m2);
      }
      if (minsf > 0) {
        sbg[i] = minsf >> 3;
      } else {
        sbg[i] = 0;
      }
      if (maxsf1 > 0) {
        const m1 = sbg[i];
        const m2 = (maxsf1 + 7) >> 3;
        sbg[i] = Math.max(m1, m2);
      }
      if (sbg[i] > 0 && mingain_s[i] > (cod_info.global_gain - sbg[i] * 8)) {
        sbg[i] = (cod_info.global_gain - mingain_s[i]) >> 3;
      }
      if (sbg[i] > 7) {
        sbg[i] = 7;
      }
      if (min_sbg > sbg[i]) {
        min_sbg = sbg[i];
      }
    }
    sbg0 = sbg[0] * 8;
    sbg1 = sbg[1] * 8;
    sbg2 = sbg[2] * 8;
    for (sfb = 0; sfb < L3Side.SFBMAX; sfb += 3) {
      sf[sfb + 0] += sbg0;
      sf[sfb + 1] += sbg1;
      sf[sfb + 2] += sbg2;
    }
    if (min_sbg > 0) {
      for (let i = 0; i < 3; ++i) {
        sbg[i] -= min_sbg;
      }
      cod_info.global_gain -= min_sbg * 8;
    }
  }

  set_scalefacs(
    cod_info: GrInfo,
    vbrsfmin: Int32Array,
    sf: Int32Array,
    max_range: Int32Array,
  ): void {
    const ifqstep = cod_info.scalefac_scale === 0 ? 2 : 4;
    const ifqstepShift = cod_info.scalefac_scale === 0 ? 1 : 2;
    const scalefac = cod_info.scalefac;
    const sfbmax = cod_info.sfbmax;
    const sbg = cod_info.subblock_gain;
    const window = cod_info.window;
    const preflag = cod_info.preflag;

    if (preflag !== 0) {
      for (let sfb = 11; sfb < sfbmax; ++sfb) {
        sf[sfb] += this.qupvt.pretab[sfb] * ifqstep;
      }
    }
    for (let sfb = 0; sfb < sfbmax; ++sfb) {
      const gain =
        cod_info.global_gain -
        sbg[window[sfb]] * 8 -
        (preflag !== 0 ? this.qupvt.pretab[sfb] : 0) * ifqstep;

      if (sf[sfb] < 0) {
        const m = gain - vbrsfmin[sfb];
        /* ifqstep*scalefac >= -sf[sfb], so round UP */
        scalefac[sfb] = (ifqstep - 1 - sf[sfb]) >> ifqstepShift;

        if (scalefac[sfb] > max_range[sfb]) {
          scalefac[sfb] = max_range[sfb];
        }
        if (scalefac[sfb] > 0 && (scalefac[sfb] << ifqstepShift) > m) {
          scalefac[sfb] = m >> ifqstepShift;
        }
      } else {
        scalefac[sfb] = 0;
      }
    }
    for (let sfb = sfbmax; sfb < L3Side.SFBMAX; ++sfb) {
      scalefac[sfb] = 0; /* sfb21 */
    }
  }

  checkScalefactor(cod_info: GrInfo, vbrsfmin: Int32Array): boolean {
    const ifqstep = cod_info.scalefac_scale === 0 ? 2 : 4;
    for (let sfb = 0; sfb < cod_info.psymax; ++sfb) {
      const s =
        (cod_info.scalefac[sfb] +
          (cod_info.preflag !== 0 ? this.qupvt.pretab[sfb] : 0)) *
          ifqstep +
        cod_info.subblock_gain[cod_info.window[sfb]] * 8;

      if (cod_info.global_gain - s < vbrsfmin[sfb]) {
        return false;
      }
    }
    return true;
  }

  private bitcount(that: AlgoT): void {
    let rc: boolean;

    if (that.gfc.mode_gr === 2) {
      rc = this.tak.scale_bitcount(that.cod_info);
    } else {
      rc = this.tak.scale_bitcount_lsf(that.gfc, that.cod_info);
    }
    if (!rc) {
      return;
    }
    /* this should not happen due to the way the scalefactors are selected */
    throw new Error(
      'INTERNAL ERROR IN VBR NEW CODE (986), please send bug report',
    );
  }

  private quantizeAndCountBits(that: AlgoT): number {
    this.quantize_x34(that);
    that.cod_info.part2_3_length = this.tak.noquant_count_bits(
      that.gfc,
      that.cod_info,
      null,
    );
    return that.cod_info.part2_3_length;
  }

  private tryGlobalStepsize(
    that: AlgoT,
    sfwork: Int32Array,
    vbrsfmin: Int32Array,
    delta: number,
  ): number {
    const xrpow_max = that.cod_info.xrpow_max;
    const sftemp = new_int(L3Side.SFBMAX);
    let nbits: number;
    let vbrmax = 0;
    for (let i = 0; i < L3Side.SFBMAX; ++i) {
      let gain = sfwork[i] + delta;
      if (gain < vbrsfmin[i]) {
        gain = vbrsfmin[i];
      }
      if (gain > 255) {
        gain = 255;
      }
      if (vbrmax < gain) {
        vbrmax = gain;
      }
      sftemp[i] = gain;
    }
    that.alloc.alloc(that, sftemp, vbrsfmin, vbrmax);
    this.bitcount(that);
    nbits = this.quantizeAndCountBits(that);
    that.cod_info.xrpow_max = xrpow_max;
    return nbits;
  }

  private searchGlobalStepsizeMax(
    that: AlgoT,
    sfwork: Int32Array,
    vbrsfmin: Int32Array,
    target: number,
  ): void {
    const cod_info = that.cod_info;
    const gain = cod_info.global_gain;
    let curr = gain;
    let gain_ok = 1024;
    let nbits = LARGE_BITS;
    let l = gain;
    let r = 512;

    assert(gain >= 0);
    while (l <= r) {
      curr = (l + r) >> 1;
      nbits = this.tryGlobalStepsize(that, sfwork, vbrsfmin, curr - gain);
      if (nbits === 0 || nbits + cod_info.part2_length < target) {
        r = curr - 1;
        gain_ok = curr;
      } else {
        l = curr + 1;
        if (gain_ok === 1024) {
          gain_ok = curr;
        }
      }
    }
    if (gain_ok !== curr) {
      curr = gain_ok;
      nbits = this.tryGlobalStepsize(that, sfwork, vbrsfmin, curr - gain);
    }
  }

  private sfDepth(sfwork: Int32Array): number {
    let m = 0;
    for (let j = L3Side.SFBMAX, i = 0; j > 0; --j, ++i) {
      const di = 255 - sfwork[i];
      if (m < di) {
        m = di;
      }
      assert(sfwork[i] >= 0);
      assert(sfwork[i] <= 255);
    }
    assert(m >= 0);
    assert(m <= 255);
    return m;
  }

  private cutDistribution(
    sfwork: Int32Array,
    sf_out: Int32Array,
    cut: number,
  ): void {
    for (let j = L3Side.SFBMAX, i = 0; j > 0; --j, ++i) {
      const x = sfwork[i];
      sf_out[i] = x < cut ? x : cut;
    }
  }

  private flattenDistribution(
    sfwork: Int32Array,
    sf_out: Int32Array,
    dm: number,
    k: number,
    p: number,
  ): number {
    let sfmax = 0;
    if (dm > 0) {
      for (let j = L3Side.SFBMAX, i = 0; j > 0; --j, ++i) {
        const di = p - sfwork[i];
        let x = (sfwork[i] + (((k * di) / dm) | 0)) | 0;
        if (x < 0) {
          x = 0;
        } else {
          if (x > 255) {
            x = 255;
          }
        }
        sf_out[i] = x;
        if (sfmax < x) {
          sfmax = x;
        }
      }
    } else {
      for (let j = L3Side.SFBMAX, i = 0; j > 0; --j, ++i) {
        let x = sfwork[i];
        sf_out[i] = x;
        if (sfmax < x) {
          sfmax = x;
        }
      }
    }
    return sfmax;
  }

  private tryThatOne(
    that: AlgoT,
    sftemp: Int32Array,
    vbrsfmin: Int32Array,
    vbrmax: number,
  ): number {
    const xrpow_max = that.cod_info.xrpow_max;
    let nbits = LARGE_BITS;
    that.alloc.alloc(that, sftemp, vbrsfmin, vbrmax);
    this.bitcount(that);
    nbits = this.quantizeAndCountBits(that);
    nbits += that.cod_info.part2_length;
    that.cod_info.xrpow_max = xrpow_max;
    return nbits;
  }

  private outOfBitsStrategy(
    that: AlgoT,
    sfwork: Int32Array,
    vbrsfmin: Int32Array,
    target: number,
  ): void {
    const wrk = new_int(L3Side.SFBMAX);
    const dm = this.sfDepth(sfwork);
    const p = that.cod_info.global_gain;

    /* PART 1 */
    {
      let bi = (dm / 2) | 0;
      let bi_ok = -1;
      let bu = 0;
      let bo = dm;
      for (;;) {
        const sfmax = this.flattenDistribution(sfwork, wrk, dm, bi, p);
        let nbits = this.tryThatOne(that, wrk, vbrsfmin, sfmax);
        if (nbits <= target) {
          bi_ok = bi;
          bo = bi - 1;
        } else {
          bu = bi + 1;
        }
        if (bu <= bo) {
          bi = (bu + bo) >> 1;
        } else {
          break;
        }
      }
      if (bi_ok >= 0) {
        if (bi !== bi_ok) {
          const sfmax = this.flattenDistribution(sfwork, wrk, dm, bi_ok, p);
          this.tryThatOne(that, wrk, vbrsfmin, sfmax);
        }
        return;
      }
    }

    /* PART 2: */
    {
      let bi = (255 + p) >> 1;
      let bi_ok = -1;
      let bu = p;
      let bo = 255;
      for (;;) {
        const sfmax = this.flattenDistribution(sfwork, wrk, dm, dm, bi);
        let nbits = this.tryThatOne(that, wrk, vbrsfmin, sfmax);
        if (nbits <= target) {
          bi_ok = bi;
          bo = bi - 1;
        } else {
          bu = bi + 1;
        }
        if (bu <= bo) {
          bi = (bu + bo) >> 1;
        } else {
          break;
        }
      }
      if (bi_ok >= 0) {
        if (bi !== bi_ok) {
          const sfmax = this.flattenDistribution(sfwork, wrk, dm, dm, bi_ok);
          this.tryThatOne(that, wrk, vbrsfmin, sfmax);
        }
        return;
      }
    }

    /* fall back to old code, likely to be never called */
    this.searchGlobalStepsizeMax(that, wrk, vbrsfmin, target);
  }

  private reduce_bit_usage(
    gfc: LameInternalFlags,
    gr: number,
    ch: number,
  ): number {
    const cod_info = gfc.l3_side.tt[gr][ch];
    /* try some better scalefac storage */
    this.tak.best_scalefac_store(gfc, gr, ch, gfc.l3_side);

    /* best huffman_divide may save some bits too */
    if (gfc.use_best_huffman === 1) {
      this.tak.best_huffman_divide(gfc, cod_info);
    }
    return cod_info.part2_3_length + cod_info.part2_length;
  }

  /* ================================================================ */
  /*  public API                                                       */
  /* ================================================================ */

  VBR_encode_frame(
    gfc: LameInternalFlags,
    xr34orig: Float32Array[][],
    l3_xmin: Float32Array[][],
    max_bits: Int32Array[],
  ): number {
    const sfwork_: Int32Array[][] = [
      [new_int(L3Side.SFBMAX), new_int(L3Side.SFBMAX)],
      [new_int(L3Side.SFBMAX), new_int(L3Side.SFBMAX)],
    ];
    const vbrsfmin_: Int32Array[][] = [
      [new_int(L3Side.SFBMAX), new_int(L3Side.SFBMAX)],
      [new_int(L3Side.SFBMAX), new_int(L3Side.SFBMAX)],
    ];
    const that_: AlgoT[][] = [
      [new AlgoT(), new AlgoT()],
      [new AlgoT(), new AlgoT()],
    ];
    const ngr = gfc.mode_gr;
    const nch = gfc.channels_out;
    const max_nbits_ch: number[][] = [
      [0, 0],
      [0, 0],
    ];
    const max_nbits_gr: number[] = [0, 0];
    let max_nbits_fr = 0;
    const use_nbits_ch: number[][] = [
      [0, 0],
      [0, 0],
    ];
    const use_nbits_gr: number[] = [0, 0];
    let use_nbits_fr = 0;

    /*
     * set up some encoding parameters
     */
    for (let gr = 0; gr < ngr; ++gr) {
      max_nbits_gr[gr] = 0;
      for (let ch = 0; ch < nch; ++ch) {
        max_nbits_ch[gr][ch] = max_bits[gr][ch];
        use_nbits_ch[gr][ch] = 0;
        max_nbits_gr[gr] += max_bits[gr][ch];
        max_nbits_fr += max_bits[gr][ch];
        that_[gr][ch] = new AlgoT();
        that_[gr][ch].gfc = gfc;
        that_[gr][ch].cod_info = gfc.l3_side.tt[gr][ch];
        that_[gr][ch].xr34orig = xr34orig[gr][ch];
        if (that_[gr][ch].cod_info.block_type === SHORT_TYPE) {
          that_[gr][ch].alloc = new ShortBlockConstrain(this);
        } else {
          that_[gr][ch].alloc = new LongBlockConstrain(this);
        }
      } /* for ch */
    }

    /*
     * searches scalefactors
     */
    for (let gr = 0; gr < ngr; ++gr) {
      for (let ch = 0; ch < nch; ++ch) {
        if (max_bits[gr][ch] > 0) {
          let that = that_[gr][ch];
          let sfwork = sfwork_[gr][ch];
          let vbrsfmin = vbrsfmin_[gr][ch];
          let vbrmax: number;

          vbrmax = this.block_sf(that, l3_xmin[gr][ch], sfwork, vbrsfmin);
          that.alloc.alloc(that, sfwork, vbrsfmin, vbrmax);
          this.bitcount(that);
        } else {
          /*
           * xr contains no energy l3_enc, our encoding data, will be
           * quantized to zero continue with next channel
           */
        }
      } /* for ch */
    }

    /*
     * encode 'as is'
     */
    use_nbits_fr = 0;
    for (let gr = 0; gr < ngr; ++gr) {
      use_nbits_gr[gr] = 0;
      for (let ch = 0; ch < nch; ++ch) {
        let that = that_[gr][ch];
        if (max_bits[gr][ch] > 0) {
          const max_nonzero_coeff = that.cod_info.max_nonzero_coeff;

          assert(max_nonzero_coeff < 576);
          fill(that.cod_info.l3_enc, 0, max_nonzero_coeff, 576);

          this.quantizeAndCountBits(that);
        } else {
          /*
           * xr contains no energy l3_enc, our encoding data, will be
           * quantized to zero continue with next channel
           */
        }
        use_nbits_ch[gr][ch] = this.reduce_bit_usage(gfc, gr, ch);
        use_nbits_gr[gr] += use_nbits_ch[gr][ch];
      } /* for ch */
      use_nbits_fr += use_nbits_gr[gr];
    }

    /*
     * check bit constrains
     */
    if (use_nbits_fr <= max_nbits_fr) {
      let ok = true;
      for (let gr = 0; gr < ngr; ++gr) {
        if (use_nbits_gr[gr] > LameInternalFlags.MAX_BITS_PER_GRANULE) {
          /*
           * violates the rule that every granule has to use no more
           * bits than MAX_BITS_PER_GRANULE
           */
          ok = false;
        }
        for (let ch = 0; ch < nch; ++ch) {
          if (use_nbits_ch[gr][ch] > LameInternalFlags.MAX_BITS_PER_CHANNEL) {
            /*
             * violates the rule that every gr_ch has to use no more
             * bits than MAX_BITS_PER_CHANNEL
             *
             * This isn't explicitly stated in the ISO docs, but the
             * part2_3_length field has only 12 bits, that makes it
             * up to a maximum size of 4095 bits!!!
             */
            ok = false;
          }
        }
      }
      if (ok) {
        return use_nbits_fr;
      }
    }

    /*
     * OK, we are in trouble and have to define how many bits are to be used
     * for each granule
     */
    {
      let ok = true;
      let sum_fr = 0;

      for (let gr = 0; gr < ngr; ++gr) {
        max_nbits_gr[gr] = 0;
        for (let ch = 0; ch < nch; ++ch) {
          if (use_nbits_ch[gr][ch] > LameInternalFlags.MAX_BITS_PER_CHANNEL) {
            max_nbits_ch[gr][ch] = LameInternalFlags.MAX_BITS_PER_CHANNEL;
          } else {
            max_nbits_ch[gr][ch] = use_nbits_ch[gr][ch];
          }
          max_nbits_gr[gr] += max_nbits_ch[gr][ch];
        }
        if (max_nbits_gr[gr] > LameInternalFlags.MAX_BITS_PER_GRANULE) {
          let f = new_float(2);
          let s = 0;
          for (let ch = 0; ch < nch; ++ch) {
            if (max_nbits_ch[gr][ch] > 0) {
              f[ch] = Math.sqrt(Math.sqrt(max_nbits_ch[gr][ch]));
              s += f[ch];
            } else {
              f[ch] = 0;
            }
          }
          for (let ch = 0; ch < nch; ++ch) {
            if (s > 0) {
              max_nbits_ch[gr][ch] =
                (LameInternalFlags.MAX_BITS_PER_GRANULE * f[ch] / s) | 0;
            } else {
              max_nbits_ch[gr][ch] = 0;
            }
          }
          if (nch > 1) {
            if (max_nbits_ch[gr][0] > use_nbits_ch[gr][0] + 32) {
              max_nbits_ch[gr][1] += max_nbits_ch[gr][0];
              max_nbits_ch[gr][1] -= use_nbits_ch[gr][0] + 32;
              max_nbits_ch[gr][0] = use_nbits_ch[gr][0] + 32;
            }
            if (max_nbits_ch[gr][1] > use_nbits_ch[gr][1] + 32) {
              max_nbits_ch[gr][0] += max_nbits_ch[gr][1];
              max_nbits_ch[gr][0] -= use_nbits_ch[gr][1] + 32;
              max_nbits_ch[gr][1] = use_nbits_ch[gr][1] + 32;
            }
            if (max_nbits_ch[gr][0] > LameInternalFlags.MAX_BITS_PER_CHANNEL) {
              max_nbits_ch[gr][0] = LameInternalFlags.MAX_BITS_PER_CHANNEL;
            }
            if (max_nbits_ch[gr][1] > LameInternalFlags.MAX_BITS_PER_CHANNEL) {
              max_nbits_ch[gr][1] = LameInternalFlags.MAX_BITS_PER_CHANNEL;
            }
          }
          max_nbits_gr[gr] = 0;
          for (let ch = 0; ch < nch; ++ch) {
            max_nbits_gr[gr] += max_nbits_ch[gr][ch];
          }
        }
        sum_fr += max_nbits_gr[gr];
      }
      if (sum_fr > max_nbits_fr) {
        {
          let f = new_float(2);
          let s = 0;
          for (let gr = 0; gr < ngr; ++gr) {
            if (max_nbits_gr[gr] > 0) {
              f[gr] = Math.sqrt(max_nbits_gr[gr]);
              s += f[gr];
            } else {
              f[gr] = 0;
            }
          }
          for (let gr = 0; gr < ngr; ++gr) {
            if (s > 0) {
              max_nbits_gr[gr] = (max_nbits_fr * f[gr] / s) | 0;
            } else {
              max_nbits_gr[gr] = 0;
            }
          }
        }
        if (ngr > 1) {
          if (max_nbits_gr[0] > use_nbits_gr[0] + 125) {
            max_nbits_gr[1] += max_nbits_gr[0];
            max_nbits_gr[1] -= use_nbits_gr[0] + 125;
            max_nbits_gr[0] = use_nbits_gr[0] + 125;
          }
          if (max_nbits_gr[1] > use_nbits_gr[1] + 125) {
            max_nbits_gr[0] += max_nbits_gr[1];
            max_nbits_gr[0] -= use_nbits_gr[1] + 125;
            max_nbits_gr[1] = use_nbits_gr[1] + 125;
          }
          for (let gr = 0; gr < ngr; ++gr) {
            if (max_nbits_gr[gr] > LameInternalFlags.MAX_BITS_PER_GRANULE) {
              max_nbits_gr[gr] = LameInternalFlags.MAX_BITS_PER_GRANULE;
            }
          }
        }
        for (let gr = 0; gr < ngr; ++gr) {
          let f = new_float(2);
          let s = 0;
          for (let ch = 0; ch < nch; ++ch) {
            if (max_nbits_ch[gr][ch] > 0) {
              f[ch] = Math.sqrt(max_nbits_ch[gr][ch]);
              s += f[ch];
            } else {
              f[ch] = 0;
            }
          }
          for (let ch = 0; ch < nch; ++ch) {
            if (s > 0) {
              max_nbits_ch[gr][ch] =
                (max_nbits_gr[gr] * f[ch] / s) | 0;
            } else {
              max_nbits_ch[gr][ch] = 0;
            }
          }
          if (nch > 1) {
            if (max_nbits_ch[gr][0] > use_nbits_ch[gr][0] + 32) {
              max_nbits_ch[gr][1] += max_nbits_ch[gr][0];
              max_nbits_ch[gr][1] -= use_nbits_ch[gr][0] + 32;
              max_nbits_ch[gr][0] = use_nbits_ch[gr][0] + 32;
            }
            if (max_nbits_ch[gr][1] > use_nbits_ch[gr][1] + 32) {
              max_nbits_ch[gr][0] += max_nbits_ch[gr][1];
              max_nbits_ch[gr][0] -= use_nbits_ch[gr][1] + 32;
              max_nbits_ch[gr][1] = use_nbits_ch[gr][1] + 32;
            }
            for (let ch = 0; ch < nch; ++ch) {
              if (max_nbits_ch[gr][ch] > LameInternalFlags.MAX_BITS_PER_CHANNEL) {
                max_nbits_ch[gr][ch] = LameInternalFlags.MAX_BITS_PER_CHANNEL;
              }
            }
          }
        }
      }
      /* sanity check */
      sum_fr = 0;
      for (let gr = 0; gr < ngr; ++gr) {
        let sum_gr = 0;
        for (let ch = 0; ch < nch; ++ch) {
          sum_gr += max_nbits_ch[gr][ch];
          if (max_nbits_ch[gr][ch] > LameInternalFlags.MAX_BITS_PER_CHANNEL) {
            ok = false;
          }
        }
        sum_fr += sum_gr;
        if (sum_gr > LameInternalFlags.MAX_BITS_PER_GRANULE) {
          ok = false;
        }
      }
      if (sum_fr > max_nbits_fr) {
        ok = false;
      }
      if (!ok) {
        /*
         * we must have done something wrong, fallback to 'on_pe' based
         * constrain
         */
        for (let gr = 0; gr < ngr; ++gr) {
          for (let ch = 0; ch < nch; ++ch) {
            max_nbits_ch[gr][ch] = max_bits[gr][ch];
          }
        }
      }
    }

    /*
     * we already called the 'best_scalefac_store' function, so we need to
     * reset some variables before we can do it again.
     */
    for (let ch = 0; ch < nch; ++ch) {
      gfc.l3_side.scfsi[ch][0] = 0;
      gfc.l3_side.scfsi[ch][1] = 0;
      gfc.l3_side.scfsi[ch][2] = 0;
      gfc.l3_side.scfsi[ch][3] = 0;
    }
    for (let gr = 0; gr < ngr; ++gr) {
      for (let ch = 0; ch < nch; ++ch) {
        gfc.l3_side.tt[gr][ch].scalefac_compress = 0;
      }
    }

    /*
     * alter our encoded data, until it fits into the target bitrate
     */
    use_nbits_fr = 0;
    for (let gr = 0; gr < ngr; ++gr) {
      use_nbits_gr[gr] = 0;
      for (let ch = 0; ch < nch; ++ch) {
        let that = that_[gr][ch];
        use_nbits_ch[gr][ch] = 0;
        if (max_bits[gr][ch] > 0) {
          let sfwork = sfwork_[gr][ch];
          let vbrsfmin = vbrsfmin_[gr][ch];
          this.cutDistribution(sfwork, sfwork, that.cod_info.global_gain);
          this.outOfBitsStrategy(
            that,
            sfwork,
            vbrsfmin,
            max_nbits_ch[gr][ch],
          );
        }
        use_nbits_ch[gr][ch] = this.reduce_bit_usage(gfc, gr, ch);
        assert(use_nbits_ch[gr][ch] <= max_nbits_ch[gr][ch]);
        use_nbits_gr[gr] += use_nbits_ch[gr][ch];
      } /* for ch */
      use_nbits_fr += use_nbits_gr[gr];
    }

    /*
     * check bit constrains, but it should always be ok, if there are no
     * bugs ;-)
     */
    if (use_nbits_fr <= max_nbits_fr) {
      return use_nbits_fr;
    }

    throw new Error(
      `INTERNAL ERROR IN VBR NEW CODE (1313), please send bug report\n` +
        `maxbits=${max_nbits_fr} usedbits=${use_nbits_fr}`,
    );
  }
}
