import type { MarketSession } from '../core/session';
import type { Candle, TfId, Unsubscribe } from '../core/types';
import { AlpacaProvider } from './alpaca';
import { BinanceProvider } from './binance';
import { CapitalProvider, isForexOrMetal } from './capital';
import type { ConnectionStatus, DataProvider, DayTicker, LiveCandle, SearchResult, SymbolInfo } from './provider';

// ─────────────────────────────────────────────────────────────────────────────
// Proveedor COMBINADO: cada símbolo va a su fuente.
//   - XAUUSD, XAGUSD y pares de divisas (EURUSD...) → Capital.com
//   - Pares de cripto (BTCUSDT...)                   → Binance
//   - Tickers de 1 a 5 letras (AAPL, MSTR...)        → Alpaca
// El resto de la app sigue viendo un único proveedor.
// ─────────────────────────────────────────────────────────────────────────────

export class CompositeProvider implements DataProvider {
  readonly id = 'mixto';
  readonly label = 'Binance · Alpaca · Capital.com';
  readonly binance = new BinanceProvider();
  readonly alpaca = new AlpacaProvider();
  readonly capital = new CapitalProvider();
  private all: DataProvider[] = [this.binance, this.alpaca, this.capital];
  /** Fuentes que se están usando (para el punto de estado de la barra superior). */
  private used = new Set<DataProvider>();
  private statusCbs = new Set<(s: ConnectionStatus) => void>();

  constructor() {
    for (const p of this.all) p.onStatus(() => this.emitStatus());
  }

  /** Fuente de un símbolo (o null si nadie lo da). */
  route(symbol: string): DataProvider | null {
    const s = symbol.toUpperCase();
    if (isForexOrMetal(s)) return this.capital;
    if (this.binance.supportsSymbol(s)) return this.binance;
    if (this.alpaca.supportsSymbol(s)) return this.alpaca;
    return null;
  }

  private need(symbol: string): DataProvider {
    const p = this.route(symbol);
    if (!p) throw new Error(`No sé de dónde sacar los datos de ${symbol}`);
    return p;
  }

  // Unión de las temporalidades: el almacén pregunta por el proveedor del símbolo con nativeFor().
  get nativeTimeframes(): TfId[] {
    return this.binance.nativeTimeframes;
  }
  get maxBarsPerRequest(): number {
    return this.binance.maxBarsPerRequest;
  }
  nativeFor(symbol: string): TfId[] {
    return this.need(symbol).nativeTimeframes;
  }
  maxBarsFor(symbol: string): number {
    return this.need(symbol).maxBarsPerRequest;
  }

  supportsSymbol(symbol: string): boolean {
    return this.route(symbol) != null;
  }

  sessionFor(symbol: string): MarketSession | null {
    return this.route(symbol)?.sessionFor?.(symbol) ?? null;
  }

  sourceLabel(symbol: string): string {
    return this.route(symbol)?.label ?? '—';
  }

  async searchSymbols(query: string): Promise<SearchResult[]> {
    const parts = await Promise.all(this.all.map((p) => p.searchSymbols(query).catch(() => [] as SearchResult[])));
    const q = query.trim().toUpperCase();
    const merged = parts.flat();
    // Coincidencia exacta primero, luego los que empiezan por el texto, y luego el resto.
    const score = (r: SearchResult) => (r.symbol === q ? 0 : r.symbol.startsWith(q) ? 1 : 2);
    return merged.map((r, i) => ({ r, i })).sort((a, b) => score(a.r) - score(b.r) || a.i - b.i).map((x) => x.r).slice(0, 300);
  }

  getSymbolInfo(symbol: string): Promise<SymbolInfo> {
    return this.need(symbol).getSymbolInfo(symbol);
  }

  fetchCandles(symbol: string, tf: TfId, opts: { limit: number; end?: number }): Promise<Candle[]> {
    return this.need(symbol).fetchCandles(symbol, tf, opts);
  }

  subscribeCandles(symbol: string, tf: TfId, cb: (c: LiveCandle) => void): Unsubscribe {
    const p = this.need(symbol);
    this.used.add(p);
    this.emitStatus();
    return p.subscribeCandles(symbol, tf, cb);
  }

  subscribeDayTicker(symbol: string, cb: (t: DayTicker) => void): Unsubscribe {
    return this.need(symbol).subscribeDayTicker(symbol, cb);
  }

  onReconnect(cb: () => void): Unsubscribe {
    const uns = this.all.map((p) => p.onReconnect(cb));
    return () => uns.forEach((u) => u());
  }

  /** Reconexión sólo de la fuente de un símbolo (para no recargar cripto cuando se corta Alpaca). */
  onSymbolReconnect(symbol: string, cb: () => void): Unsubscribe {
    return this.need(symbol).onReconnect(cb);
  }

  onSymbolStatus(symbol: string, cb: (s: ConnectionStatus, msg?: string) => void): Unsubscribe {
    const p = this.route(symbol);
    if (!p) return () => {};
    return (p.onStatus as (cb: (s: ConnectionStatus, msg?: string) => void) => Unsubscribe)(cb);
  }

  private lastStatus: ConnectionStatus = 'closed';
  private emitStatus() {
    // Peor estado de las fuentes en uso.
    const st: ConnectionStatus[] = [];
    for (const p of this.used) p.onStatus((s) => st.push(s))();
    const s: ConnectionStatus = !st.length ? 'connecting' : st.includes('closed') ? 'closed' : st.includes('connecting') ? 'connecting' : 'open';
    this.lastStatus = s;
    this.statusCbs.forEach((cb) => cb(s));
  }

  onStatus(cb: (s: ConnectionStatus) => void): Unsubscribe {
    this.statusCbs.add(cb);
    cb(this.lastStatus);
    return () => this.statusCbs.delete(cb);
  }

  /** Tras cambiar las claves en "Fuentes de datos". */
  resetConfig() {
    this.alpaca.resetConfig();
    this.capital.resetConfig();
  }
}
