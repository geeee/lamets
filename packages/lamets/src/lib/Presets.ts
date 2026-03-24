import type { LameGlobalFlags } from './LameGlobalFlags.js';
import { VbrMode } from './VbrMode.js';
import { VBRPresets } from './VBRPresets.js';
import { ABRPresets } from './ABRPresets.js';
import type { Lame } from './Lame.js';

/* Preset constants (mirrored from Lame class statics) */
const V9 = 410;
const V8 = 420;
const V7 = 430;
const V6 = 440;
const V5 = 450;
const V4 = 460;
const V3 = 470;
const V2 = 480;
const V1 = 490;
const V0 = 500;

const R3MIX = 1000;
const STANDARD = 1001;
const EXTREME = 1002;
const INSANE = 1003;
const STANDARD_FAST = 1004;
const EXTREME_FAST = 1005;
const MEDIUM = 1006;
const MEDIUM_FAST = 1007;

/**
 * Switch mappings for VBR mode VBR_RH
 *
 * vbr_q  qcomp_l  qcomp_s  expY  st_lrm   st_s  mask adj_l  adj_s  ath_lower  ath_curve  ath_sens  interChR  safejoint sfb21mod  msfix
 */
const vbr_old_switch_map: VBRPresets[] = [
  new VBRPresets(0, 9, 9, 0, 5.20, 125.0, -4.2, -6.3, 4.8, 1, 0, 0, 2, 21, 0.97),
  new VBRPresets(1, 9, 9, 0, 5.30, 125.0, -3.6, -5.6, 4.5, 1.5, 0, 0, 2, 21, 1.35),
  new VBRPresets(2, 9, 9, 0, 5.60, 125.0, -2.2, -3.5, 2.8, 2, 0, 0, 2, 21, 1.49),
  new VBRPresets(3, 9, 9, 1, 5.80, 130.0, -1.8, -2.8, 2.6, 3, -4, 0, 2, 20, 1.64),
  new VBRPresets(4, 9, 9, 1, 6.00, 135.0, -0.7, -1.1, 1.1, 3.5, -8, 0, 2, 0, 1.79),
  new VBRPresets(5, 9, 9, 1, 6.40, 140.0, 0.5, 0.4, -7.5, 4, -12, 0.0002, 0, 0, 1.95),
  new VBRPresets(6, 9, 9, 1, 6.60, 145.0, 0.67, 0.65, -14.7, 6.5, -19, 0.0004, 0, 0, 2.30),
  new VBRPresets(7, 9, 9, 1, 6.60, 145.0, 0.8, 0.75, -19.7, 8, -22, 0.0006, 0, 0, 2.70),
  new VBRPresets(8, 9, 9, 1, 6.60, 145.0, 1.2, 1.15, -27.5, 10, -23, 0.0007, 0, 0, 0),
  new VBRPresets(9, 9, 9, 1, 6.60, 145.0, 1.6, 1.6, -36, 11, -25, 0.0008, 0, 0, 0),
  new VBRPresets(10, 9, 9, 1, 6.60, 145.0, 2.0, 2.0, -36, 12, -25, 0.0008, 0, 0, 0),
];

/**
 * vbr_q  qcomp_l  qcomp_s  expY  st_lrm   st_s  mask adj_l  adj_s  ath_lower  ath_curve  ath_sens  interChR  safejoint sfb21mod  msfix
 */
const vbr_psy_switch_map: VBRPresets[] = [
  new VBRPresets(0, 9, 9, 0, 4.20, 25.0, -7.0, -4.0, 7.5, 1, 0, 0, 2, 26, 0.97),
  new VBRPresets(1, 9, 9, 0, 4.20, 25.0, -5.6, -3.6, 4.5, 1.5, 0, 0, 2, 21, 1.35),
  new VBRPresets(2, 9, 9, 0, 4.20, 25.0, -4.4, -1.8, 2, 2, 0, 0, 2, 18, 1.49),
  new VBRPresets(3, 9, 9, 1, 4.20, 25.0, -3.4, -1.25, 1.1, 3, -4, 0, 2, 15, 1.64),
  new VBRPresets(4, 9, 9, 1, 4.20, 25.0, -2.2, 0.1, 0, 3.5, -8, 0, 2, 0, 1.79),
  new VBRPresets(5, 9, 9, 1, 4.20, 25.0, -1.0, 1.65, -7.7, 4, -12, 0.0002, 0, 0, 1.95),
  new VBRPresets(6, 9, 9, 1, 4.20, 25.0, -0.0, 2.47, -7.7, 6.5, -19, 0.0004, 0, 0, 2),
  new VBRPresets(7, 9, 9, 1, 4.20, 25.0, 0.5, 2.0, -14.5, 8, -22, 0.0006, 0, 0, 2),
  new VBRPresets(8, 9, 9, 1, 4.20, 25.0, 1.0, 2.4, -22.0, 10, -23, 0.0007, 0, 0, 2),
  new VBRPresets(9, 9, 9, 1, 4.20, 25.0, 1.5, 2.95, -30.0, 11, -25, 0.0008, 0, 0, 2),
  new VBRPresets(10, 9, 9, 1, 4.20, 25.0, 2.0, 2.95, -36.0, 12, -30, 0.0008, 0, 0, 2),
];

