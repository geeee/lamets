import { new_float, new_float_n, new_int } from './common.js';
import { SBMAX_l, SBMAX_s } from './constants.js';

/** Variables used for --nspsytune */
export class NsPsy {
  last_en_subshort = new_float_n(4, 9) as Float32Array[];
  lastAttacks = new_int(4);
  pefirbuf = new_float(19);
  longfact = new_float(SBMAX_l);
  shortfact = new_float(SBMAX_s);
  /** short block tuning */
  attackthre = 0;
  attackthre_s = 0;
}
