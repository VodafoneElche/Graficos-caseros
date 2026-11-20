import { US_STOCKS } from '../core/session';
import { bucketStart } from '../core/timeframes';
import type { Candle, TfId, Unsubscribe } from '../core/types';
import { type ConnectionStatus, type DataProvider, type DayTicker, type LiveCandle, type SearchResult, type SymbolInfo, rankResults } from './provider';
import { SseHub } from './sse';

// ─────────────────────────────────────────────────────────────────────────────
// Proveedor ALPACA: acciones de EE. UU. (Nasdaq, NYSE...).
//
// Plan gratuito ("Basic"):
//   - Tiempo real: sólo la bolsa IEX (≈2-3 % del volumen total). El precio es
//     prácticamente el mismo que en el resto de bolsas; el VOLUMEN es mucho menor.
//   - Histórico: de TODAS las bolsas (consolidado "SIP"), salvo los últimos 15 minutos.
//   => Usamos lo mejor de cada uno: velas antiguas consolidadas (precio y volumen
//      buenos) + los últimos 15 minutos y el tiempo real desde IEX.
// Plan de pago ("Algo Trader Plus", 99 $/mes): todo consolidado y en tiempo real.
//
// Las velas se cortan como en TradingView: sólo horario regular (9:30-16:00 de
// Nueva York), la de 1h empieza a las 9:30, la de 4h a las 9:30 y a las 13:30.
// Por eso 1h y 4h se construyen con velas de 30 minutos (las de 1h de Alpaca van de
// en punto a en punto).
//
// Las claves están en el servidor; aquí sólo se llama a /proxy/alpaca y /stream/alpaca.
// ─────────────────────────────────────────────────────────────────────────────

const TF_PARAM: Partial<Record<TfId, string>> = { '1m': '1Min', '5m': '5Min', '15m': '15Min', '30m': '30Min', '1D': '1Day' };

/** Cuántos días hacia atrás pedir como máximo para tener ~10.000 velas (Alpaca exige fecha de inicio). */
const SPAN_DAYS: Partial<Record<TfId, number>> = { '1m': 30, '5m': 120, '15m': 365, '30m': 900, '1D': 365 * 30 };

/** Retraso del histórico consolidado en el plan gratuito (15 min + margen). */
const SIP_DELAY = 16 * 60;

