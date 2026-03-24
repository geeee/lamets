import { new_byte, new_float, new_float_n, new_int, new_int_n, new_double } from './common.js';
import { ENCDELAY, MDCTDELAY, CBANDS, SBMAX_l, SBMAX_s, SBLIMIT } from './constants.js';
import { IIISideInfo } from './IIISideInfo.js';
import { ScaleFac } from './ScaleFac.js';
import { NsPsy } from './NsPsy.js';
import { VBRSeekInfo } from './VBRSeekInfo.js';
import { ATH } from './ATH.js';
import { PSY } from './PSY.js';
import { III_psy_xmin } from './III_psy_xmin.js';
import { ReplayGain } from './ReplayGain.js';
import { ID3TagSpec } from './ID3TagSpec.js';
import { PlottingData } from './PlottingData.js';
import type { L3Side } from './L3Side.js';

export interface IIterationLoop {
  iteration_loop(
    gfp: import('./LameGlobalFlags.js').LameGlobalFlags,
    pe: Float32Array[],
    ms_ener_ratio: Float32Array,
    ratio: import('./III_psy_ratio.js').III_psy_ratio[][],
  ): void;
}

export class LameInternalFlags {
  /* Static constants */
  static readonly MFSIZE = 3 * 1152 + ENCDELAY - MDCTDELAY;
  static readonly MAX_BITS_PER_CHANNEL = 4095;
  static readonly MAX_BITS_PER_GRANULE = 7680;
  static readonly BPC = 320;
  static readonly MAX_HEADER_BUF = 256;
  private static readonly MAX_HEADER_LEN = 40;

