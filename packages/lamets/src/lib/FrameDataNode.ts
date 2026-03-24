import { Inf } from './Inf.js';

export class FrameDataNode {
  nxt: FrameDataNode | null = null;
  /** Frame Identifier */
  fid = 0;
  /** 3-character language descriptor */
  lng: string | null = null;
  dsc = new Inf();
  txt = new Inf();
}
