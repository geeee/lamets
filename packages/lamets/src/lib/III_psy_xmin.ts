import { new_float, new_float_n, arraycopy } from './common.js';
import { SBMAX_l, SBMAX_s } from './constants.js';

export class III_psy_xmin {
  l = new_float(SBMAX_l);
  s = new_float_n(SBMAX_s, 3) as Float32Array[];

  assign(other: III_psy_xmin): void {
    arraycopy(other.l, 0, this.l, 0, SBMAX_l);
    for (let i = 0; i < SBMAX_s; i++) {
      for (let j = 0; j < 3; j++) {
        this.s[i][j] = other.s[i][j];
      }
    }
  }
}
