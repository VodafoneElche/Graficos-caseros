import type { MarketSession } from './session';
import type { Candle, TfId } from './types';

// Definición de las temporalidades y cálculo de "cubos" (a qué vela pertenece un instante).
// Todo en UTC, igual que Binance y TradingView para cripto.

export interface TfDef {
  id: TfId;
  label: string;
  kind: 'fixed' | 'week' | 'month' | 'year';
  /** Duración en segundos (aproximada para semana/mes/año; sólo para ordenar). */
  seconds: number;
}

const D = 86400;

export const TIMEFRAMES: Record<TfId, TfDef> = {
  '1s': { id: '1s', label: '1s', kind: 'fixed', seconds: 1 },
  '45s': { id: '45s', label: '45s', kind: 'fixed', seconds: 45 },
  '1m': { id: '1m', label: '1m', kind: 'fixed', seconds: 60 },
  '2m': { id: '2m', label: '2m', kind: 'fixed', seconds: 120 },
  '3m': { id: '3m', label: '3m', kind: 'fixed', seconds: 180 },
  '5m': { id: '5m', label: '5m', kind: 'fixed', seconds: 300 },
  '10m': { id: '10m', label: '10m', kind: 'fixed', seconds: 600 },
  '15m': { id: '15m', label: '15m', kind: 'fixed', seconds: 900 },
  '30m': { id: '30m', label: '30m', kind: 'fixed', seconds: 1800 },
  '1h': { id: '1h', label: '1h', kind: 'fixed', seconds: 3600 },
  '2h': { id: '2h', label: '2h', kind: 'fixed', seconds: 7200 },
  '3h': { id: '3h', label: '3h', kind: 'fixed', seconds: 10800 },
  '4h': { id: '4h', label: '4h', kind: 'fixed', seconds: 14400 },
  '1D': { id: '1D', label: 'D', kind: 'fixed', seconds: D },
  '1W': { id: '1W', label: 'S', kind: 'week', seconds: 7 * D },
  '1M': { id: '1M', label: 'M', kind: 'month', seconds: 30 * D },
  '12M': { id: '12M', label: '12M', kind: 'year', seconds: 365 * D },
};

/** Temporalidades que se ofrecen al usuario en los selectores. */
export const USER_TFS: TfId[] = ['45s', '1m', '2m', '5m', '10m', '15m', '30m', '1h', '3h', '4h', '1D', '1W', '1M'];

export function tfLabel(tf: TfId): string {
  return TIMEFRAMES[tf].label;
}

export function tfSeconds(tf: TfId): number {
  return TIMEFRAMES[tf].seconds;
}

/**
 * Inicio (segundos UTC) de la vela de temporalidad `tf` que contiene el instante `t`.
 * Con `sess` (acciones, forex): velas cortadas según el horario de ese mercado (ver core/session.ts).
 */
export function bucketStart(tf: TfId, t: number, sess?: MarketSession | null): number {
  if (sess) return sessionBucketStart(tf, t, sess);
  return utcBucketStart(tf, t);
}

function sessionBucketStart(tf: TfId, t: number, sess: MarketSession): number {
  const def = TIMEFRAMES[tf];
  if (def.kind === 'fixed' && def.seconds < D) {
    const open = sess.dateOpen(sess.date(t));
    if (t < open) return Math.floor(t / def.seconds) * def.seconds;
    return open + Math.floor((t - open) / def.seconds) * def.seconds;
  }
  return utcBucketStart(tf, sess.date(t));
}

function utcBucketStart(tf: TfId, t: number): number {
  const def = TIMEFRAMES[tf];
  switch (def.kind) {
    case 'fixed':
      return Math.floor(t / def.seconds) * def.seconds;
    case 'week': {
      // Semanas de lunes 00:00 UTC (el 1-1-1970 fue jueves).
      const days = Math.floor(t / D);
      const dow = (days + 3) % 7; // lunes = 0
      return (days - dow) * D;
    }
    case 'month': {
      const d = new Date(t * 1000);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000;
    }
    case 'year': {
      const d = new Date(t * 1000);
      return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000;
    }
  }
}

/**
 * Inicio de la vela siguiente. Con `sess` devuelve el INSTANTE REAL en que termina
 * la vela (p. ej. a las 16:00 de Nueva York para la última vela del día de una acción).
 */
