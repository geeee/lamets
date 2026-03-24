import { Mp3Encoder } from 'lamets';

export interface RecorderOptions {
  /** Bitrate in kbps (default: 128) */
  kbps?: number;
  /** Called on each audio process tick with RMS level 0-1 */
  onLevel?: (level: number) => void;
  /** Called each second with elapsed time in seconds */
  onTime?: (seconds: number) => void;
}

export class Recorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private encoder: Mp3Encoder | null = null;
  private chunks: Uint8Array[] = [];
  private startTime = 0;
  private timeInterval = 0;
  private _recording = false;
  private opts: RecorderOptions;

  constructor(opts: RecorderOptions = {}) {
    this.opts = opts;
  }

  get recording(): boolean {
    return this._recording;
  }

  async start(): Promise<void> {
    if (this._recording) return;

    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.context = new AudioContext();
    const source = this.context.createMediaStreamSource(this.stream);
    const sampleRate = this.context.sampleRate;
    const kbps = this.opts.kbps ?? 128;

    this.processor = this.context.createScriptProcessor(4096, 1, 1);
    this.encoder = new Mp3Encoder(1, sampleRate, kbps);
    this.chunks = [];

    this.processor.onaudioprocess = (e) => {
      const float32 = e.inputBuffer.getChannelData(0);

      if (this.opts.onLevel) {
        let sum = 0;
        for (let i = 0; i < float32.length; i++) sum += float32[i] * float32[i];
        this.opts.onLevel(Math.sqrt(sum / float32.length));
      }

      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      const mp3buf = this.encoder!.encodeBuffer(int16);
      if (mp3buf.length > 0) {
        this.chunks.push(new Uint8Array(
          mp3buf.buffer.slice(mp3buf.byteOffset, mp3buf.byteOffset + mp3buf.byteLength),
        ));
      }
    };

    source.connect(this.processor);
    this.processor.connect(this.context.destination);

    this._recording = true;
    this.startTime = performance.now();

    if (this.opts.onTime) {
      this.opts.onTime(0);
      this.timeInterval = window.setInterval(() => {
        this.opts.onTime!(((performance.now() - this.startTime) / 1000) | 0);
      }, 1000);
    }
  }

  stop(): Blob {
    if (!this._recording) throw new Error('Not recording');

    clearInterval(this.timeInterval);

    const flush = this.encoder!.flush();
    if (flush.length > 0) {
      this.chunks.push(new Uint8Array(
        flush.buffer.slice(flush.byteOffset, flush.byteOffset + flush.byteLength),
      ));
    }

    this.processor!.disconnect();
    this.stream!.getTracks().forEach(t => t.stop());
    this.context!.close();

    this._recording = false;
    this.encoder = null;
    this.processor = null;
    this.stream = null;
    this.context = null;

    return new Blob(this.chunks as BlobPart[], { type: 'audio/mpeg' });
  }
}
