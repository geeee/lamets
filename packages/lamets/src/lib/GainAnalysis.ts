import { new_float, new_int, arraycopy, fill } from './common.js';
import { ReplayGain } from './ReplayGain.js';
import type { LameInternalFlags } from './LameInternalFlags.js';

export class GainAnalysis {

  /**
   * Table entries per dB
   */
  static readonly STEPS_per_dB = 100.0;

  /**
   * Table entries for 0...MAX_dB (normal max. values are 70...80 dB)
   */
  static readonly MAX_dB = 120.0;

  static readonly GAIN_NOT_ENOUGH_SAMPLES = -24601;
  static readonly GAIN_ANALYSIS_ERROR = 0;
  static readonly GAIN_ANALYSIS_OK = 1;
  static readonly INIT_GAIN_ANALYSIS_ERROR = 0;
  static readonly INIT_GAIN_ANALYSIS_OK = 1;

  static readonly YULE_ORDER = 10;
  static readonly MAX_ORDER = GainAnalysis.YULE_ORDER;

  /**
   * maximum allowed sample frequency [Hz]
   */
  static readonly MAX_SAMP_FREQ = 48000;
  static readonly RMS_WINDOW_TIME_NUMERATOR = 1;

  /**
   * numerator / denominator = time slice size [s]
   */
  static readonly RMS_WINDOW_TIME_DENOMINATOR = 20;

  /**
   * max. Samples per Time slice
   */
  static readonly MAX_SAMPLES_PER_WINDOW = (
    (GainAnalysis.MAX_SAMP_FREQ * GainAnalysis.RMS_WINDOW_TIME_NUMERATOR)
    / GainAnalysis.RMS_WINDOW_TIME_DENOMINATOR + 1
  );

  /**
   * calibration value for 89dB
   */
  static readonly PINK_REF = 64.82;

  /**
   * percentile which is louder than the proposed level
   */
  private static readonly RMS_PERCENTILE = 0.95;

  /**
   * Yule filter coefficients, indexed by frequency index.
   * Each sub-array has 21 elements (10th order IIR, interleaved a/b).
   */
  private static readonly ABYule: number[][] = [
    [0.03857599435200, -3.84664617118067, -0.02160367184185,
      7.81501653005538, -0.00123395316851, -11.34170355132042,
      -0.00009291677959, 13.05504219327545, -0.01655260341619,
      -12.28759895145294, 0.02161526843274, 9.48293806319790,
      -0.02074045215285, -5.87257861775999, 0.00594298065125,
      2.75465861874613, 0.00306428023191, -0.86984376593551,
      0.00012025322027, 0.13919314567432, 0.00288463683916],
    [0.05418656406430, -3.47845948550071, -0.02911007808948,
      6.36317777566148, -0.00848709379851, -8.54751527471874,
      -0.00851165645469, 9.47693607801280, -0.00834990904936,
      -8.81498681370155, 0.02245293253339, 6.85401540936998,
      -0.02596338512915, -4.39470996079559, 0.01624864962975,
      2.19611684890774, -0.00240879051584, -0.75104302451432,
      0.00674613682247, 0.13149317958808, -0.00187763777362],
    [0.15457299681924, -2.37898834973084, -0.09331049056315,
      2.84868151156327, -0.06247880153653, -2.64577170229825,
      0.02163541888798, 2.23697657451713, -0.05588393329856,
      -1.67148153367602, 0.04781476674921, 1.00595954808547,
      0.00222312597743, -0.45953458054983, 0.03174092540049,
      0.16378164858596, -0.01390589421898, -0.05032077717131,
      0.00651420667831, 0.02347897407020, -0.00881362733839],
    [0.30296907319327, -1.61273165137247, -0.22613988682123,
      1.07977492259970, -0.08587323730772, -0.25656257754070,
      0.03282930172664, -0.16276719120440, -0.00915702933434,
      -0.22638893773906, -0.02364141202522, 0.39120800788284,
      -0.00584456039913, -0.22138138954925, 0.06276101321749,
      0.04500235387352, -0.00000828086748, 0.02005851806501,
      0.00205861885564, 0.00302439095741, -0.02950134983287],
    [0.33642304856132, -1.49858979367799, -0.25572241425570,
      0.87350271418188, -0.11828570177555, 0.12205022308084,
      0.11921148675203, -0.80774944671438, -0.07834489609479,
      0.47854794562326, -0.00469977914380, -0.12453458140019,
      -0.00589500224440, -0.04067510197014, 0.05724228140351,
      0.08333755284107, 0.00832043980773, -0.04237348025746,
      -0.01635381384540, 0.02977207319925, -0.01760176568150],
    [0.44915256608450, -0.62820619233671, -0.14351757464547,
      0.29661783706366, -0.22784394429749, -0.37256372942400,
      -0.01419140100551, 0.00213767857124, 0.04078262797139,
      -0.42029820170918, -0.12398163381748, 0.22199650564824,
      0.04097565135648, 0.00613424350682, 0.10478503600251,
      0.06747620744683, -0.01863887810927, 0.05784820375801,
      -0.03193428438915, 0.03222754072173, 0.00541907748707],
    [0.56619470757641, -1.04800335126349, -0.75464456939302,
      0.29156311971249, 0.16242137742230, -0.26806001042947,
      0.16744243493672, 0.00819999645858, -0.18901604199609,
      0.45054734505008, 0.30931782841830, -0.33032403314006,
      -0.27562961986224, 0.06739368333110, 0.00647310677246,
      -0.04784254229033, 0.08647503780351, 0.01639907836189,
      -0.03788984554840, 0.01807364323573, -0.00588215443421],
    [0.58100494960553, -0.51035327095184, -0.53174909058578,
      -0.31863563325245, -0.14289799034253, -0.20256413484477,
      0.17520704835522, 0.14728154134330, 0.02377945217615,
      0.38952639978999, 0.15558449135573, -0.23313271880868,
      -0.25344790059353, -0.05246019024463, 0.01628462406333,
      -0.02505961724053, 0.06920467763959, 0.02442357316099,
      -0.03721611395801, 0.01818801111503, -0.00749618797172],
    [0.53648789255105, -0.25049871956020, -0.42163034350696,
      -0.43193942311114, -0.00275953611929, -0.03424681017675,
      0.04267842219415, -0.04678328784242, -0.10214864179676,
      0.26408300200955, 0.14590772289388, 0.15113130533216,
      -0.02459864859345, -0.17556493366449, -0.11202315195388,
      -0.18823009262115, -0.04060034127000, 0.05477720428674,
      0.04788665548180, 0.04704409688120, -0.02217936801134],
  ];