  /* Instance fields */
  mfbuf = new_float_n(2, LameInternalFlags.MFSIZE) as Float32Array[];
  blackfilt: (Float32Array | null)[] = new Array(2 * LameInternalFlags.BPC + 1).fill(null);
  header: Header[] = [];
  Class_ID = 0;
  lame_encode_frame_init = 0;
  iteration_init_init = 0;
  fill_buffer_resample_init = 0;
  /** granules per frame */
  mode_gr = 0;
  /** number of channels in the input data stream */
  channels_in = 0;
  /** number of channels in the output data stream */
  channels_out = 0;
  /** input_samp_rate/output_samp_rate */
  resample_ratio = 0;
  mf_samples_to_encode = 0;
  mf_size = 0;
  /** min bitrate index */
  VBR_min_bitrate = 0;
  /** max bitrate index */
  VBR_max_bitrate = 0;
  bitrate_index = 0;
  samplerate_index = 0;
  mode_ext = 0;
  /** normalized frequency bounds of passband */
  lowpass1 = 0;
  lowpass2 = 0;
  /** normalized frequency bounds of passband */
  highpass1 = 0;
  highpass2 = 0;
  /** 0 = none, 1 = ISO AAC model, 2 = allow scalefac_select=1 */
  noise_shaping = 0;
  /** 0=ISO model, 1=amplify within 50%, 2=amplify most distorted, 3=method 1+refine with 2 */
  noise_shaping_amp = 0;
  /** 0=no substep, 1=substep at last step(VBR), 2=substep inside loop, 3=both */
  substep_shaping = 0;
  /** 1 = gpsycho. 0 = none */
  psymodel = 0;
  /** 0-2: stop conditions for noise shaping */
  noise_shaping_stop = 0;
  /** 0 = no, 1 = yes */
  subblock_gain = 0;
  /** 0=no, 1=outside loop, 2=inside loop(slow) */
  use_best_huffman = 0;
  /** 0=stop early, 1=full search */
  full_outer_loop = 0;
  l3_side = new IIISideInfo();
  ms_ratio = new_float(2);
  /** padding for the current frame? */
  padding = 0;
  frac_SpF = 0;
  slot_lag = 0;
  /** optional ID3 tags */
  tag_spec: ID3TagSpec | null = null;
  nMusicCRC = 0;
  OldValue = new_int(2);
  CurrentStep = new_int(2);
  masking_lower = 0;
  bv_scf = new_int(576);
  pseudohalf = new_int(39); // L3Side.SFBMAX = SBMAX_s * 3 = 39
  /** will be set in Lame.initParams */
  sfb21_extra = false;
  inbuf_old: (Float32Array | null)[] = [null, null];
  itime = new_double(2);
  sideinfo_len = 0;
  sb_sample = new_float_n(2, 2, 18, SBLIMIT) as Float32Array[][][];
  amp_filter = new_float(32);
  h_ptr = 0;
  w_ptr = 0;
  ancillary_flag = 0;
  /** in bits */
  ResvSize = 0;
  /** in bits */
  ResvMax = 0;
  scalefac_band = new ScaleFac();
  minval_l = new_float(CBANDS);
  minval_s = new_float(CBANDS);
  nb_1 = new_float_n(4, CBANDS) as Float32Array[];
  nb_2 = new_float_n(4, CBANDS) as Float32Array[];
  nb_s1 = new_float_n(4, CBANDS) as Float32Array[];
  nb_s2 = new_float_n(4, CBANDS) as Float32Array[];
  s3_ss: Float32Array | null = null;
  s3_ll: Float32Array | null = null;
  decay = 0;
  thm: III_psy_xmin[] = [];
  en: III_psy_xmin[] = [];
  /** fft and energy calculation */
  tot_ener = new_float(4);
  /** loudness^2 approx. per granule and channel */
  loudness_sq = new_float_n(2, 2) as Float32Array[];
  /** account for granule delay of L3psycho_anal */
  loudness_sq_save = new_float(2);
  /** Scale Factor Bands */
  mld_l = new_float(SBMAX_l);
  mld_s = new_float(SBMAX_s);
  bm_l = new_int(SBMAX_l);
  bo_l = new_int(SBMAX_l);
  bm_s = new_int(SBMAX_s);
  bo_s = new_int(SBMAX_s);
  npart_l = 0;
  npart_s = 0;
  s3ind = new_int_n(CBANDS, 2) as Int32Array[];
  s3ind_s = new_int_n(CBANDS, 2) as Int32Array[];
  numlines_s = new_int(CBANDS);
  numlines_l = new_int(CBANDS);
  rnumlines_l = new_float(CBANDS);
  mld_cb_l = new_float(CBANDS);
  mld_cb_s = new_float(CBANDS);
  numlines_s_num1 = 0;
  numlines_l_num1 = 0;
  pe = new_float(4);
  ms_ratio_s_old = 0;
  ms_ratio_l_old = 0;
  ms_ener_ratio_old = 0;
  /** block type */
  blocktype_old = new_int(2);
  /** variables used for --nspsytune */
  nsPsy = new NsPsy();
  /** used for Xing VBR header */
  VBR_seek_table = new VBRSeekInfo();
  /** all ATH related stuff */
  ATH: ATH | null = null;
  PSY: PSY | null = null;
  nogap_total = 0;
  nogap_current = 0;
  /* ReplayGain */
  decode_on_the_fly = true;
  findReplayGain = true;
  findPeakSample = true;
  PeakSample = 0;
  RadioGain = 0;
  AudiophileGain = 0;
  rgdata: ReplayGain | null = null;
  /** gain change required for preventing clipping */
  noclipGainChange = 0;
  /** user-specified scale factor required for preventing clipping */
  noclipScale = 0;
  /* simple statistics */
  bitrate_stereoMode_Hist = new_int_n(16, 4 + 1) as Int32Array[];
  /** norm/start/short/stop/mixed(short)/sum */
  bitrate_blockType_Hist = new_int_n(16, 4 + 1 + 1) as Int32Array[];
  pinfo: PlottingData | null = null;
  hip: null = null; // Decoder stub - not used
  in_buffer_nsamples = 0;
  in_buffer_0: Float32Array | null = null;
  in_buffer_1: Float32Array | null = null;
  iteration_loop: IIterationLoop | null = null;

  constructor() {
    this.en = new Array(4);
    this.thm = new Array(4);
    for (let i = 0; i < 4; i++) {
      this.en[i] = new III_psy_xmin();
      this.thm[i] = new III_psy_xmin();
    }
    this.header = new Array(LameInternalFlags.MAX_HEADER_BUF);
    for (let i = 0; i < LameInternalFlags.MAX_HEADER_BUF; i++) {
      this.header[i] = new Header();
    }
  }
}

export class Header {
  write_timing = 0;
  ptr = 0;
  buf = new_byte(40);
}
