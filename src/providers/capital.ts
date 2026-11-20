import { FOREX, METALS, type MarketSession } from '../core/session';
import { bucketStart } from '../core/timeframes';
import type { Candle, TfId, Unsubscribe } from '../core/types';
import { type ConnectionStatus, type DataProvider, type DayTicker, type LiveCandle, type SearchResult, type SymbolInfo, rankResults } from './provider';
import { SseHub } from './sse';

// ─────────────────────────────────────────────────────────────────────────────
// Proveedor CAPITAL.COM: oro, plata y forex (precios de CFD, cuenta demo gratuita).
//
//  - Precios: los de compra ("bid"), igual que muestra TradingView para CAPITALCOM:GOLD.
//  - Volumen: el forex y el oro al contado no tienen volumen real. Capital.com no da
//    volumen; la barra de volumen saldrá vacía.
//  - Histórico: hasta 1000 velas por petición (1m, 5m, 15m, 30m, 1h, D, S).
//    4h se construye con velas de 1h cortadas como TradingView (el día del forex
//    empieza a las 17:00 de Nueva York; el del oro y la plata a las 18:00).
//  - Tiempo real: precios por WebSocket (a través de nuestro servidor).
//
// En la app los símbolos se llaman como en TradingView (XAUUSD, EURUSD...); aquí se
// traducen a los nombres de Capital.com ("epic": GOLD, SILVER, EURUSD...).
// ─────────────────────────────────────────────────────────────────────────────

const RES: Partial<Record<TfId, string>> = {
  '1m': 'MINUTE', '5m': 'MINUTE_5', '15m': 'MINUTE_15', '30m': 'MINUTE_30', '1h': 'HOUR', '1D': 'DAY', '1W': 'WEEK',
};
const RES_SECS: Partial<Record<TfId, number>> = { '1m': 60, '5m': 300, '15m': 900, '30m': 1800, '1h': 3600, '1D': 86400, '1W': 7 * 86400 };

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'NZD', 'CAD', 'SEK', 'NOK', 'DKK', 'PLN', 'HUF', 'CZK', 'TRY', 'MXN', 'ZAR', 'SGD', 'HKD', 'CNH', 'ILS'];
const METAL_EPICS: Record<string, string> = { XAUUSD: 'GOLD', XAGUSD: 'SILVER', XPTUSD: 'PLATINUM', XPDUSD: 'PALLADIUM' };
const EPIC_TO_SYMBOL: Record<string, string> = Object.fromEntries(Object.entries(METAL_EPICS).map(([s, e]) => [e, s]));
const NAMES: Record<string, string> = { XAUUSD: 'Oro / Dólar', XAGUSD: 'Plata / Dólar', XPTUSD: 'Platino / Dólar', XPDUSD: 'Paladio / Dólar' };

export function isForexOrMetal(symbol: string): boolean {
  if (METAL_EPICS[symbol]) return true;
  return /^[A-Z]{6}$/.test(symbol) && CURRENCIES.includes(symbol.slice(0, 3)) && CURRENCIES.includes(symbol.slice(3));
}

const toEpic = (symbol: string) => METAL_EPICS[symbol] ?? symbol;

/** Fecha para Capital.com: "YYYY-MM-DDTHH:MM:SS" en UTC. */
const capDate = (t: number) => new Date(t * 1000).toISOString().slice(0, 19);

/** Instante de una vela de Capital.com (en UTC). */
function parseTime(p: any): number {
  const s: string = p.snapshotTimeUTC ?? p.snapshotTime;
  return Math.floor(Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s + 'Z') / 1000);
}

export class CapitalProvider implements DataProvider {
  readonly id = 'capital';
  readonly label = 'Capital.com';
  // 1s: sólo en tiempo real (Capital.com no da histórico de segundos), para la vela de 45s.
  readonly nativeTimeframes: TfId[] = ['1s', '1m', '5m', '15m', '30m', '1h', '1D', '1W'];
  readonly maxBarsPerRequest = 1000;
  private hub = new SseHub('/stream/capital', 'epics', 'quote', (d) => d.e);
  private infoCache = new Map<string, Promise<SymbolInfo>>();

  supportsSymbol(symbol: string): boolean {
    return isForexOrMetal(symbol);
  }