  /**
   * Butterworth filter coefficients, indexed by frequency index.
   * Each sub-array has 5 elements (2nd order IIR, interleaved a/b).
   */
  private static readonly ABButter: number[][] = [
    [0.98621192462708, -1.97223372919527, -1.97242384925416,
      0.97261396931306, 0.98621192462708],
    [0.98500175787242, -1.96977855582618, -1.97000351574484,
      0.97022847566350, 0.98500175787242],
    [0.97938932735214, -1.95835380975398, -1.95877865470428,
      0.95920349965459, 0.97938932735214],
    [0.97531843204928, -1.95002759149878, -1.95063686409857,
      0.95124613669835, 0.97531843204928],
    [0.97316523498161, -1.94561023566527, -1.94633046996323,
      0.94705070426118, 0.97316523498161],
    [0.96454515552826, -1.92783286977036, -1.92909031105652,
      0.93034775234268, 0.96454515552826],
    [0.96009142950541, -1.91858953033784, -1.92018285901082,
      0.92177618768381, 0.96009142950541],
    [0.95856916599601, -1.91542108074780, -1.91713833199203,
      0.91885558323625, 0.95856916599601],
    [0.94597685600279, -1.88903307939452, -1.89195371200558,
      0.89487434461664, 0.94597685600279],
  ];

