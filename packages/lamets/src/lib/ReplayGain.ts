import { new_float, new_int } from './common.js';
import { GainAnalysis } from './GainAnalysis.js';

export class ReplayGain {
  linprebuf = new_float(GainAnalysis.MAX_ORDER * 2);
  /** left input samples, with pre-buffer */
  linpre = 0;
  lstepbuf = new_float(GainAnalysis.MAX_SAMPLES_PER_WINDOW + GainAnalysis.MAX_ORDER);
  /** left "first step" (i.e. post first filter) samples */
  lstep = 0;
  loutbuf = new_float(GainAnalysis.MAX_SAMPLES_PER_WINDOW + GainAnalysis.MAX_ORDER);
  /** left "out" (i.e. post second filter) samples */
  lout = 0;
  rinprebuf = new_float(GainAnalysis.MAX_ORDER * 2);
  /** right input samples */
  rinpre = 0;
  rstepbuf = new_float(GainAnalysis.MAX_SAMPLES_PER_WINDOW + GainAnalysis.MAX_ORDER);
  rstep = 0;
  routbuf = new_float(GainAnalysis.MAX_SAMPLES_PER_WINDOW + GainAnalysis.MAX_ORDER);
  rout = 0;
  /** number of samples required to reach number of milliseconds required for RMS window */
  sampleWindow = 0;
  totsamp = 0;
  lsum = 0;
  rsum = 0;
  freqindex = 0;
  first = 0;
  A = new_int((GainAnalysis.STEPS_per_dB * GainAnalysis.MAX_dB) | 0);
  B = new_int((GainAnalysis.STEPS_per_dB * GainAnalysis.MAX_dB) | 0);
}
