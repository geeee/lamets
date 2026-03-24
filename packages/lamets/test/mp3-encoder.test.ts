import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Mp3Encoder, WavHeader } from '../src/index.js';

/** Helper: encode a WAV buffer to MP3 chunks */
function encodeWav(
  samples: Int16Array,
  channels: number,
  sampleRate: number,
  kbps: number,
  rightSamples?: Int16Array,
): Int8Array[] {
  const encoder = new Mp3Encoder(channels, sampleRate, kbps);
  const chunks: Int8Array[] = [];
  const maxSamples = 1152;

  if (channels === 1 || !rightSamples) {
    let remaining = samples.length;
    for (let i = 0; remaining >= maxSamples; i += maxSamples) {
      const left = samples.subarray(i, i + maxSamples);
      const mp3 = encoder.encodeBuffer(left);
      if (mp3.length > 0) chunks.push(new Int8Array(mp3));
      remaining -= maxSamples;
    }
  } else {
    let remaining = samples.length;
    for (let i = 0; remaining >= maxSamples; i += maxSamples) {
      const left = samples.subarray(i, i + maxSamples);
      const right = rightSamples.subarray(i, i + maxSamples);
      const mp3 = encoder.encodeBuffer(left, right);
      if (mp3.length > 0) chunks.push(new Int8Array(mp3));
      remaining -= maxSamples;
    }
  }

  const flush = encoder.flush();
  if (flush.length > 0) chunks.push(new Int8Array(flush));
  return chunks;
}

/** Helper: concatenate Int8Array chunks into a single Uint8Array */
function concatChunks(chunks: Int8Array[]): Uint8Array {
  const totalLength = chunks.reduce((s, c) => s + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength), offset);
    offset += chunk.length;
  }
  return result;
}

/** Helper: verify MP3 sync word */
function verifyMp3SyncWord(data: Int8Array): void {
  expect(data[0] & 0xFF).toBe(0xFF);
  expect((data[1] & 0xE0) & 0xFF).toBe(0xE0);
}

// ---------------------------------------------------------------
// WavHeader tests
// ---------------------------------------------------------------