  /**
   * When calling this procedure, make sure that ip[-order] and op[-order]
   * point to real data
   */
  private filterYule(
    input: Float32Array, inputPos: number,
    output: Float32Array, outputPos: number,
    nSamples: number,
    kernel: number[],
  ): void {
    while (nSamples-- !== 0) {
      /* 1e-10 is a hack to avoid slowdown because of denormals */
      output[outputPos] = 1e-10
        + input[inputPos + 0] * kernel[0]
        - output[outputPos - 1] * kernel[1]
        + input[inputPos - 1] * kernel[2]
        - output[outputPos - 2] * kernel[3]
        + input[inputPos - 2] * kernel[4]
        - output[outputPos - 3] * kernel[5]
        + input[inputPos - 3] * kernel[6]
        - output[outputPos - 4] * kernel[7]
        + input[inputPos - 4] * kernel[8]
        - output[outputPos - 5] * kernel[9]
        + input[inputPos - 5] * kernel[10]
        - output[outputPos - 6] * kernel[11]
        + input[inputPos - 6] * kernel[12]
        - output[outputPos - 7] * kernel[13]
        + input[inputPos - 7] * kernel[14]
        - output[outputPos - 8] * kernel[15]
        + input[inputPos - 8] * kernel[16]
        - output[outputPos - 9] * kernel[17]
        + input[inputPos - 9] * kernel[18]
        - output[outputPos - 10] * kernel[19]
        + input[inputPos - 10] * kernel[20];
      ++outputPos;
      ++inputPos;
    }
  }

  private filterButter(
    input: Float32Array, inputPos: number,
    output: Float32Array, outputPos: number,
    nSamples: number,
    kernel: number[],
  ): void {
    while (nSamples-- !== 0) {
      output[outputPos] =
        input[inputPos + 0] * kernel[0]
        - output[outputPos - 1] * kernel[1]
        + input[inputPos - 1] * kernel[2]
        - output[outputPos - 2] * kernel[3]
        + input[inputPos - 2] * kernel[4];
      ++outputPos;
      ++inputPos;
    }
  }

  /**
   * @return INIT_GAIN_ANALYSIS_OK if successful, INIT_GAIN_ANALYSIS_ERROR if not
   */
  private ResetSampleFrequency(rgData: ReplayGain, samplefreq: number): number {
    /* zero out initial values */
    for (let i = 0; i < GainAnalysis.MAX_ORDER; i++) {
      rgData.linprebuf[i] = rgData.lstepbuf[i] = rgData.loutbuf[i] =
        rgData.rinprebuf[i] = rgData.rstepbuf[i] = rgData.routbuf[i] = 0.0;
    }

    switch ((samplefreq) | 0) {
      case 48000:
        rgData.freqindex = 0;
        break;
      case 44100:
        rgData.freqindex = 1;
        break;
      case 32000:
        rgData.freqindex = 2;
        break;
      case 24000:
        rgData.freqindex = 3;
        break;
      case 22050:
        rgData.freqindex = 4;
        break;
      case 16000:
        rgData.freqindex = 5;
        break;
      case 12000:
        rgData.freqindex = 6;
        break;
      case 11025:
        rgData.freqindex = 7;
        break;
      case 8000:
        rgData.freqindex = 8;
        break;
      default:
        return GainAnalysis.INIT_GAIN_ANALYSIS_ERROR;
    }

    rgData.sampleWindow = (
      (samplefreq * GainAnalysis.RMS_WINDOW_TIME_NUMERATOR
        + GainAnalysis.RMS_WINDOW_TIME_DENOMINATOR - 1)
      / GainAnalysis.RMS_WINDOW_TIME_DENOMINATOR
    ) | 0;

    rgData.lsum = 0.0;
    rgData.rsum = 0.0;
    rgData.totsamp = 0;

    fill(rgData.A, 0);

    return GainAnalysis.INIT_GAIN_ANALYSIS_OK;
  }

  InitGainAnalysis(rgData: ReplayGain, samplefreq: number): number {
    if (this.ResetSampleFrequency(rgData, samplefreq) !== GainAnalysis.INIT_GAIN_ANALYSIS_OK) {
      return GainAnalysis.INIT_GAIN_ANALYSIS_ERROR;
    }

    rgData.linpre = GainAnalysis.MAX_ORDER;
    rgData.rinpre = GainAnalysis.MAX_ORDER;
    rgData.lstep = GainAnalysis.MAX_ORDER;
    rgData.rstep = GainAnalysis.MAX_ORDER;
    rgData.lout = GainAnalysis.MAX_ORDER;
    rgData.rout = GainAnalysis.MAX_ORDER;

    fill(rgData.B, 0);

    return GainAnalysis.INIT_GAIN_ANALYSIS_OK;
  }

  /**
   * square
   */
  private fsqr(d: number): number {
    return d * d;
  }