export function nextBucketStart(tf: TfId, t: number, sess?: MarketSession | null): number {
  if (sess) {
    const def = TIMEFRAMES[tf];
    const start = sessionBucketStart(tf, t, sess);
    if (def.kind === 'fixed' && def.seconds < D) return Math.min(start + def.seconds, sess.close(start));
    return sess.dateOpen(utcNextBucketStart(tf, start));
  }
  return utcNextBucketStart(tf, t);
}

function utcNextBucketStart(tf: TfId, t: number): number {
  const s = utcBucketStart(tf, t);
  const def = TIMEFRAMES[tf];
  switch (def.kind) {
    case 'fixed':
      return s + def.seconds;
    case 'week':
      return s + 7 * D;
    case 'month': {
      const d = new Date(s * 1000);
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000;
    }
    case 'year': {
      const d = new Date(s * 1000);
      return Date.UTC(d.getUTCFullYear() + 1, 0, 1) / 1000;
    }
  }
}

/**
 * Elige de qué temporalidad "nativa" del proveedor se construye `tf`.
 * Si el proveedor la da directamente, se usa tal cual. Si no, se busca la mayor
 * temporalidad nativa que divida exactamente a la pedida (p. ej. 45s ← 1s, 10m ← 5m, 3h ← 1h).
 */
export function planTimeframe(native: TfId[], tf: TfId): { base: TfId; aggregated: boolean } {
  if (native.includes(tf)) return { base: tf, aggregated: false };
  const def = TIMEFRAMES[tf];
  if (def.kind === 'year') {
    if (native.includes('1M')) return { base: '1M', aggregated: true };
  }
  if (def.kind === 'month' || def.kind === 'week') {
    if (native.includes('1D')) return { base: '1D', aggregated: true };
  }
  const candidates = native
    .map((n) => TIMEFRAMES[n])
    .filter((n) => n.kind === 'fixed' && n.seconds < def.seconds && (def.kind !== 'fixed' || def.seconds % n.seconds === 0))
    .sort((a, b) => b.seconds - a.seconds);
  if (!candidates.length) throw new Error(`El proveedor no puede construir la temporalidad ${tf}`);
  return { base: candidates[0].id, aggregated: true };
}

/** Agrupa velas pequeñas (ordenadas) en velas de temporalidad `tf`. */
export function aggregate(base: Candle[], tf: TfId, sess?: MarketSession | null): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null;
  for (const c of base) {
    const b = bucketStart(tf, c.time, sess);
    if (!cur || cur.time !== b) {
      cur = { time: b, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
      out.push(cur);
    } else {
      if (c.high > cur.high) cur.high = c.high;
      if (c.low < cur.low) cur.low = c.low;
      cur.close = c.close;
      cur.volume += c.volume;
    }
  }
  return out;
}

/** Búsqueda binaria: índice del último elemento con tiempo <= t (o -1). */
export function indexAtOrBefore(n: number, timeAt: (i: number) => number, t: number): number {
  let lo = 0;
  let hi = n - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeAt(mid) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Igual que indexAtOrBefore pero para un array de velas. */
export function candleIndexAtOrBefore(arr: { time: number }[], t: number): number {
  return indexAtOrBefore(arr.length, (i) => arr[i].time, t);
}

/** Inserta o reemplaza una vela en un array ordenado. */
export function upsertCandle(arr: Candle[], c: Candle): 'replace' | 'append' | 'insert' {
  const n = arr.length;
  if (!n || c.time > arr[n - 1].time) {
    arr.push(c);
    return 'append';
  }
  if (arr[n - 1].time === c.time) {
    arr[n - 1] = c;
    return 'replace';
  }
  const idx = candleIndexAtOrBefore(arr, c.time);
  if (idx >= 0 && arr[idx].time === c.time) {
    arr[idx] = c;
    return 'replace';
  }
  arr.splice(idx + 1, 0, c);
  return 'insert';
}

/** Grupo de una temporalidad (para la pestaña "Visibilidad" de los indicadores). */
export function tfGroup(tf: TfId): import('./types').TfGroup {
  const s = TIMEFRAMES[tf].seconds;
  if (s < 60) return 'sec';
  if (s < 3600) return 'min';
  if (s < 86400) return 'hour';
  if (s < 7 * 86400) return 'day';
  if (s < 28 * 86400) return 'week';
  return 'month';
}
