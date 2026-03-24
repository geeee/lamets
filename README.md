# lamets

Fast MP3 encoder written in TypeScript. Encode PCM audio to MP3 in the browser or Node.js — no native dependencies, no WebAssembly, just pure TypeScript.

lamets is an AI-assisted TypeScript port of jump3r (Java Unofficial MP3 EncodeR) by Ken Handel, which is a Java port of [libmp3lame](http://lame.sourceforge.net/). Inspired by zhuker's [lamejs](https://github.com/zhuker/lamejs).

- Works in browsers and Node.js
- ES modules and CommonJS
- TypeScript types included
- Mono and stereo encoding
- CBR encoding at 32-320 kbps
- Real-time encoding from microphone via Web Audio API
- Client-side WAV to MP3 conversion

## Packages

| Package | Description |
|---------|-------------|
| [lamets](packages/lamets) | Core MP3 encoder |
| [lamets-recorder](packages/recorder) | Record MP3 from the microphone in the browser |

## Installation

```bash
npm install lamets
```

## Quick Start

```typescript
import { Mp3Encoder } from 'lamets';

const encoder = new Mp3Encoder(1, 44100, 128); // mono, 44.1khz, 128kbps
const samples = new Int16Array(44100); // your PCM samples here

const mp3Data = [];
for (let i = 0; i < samples.length; i += 1152) {
  const chunk = samples.subarray(i, i + 1152);
  const mp3buf = encoder.encodeBuffer(chunk);
  if (mp3buf.length > 0) mp3Data.push(mp3buf);
}
const end = encoder.flush();
if (end.length > 0) mp3Data.push(end);

const blob = new Blob(mp3Data, { type: 'audio/mp3' });
```

## Record from Microphone

```bash
npm install lamets-recorder
```

```typescript
import { Recorder } from 'lamets-recorder';

const recorder = new Recorder({ kbps: 128 });

await recorder.start();
// ... user clicks stop ...
const mp3Blob = recorder.stop(); // returns a Blob
```

With level meter and timer callbacks:

```typescript
const recorder = new Recorder({
  kbps: 128,
  onLevel(rms) { /* 0-1 RMS level, fires on each audio frame */ },
  onTime(seconds) { /* elapsed time, fires every second */ },
});
```

## Stereo

```typescript
const encoder = new Mp3Encoder(2, 44100, 128);

const left = new Int16Array(44100);
const right = new Int16Array(44100);

for (let i = 0; i < left.length; i += 1152) {
  const mp3buf = encoder.encodeBuffer(
    left.subarray(i, i + 1152),
    right.subarray(i, i + 1152),
  );
  if (mp3buf.length > 0) mp3Data.push(mp3buf);
}
```

## License

LGPL-2.1-or-later
