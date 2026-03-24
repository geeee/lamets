import { new_float } from './common.js';
import { SBMAX_l, SBMAX_s } from './constants.js';

/** PSY Model related stuff */
export class PSY {
  /** The dbQ stuff */
  mask_adjust = 0;
  /** The dbQ stuff */
  mask_adjust_short = 0;
  /** Band weight long scalefactor bands */
  bo_l_weight = new_float(SBMAX_l);
  /** Band weight short scalefactor bands */
  bo_s_weight = new_float(SBMAX_s);
}
