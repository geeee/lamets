import { FrameDataNode } from './FrameDataNode.js';

export const enum MimeType {
  MIMETYPE_NONE = 0,
  MIMETYPE_JPEG = 1,
  MIMETYPE_PNG = 2,
  MIMETYPE_GIF = 3,
}

export class ID3TagSpec {
  flags = 0;
  year = 0;
  title: string | null = null;
  artist: string | null = null;
  album: string | null = null;
  comment: string | null = null;
  track_id3v1 = 0;
  genre_id3v1 = 0;
  albumart: Uint8Array | null = null;
  albumart_size = 0;
  padding_size = 0;
  albumart_mimetype = MimeType.MIMETYPE_NONE;
  values: string[] = [];
  num_values = 0;
  v2_head: FrameDataNode | null = null;
  v2_tail: FrameDataNode | null = null;
}
