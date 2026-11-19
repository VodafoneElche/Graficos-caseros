import type { Candle, TfId, Unsubscribe } from '../core/types';
import { type ConnectionStatus, type DataProvider, type DayTicker, type SearchResult, type SymbolInfo, precisionFromTick, rankResults } from './provider';

// Proveedor Binance (spot), sin clave de API.
//  - Histórico: REST /api/v3/klines, pedido a través de nuestro servidor (/proxy/binance/...).
//    Así el navegador no depende de CORS y en la fase 2 el servidor podrá cachear.
//  - Tiempo real: WebSocket público de Binance, directamente desde el navegador.

const INTERVALS: Partial<Record<TfId, string>> = {
  '1s': '1s', '1m': '1m', '3m': '3m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '2h': '2h', '4h': '4h', '1D': '1d', '1W': '1w', '1M': '1M',
};

const WS_URLS = ['wss://stream.binance.com:9443/stream', 'wss://data-stream.binance.vision/stream'];

type StreamCb = (data: any) => void;

/** Una sola conexión WebSocket multiplexada con SUBSCRIBE/UNSUBSCRIBE y reconexión automática. */
class BinanceSocket {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<StreamCb>>();
  private pendingSub = new Set<string>();
  private pendingUnsub = new Set<string>();
  private flushTimer: number | null = null;
  private reqId = 1;
  private everOpened = false;
  private attempt = 0;
  private urlIdx = 0;
  private lastMsg = Date.now();
  private reconnectCbs = new Set<() => void>();
  private statusCbs = new Set<(s: ConnectionStatus) => void>();
  private status: ConnectionStatus = 'closed';

  constructor() {
    // Vigilante: si no llega nada en 30 s con suscripciones activas, reconectar.
    setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN && this.subs.size && Date.now() - this.lastMsg > 30000) {
        console.warn('[binance] sin datos en 30 s, reconectando');
        this.ws.close();
      }
    }, 5000);
  }

  onReconnect(cb: () => void): Unsubscribe {
    this.reconnectCbs.add(cb);
    return () => this.reconnectCbs.delete(cb);
  }

  onStatus(cb: (s: ConnectionStatus) => void): Unsubscribe {
    this.statusCbs.add(cb);
    cb(this.status);
    return () => this.statusCbs.delete(cb);
  }

  private setStatus(s: ConnectionStatus) {
    this.status = s;
    this.statusCbs.forEach((cb) => cb(s));
  }

  subscribe(stream: string, cb: StreamCb): Unsubscribe {
    let set = this.subs.get(stream);
    if (!set) {
      set = new Set();
      this.subs.set(stream, set);
      this.pendingUnsub.delete(stream);
      this.pendingSub.add(stream);
      this.ensureConnected();
      this.scheduleFlush();
    }
    set.add(cb);
    return () => {
      const s = this.subs.get(stream);
      if (!s) return;
      s.delete(cb);
      if (!s.size) {
        this.subs.delete(stream);
        this.pendingSub.delete(stream);
        this.pendingUnsub.add(stream);
        this.scheduleFlush();
      }
    };
  }

  private ensureConnected() {
    if (this.ws) return;
    const url = WS_URLS[this.urlIdx % WS_URLS.length];
    this.setStatus('connecting');
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.lastMsg = Date.now();
      this.setStatus('open');
      // (Re)suscribir todo lo activo.
      this.pendingUnsub.clear();
      this.pendingSub = new Set(this.subs.keys());
      this.scheduleFlush();
      if (this.everOpened) this.reconnectCbs.forEach((cb) => cb());
      this.everOpened = true;
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      let msg: any;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!msg || !msg.stream) return; // respuestas a SUBSCRIBE
      const set = this.subs.get(msg.stream);
      if (set) set.forEach((cb) => cb(msg.data));
    };
    ws.onclose = () => {
      this.ws = null;
      this.setStatus('closed');
      this.attempt++;
      if (this.attempt % 3 === 0) this.urlIdx++; // tras varios fallos, probar la URL alternativa
      const delay = Math.min(15000, [1000, 2000, 5000, 10000][Math.min(this.attempt - 1, 3)] ?? 15000);
      setTimeout(() => {
        if (this.subs.size) this.ensureConnected();
      }, delay);
    };
    ws.onerror = () => ws.close();
  }

  // Binance admite como máximo 5 mensajes por segundo: agrupamos las (des)suscripciones.
  private scheduleFlush() {
    if (this.flushTimer != null) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = null;
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (this.pendingUnsub.size) {
        ws.send(JSON.stringify({ method: 'UNSUBSCRIBE', params: [...this.pendingUnsub], id: this.reqId++ }));
        this.pendingUnsub.clear();
      }
      if (this.pendingSub.size) {
        const all = [...this.pendingSub];
        this.pendingSub.clear();
        for (let i = 0; i < all.length; i += 200) {
          ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: all.slice(i, i + 200), id: this.reqId++ }));
        }
      }
    }, 300);
  }
}

function parseKline(k: any): Candle {
  return {
    time: Math.floor(k.t / 1000),
    open: +k.o,
    high: +k.h,
    low: +k.l,
    close: +k.c,
    volume: +k.v,
  };
}

export class BinanceProvider implements DataProvider {
  readonly id = 'binance';
  readonly label = 'Binance';
  readonly nativeTimeframes = Object.keys(INTERVALS) as TfId[];
  readonly maxBarsPerRequest = 1000;
  private socket = new BinanceSocket();
  private infoCache = new Map<string, Promise<SymbolInfo>>();

