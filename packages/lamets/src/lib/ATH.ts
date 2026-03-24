import { new_float } from './common.js';
import { SBMAX_l, SBMAX_s, PSFB21, PSFB12, CBANDS, BLKSIZE } from './constants.js';

/**
 * ATH related stuff. If something new ATH related has to be added,
 * please plug it here into the ATH.
 */
export class ATH {
  /** Method for the auto adjustment */
  useAdjust = 0;
  /** factor for tuning the (sample power) point below which adaptive threshold of hearing adjustment occurs */
  aaSensitivityP = 0;
  /** Lowering based on peak volume, 1 = no lowering */
  adjust = 0;
  /** Limit for dynamic ATH adjust */
  adjustLimit = 0;
  /** Determined to lower x dB each second */
  decay = 0;
  /** Lowest ATH value */
  floor = 0;
  /** ATH for sfbs in long blocks */
  l = new_float(SBMAX_l);
  /** ATH for sfbs in short blocks */
  s = new_float(SBMAX_s);
  /** ATH for partitioned sfb21 in long blocks */
  psfb21 = new_float(PSFB21);
  /** ATH for partitioned sfb12 in short blocks */
  psfb12 = new_float(PSFB12);
  /** ATH for long block convolution bands */
  cb_l = new_float(CBANDS);
  /** ATH for short block convolution bands */
  cb_s = new_float(CBANDS);
  /** Equal loudness weights (based on ATH) */
  eql_w = new_float(BLKSIZE / 2);
}
