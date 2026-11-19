import { indexAtOrBefore, nextBucketStart, TIMEFRAMES } from '../core/timeframes';
import type { Candle, MaType, PivotType, PriceSource, SmoothingType, TfId } from '../core/types';

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

/** Valores de la "Fuente" elegida (close, open, hl2...). */
export function sourceValues(cs: Candle[], src: PriceSource = 'close'): number[] {
  switch (src) {
    case 'open':
      return cs.map((c) => c.open);
    case 'high':
      return cs.map((c) => c.high);
    case 'low':
      return cs.map((c) => c.low);
    case 'hl2':
      return cs.map((c) => (c.high + c.low) / 2);
    case 'hlc3':
      return cs.map((c) => (c.high + c.low + c.close) / 3);
    case 'ohlc4':
      return cs.map((c) => (c.open + c.high + c.low + c.close) / 4);
    case 'hlcc4':
      return cs.map((c) => (c.high + c.low + 2 * c.close) / 4);
    default:
      return cs.map((c) => c.close);
  }
}

/** ta.rma (SMMA): media de Wilder. */
export function rma(src: Values, period: number): Values {
  const out: Values = new Array(src.length).fill(null);
  let prev: number | null = null;
  let seedSum = 0;
  let seedCount = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (v == null) continue;
    if (prev == null) {
      seedSum += v;
      if (++seedCount === period) out[i] = prev = seedSum / period;
    } else out[i] = prev = (prev * (period - 1) + v) / period;
  }
  return out;
}

/** ta.wma: media ponderada lineal. */
export function wma(src: Values, period: number): Values {
  const out: Values = new Array(src.length).fill(null);
  const den = (period * (period + 1)) / 2;
  for (let i = period - 1; i < src.length; i++) {
    let sum = 0;
    let ok = true;
    for (let k = 0; k < period; k++) {
      const v = src[i - k];
      if (v == null) {
        ok = false;
        break;
      }
      sum += v * (period - k);
    }
    if (ok) out[i] = sum / den;
  }
  return out;
}

/** ta.vwma: media ponderada por volumen. */
export function vwma(src: Values, vol: number[], period: number): Values {
  const pv = src.map((v, i) => (v == null ? null : v * vol[i]));
  const a = sma(pv, period);
  const b = sma(
    src.map((v, i) => (v == null ? null : vol[i])),
    period,
  );
  return a.map((x, i) => (x == null || !b[i] ? null : x / b[i]!));
}

/** ta.stdev (desviación típica poblacional, como TradingView). */
export function stdev(src: Values, period: number): Values {
  const m = sma(src, period);
  const out: Values = new Array(src.length).fill(null);
  for (let i = period - 1; i < src.length; i++) {
    if (m[i] == null) continue;
    let s2 = 0;
    for (let k = 0; k < period; k++) s2 += (src[i - k]! - m[i]!) ** 2;
    out[i] = Math.sqrt(s2 / period);
  }
  return out;
}

export interface Smoothed {
  line: Values;
  upper?: Values;
  lower?: Values;
}

/** Línea de suavizado de una media (sección "Suavizado" del indicador EMA/SMA de TradingView). */
export function smoothing(type: SmoothingType, src: Values, length: number, vol: number[], bbMult = 2): Smoothed | null {
  switch (type) {
    case 'SMA':
      return { line: sma(src, length) };
    case 'EMA':
      return { line: ema(src, length) };
    case 'SMMA':
      return { line: rma(src, length) };
    case 'WMA':
      return { line: wma(src, length) };
    case 'VWMA':
      return { line: vwma(src, vol, length) };
    case 'SMA+BB': {
      const line = sma(src, length);
      const sd = stdev(src, length);
      return {
        line,
        upper: line.map((v, i) => (v == null || sd[i] == null ? null : v + bbMult * sd[i]!)),
        lower: line.map((v, i) => (v == null || sd[i] == null ? null : v - bbMult * sd[i]!)),
      };
    }
    default:
      return null;
  }
}

