import { new_int, arraycopy } from './common.js';
import { SBMAX_l, SBMAX_s, PSFB21, PSFB12 } from './constants.js';

/** Layer III side information - scale factors */
export class ScaleFac {
  l = new_int(1 + SBMAX_l);
  s = new_int(1 + SBMAX_s);
  psfb21 = new_int(1 + PSFB21);
  psfb12 = new_int(1 + PSFB12);

  constructor(arrL?: Int32Array, arrS?: Int32Array, arr21?: Int32Array, arr12?: Int32Array) {
    if (arrL && arrS && arr21 && arr12) {
      arraycopy(arrL, 0, this.l, 0, Math.min(arrL.length, this.l.length));
      arraycopy(arrS, 0, this.s, 0, Math.min(arrS.length, this.s.length));
      arraycopy(arr21, 0, this.psfb21, 0, Math.min(arr21.length, this.psfb21.length));
      arraycopy(arr12, 0, this.psfb12, 0, Math.min(arr12.length, this.psfb12.length));
    }
  }
}