  AnalyzeSamples(
    rgData: ReplayGain,
    left_samples: Float32Array, left_samplesPos: number,
    right_samples: Float32Array, right_samplesPos: number,
    num_samples: number,
    num_channels: number,
  ): number {
    let curleft: number;
    let curleftBase: Float32Array;
    let curright: number;
    let currightBase: Float32Array;
    let batchsamples: number;
    let cursamples: number;
    let cursamplepos: number;

    if (num_samples === 0)
      return GainAnalysis.GAIN_ANALYSIS_OK;

    cursamplepos = 0;
    batchsamples = num_samples;

    switch (num_channels) {
      case 1:
        right_samples = left_samples;
        right_samplesPos = left_samplesPos;
        break;
      case 2:
        break;
      default:
        return GainAnalysis.GAIN_ANALYSIS_ERROR;
    }

    if (num_samples < GainAnalysis.MAX_ORDER) {
      arraycopy(left_samples, left_samplesPos, rgData.linprebuf,
        GainAnalysis.MAX_ORDER, num_samples);
      arraycopy(right_samples, right_samplesPos, rgData.rinprebuf,
        GainAnalysis.MAX_ORDER, num_samples);
    } else {
      arraycopy(left_samples, left_samplesPos, rgData.linprebuf,
        GainAnalysis.MAX_ORDER, GainAnalysis.MAX_ORDER);
      arraycopy(right_samples, right_samplesPos, rgData.rinprebuf,
        GainAnalysis.MAX_ORDER, GainAnalysis.MAX_ORDER);
    }

    while (batchsamples > 0) {
      cursamples = batchsamples > rgData.sampleWindow - rgData.totsamp
        ? rgData.sampleWindow - rgData.totsamp
        : batchsamples;
      if (cursamplepos < GainAnalysis.MAX_ORDER) {
        curleft = rgData.linpre + cursamplepos;
        curleftBase = rgData.linprebuf;
        curright = rgData.rinpre + cursamplepos;
        currightBase = rgData.rinprebuf;
        if (cursamples > GainAnalysis.MAX_ORDER - cursamplepos)
          cursamples = GainAnalysis.MAX_ORDER - cursamplepos;
      } else {
        curleft = left_samplesPos + cursamplepos;
        curleftBase = left_samples;
        curright = right_samplesPos + cursamplepos;
        currightBase = right_samples;
      }

      this.filterYule(curleftBase, curleft, rgData.lstepbuf,
        rgData.lstep + rgData.totsamp, cursamples,
        GainAnalysis.ABYule[rgData.freqindex]);
      this.filterYule(currightBase, curright, rgData.rstepbuf,
        rgData.rstep + rgData.totsamp, cursamples,
        GainAnalysis.ABYule[rgData.freqindex]);

      this.filterButter(rgData.lstepbuf, rgData.lstep + rgData.totsamp,
        rgData.loutbuf, rgData.lout + rgData.totsamp, cursamples,
        GainAnalysis.ABButter[rgData.freqindex]);
      this.filterButter(rgData.rstepbuf, rgData.rstep + rgData.totsamp,
        rgData.routbuf, rgData.rout + rgData.totsamp, cursamples,
        GainAnalysis.ABButter[rgData.freqindex]);

      curleft = rgData.lout + rgData.totsamp;
      /* Get the squared values */
      curleftBase = rgData.loutbuf;
      curright = rgData.rout + rgData.totsamp;
      currightBase = rgData.routbuf;

      let i = cursamples % 8;
      while (i-- !== 0) {
        rgData.lsum += this.fsqr(curleftBase[curleft++]);
        rgData.rsum += this.fsqr(currightBase[curright++]);
      }
      i = (cursamples / 8) | 0;
      while (i-- !== 0) {
        rgData.lsum += this.fsqr(curleftBase[curleft + 0])
          + this.fsqr(curleftBase[curleft + 1])
          + this.fsqr(curleftBase[curleft + 2])
          + this.fsqr(curleftBase[curleft + 3])
          + this.fsqr(curleftBase[curleft + 4])
          + this.fsqr(curleftBase[curleft + 5])
          + this.fsqr(curleftBase[curleft + 6])
          + this.fsqr(curleftBase[curleft + 7]);
        curleft += 8;
        rgData.rsum += this.fsqr(currightBase[curright + 0])
          + this.fsqr(currightBase[curright + 1])
          + this.fsqr(currightBase[curright + 2])
          + this.fsqr(currightBase[curright + 3])
          + this.fsqr(currightBase[curright + 4])
          + this.fsqr(currightBase[curright + 5])
          + this.fsqr(currightBase[curright + 6])
          + this.fsqr(currightBase[curright + 7]);
        curright += 8;
      }

      batchsamples -= cursamples;
      cursamplepos += cursamples;
      rgData.totsamp += cursamples;
      if (rgData.totsamp === rgData.sampleWindow) {
        /* Get the Root Mean Square (RMS) for this set of samples */
        const val: number = GainAnalysis.STEPS_per_dB
          * 10.0
          * Math.log10(
            (rgData.lsum + rgData.rsum) / rgData.totsamp * 0.5 + 1.0e-37,
          );
        let ival: number = (val <= 0) ? 0 : (val | 0);
        if (ival >= rgData.A.length)
          ival = rgData.A.length - 1;
        rgData.A[ival]++;
        rgData.lsum = rgData.rsum = 0.0;

        arraycopy(rgData.loutbuf, rgData.totsamp,
          rgData.loutbuf, 0, GainAnalysis.MAX_ORDER);
        arraycopy(rgData.routbuf, rgData.totsamp,
          rgData.routbuf, 0, GainAnalysis.MAX_ORDER);
        arraycopy(rgData.lstepbuf, rgData.totsamp,
          rgData.lstepbuf, 0, GainAnalysis.MAX_ORDER);
        arraycopy(rgData.rstepbuf, rgData.totsamp,
          rgData.rstepbuf, 0, GainAnalysis.MAX_ORDER);
        rgData.totsamp = 0;
      }
      if (rgData.totsamp > rgData.sampleWindow) {
        /*
         * somehow I really screwed up: Error in programming! Contact
         * author about totsamp > sampleWindow
         */
        return GainAnalysis.GAIN_ANALYSIS_ERROR;
      }
    }
    if (num_samples < GainAnalysis.MAX_ORDER) {
      arraycopy(rgData.linprebuf, num_samples, rgData.linprebuf,
        0, GainAnalysis.MAX_ORDER - num_samples);
      arraycopy(rgData.rinprebuf, num_samples, rgData.rinprebuf,
        0, GainAnalysis.MAX_ORDER - num_samples);
      arraycopy(left_samples, left_samplesPos, rgData.linprebuf,
        GainAnalysis.MAX_ORDER - num_samples, num_samples);
      arraycopy(right_samples, right_samplesPos, rgData.rinprebuf,
        GainAnalysis.MAX_ORDER - num_samples, num_samples);
    } else {
      arraycopy(left_samples, left_samplesPos + num_samples
        - GainAnalysis.MAX_ORDER, rgData.linprebuf, 0, GainAnalysis.MAX_ORDER);
      arraycopy(right_samples, right_samplesPos + num_samples
        - GainAnalysis.MAX_ORDER, rgData.rinprebuf, 0, GainAnalysis.MAX_ORDER);
    }

    return GainAnalysis.GAIN_ANALYSIS_OK;
  }

