import { MPEGMode } from './MPEGMode.js';
import { VbrMode } from './VbrMode.js';
import { ShortBlock } from './ShortBlock.js';
import type { LameInternalFlags } from './LameInternalFlags.js';

/**
 * Control Parameters set by User.
 */
export class LameGlobalFlags {
  class_id = 0;

  /* input description */
  /** number of samples. default=-1 */
  num_samples = 0;
  /** scale input by this amount before encoding */
  scale = 0;
  /** scale input of channel 0 (left) by this amount before encoding */
  scale_left = 0;
  /** scale input of channel 1 (right) by this amount before encoding */
  scale_right = 0;
  /** collect data for a MP3 frame analyzer? */
  analysis = false;
  /** add Xing VBR tag? */
  bWriteVbrTag = false;
  /** use lame/mpglib to convert mp3 to wav */
  decode_only = false;
  /** force M/S mode. requires mode=1 */
  force_ms = false;
  /** use free format? default=0 */
  free_format = false;
  /** decode on the fly? default=0 */
  decode_on_the_fly = false;
  /** sizeof(wav file)/sizeof(mp3 file) */
  compression_ratio = 0;
  /** mark as copyright. default=0 */
  copyright = 0;
  /** mark as original. default=1 */
  original = 0;

  /* general control params */
  /** the MP3 'private extension' bit. Meaningless */
  extension = 0;
  /** Input PCM is emphased PCM */
  emphasis = 0;
  /** use 2 bytes per frame for a CRC checksum. default=0 */
  error_protection = false;
  /** enforce ISO spec as much as possible */
  strict_ISO = false;
  /** use bit reservoir? */
  disable_reservoir = false;
  /* quantization/noise shaping */
  quant_comp = 0;
  quant_comp_short = 0;
  experimentalY = false;
  experimentalZ = 0;
  exp_nspsytune = 0;
  preset = 0;
  /** Range [0,...,1[ */
  VBR_q_frac = 0;
  VBR_mean_bitrate_kbps = 0;
  VBR_min_bitrate_kbps = 0;
  VBR_max_bitrate_kbps = 0;
  /** strictly enforce VBR_min_bitrate */
  VBR_hard_min = 0;
  /** freq in Hz. 0=lame choses. -1=no filter */
  lowpassfreq = 0;
  /** freq in Hz. 0=lame choses. -1=no filter */
  highpassfreq = 0;
  /** freq width of filter, in Hz (default=15%) */
  lowpasswidth = 0;
  /** freq width of filter, in Hz (default=15%) */
  highpasswidth = 0;
  maskingadjust = 0;
  maskingadjust_short = 0;

  /* frame params */
  /** only use ATH */
  ATHonly = false;
  /** only use ATH for short blocks */
  ATHshort = false;
  /** disable ATH */
  noATH = false;
  /** select ATH formula */
  ATHtype = 0;
  /** change ATH formula 4 shape */
  ATHcurve = 0;
  /** lower ATH by this many db */
  ATHlower = 0;
  /** select ATH auto-adjust scheme */
  athaa_type = 0;
  /** select ATH auto-adjust loudness calc */
  athaa_loudapprox = 0;
  /** dB, tune active region of auto-level */
  athaa_sensitivity = 0;
  short_blocks: ShortBlock | null = null;
  /** use temporal masking effect */
  useTemporal: boolean | null = null;
  interChRatio = 0;
  /** Naoki's adjustment of Mid/Side maskings */
  msfix = 0;
  /** 0 off, 1 on */
  tune = false;
  /** used to pass values for debugging and stuff */
  tune_value_a = 0;
  /** number of samples of padding appended to input */
  encoder_padding = 0;
  /** number of frames encoded */
  frameNum = 0;
  /** is this struct owned by calling program or lame? */
  lame_allocated_gfp = 0;
  internal_flags: LameInternalFlags | null = null;

  /* Private fields with getters/setters */
  private in_num_channels = 2;
  private in_samplerate = 44100;
  private out_samplerate = 0;
  private quality = 5;
  private mode: MPEGMode = MPEGMode.STEREO;
  private findReplayGain = false;
  private write_id3tag_automatic = true;
  private brate = 0;
  private VBR: VbrMode = VbrMode.vbr_off;
  private VBR_quality = 0;
  private mpeg_version = 0;
  private encoder_delay = 0;
  private frame_size = 0;

  // Getters/Setters
  getInNumChannels(): number { return this.in_num_channels; }
  setInNumChannels(n: number): void { this.in_num_channels = n; }

  getInSampleRate(): number { return this.in_samplerate; }
  setInSampleRate(n: number): void { this.in_samplerate = n; }

  getOutSampleRate(): number { return this.out_samplerate; }
  setOutSampleRate(n: number): void { this.out_samplerate = n; }

  getQuality(): number { return this.quality; }
  setQuality(n: number): void { this.quality = n; }

  getMode(): MPEGMode { return this.mode; }
  setMode(m: MPEGMode): void { this.mode = m; }

  isFindReplayGain(): boolean { return this.findReplayGain; }
  setFindReplayGain(b: boolean): void { this.findReplayGain = b; }

  isWriteId3tagAutomatic(): boolean { return this.write_id3tag_automatic; }
  setWriteId3tagAutomatic(b: boolean): void { this.write_id3tag_automatic = b; }

  getBitRate(): number { return this.brate; }
  setBitRate(n: number): void { this.brate = n; }

  getVBR(): VbrMode { return this.VBR; }
  setVBR(v: VbrMode): void { this.VBR = v; }

  getVBRQuality(): number { return this.VBR_quality; }
  setVBRQuality(n: number): void { this.VBR_quality = n; }

  getMpegVersion(): number { return this.mpeg_version; }
  setMpegVersion(n: number): void { this.mpeg_version = n; }

  getEncoderDelay(): number { return this.encoder_delay; }
  setEncoderDelay(n: number): void { this.encoder_delay = n; }

  getFrameSize(): number { return this.frame_size; }
  setFrameSize(n: number): void { this.frame_size = n; }
}