/**
 * Switch mappings for ABR mode
 *
 * kbps  quant q_s safejoint nsmsfix st_lrm  st_s  ns-bass scale   msk ath_lwr ath_curve  interch , sfscale
 */
const abr_switch_map: ABRPresets[] = [
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -30.0, 11, 0.0012, 1),     /*   8, impossible to use in stereo */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -25.0, 11, 0.0010, 1),     /*  16 */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -20.0, 11, 0.0010, 1),     /*  24 */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -15.0, 11, 0.0010, 1),     /*  32 */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -10.0, 11, 0.0009, 1),     /*  40 */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -10.0, 11, 0.0009, 1),     /*  48 */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -6.0, 11, 0.0008, 1),      /*  56 */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, -2.0, 11, 0.0008, 1),      /*  64 */
  new ABRPresets(9, 9, 0, 0, 6.60, 145, 0, 0.95, 0, .0, 8, 0.0007, 1),         /*  80 */
  new ABRPresets(9, 9, 0, 2.50, 6.60, 145, 0, 0.95, 0, 1.0, 5.5, 0.0006, 1),   /*  96 */
  new ABRPresets(9, 9, 0, 2.25, 6.60, 145, 0, 0.95, 0, 2.0, 4.5, 0.0005, 1),   /* 112 */
  new ABRPresets(9, 9, 0, 1.95, 6.40, 140, 0, 0.95, 0, 3.0, 4, 0.0002, 1),     /* 128 */
  new ABRPresets(9, 9, 1, 1.79, 6.00, 135, 0, 0.95, -2, 5.0, 3.5, 0, 1),       /* 160 */
  new ABRPresets(9, 9, 1, 1.49, 5.60, 125, 0, 0.97, -4, 7.0, 3, 0, 0),         /* 192 */
  new ABRPresets(9, 9, 1, 1.25, 5.20, 125, 0, 0.98, -6, 9.0, 2, 0, 0),         /* 224 */
  new ABRPresets(9, 9, 1, 0.97, 5.20, 125, 0, 1.00, -8, 10.0, 1, 0, 0),        /* 256 */
  new ABRPresets(9, 9, 1, 0.90, 5.20, 125, 0, 1.00, -10, 12.0, 0, 0, 0),       /* 320 */
];

function lame_set_VBR_q(gfp: LameGlobalFlags, VBR_q: number): number {
  let ret = 0;

  if (0 > VBR_q) {
    /* Unknown VBR quality level! */
    ret = -1;
    VBR_q = 0;
  }
  if (9 < VBR_q) {
    ret = -1;
    VBR_q = 9;
  }

  gfp.setVBRQuality(VBR_q);
  gfp.VBR_q_frac = 0;
  return ret;
}

export class Presets {
  lame!: Lame;

  init(lame: Lame): void {
    this.lame = lame;
  }