  private analyzeResult(A: Int32Array, len: number): number {
    let i: number;

    let elems = 0;
    for (i = 0; i < len; i++)
      elems += A[i];
    if (elems === 0)
      return GainAnalysis.GAIN_NOT_ENOUGH_SAMPLES;

    let upper: number = Math.ceil(elems * (1.0 - GainAnalysis.RMS_PERCENTILE)) | 0;
    for (i = len; i-- > 0;) {
      if ((upper -= A[i]) <= 0)
        break;
    }

    return GainAnalysis.PINK_REF - i / GainAnalysis.STEPS_per_dB;
  }

  GetTitleGain(rgData: ReplayGain): number {
    const retval: number = this.analyzeResult(rgData.A, rgData.A.length);

    for (let i = 0; i < rgData.A.length; i++) {
      rgData.B[i] += rgData.A[i];
      rgData.A[i] = 0;
    }

    for (let i = 0; i < GainAnalysis.MAX_ORDER; i++) {
      rgData.linprebuf[i] = rgData.lstepbuf[i] = rgData.loutbuf[i] =
        rgData.rinprebuf[i] = rgData.rstepbuf[i] = rgData.routbuf[i] = 0.0;
    }

    rgData.totsamp = 0;
    rgData.lsum = rgData.rsum = 0.0;
    return retval;
  }
}
