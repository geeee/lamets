import { new_int_n } from './common.js';
import { GrInfo } from './GrInfo.js';

export class IIISideInfo {
  tt: GrInfo[][];
  main_data_begin = 0;
  private_bits = 0;
  resvDrain_pre = 0;
  resvDrain_post = 0;
  scfsi = new_int_n(2, 4) as Int32Array[];

  constructor() {
    this.tt = [
      [new GrInfo(), new GrInfo()],
      [new GrInfo(), new GrInfo()],
    ];
  }
}
