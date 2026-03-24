/** MPEG channel modes */
export const enum MPEGMode {
  STEREO = 0,
  JOINT_STEREO = 1,
  /** LAME doesn't support this! */
  DUAL_CHANNEL = 2,
  MONO = 3,
  NOT_SET = -1,
}