/** "Compensación": desplaza la serie N barras (positivo = a la derecha). */
export function shift(v: Values, n: number): Values {
  if (!n) return v;
  const out: Values = new Array(v.length).fill(null);
  for (let i = 0; i < v.length; i++) {
    const j = i - n;
    if (j >= 0 && j < v.length) out[i] = v[j];
  }
  return out;
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
export function projectSeries(chartCandles: Candle[], chartTf: TfId, src: Candle[], srcTf: TfId, srcValues: Values, waitClose = false): Values {
  const out: Values = new Array(chartCandles.length).fill(null);
  if (!src.length) return out;
  const higher = TIMEFRAMES[srcTf].seconds >= TIMEFRAMES[chartTf].seconds;
  if (higher && waitClose) {
    // "Espere al cierre": cada vela usa el valor de la última vela grande YA CERRADA
    // al terminar esa vela del gráfico (no se redibuja con la vela grande en curso).
    const now = Date.now() / 1000;
    for (let i = 0; i < chartCandles.length; i++) {
      const chartEnd = Math.min(nextBucketStart(chartTf, chartCandles[i].time), now);
      let j = indexAtOrBefore(src.length, (k) => src[k].time, chartEnd - 1);
      if (j >= 0 && nextBucketStart(srcTf, src[j].time) > chartEnd) j--;
      if (j >= 0) out[i] = srcValues[j];
    }
    return out;
  }
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
  return pivotLevels('Traditional', h, l, c, c, c);
}

/** Niveles de pivot según el tipo (fórmulas del indicador "Pivots" de TradingView).
 *  h/l/c/o: periodo anterior; openCur: apertura del periodo actual (Woodie). */
export function pivotLevels(type: PivotType, h: number, l: number, c: number, o: number, openCur: number): PivotLevel[] {
  const r = h - l;
  const L = (name: string, price: number) => ({ name, price });
  switch (type) {
    case 'Fibonacci': {
      const p = (h + l + c) / 3;
      return [L('P', p), L('R1', p + 0.382 * r), L('S1', p - 0.382 * r), L('R2', p + 0.618 * r), L('S2', p - 0.618 * r), L('R3', p + r), L('S3', p - r)];
    }
    case 'Woodie': {
      const p = (h + l + 2 * openCur) / 4;
      const r3 = h + 2 * (p - l);
      const s3 = l - 2 * (h - p);
      return [L('P', p), L('R1', 2 * p - l), L('S1', 2 * p - h), L('R2', p + r), L('S2', p - r), L('R3', r3), L('S3', s3), L('R4', r3 + r), L('S4', s3 - r)];
    }
    case 'Classic': {
      const p = (h + l + c) / 3;
      return [L('P', p), L('R1', 2 * p - l), L('S1', 2 * p - h), L('R2', p + r), L('S2', p - r), L('R3', p + 2 * r), L('S3', p - 2 * r), L('R4', p + 3 * r), L('S4', p - 3 * r)];
    }
    case 'DM': {
      const x = c < o ? h + 2 * l + c : c > o ? 2 * h + l + c : h + l + 2 * c;
      return [L('P', x / 4), L('R1', x / 2 - l), L('S1', x / 2 - h)];
    }
    case 'Camarilla': {
      const p = (h + l + c) / 3;
      const k = 1.1 * r;
      const r5 = l ? (h / l) * c : c;
      return [
        L('P', p),
        L('R1', c + k / 12), L('S1', c - k / 12),
        L('R2', c + k / 6), L('S2', c - k / 6),
        L('R3', c + k / 4), L('S3', c - k / 4),
        L('R4', c + k / 2), L('S4', c - k / 2),
        L('R5', r5), L('S5', c - (r5 - c)),
      ];
    }
    default: {
      const p = (h + l + c) / 3;
      return [
        L('P', p),
        L('R1', p * 2 - l), L('S1', p * 2 - h),
        L('R2', p + r), L('S2', p - r),
        L('R3', p * 2 + (h - 2 * l)), L('S3', p * 2 - (2 * h - l)),
        L('R4', p * 3 + (h - 3 * l)), L('S4', p * 3 - (3 * h - l)),
        L('R5', p * 4 + (h - 4 * l)), L('S5', p * 4 - (4 * h - l)),
      ];
    }
  }
}

/** Calcula los pivots de los últimos `maxPeriods` periodos (el actual + los anteriores). */
export function buildPivots(chartCandles: Candle[], htf: Candle[], maxPeriods = 15, type: PivotType = 'Traditional'): PivotPeriod[] {
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
    out.push({ i1, i2, levels: pivotLevels(type, prev.high, prev.low, prev.close, prev.open, htf[k].open) });
    if (i1 === 0) break;
  }
  return out.reverse();
}