  private apply_vbr_preset(
    gfp: LameGlobalFlags,
    a: number,
    enforce: number,
  ): void {
    let vbr_preset =
      gfp.getVBR() === VbrMode.vbr_rh
        ? vbr_old_switch_map
        : vbr_psy_switch_map;

    let x = gfp.VBR_q_frac;
    let p = vbr_preset[a];
    let q = vbr_preset[a + 1];
    let set = p;

    // NOOP(vbr_q);
    // NOOP(quant_comp);
    // NOOP(quant_comp_s);
    // NOOP(expY);
    p.st_lrm = p.st_lrm + x * (q.st_lrm - p.st_lrm);
    // LERP(st_lrm);
    p.st_s = p.st_s + x * (q.st_s - p.st_s);
    // LERP(st_s);
    p.masking_adj = p.masking_adj + x * (q.masking_adj - p.masking_adj);
    // LERP(masking_adj);
    p.masking_adj_short =
      p.masking_adj_short * (q.masking_adj_short - p.masking_adj_short);
    // LERP(masking_adj_short);
    p.ath_lower = p.ath_lower + x * (q.ath_lower - p.ath_lower);
    // LERP(ath_lower);
    p.ath_curve = p.ath_curve + x * (q.ath_curve - p.ath_curve);
    // LERP(ath_curve);
    p.ath_sensitivity =
      p.ath_sensitivity + x * (q.ath_sensitivity - p.ath_sensitivity);
    // LERP(ath_sensitivity);
    p.interch = p.interch + x * (q.interch - p.interch);
    // LERP(interch);
    // NOOP(safejoint);
    // NOOP(sfb21mod);
    p.msfix = p.msfix + x * (q.msfix - p.msfix);
    // LERP(msfix);

    lame_set_VBR_q(gfp, set.vbr_q);

    if (enforce !== 0) gfp.quant_comp = set.quant_comp;
    else if (!(Math.abs(gfp.quant_comp - -1) > 0))
      gfp.quant_comp = set.quant_comp;
    // SET_OPTION(quant_comp, set.quant_comp, -1);
    if (enforce !== 0) gfp.quant_comp_short = set.quant_comp_s;
    else if (!(Math.abs(gfp.quant_comp_short - -1) > 0))
      gfp.quant_comp_short = set.quant_comp_s;
    // SET_OPTION(quant_comp_short, set.quant_comp_s, -1);
    if (set.expY !== 0) {
      gfp.experimentalY = set.expY !== 0;
    }
    if (enforce !== 0)
      gfp.internal_flags!.nsPsy.attackthre = set.st_lrm;
    else if (!(Math.abs(gfp.internal_flags!.nsPsy.attackthre - -1) > 0))
      gfp.internal_flags!.nsPsy.attackthre = set.st_lrm;
    // SET_OPTION(short_threshold_lrm, set.st_lrm, -1);
    if (enforce !== 0)
      gfp.internal_flags!.nsPsy.attackthre_s = set.st_s;
    else if (!(Math.abs(gfp.internal_flags!.nsPsy.attackthre_s - -1) > 0))
      gfp.internal_flags!.nsPsy.attackthre_s = set.st_s;
    // SET_OPTION(short_threshold_s, set.st_s, -1);
    if (enforce !== 0) gfp.maskingadjust = set.masking_adj;
    else if (!(Math.abs(gfp.maskingadjust - 0) > 0))
      gfp.maskingadjust = set.masking_adj;
    // SET_OPTION(maskingadjust, set.masking_adj, 0);
    if (enforce !== 0) gfp.maskingadjust_short = set.masking_adj_short;
    else if (!(Math.abs(gfp.maskingadjust_short - 0) > 0))
      gfp.maskingadjust_short = set.masking_adj_short;
    // SET_OPTION(maskingadjust_short, set.masking_adj_short, 0);
    if (enforce !== 0) gfp.ATHlower = -set.ath_lower / 10.0;
    else if (!(Math.abs(-gfp.ATHlower * 10.0 - 0) > 0))
      gfp.ATHlower = -set.ath_lower / 10.0;
    // SET_OPTION(ATHlower, set.ath_lower, 0);
    if (enforce !== 0) gfp.ATHcurve = set.ath_curve;
    else if (!(Math.abs(gfp.ATHcurve - -1) > 0))
      gfp.ATHcurve = set.ath_curve;
    // SET_OPTION(ATHcurve, set.ath_curve, -1);
    if (enforce !== 0) gfp.athaa_sensitivity = set.ath_sensitivity;
    else if (!(Math.abs(gfp.athaa_sensitivity - -1) > 0))
      gfp.athaa_sensitivity = set.ath_sensitivity;
    // SET_OPTION(athaa_sensitivity, set.ath_sensitivity, 0);
    if (set.interch > 0) {
      if (enforce !== 0) gfp.interChRatio = set.interch;
      else if (!(Math.abs(gfp.interChRatio - -1) > 0))
        gfp.interChRatio = set.interch;
      // SET_OPTION(interChRatio, set.interch, -1);
    }

    /* parameters for which there is no proper set/get interface */
    if (set.safejoint > 0) {
      gfp.exp_nspsytune = gfp.exp_nspsytune | set.safejoint;
    }
    if (set.sfb21mod > 0) {
      gfp.exp_nspsytune = gfp.exp_nspsytune | (set.sfb21mod << 20);
    }
    if (enforce !== 0) gfp.msfix = set.msfix;
    else if (!(Math.abs(gfp.msfix - -1) > 0)) gfp.msfix = set.msfix;
    // SET_OPTION(msfix, set.msfix, -1);

    if (enforce === 0) {
      gfp.setVBRQuality(a);
      gfp.VBR_q_frac = x;
    }
  }

