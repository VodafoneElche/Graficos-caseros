import { indexAtOrBefore, nextBucketStart, TIMEFRAMES } from '../core/timeframes';
import type { Candle, MaType, TfId } from '../core/types';

// Indicadores. Las fórmulas siguen las de TradingView (Pine Script):
//   ta.sma, ta.ema (semilla = SMA del primer periodo), ta.rsi (medias de Wilder / RMA).

export type Values = (number | null)[];

export function sma(src: Values, period: number): Values {
  const out: Values = new Array(src.length).fill(null);
  let sum = 0;
  let count = 0;
  const win: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null) {
      sum = 0;
      count = 0;
      win.length = 0;
      continue;
    }
    win.push(v);
    sum += v;
    count++;
    if (count > period) {
      sum -= win.shift()!;
      count--;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

export function ema(src: Values, period: number): Values {
  const out: Values = new Array(src.length).fill(null);
  const k = 2 / (period + 1);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null) continue;
    if (prev == null) {
      seedSum += v;
      seedCount++;
      if (seedCount === period) {
        prev = seedSum / period;
        out[i] = prev;
      }
    } else {
      prev = v * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

export function movingAverage(type: MaType, src: Values, period: number): Values {
  return type === 'EMA' ? ema(src, period) : sma(src, period);
}

/** RSI de Wilder (igual que ta.rsi de TradingView). */
export function rsi(closes: number[], period = 14): Values {
  const out: Values = new Array(closes.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i < closes.length; i++) {
    const ch = closes[i] - closes[i - 1];
    const g = ch > 0 ? ch : 0;
    const l = ch < 0 ? -ch : 0;
    if (i <= period) {
      avgGain += g;
      avgLoss += l;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
      }
    } else {
      avgGain = (avgGain * (period - 1) + g) / period;
      avgLoss = (avgLoss * (period - 1) + l) / period;
      out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    }
  }
  return out;
}

/**
 * Proyecta una serie de OTRA temporalidad sobre las velas del gráfico.
 *  - Si la otra temporalidad es mayor (p. ej. EMA de 1h sobre 5m): cada vela toma el
 *    valor de la vela grande que la contiene (en la vela actual, el valor en curso).
 *  - Si es menor: cada vela toma el valor de la última vela pequeña ya cerrada dentro de ella.
 */
export function projectSeries(chartCandles: Candle[], chartTf: TfId, src: Candle[], srcTf: TfId, srcValues: Values): Values {
  const out: Values = new Array(chartCandles.length).fill(null);
  if (!src.length) return out;
  const higher = TIMEFRAMES[srcTf].seconds >= TIMEFRAMES[chartTf].seconds;
  const n = chartCandles.length;
  const srcTime = (i: number) => src[i].time;
  for (let i = 0; i < n; i++) {
    const t = chartCandles[i].time;
    let j: number;
    if (higher) {
      j = indexAtOrBefore(src.length, srcTime, t);
    } else if (i === n - 1) {
      j = src.length - 1;
    } else {
      // Última vela pequeña que termina antes de que termine la vela del gráfico.
      const chartEnd = nextBucketStart(chartTf, t);
      j = indexAtOrBefore(src.length, srcTime, chartEnd - 1);
      if (j >= 0 && nextBucketStart(srcTf, src[j].time) > chartEnd) j--;
    }
    if (j >= 0) out[i] = srcValues[j];
  }
  return out;
}

// ── Pivots "Traditional" (Pivot Points Standard de TradingView) ──────────────

export interface PivotLevel {
  name: string;
  price: number;
}

export interface PivotPeriod {
  /** Índices (en el array de velas del gráfico) de la primera y última vela del periodo. */
  i1: number;
  i2: number;
  levels: PivotLevel[];
}

/** Temporalidad de los pivots en modo "Auto" de TradingView. */
export function pivotTfFor(chartTf: TfId): TfId {
  const s = TIMEFRAMES[chartTf].seconds;
  if (s <= 15 * 60) return '1D';
  if (s < 86400) return '1W';
  if (s < 7 * 86400) return '1M';
  return '12M';
}

export function traditionalLevels(h: number, l: number, c: number): PivotLevel[] {
  const p = (h + l + c) / 3;
  return [
    { name: 'P', price: p },
    { name: 'R1', price: p * 2 - l },
    { name: 'S1', price: p * 2 - h },
    { name: 'R2', price: p + (h - l) },
    { name: 'S2', price: p - (h - l) },
    { name: 'R3', price: p * 2 + (h - 2 * l) },
    { name: 'S3', price: p * 2 - (2 * h - l) },
    { name: 'R4', price: p * 3 + (h - 3 * l) },
    { name: 'S4', price: p * 3 - (3 * h - l) },
    { name: 'R5', price: p * 4 + (h - 4 * l) },
    { name: 'S5', price: p * 4 - (4 * h - l) },
  ];
}

/** Calcula los pivots de los últimos `maxPeriods` periodos visibles en el gráfico. */
export function buildPivots(chartCandles: Candle[], htf: Candle[], maxPeriods = 15): PivotPeriod[] {
  const out: PivotPeriod[] = [];
  const n = chartCandles.length;
  if (!n || htf.length < 2) return out;
  const ct = (i: number) => chartCandles[i].time;
  for (let k = htf.length - 1; k >= 1 && out.length < maxPeriods; k--) {
    const start = htf[k].time;
    const end = k + 1 < htf.length ? htf[k + 1].time : Infinity;
    const i2 = indexAtOrBefore(n, ct, end - 1);
    if (i2 < 0) break;
    if (chartCandles[i2].time < start) continue; // periodo sin velas en el gráfico
    let i1 = indexAtOrBefore(n, ct, start - 1) + 1;
    const prev = htf[k - 1];
    out.push({ i1, i2, levels: traditionalLevels(prev.high, prev.low, prev.close) });
    if (i1 === 0) break;
  }
  return out.reverse();
}