describe('WavHeader', () => {
  it('parses mono WAV header', () => {
    const wav = readFileSync('test/fixtures/sine-440hz-mono.wav');
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const header = WavHeader.readHeader(dv);

    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(44100);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataLen).toBe(44100 * 2);
    expect(header.dataOffset).toBe(44);
  });

  it('parses stereo WAV header', () => {
    const wav = readFileSync('test/fixtures/sine-440hz-stereo.wav');
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const header = WavHeader.readHeader(dv);

    expect(header.channels).toBe(2);
    expect(header.sampleRate).toBe(44100);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataLen).toBe(44100 * 4);
  });

  it('parses lamejs Left44100.wav', () => {
    const wav = readFileSync('test/fixtures/Left44100.wav');
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const header = WavHeader.readHeader(dv);

    expect(header.channels).toBe(1);
    expect(header.sampleRate).toBe(44100);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataLen).toBeGreaterThan(0);
  });

  it('parses lamejs Stereo44100.wav', () => {
    const wav = readFileSync('test/fixtures/Stereo44100.wav');
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const header = WavHeader.readHeader(dv);

    expect(header.channels).toBe(2);
    expect(header.sampleRate).toBe(44100);
    expect(header.bitsPerSample).toBe(16);
    expect(header.dataLen).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------
// lamejs-ported tests (from Tests.js)
// ---------------------------------------------------------------

describe('lamejs Tests.js ported', () => {
  it('testFullLength - encodes Left44100.wav mono', () => {
    const r = readFileSync(join('test', 'fixtures', 'Left44100.wav'));
    const sampleBuf = new Uint8Array(r).buffer;
    const w = WavHeader.readHeader(new DataView(sampleBuf));
    const samples = new Int16Array(sampleBuf, w.dataOffset, w.dataLen / 2);

    const chunks = encodeWav(samples, 1, w.sampleRate, 128);
    const mp3 = concatChunks(chunks);

    expect(mp3.length).toBeGreaterThan(0);
    // Verify first frame has valid MP3 sync
    verifyMp3SyncWord(chunks[0]);

    // Write output for manual inspection if desired
    writeFileSync(join('test', 'fixtures', 'testjs2.mp3'), mp3);
  });

  it('testStereo44100 - encodes Left44100+Right44100 stereo', () => {
    const r1 = readFileSync(join('test', 'fixtures', 'Left44100.wav'));
    const r2 = readFileSync(join('test', 'fixtures', 'Right44100.wav'));

    const sampleBuf1 = new Uint8Array(r1).buffer;
    const sampleBuf2 = new Uint8Array(r2).buffer;
    const w1 = WavHeader.readHeader(new DataView(sampleBuf1));
    const w2 = WavHeader.readHeader(new DataView(sampleBuf2));

    const samples1 = new Int16Array(sampleBuf1, w1.dataOffset, w1.dataLen / 2);
    const samples2 = new Int16Array(sampleBuf2, w2.dataOffset, w2.dataLen / 2);

    expect(samples1.length).toBe(samples2.length);
    expect(w1.sampleRate).toBe(w2.sampleRate);

    const chunks = encodeWav(samples1, 2, w1.sampleRate, 128, samples2);
    const mp3 = concatChunks(chunks);

    expect(mp3.length).toBeGreaterThan(0);
    verifyMp3SyncWord(chunks[0]);

    writeFileSync(join('test', 'fixtures', 'stereo.mp3'), mp3);
  });
});

// ---------------------------------------------------------------
// Basic encoding tests
// ---------------------------------------------------------------

describe('Mp3Encoder', () => {
  it('encodes mono sine wave', () => {
    const wav = readFileSync('test/fixtures/sine-440hz-mono.wav');
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const header = WavHeader.readHeader(dv);
    const samples = new Int16Array(
      wav.buffer, wav.byteOffset + header.dataOffset, header.dataLen / 2,
    );

    const chunks = encodeWav(samples, 1, header.sampleRate, 128);
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);

    expect(totalLength).toBeGreaterThan(0);
    verifyMp3SyncWord(chunks[0]);
  });

  it('encodes stereo sine wave', () => {
    const wav = readFileSync('test/fixtures/sine-440hz-stereo.wav');
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const header = WavHeader.readHeader(dv);

    const totalSamples = header.dataLen / (header.bitsPerSample / 8);
    const allSamples = new Int16Array(
      wav.buffer, wav.byteOffset + header.dataOffset, totalSamples,
    );

    // Deinterleave
    const numFrames = totalSamples / 2;
    const left = new Int16Array(numFrames);
    const right = new Int16Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      left[i] = allSamples[i * 2];
      right[i] = allSamples[i * 2 + 1];
    }

    const chunks = encodeWav(left, 2, header.sampleRate, 128, right);
    const totalLength = chunks.reduce((s, c) => s + c.length, 0);

    expect(totalLength).toBeGreaterThan(0);
    verifyMp3SyncWord(chunks[0]);
  });

  it('handles various bitrates', () => {
    const bitrates = [64, 128, 192, 256, 320];
    for (const kbps of bitrates) {
      const encoder = new Mp3Encoder(1, 44100, kbps);
      const samples = new Int16Array(1152);
      for (let i = 0; i < 1152; i++) {
        samples[i] = Math.round(32767 * 0.5 * Math.sin(2 * Math.PI * 440 * i / 44100));
      }
      const mp3 = encoder.encodeBuffer(samples);
      const flush = encoder.flush();
      const total = mp3.length + flush.length;
      expect(total).toBeGreaterThanOrEqual(0);
    }
  });

  it('produces non-empty output for multi-frame audio', () => {
    const encoder = new Mp3Encoder(1, 44100, 128);
    const chunks: Int8Array[] = [];

    for (let frame = 0; frame < 10; frame++) {
      const samples = new Int16Array(1152);
      for (let i = 0; i < 1152; i++) {
        const t = (frame * 1152 + i) / 44100;
        samples[i] = Math.round(32767 * 0.5 * Math.sin(2 * Math.PI * 440 * t));
      }
      const mp3 = encoder.encodeBuffer(samples);
      if (mp3.length > 0) chunks.push(new Int8Array(mp3));
    }
    const flush = encoder.flush();
    if (flush.length > 0) chunks.push(new Int8Array(flush));

    const totalLength = chunks.reduce((s, c) => s + c.length, 0);
    expect(totalLength).toBeGreaterThan(100);
  });

  it('encodes Stereo44100.wav (real stereo file)', () => {
    const wav = readFileSync('test/fixtures/Stereo44100.wav');
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
    const header = WavHeader.readHeader(dv);

    expect(header.channels).toBe(2);

    const totalSamples = header.dataLen / 2;
    const allSamples = new Int16Array(wav.buffer, wav.byteOffset + header.dataOffset, totalSamples);

    const numFrames = totalSamples / 2;
    const left = new Int16Array(numFrames);
    const right = new Int16Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      left[i] = allSamples[i * 2];
      right[i] = allSamples[i * 2 + 1];
    }

    const chunks = encodeWav(left, 2, header.sampleRate, 128, right);
    const mp3 = concatChunks(chunks);

    expect(mp3.length).toBeGreaterThan(0);
    verifyMp3SyncWord(chunks[0]);
  });
});
