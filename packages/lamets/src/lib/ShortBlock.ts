export const enum ShortBlock {
  /** LAME may use them, even different block types for L/R */
  short_block_allowed = 0,
  /** LAME may use them, but always same block types in L/R */
  short_block_coupled = 1,
  /** LAME will not use short blocks, long blocks only */
  short_block_dispensed = 2,
  /** LAME will not use long blocks, short blocks only */
  short_block_forced = 3,
}
