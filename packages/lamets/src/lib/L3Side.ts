import { SBMAX_s } from './constants.js';

export class L3Side {
  /** max scalefactor band, max(SBMAX_l, SBMAX_s*3, (SBMAX_s-3)*3+8) */
  static readonly SFBMAX = SBMAX_s * 3;
}
