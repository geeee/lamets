/**
 * Encoder constants.
 *
 * In Java these live as static fields on the Encoder class, and data classes
 * like ATH, NsPsy, LameInternalFlags reference them freely because Java
 * resolves static finals at compile time with no import-order issues.
 *
 * In ES modules the same layout creates circular imports (data classes ↔
 * Encoder), so the constants are factored out here.
 */

export const ENCDELAY = 576;
export const POSTDELAY = 1152;
export const MDCTDELAY = 48;
export const FFTOFFSET = 224 + MDCTDELAY;
export const DECDELAY = 528;
export const SBLIMIT = 32;
export const CBANDS = 64;
export const SBPSY_l = 21;
export const SBPSY_s = 12;
export const SBMAX_l = 22;
export const SBMAX_s = 13;
export const PSFB21 = 6;
export const PSFB12 = 6;
export const BLKSIZE = 1024;
export const HBLKSIZE = (BLKSIZE / 2 + 1);
export const BLKSIZE_s = 256;
export const HBLKSIZE_s = (BLKSIZE_s / 2 + 1);
export const NORM_TYPE = 0;
export const START_TYPE = 1;
export const SHORT_TYPE = 2;
export const STOP_TYPE = 3;
export const MPG_MD_LR_LR = 0;
export const MPG_MD_LR_I = 1;
export const MPG_MD_MS_LR = 2;
export const MPG_MD_MS_I = 3;

export const fircoef = new Float32Array([
  -0.0207887 * 5, -0.0378413 * 5, -0.0432472 * 5, -0.031183 * 5,
  7.79609e-18 * 5, 0.0467745 * 5, 0.10091 * 5, 0.151365 * 5,
  0.187098 * 5,
]);
