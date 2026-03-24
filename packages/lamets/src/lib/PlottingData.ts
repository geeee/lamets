/** Frame analyzer data - stub (not used in encoder-only mode) */
export class PlottingData {
  // PsyModel fields
  energy: number[][][] = [];
  energy_save: number[][] = [];
  pe: number[][] = [];
  ers: number[][] = [];
  ers_save: number[] = [];
  // Encoder frame-copy fields
  ms_ratio: number[] = [];
  ms_ener_ratio: number[] = [];
  blocktype: number[][] = [];
  xr: Float32Array[][] = [];
  pcmdata: number[][] = [];
  // QuantizePVT set_pinfo fields - indexed as [gr][ch][sfb]
  en: number[][][] = [];
  xfsf: number[][][] = [];
  thr: number[][][] = [];
  LAMEsfb: number[][][] = [];
  en_s: number[][][] = [];
  xfsf_s: number[][][] = [];
  thr_s: number[][][] = [];
  LAMEsfb_s: number[][][] = [];
  LAMEqss: number[][] = [];
  LAMEmainbits: number[][] = [];
  LAMEsfbits: number[][] = [];
  over: number[][] = [];
  max_noise: number[][] = [];
  over_noise: number[][] = [];
  tot_noise: number[][] = [];
  over_SSD: number[][] = [];
  // Reservoir fields
  mean_bits: number = 0;
  resvsize: number = 0;
}