  constructor(private restBase = '/proxy/binance') {}

  private async get(path: string, params: Record<string, string | number>): Promise<any> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`${this.restBase}${path}?${qs}`);
        if (r.ok) return await r.json();
        const body = await r.text();
        if (r.status === 400) throw new Error(`Binance: ${body}`);
        lastErr = new Error(`HTTP ${r.status}: ${body.slice(0, 200)}`);
      } catch (e) {
        lastErr = e;
        if (e instanceof Error && e.message.startsWith('Binance:')) throw e;
      }
      await new Promise((res) => setTimeout(res, 500 * (i + 1)));
    }
    throw lastErr;
  }

  private allSymbols: Promise<SearchResult[]> | null = null;

  /** Lista de todos los pares de contado que se negocian ahora en Binance (se pide una vez). */
  private loadAllSymbols(): Promise<SearchResult[]> {
    if (!this.allSymbols) {
      const map = (j: any): SearchResult[] => {
        // Primero los pares en USDT (los habituales), luego el resto.
        const list: SearchResult[] = (j.symbols || [])
          .filter((s: any) => s.status === 'TRADING')
          .map((s: any) => ({ symbol: s.symbol, description: `${s.baseAsset} / ${s.quoteAsset}`, kind: 'crypto', source: 'Binance', quote: s.quoteAsset }));
        const rank = (r: any) => (r.quote === 'USDT' ? 0 : r.quote === 'USDC' ? 1 : r.quote === 'BTC' ? 2 : 3);
        list.sort((a: any, b: any) => rank(a) - rank(b) || a.symbol.localeCompare(b.symbol));
        return list;
      };
      this.allSymbols = this.get('/api/v3/exchangeInfo', { symbolStatus: 'TRADING', showPermissionSets: 'false' })
        .catch(() => this.get('/api/v3/exchangeInfo', {}))
        .then(map);
      this.allSymbols.catch(() => (this.allSymbols = null));
    }
    return this.allSymbols;
  }

  async searchSymbols(query: string): Promise<SearchResult[]> {
    return rankResults(await this.loadAllSymbols(), query);
  }

  supportsSymbol(symbol: string): boolean {
    // Pares de cripto de Binance: terminan en una moneda de cotización conocida.
    return /^[A-Z0-9]{2,}(USDT|USDC|FDUSD|BTC|ETH|BNB|EUR|TRY)$/.test(symbol.toUpperCase());
  }

  getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    const s = symbol.toUpperCase();
    let p = this.infoCache.get(s);
    if (!p) {
      p = this.get('/api/v3/exchangeInfo', { symbol: s }).then((j) => {
        const info = j.symbols?.[0];
        if (!info) throw new Error(`Símbolo ${s} no encontrado en Binance`);
        const pf = info.filters.find((f: any) => f.filterType === 'PRICE_FILTER');
        const tick = pf ? pf.tickSize : '0.01';
        return {
          symbol: s,
          description: `${info.baseAsset} / ${info.quoteAsset}`,
          precision: precisionFromTick(tick),
          minMove: +tick,
        };
      });
      p.catch(() => this.infoCache.delete(s));
      this.infoCache.set(s, p);
    }
    return p;
  }

  async fetchCandles(symbol: string, tf: TfId, opts: { limit: number; end?: number }): Promise<Candle[]> {
    const interval = INTERVALS[tf];
    if (!interval) throw new Error(`Binance no da ${tf} de forma nativa`);
    const params: Record<string, string | number> = {
      symbol: symbol.toUpperCase(),
      interval,
      limit: Math.min(opts.limit, this.maxBarsPerRequest),
    };
    if (opts.end != null) params.endTime = opts.end * 1000 - 1;
    const rows: any[] = await this.get('/api/v3/klines', params);
    return rows.map((r) => ({
      time: Math.floor(r[0] / 1000),
      open: +r[1],
      high: +r[2],
      low: +r[3],
      close: +r[4],
      volume: +r[5],
    }));
  }

  subscribeCandles(symbol: string, tf: TfId, cb: (c: Candle) => void): Unsubscribe {
    const interval = INTERVALS[tf];
    if (!interval) throw new Error(`Binance no da ${tf} de forma nativa`);
    return this.socket.subscribe(`${symbol.toLowerCase()}@kline_${interval}`, (d) => cb(parseKline(d.k)));
  }

  subscribeDayTicker(symbol: string, cb: (t: DayTicker) => void): Unsubscribe {
    // La vela diaria en curso tiene justo lo que queremos: apertura del día y último precio.
    const s = symbol.toUpperCase();
    let alive = true;
    this.fetchCandles(s, '1D', { limit: 1 })
      .then((c) => {
        if (alive && c[0]) cb({ symbol: s, last: c[0].close, dayOpen: c[0].open });
      })
      .catch(() => {});
    const un = this.socket.subscribe(`${s.toLowerCase()}@kline_1d`, (d) => cb({ symbol: s, last: +d.k.c, dayOpen: +d.k.o }));
    return () => {
      alive = false;
      un();
    };
  }

  onReconnect(cb: () => void): Unsubscribe {
    return this.socket.onReconnect(cb);
  }

  onStatus(cb: (s: ConnectionStatus) => void): Unsubscribe {
    return this.socket.onStatus(cb);
  }
}