  private apply_abr_preset(
    gfp: LameGlobalFlags,
    preset: number,
    enforce: number,
  ): number {
    /* Variables for the ABR stuff */
    let actual_bitrate = preset;

    let r = this.lame.nearestBitrateFullIndex(preset);

    gfp.setVBR(VbrMode.vbr_abr);
    gfp.VBR_mean_bitrate_kbps = actual_bitrate;
    gfp.VBR_mean_bitrate_kbps = Math.min(gfp.VBR_mean_bitrate_kbps, 320);
    gfp.VBR_mean_bitrate_kbps = Math.max(gfp.VBR_mean_bitrate_kbps, 8);
    gfp.setBitRate(gfp.VBR_mean_bitrate_kbps);
    if (gfp.VBR_mean_bitrate_kbps > 320) {
      gfp.disable_reservoir = true;
    }

    /* parameters for which there is no proper set/get interface */
    if (abr_switch_map[r].safejoint > 0)
      gfp.exp_nspsytune = gfp.exp_nspsytune | 2;
    /* safejoint */

    if (abr_switch_map[r].sfscale > 0) {
      gfp.internal_flags!.noise_shaping = 2;
    }
    /* ns-bass tweaks */
    if (Math.abs(abr_switch_map[r].nsbass) > 0) {
      let k = 0 | (abr_switch_map[r].nsbass * 4);
      if (k < 0) k += 64;
      gfp.exp_nspsytune = gfp.exp_nspsytune | (k << 2);
    }

    if (enforce !== 0) gfp.quant_comp = abr_switch_map[r].quant_comp;
    else if (!(Math.abs(gfp.quant_comp - -1) > 0))
      gfp.quant_comp = abr_switch_map[r].quant_comp;
    // SET_OPTION(quant_comp, abr_switch_map[r].quant_comp, -1);
    if (enforce !== 0) gfp.quant_comp_short = abr_switch_map[r].quant_comp_s;
    else if (!(Math.abs(gfp.quant_comp_short - -1) > 0))
      gfp.quant_comp_short = abr_switch_map[r].quant_comp_s;
    // SET_OPTION(quant_comp_short, abr_switch_map[r].quant_comp_s, -1);

    if (enforce !== 0) gfp.msfix = abr_switch_map[r].nsmsfix;
    else if (!(Math.abs(gfp.msfix - -1) > 0))
      gfp.msfix = abr_switch_map[r].nsmsfix;
    // SET_OPTION(msfix, abr_switch_map[r].nsmsfix, -1);

    if (enforce !== 0)
      gfp.internal_flags!.nsPsy.attackthre = abr_switch_map[r].st_lrm;
    else if (!(Math.abs(gfp.internal_flags!.nsPsy.attackthre - -1) > 0))
      gfp.internal_flags!.nsPsy.attackthre = abr_switch_map[r].st_lrm;
    // SET_OPTION(short_threshold_lrm, abr_switch_map[r].st_lrm, -1);
    if (enforce !== 0)
      gfp.internal_flags!.nsPsy.attackthre_s = abr_switch_map[r].st_s;
    else if (!(Math.abs(gfp.internal_flags!.nsPsy.attackthre_s - -1) > 0))
      gfp.internal_flags!.nsPsy.attackthre_s = abr_switch_map[r].st_s;
    // SET_OPTION(short_threshold_s, abr_switch_map[r].st_s, -1);

    /*
     * ABR seems to have big problems with clipping, especially at low
     * bitrates
     */
    /*
     * so we compensate for that here by using a scale value depending on
     * bitrate
     */
    if (enforce !== 0) gfp.scale = abr_switch_map[r].scale;
    else if (!(Math.abs(gfp.scale - -1) > 0))
      gfp.scale = abr_switch_map[r].scale;
    // SET_OPTION(scale, abr_switch_map[r].scale, -1);

    if (enforce !== 0) gfp.maskingadjust = abr_switch_map[r].masking_adj;
    else if (!(Math.abs(gfp.maskingadjust - 0) > 0))
      gfp.maskingadjust = abr_switch_map[r].masking_adj;
    // SET_OPTION(maskingadjust, abr_switch_map[r].masking_adj, 0);
    if (abr_switch_map[r].masking_adj > 0) {
      if (enforce !== 0)
        gfp.maskingadjust_short = abr_switch_map[r].masking_adj * 0.9;
      else if (!(Math.abs(gfp.maskingadjust_short - 0) > 0))
        gfp.maskingadjust_short = abr_switch_map[r].masking_adj * 0.9;
      // SET_OPTION(maskingadjust_short, abr_switch_map[r].masking_adj *
      // .9, 0);
    } else {
      if (enforce !== 0)
        gfp.maskingadjust_short = abr_switch_map[r].masking_adj * 1.1;
      else if (!(Math.abs(gfp.maskingadjust_short - 0) > 0))
        gfp.maskingadjust_short = abr_switch_map[r].masking_adj * 1.1;
      // SET_OPTION(maskingadjust_short, abr_switch_map[r].masking_adj *
      // 1.1, 0);
    }

    if (enforce !== 0)
      gfp.ATHlower = -abr_switch_map[r].ath_lower / 10.0;
    else if (!(Math.abs(-gfp.ATHlower * 10.0 - 0) > 0))
      gfp.ATHlower = -abr_switch_map[r].ath_lower / 10.0;
    // SET_OPTION(ATHlower, abr_switch_map[r].ath_lower, 0);
    if (enforce !== 0) gfp.ATHcurve = abr_switch_map[r].ath_curve;
    else if (!(Math.abs(gfp.ATHcurve - -1) > 0))
      gfp.ATHcurve = abr_switch_map[r].ath_curve;
    // SET_OPTION(ATHcurve, abr_switch_map[r].ath_curve, -1);

    if (enforce !== 0) gfp.interChRatio = abr_switch_map[r].interch;
    else if (!(Math.abs(gfp.interChRatio - -1) > 0))
      gfp.interChRatio = abr_switch_map[r].interch;
    // SET_OPTION(interChRatio, abr_switch_map[r].interch, -1);

    return preset;
  }

