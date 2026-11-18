import { TIMEFRAMES, bucketStart, nextBucketStart } from '../core/timeframes';
import type { Candle, TfId, Unsubscribe } from '../core/types';
import { rankResults, type ConnectionStatus, type DataProvider, type DayTicker, type SearchResult, type SymbolInfo } from './provider';

// Proveedor de DEMOSTRACIÓN: genera precios inventados (deterministas) sin conexión a internet.
// Se activa abriendo la app con ?demo=1. Sirve para probar la interfaz y como ejemplo
// de que el resto de la app funciona con cualquier proveedor.

const NATIVE: TfId[] = ['1s', '1m', '5m', '15m', '30m', '1h', '4h', '1D', '1W', '1M'];

function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function basePrice(symbol: string): number {
  if (symbol.startsWith('BTC')) return 90000;
  if (symbol.startsWith('BNB')) return 900;
  if (symbol.startsWith('SOL')) return 180;
  if (symbol.startsWith('BCH')) return 500;
  if (symbol.startsWith('LINK')) return 20;
  return 1 + (symbol.charCodeAt(0) % 7) * 0.13;
}

function priceAt(symbol: string, t: number): number {
  const seed = symbol.charCodeAt(0) + symbol.charCodeAt(1) * 3;
  const x =
    0.25 * Math.sin(t / 2_000_000 + seed) +
    0.08 * Math.sin(t / 300_000 + seed * 2) +
    0.03 * Math.sin(t / 40_000 + seed) +
    0.01 * Math.sin(t / 3_000) +
    0.004 * Math.sin(t / 400) +
    0.0015 * (hash(Math.floor(t / 5) + seed) - 0.5);
  return basePrice(symbol) * Math.exp(x);
}

function makeCandle(symbol: string, tf: TfId, start: number, upTo?: number): Candle {
  const end = Math.min(nextBucketStart(tf, start), upTo ?? Infinity);
  const steps = 12;
  const dt = Math.max(1, (end - start) / steps);
  let high = -Infinity;
  let low = Infinity;
  for (let t = start; t < end; t += dt) {
    const p = priceAt(symbol, t);
    if (p > high) high = p;
    if (p < low) low = p;
  }
  const open = priceAt(symbol, start);
  const close = priceAt(symbol, Math.max(start, end - 1));
  high = Math.max(high, open, close);
  low = Math.min(low, open, close);
  const volume = (end - start) * (0.5 + hash(start)) * 2;
  return { time: start, open, high, low, close, volume };
}

export class MockProvider implements DataProvider {
  readonly id = 'demo';
  readonly label = 'Demo (datos inventados)';
  readonly nativeTimeframes = NATIVE;
  readonly maxBarsPerRequest = 1000;

  async searchSymbols(query: string): Promise<SearchResult[]> {
    const bases = ['BTC', 'ETH', 'SOL', 'BNB', 'LINK', 'THETA', 'SAND', 'BCH', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LTC', 'TRX', 'ATOM'];
    const all: SearchResult[] = [];
    for (const q of ['USDT', 'USDC', 'BTC']) for (const b of bases) if (b !== 'BTC' || q !== 'BTC') all.push({ symbol: b + q, description: `${b} / ${q} (demo)`, kind: 'crypto', source: 'Demo' });
    return rankResults(all, query);
  }

  supportsSymbol(symbol: string): boolean {
    return /USDT$/.test(symbol);
  }

  async getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    const s = symbol.toUpperCase();
    const p = basePrice(s);
    const precision = p > 1000 ? 2 : p > 10 ? 3 : 4;
    return { symbol: s, description: `${s} (demo)`, precision, minMove: Math.pow(10, -precision) };
  }

  async fetchCandles(symbol: string, tf: TfId, opts: { limit: number; end?: number }): Promise<Candle[]> {
    const now = Date.now() / 1000;
    const end = Math.min(opts.end ?? Infinity, now + 1);
    let t = bucketStart(tf, end - 1);
    const out: Candle[] = [];
    const limit = Math.min(opts.limit, this.maxBarsPerRequest);
    while (out.length < limit) {
      out.push(makeCandle(symbol, tf, t, now));
      t = bucketStart(tf, t - 1);
    }
    return out.reverse();
  }

  subscribeCandles(symbol: string, tf: TfId, cb: (c: Candle) => void): Unsubscribe {
    const id = window.setInterval(() => {
      const now = Date.now() / 1000;
      cb(makeCandle(symbol, tf, bucketStart(tf, now), now));
    }, TIMEFRAMES[tf].seconds <= 1 ? 1000 : 2000);
    return () => clearInterval(id);
  }

  subscribeDayTicker(symbol: string, cb: (t: DayTicker) => void): Unsubscribe {
    const tick = () => {
      const now = Date.now() / 1000;
      const c = makeCandle(symbol, '1D', bucketStart('1D', now), now);
      cb({ symbol, last: c.close, dayOpen: c.open });
    };
    tick();
    const id = window.setInterval(tick, 2000);
    return () => clearInterval(id);
  }

  onReconnect(): Unsubscribe {
    return () => {};
  }

  onStatus(cb: (s: ConnectionStatus) => void): Unsubscribe {
    cb('open');
    return () => {};
  }
}