const iso = (t: number) => new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export class AlpacaProvider implements DataProvider {
  readonly id = 'alpaca';
  readonly label = 'Alpaca';
  // 1s se construye con operaciones sueltas (para la vela de 45s).
  readonly nativeTimeframes: TfId[] = ['1s', '1m', '5m', '15m', '30m', '1D'];
  // Se piden 10.000 velas a Alpaca (con pre y post) y se devuelven hasta 2.000 de horario
  // regular: así una página "llena" significa que hay más historia.
  readonly maxBarsPerRequest = 2000;
  private hub = new SseHub('/stream/alpaca', 'symbols', 'trade', (d) => d.S);
  private plan: Promise<'basic' | 'sip'> | null = null;
  private assets: Promise<SearchResult[]> | null = null;
  private infoCache = new Map<string, Promise<SymbolInfo>>();

  supportsSymbol(symbol: string): boolean {
    return /^[A-Z]{1,5}$/.test(symbol);
  }

  sessionFor() {
    return US_STOCKS;
  }

  sourceLabel(): string {
    return 'Alpaca';
  }

  /** Plan elegido en "Fuentes de datos" (se vuelve a leer al guardar). */
  getPlan(): Promise<'basic' | 'sip'> {
    if (!this.plan) {
      this.plan = fetch('/api/datasources')
        .then((r) => r.json())
        .then((j) => (j?.alpaca?.plan === 'sip' ? 'sip' : 'basic') as 'basic' | 'sip')
        .catch(() => 'basic' as const);
    }
    return this.plan;
  }

  resetConfig() {
    this.plan = null;
    this.assets = null;
    this.infoCache.clear();
  }

  private async get(path: string, params: Record<string, string | number | undefined>): Promise<any> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined) qs.set(k, String(v));
    let lastErr: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(`/proxy/alpaca${path}?${qs}`);
        if (r.ok) return await r.json();
        let msg = `HTTP ${r.status}`;
        try {
          msg = (await r.json()).error || msg;
        } catch {}
        // Errores que no se arreglan reintentando: claves, plan, símbolo.
        if ([400, 401, 403, 404, 412, 422].includes(r.status)) throw Object.assign(new Error(msg), { final: true });
        lastErr = new Error(msg);
      } catch (e: any) {
        if (e?.final) throw e;
        lastErr = e;
      }
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
    throw lastErr;
  }

  // ── Símbolos ────────────────────────────────────────────────────────────────

  private loadAssets(): Promise<SearchResult[]> {
    if (!this.assets) {
      this.assets = this.get('/v2/assets', {}).then((list: any[]) =>
        list
          .map((a) => ({ symbol: a.s, description: a.n, kind: 'stock' as const, source: `Alpaca · ${a.x === 'ARCA' ? 'NYSE Arca' : a.x === 'BATS' ? 'Cboe' : a.x}` }))
          .filter((r) => this.supportsSymbol(r.symbol))
          .sort((a, b) => a.symbol.length - b.symbol.length || a.symbol.localeCompare(b.symbol)),
      );
      this.assets.catch(() => (this.assets = null));
    }
    return this.assets;
  }

  async searchSymbols(query: string): Promise<SearchResult[]> {
    try {
      return rankResults(await this.loadAssets(), query, 100);
    } catch {
      return [];
    }
  }

  getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    let p = this.infoCache.get(symbol);
    if (!p) {
      p = (async () => {
        let description = symbol;
        let listed: boolean | null = null; // null = no se pudo leer la lista
        try {
          const all = await this.loadAssets();
          const a = all.find((r) => r.symbol === symbol);
          listed = !!a;
          if (a) description = a.description;
        } catch {}
        // Decimales como TradingView: 2 (4 si cotiza por debajo de 1 $). Si no está en la
        // lista de Alpaca, se comprueba pidiendo sus últimas velas diarias.
        let precision = 2;
        let last: Candle | undefined;
        if (!listed) {
          try {
            const d = await this.fetchCandles(symbol, '1D', { limit: 5 });
            last = d[d.length - 1];
          } catch (e) {
            if (e instanceof Error && /Faltan/.test(e.message)) throw e;
          }
        }
        if (!last && listed === false) throw new Error(`Símbolo ${symbol} no encontrado en Alpaca`);
        if (last && last.close < 1) precision = 4;
        return { symbol, description, precision, minMove: precision === 4 ? 0.0001 : 0.01 };
      })();
      p.catch(() => this.infoCache.delete(symbol));
      this.infoCache.set(symbol, p);
    }
    return p;
  }

  // ── Histórico ───────────────────────────────────────────────────────────────

  private toCandle(b: any, tf: TfId): Candle {
    const t = Math.floor(Date.parse(b.t) / 1000);
    return { time: tf === '1D' ? US_STOCKS.date(t) : t, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v };
  }

  /** Velas de `feed` entre start y end (desc = las más recientes primero), ya ordenadas de antigua a reciente. */
  private async bars(symbol: string, tf: TfId, feed: 'sip' | 'iex', start: number, end: number, limit: number): Promise<Candle[]> {
    const j = await this.get(`/v2/stocks/${symbol}/bars`, {
      timeframe: TF_PARAM[tf],
      start: iso(start),
      end: iso(end),
      limit: 10000,
      sort: 'desc',
      feed,
      adjustment: 'split',
    });
    const rows: any[] = j?.bars || [];
    let out = rows.map((b) => this.toCandle(b, tf));
    // Velas de menos de un día: sólo horario regular (como TradingView por defecto).
    if (tf !== '1D') out = out.filter((c) => US_STOCKS.inSession(c.time));
    return out.slice(0, limit).reverse();
  }

  async fetchCandles(symbol: string, tf: TfId, opts: { limit: number; end?: number }): Promise<Candle[]> {
    if (tf === '1s') return this.fetchSeconds(symbol, opts);
    if (!TF_PARAM[tf]) throw new Error(`Alpaca no da ${tf} de forma nativa`);
    const plan = await this.getPlan();
    const now = Math.floor(Date.now() / 1000);
    const end = Math.min(opts.end != null ? opts.end - 1 : now, now);
    const start = end - (SPAN_DAYS[tf] ?? 365) * 86400;
    if (plan === 'sip') return this.bars(symbol, tf, 'sip', start, end, opts.limit);

    // Plan gratuito: consolidado hasta hace 16 minutos + IEX desde entonces.
    const sipEnd = Math.min(end, now - SIP_DELAY);
    const old = await this.bars(symbol, tf, 'sip', start, sipEnd, opts.limit);
    if (end <= sipEnd) return old;
    let recent: Candle[] = [];
    try {
      recent = await this.bars(symbol, tf, 'iex', sipEnd - (tf === '1D' ? 86400 * 5 : 3600), end, 1000);
    } catch (e) {
      console.warn('[alpaca] IEX reciente falló', e);
    }
    return mergeTail(old, recent);
  }

  /** Velas de 1 segundo a partir de las operaciones de IEX (para construir 45s). */
  private async fetchSeconds(symbol: string, opts: { limit: number; end?: number }): Promise<Candle[]> {
    const now = Math.floor(Date.now() / 1000);
    const end = Math.min(opts.end != null ? opts.end - 1 : now, now);
    const trades: any[] = [];
    let token: string | undefined;
    for (let page = 0; page < 2; page++) {
      const j = await this.get(`/v2/stocks/${symbol}/trades`, {
        start: iso(end - 5 * 86400),
        end: iso(end),
        limit: 10000,
        sort: 'desc',
        feed: 'iex',
        page_token: token,
      });
      trades.push(...(j?.trades || []));
      token = j?.next_page_token || undefined;
      if (!token) break;
    }
    const bySec = new Map<number, Candle>();
    for (let i = trades.length - 1; i >= 0; i--) {
      const tr = trades[i];
      const t = Math.floor(Date.parse(tr.t) / 1000);
      if (!US_STOCKS.inSession(t)) continue;
      const c = bySec.get(t);
      if (!c) bySec.set(t, { time: t, open: tr.p, high: tr.p, low: tr.p, close: tr.p, volume: tr.s });
      else {
        c.high = Math.max(c.high, tr.p);
        c.low = Math.min(c.low, tr.p);
        c.close = tr.p;
        c.volume += tr.s;
      }
    }
    // Menos de una página completa: el almacén entiende que no hay más historia.
    return [...bySec.values()].sort((a, b) => a.time - b.time).slice(-opts.limit);
  }

  // ── Tiempo real ─────────────────────────────────────────────────────────────

  subscribeCandles(symbol: string, tf: TfId, cb: (c: LiveCandle) => void): Unsubscribe {
    return this.hub.subscribe(symbol, (tr: { p: number; s: number; t: number }) => {
      const t = Math.floor(tr.t / 1000);
      if (!US_STOCKS.inSession(t)) return; // pre y post: fuera, como TradingView por defecto
      cb({ time: bucketStart(tf, t, US_STOCKS), open: tr.p, high: tr.p, low: tr.p, close: tr.p, volume: tr.s, merge: true });
    });
  }

  // Lista de seguimiento: se pregunta a la vez por todos los símbolos cada pocos segundos
  // (con el plan gratuito sólo se pueden seguir 30 símbolos en tiempo real).
  private tickerCbs = new Map<string, Set<(t: DayTicker) => void>>();
  private tickerTimer: number | null = null;
  private prevClose = new Map<string, { t: number; byDate: Map<number, number>; dates: number[] }>();

  subscribeDayTicker(symbol: string, cb: (t: DayTicker) => void): Unsubscribe {
    let set = this.tickerCbs.get(symbol);
    if (!set) this.tickerCbs.set(symbol, (set = new Set()));
    set.add(cb);
    if (this.tickerTimer == null) {
      this.tickerTimer = window.setTimeout(() => this.pollTickers(), 300);
    }
    return () => {
      const s = this.tickerCbs.get(symbol);
      s?.delete(cb);
      if (s && !s.size) this.tickerCbs.delete(symbol);
    };
  }

  /** Cierres diarios consolidados de los últimos días (para el "Cambio" frente al cierre anterior). */
  private async loadPrevCloses(symbols: string[]) {
    const now = Math.floor(Date.now() / 1000);
    const need = symbols.filter((s) => {
      const p = this.prevClose.get(s);
      return !p || now - p.t > 20 * 60;
    });
    if (!need.length) return;
    const plan = await this.getPlan();
    let token: string | undefined;
    const fresh = new Map<string, { t: number; byDate: Map<number, number>; dates: number[] }>();
    for (const s of need) fresh.set(s, { t: now, byDate: new Map(), dates: [] });
    for (let page = 0; page < 5; page++) {
      const j = await this.get('/v2/stocks/bars', {
        symbols: need.join(','),
        timeframe: '1Day',
        start: iso(now - 12 * 86400),
        end: iso(plan === 'sip' ? now : now - SIP_DELAY),
        limit: 10000,
        feed: 'sip',
        adjustment: 'split',
        page_token: token,
      });
      for (const [sym, rows] of Object.entries<any[]>(j?.bars || {})) {
        const f = fresh.get(sym);
        if (!f) continue;
        for (const b of rows) f.byDate.set(US_STOCKS.date(Math.floor(Date.parse(b.t) / 1000)), b.c);
      }
      token = j?.next_page_token || undefined;
      if (!token) break;
    }
    for (const [s, f] of fresh) {
      f.dates = [...f.byDate.keys()].sort((a, b) => a - b);
      this.prevClose.set(s, f);
    }
  }

  private async pollTickers() {
    const symbols = [...this.tickerCbs.keys()];
    if (!symbols.length) {
      this.tickerTimer = null;
      return;
    }
    try {
      await this.loadPrevCloses(symbols).catch((e) => console.warn('[alpaca] cierres anteriores', e));
      const plan = await this.getPlan();
      for (let i = 0; i < symbols.length; i += 100) {
        const chunk = symbols.slice(i, i + 100);
        const j = await this.get('/v2/stocks/snapshots', { symbols: chunk.join(','), feed: plan === 'sip' ? 'sip' : 'iex' });
        const snaps = j?.snapshots || j || {};
        for (const s of chunk) {
          const snap = snaps[s];
          const last = snap?.latestTrade?.p ?? snap?.dailyBar?.c;
          if (last == null) continue;
          const tradeT = snap?.latestTrade?.t ? Math.floor(Date.parse(snap.latestTrade.t) / 1000) : Math.floor(Date.now() / 1000);
          const day = US_STOCKS.date(tradeT);
          // Cierre anterior: el último día consolidado ANTES del día de la última operación.
          let ref: number | undefined;
          const pc = this.prevClose.get(s);
          if (pc) for (const d of pc.dates) if (d < day) ref = pc.byDate.get(d);
          ref ??= snap?.prevDailyBar?.c ?? last;
          this.tickerCbs.get(s)?.forEach((cb) => cb({ symbol: s, last, dayOpen: ref! }));
        }
      }
    } catch (e) {
      console.warn('[alpaca] lista de seguimiento', e);
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

/**
 * Une el histórico consolidado (`old`) con las velas recientes de IEX (`recent`).
 * La vela que comparten se completa con lo que IEX ha visto después (máximo, mínimo y cierre).
 */
export function mergeTail(old: Candle[], recent: Candle[]): Candle[] {
  if (!old.length) return recent;
  const out = old.slice();
  const lastT = out[out.length - 1].time;
  for (const r of recent) {
    if (r.time < lastT) continue;
    if (r.time === lastT) {
      const o = out[out.length - 1];
      out[out.length - 1] = { ...o, high: Math.max(o.high, r.high), low: Math.min(o.low, r.low), close: r.close };
    } else out.push(r);
  }
  return out;
}