  sessionFor(symbol: string): MarketSession {
    return METAL_EPICS[symbol] ? METALS : FOREX;
  }

  sourceLabel(): string {
    return 'Capital.com';
  }

  resetConfig() {
    this.infoCache.clear();
  }

  private async get(path: string, params: Record<string, string | number | undefined> = {}): Promise<any> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`/proxy/capital${path}${qs.toString() ? '?' + qs : ''}`);
        if (r.ok) return await r.json();
        let body: any = {};
        try {
          body = await r.json();
        } catch {}
        const err = Object.assign(new Error(body.error || `HTTP ${r.status}`), { status: r.status, detail: body.detail || '' });
        if ([400, 401, 403, 404, 412].includes(r.status)) throw Object.assign(err, { final: true });
        lastErr = err;
      } catch (e: any) {
        if (e?.final) throw e;
        lastErr = e;
      }
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
    throw lastErr;
  }

  async searchSymbols(query: string): Promise<SearchResult[]> {
    const own: SearchResult[] = [
      ...Object.keys(METAL_EPICS).map((s) => ({ symbol: s, description: NAMES[s], kind: 'commodity' as const, source: 'Capital.com' })),
    ];
    const q = query.trim().toUpperCase();
    if (q.length >= 2) {
      try {
        const j = await this.get('/api/v1/markets', { searchTerm: q });
        for (const m of j?.markets || []) {
          if (m.instrumentType === 'CURRENCIES' && isForexOrMetal(m.epic) && !own.some((r) => r.symbol === m.epic)) {
            own.push({ symbol: m.epic, description: m.instrumentName || m.epic, kind: 'forex', source: 'Capital.com' });
          }
        }
      } catch {
        /* sin claves o sin conexión: sólo la lista fija */
      }
    }
    // Pares principales aunque no se haya buscado nada.
    for (const s of ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY']) {
      if (!own.some((r) => r.symbol === s)) own.push({ symbol: s, description: `${s.slice(0, 3)} / ${s.slice(3)}`, kind: 'forex', source: 'Capital.com' });
    }
    return rankResults(own, query, 100);
  }

  getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    let p = this.infoCache.get(symbol);
    if (!p) {
      p = this.get(`/api/v1/markets/${toEpic(symbol)}`).then(
        (j) => {
          const snap = j?.snapshot || {};
          const name = j?.instrument?.name || NAMES[symbol] || symbol;
          let precision = Number(snap.decimalPlacesFactor);
          if (!Number.isFinite(precision) || precision < 0 || precision > 8) precision = defaultPrecision(symbol);
          return { symbol, description: name, precision, minMove: Math.pow(10, -precision) };
        },
        (e) => {
          if (e?.status === 404) throw new Error(`Símbolo ${symbol} no encontrado en Capital.com`);
          throw e;
        },
      );
      p.catch(() => this.infoCache.delete(symbol));
      this.infoCache.set(symbol, p);
    }
    return p;
  }

  async fetchCandles(symbol: string, tf: TfId, opts: { limit: number; end?: number }): Promise<Candle[]> {
    if (tf === '1s') return []; // sin histórico de segundos: la vela de 45s se va formando en vivo
    const res = RES[tf];
    if (!res) throw new Error(`Capital.com no da ${tf} de forma nativa`);
    const max = Math.min(opts.limit, this.maxBarsPerRequest);
    let j: any;
    if (opts.end == null) {
      j = await this.get(`/api/v1/prices/${toEpic(symbol)}`, { resolution: res, max });
    } else {
      // Hacia atrás: ventana de tiempo que debería contener `max` velas (con fines de semana).
      // Si Capital.com dice que la ventana es demasiado grande, se va reduciendo.
      let span = Math.ceil(max * (RES_SECS[tf] ?? 60) * 1.45);
      for (let i = 0; ; i++) {
        try {
          j = await this.get(`/api/v1/prices/${toEpic(symbol)}`, { resolution: res, max, from: capDate(opts.end - span), to: capDate(opts.end - 1) });
          break;
        } catch (e: any) {
          if (i < 4 && e?.status === 400 && /date|range/i.test(e.detail + e.message)) {
            span = Math.floor(span / 3);
            continue;
          }
          if (e?.status === 404 || /not.?found/i.test(e?.detail || '')) return []; // no hay más historia
          throw e;
        }
      }
    }
    const rows: any[] = j?.prices || [];
    const out: Candle[] = [];
    for (const p of rows) {
      let t = parseTime(p);
      // Velas diarias y semanales: con la FECHA de negociación (00:00 UTC), como TradingView.
      if (tf === '1D') t = Math.floor((t + 12 * 3600) / 86400) * 86400;
      if (tf === '1W') t = bucketStart('1W', Math.floor((t + 36 * 3600) / 86400) * 86400);
      const o = price(p.openPrice);
      const c = price(p.closePrice);
      const h = price(p.highPrice);
      const l = price(p.lowPrice);
      if (![o, c, h, l].every(Number.isFinite)) continue;
      if (opts.end != null && t >= opts.end) continue;
      out.push({ time: t, open: o, high: h, low: l, close: c, volume: Number(p.lastTradedVolume) || 0 });
    }
    out.sort((a, b) => a.time - b.time);
    // Sin duplicados (por si dos velas caen en la misma fecha).
    const dedup: Candle[] = [];
    for (const c of out) {
      const last = dedup[dedup.length - 1];
      if (last && last.time === c.time) dedup[dedup.length - 1] = c;
      else dedup.push(c);
    }
    return dedup;
  }

  subscribeCandles(symbol: string, tf: TfId, cb: (c: LiveCandle) => void): Unsubscribe {
    const sess = this.sessionFor(symbol);
    return this.hub.subscribe(toEpic(symbol), (q: { b: number; t: number }) => {
      const p = Number(q.b);
      if (!Number.isFinite(p)) return;
      const t = Math.floor((q.t || Date.now()) / 1000);
      cb({ time: bucketStart(tf, t, sess), open: p, high: p, low: p, close: p, volume: 0, merge: true });
    });
  }

  // Lista de seguimiento: precio y cambio del día para todos a la vez, cada pocos segundos.
  private tickerCbs = new Map<string, Set<(t: DayTicker) => void>>();
  private tickerTimer: number | null = null;

  subscribeDayTicker(symbol: string, cb: (t: DayTicker) => void): Unsubscribe {
    let set = this.tickerCbs.get(symbol);
    if (!set) this.tickerCbs.set(symbol, (set = new Set()));
    set.add(cb);
    if (this.tickerTimer == null) this.tickerTimer = window.setTimeout(() => this.pollTickers(), 300);
    return () => {
      const s = this.tickerCbs.get(symbol);
      s?.delete(cb);
      if (s && !s.size) this.tickerCbs.delete(symbol);
    };
  }

  private async pollTickers() {
    const symbols = [...this.tickerCbs.keys()];
    if (!symbols.length) {
      this.tickerTimer = null;
      return;
    }
    try {
      for (let i = 0; i < symbols.length; i += 50) {
        const chunk = symbols.slice(i, i + 50);
        const j = await this.get('/api/v1/markets', { epics: chunk.map(toEpic).join(',') });
        const list: any[] = j?.marketDetails || j?.markets || [];
        for (const m of list) {
          const epic = m.instrument?.epic ?? m.epic;
          const snap = m.snapshot ?? m;
          const sym = EPIC_TO_SYMBOL[epic] ?? epic;
          const last = Number(snap.bid);
          if (!Number.isFinite(last)) continue;
          const net = Number(snap.netChange);
          const dayOpen = Number.isFinite(net) ? last - net : last;
          this.tickerCbs.get(sym)?.forEach((cb) => cb({ symbol: sym, last, dayOpen }));
        }
      }
    } catch (e) {
      console.warn('[capital] lista de seguimiento', e);
    }
    this.tickerTimer = window.setTimeout(() => this.pollTickers(), 5000);
  }

  onReconnect(cb: () => void): Unsubscribe {
    return this.hub.onReconnect(cb);
  }

  onStatus(cb: (s: ConnectionStatus, msg?: string) => void): Unsubscribe {
    return this.hub.onStatus(cb);
  }
}

function price(x: any): number {
  if (x == null) return NaN;
  if (typeof x === 'number') return x;
  return Number(x.bid ?? x.ask);
}

function defaultPrecision(symbol: string): number {
  if (symbol === 'XAUUSD') return 2;
  if (symbol === 'XAGUSD') return 3;
  if (symbol.endsWith('JPY')) return 3;
  return 5;
}
