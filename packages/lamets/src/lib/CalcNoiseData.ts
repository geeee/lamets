import { new_int, new_float } from './common.js';

/** Allows re-use of previously computed noise values */
export class CalcNoiseData {
  global_gain = 0;
  sfb_count1 = 0;
  step = new_int(39);
  noise = new_float(39);
  noise_log = new_float(39);
}