  apply_preset(
    gfp: LameGlobalFlags,
    preset: number,
    enforce: number,
  ): number {
    /* translate legacy presets */
    switch (preset) {
      case R3MIX: {
        preset = V3;
        gfp.setVBR(VbrMode.vbr_mtrh);
        break;
      }
      case MEDIUM: {
        preset = V4;
        gfp.setVBR(VbrMode.vbr_rh);
        break;
      }
      case MEDIUM_FAST: {
        preset = V4;
        gfp.setVBR(VbrMode.vbr_mtrh);
        break;
      }
      case STANDARD: {
        preset = V2;
        gfp.setVBR(VbrMode.vbr_rh);
        break;
      }
      case STANDARD_FAST: {
        preset = V2;
        gfp.setVBR(VbrMode.vbr_mtrh);
        break;
      }
      case EXTREME: {
        preset = V0;
        gfp.setVBR(VbrMode.vbr_rh);
        break;
      }
      case EXTREME_FAST: {
        preset = V0;
        gfp.setVBR(VbrMode.vbr_mtrh);
        break;
      }
      case INSANE: {
        preset = 320;
        gfp.preset = preset;
        this.apply_abr_preset(gfp, preset, enforce);
        gfp.setVBR(VbrMode.vbr_off);
        return preset;
      }
    }

    gfp.preset = preset;
    {
      switch (preset) {
        case V9:
          this.apply_vbr_preset(gfp, 9, enforce);
          return preset;
        case V8:
          this.apply_vbr_preset(gfp, 8, enforce);
          return preset;
        case V7:
          this.apply_vbr_preset(gfp, 7, enforce);
          return preset;
        case V6:
          this.apply_vbr_preset(gfp, 6, enforce);
          return preset;
        case V5:
          this.apply_vbr_preset(gfp, 5, enforce);
          return preset;
        case V4:
          this.apply_vbr_preset(gfp, 4, enforce);
          return preset;
        case V3:
          this.apply_vbr_preset(gfp, 3, enforce);
          return preset;
        case V2:
          this.apply_vbr_preset(gfp, 2, enforce);
          return preset;
        case V1:
          this.apply_vbr_preset(gfp, 1, enforce);
          return preset;
        case V0:
          this.apply_vbr_preset(gfp, 0, enforce);
          return preset;
        default:
          break;
      }
    }
    if (8 <= preset && preset <= 320) {
      return this.apply_abr_preset(gfp, preset, enforce);
    }

    /* no corresponding preset found */
    gfp.preset = 0;
    return preset;
  }

  setPreset(gfp: LameGlobalFlags, preset: number): number {
    return this.apply_preset(gfp, preset, 1);
  }

  lame_set_VBR(gfp: LameGlobalFlags, mode: VbrMode): void {
    gfp.setVBR(mode);
  }

  lame_init_preset(gfp: LameGlobalFlags, preset: number): number {
    return this.apply_preset(gfp, preset, 0);
  }
}
