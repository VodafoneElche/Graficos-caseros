import type { MarketSession } from '../core/session';
import type { Candle, TfId, Unsubscribe } from '../core/types';

// ─────────────────────────────────────────────────────────────────────────────
// CAPA DE PROVEEDORES DE DATOS
//
// Todo el resto de la aplicación habla SOLO con esta interfaz. Para añadir una
// fuente nueva (OANDA, Alpaca, Finnhub...) basta con escribir una clase que la
// cumpla y registrarla en `providers/index.ts`. Los gráficos, indicadores y la
// watchlist no cambian.
//
// El proveedor sólo tiene que dar las temporalidades que sabe dar de forma
// nativa (`nativeTimeframes`). Las demás (45s, 2m, 10m, 3h...) las construye la
// app agregando velas más pequeñas (ver core/store.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface SymbolInfo {
  symbol: string;
  description: string;
  /** Decimales a mostrar. */
  precision: number;
  /** Variación mínima de precio (tick). */
  minMove: number;
}

/** Resultado del buscador de símbolos. */
export interface SearchResult {
  symbol: string;
  description: string;
  /** Categoría para las pestañas del buscador. */
  kind: 'crypto' | 'stock' | 'forex' | 'index' | 'commodity';
  /** Nombre de la fuente de datos (Binance, OANDA...). */
  source: string;
}

export interface DayTicker {
  symbol: string;
  last: number;
  /** Precio de apertura del día (UTC) = cierre del día anterior en cripto. */
  dayOpen: number;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

/**
 * Vela en tiempo real. Con `merge: true` es sólo una operación (o un precio) suelta:
 * se SUMA a la vela que ya hay con esa hora (máximo, mínimo, cierre y volumen),
 * en vez de sustituirla. Así los proveedores que dan operaciones (Alpaca) o precios
 * (Capital.com) no tienen que conocer la vela completa.
 */
export type LiveCandle = Candle & { merge?: boolean };

export interface DataProvider {
  readonly id: string;
  readonly label: string;
  /** Temporalidades que el proveedor da directamente. */
  readonly nativeTimeframes: TfId[];
  /** Máximo de velas por petición REST. */
  readonly maxBarsPerRequest: number;

  /** ¿Este proveedor da datos de este símbolo? (Los que no, se ven en gris en la watchlist.) */
  supportsSymbol(symbol: string): boolean;

  /** Busca símbolos que contengan el texto (vacío = los más habituales). */
  searchSymbols(query: string): Promise<SearchResult[]>;

  /** Comprueba que el símbolo existe y devuelve sus decimales. */
  getSymbolInfo(symbol: string): Promise<SymbolInfo>;

  /**
   * Velas históricas de una temporalidad nativa, ordenadas de antigua a reciente.
   * Si se pasa `end` (segundos), sólo velas con time < end.
   */
  fetchCandles(symbol: string, tf: TfId, opts: { limit: number; end?: number }): Promise<Candle[]>;

  /** Velas en tiempo real (la vela actual se actualiza muchas veces). */
  subscribeCandles(symbol: string, tf: TfId, cb: (c: LiveCandle) => void): Unsubscribe;

  /** Horario del mercado del símbolo (acciones, forex). Sin él: 24/7 en UTC, como cripto. */
  sessionFor?(symbol: string): MarketSession | null;

  /** Nombre de la fuente de un símbolo concreto (para la leyenda del gráfico). */
  sourceLabel?(symbol: string): string;

  /** Proveedor combinado: temporalidades nativas, velas por petición y reconexión de la fuente de UN símbolo. */
  nativeFor?(symbol: string): TfId[];
  maxBarsFor?(symbol: string): number;
  onSymbolReconnect?(symbol: string, cb: () => void): Unsubscribe;

  /** Estado del tiempo real de la fuente de un símbolo concreto. */
  onSymbolStatus?(symbol: string, cb: (s: ConnectionStatus, msg?: string) => void): Unsubscribe;

  /** Último precio y apertura del día, para la watchlist. */
  subscribeDayTicker(symbol: string, cb: (t: DayTicker) => void): Unsubscribe;

  /** Se llama tras una reconexión: conviene recargar las últimas velas por si se perdió algo. */
  onReconnect(cb: () => void): Unsubscribe;

  /** Estado de la conexión en tiempo real. */
  onStatus(cb: (s: ConnectionStatus) => void): Unsubscribe;
}

/** Decimales a partir de un tick tipo "0.01000000". */
export function precisionFromTick(tick: string | number): number {
  const s = typeof tick === 'number' ? tick.toFixed(12) : tick;
  const trimmed = s.replace(/0+$/, '');
  const dot = trimmed.indexOf('.');
  return dot < 0 ? 0 : trimmed.length - dot - 1;
}

/** Ordena y filtra resultados: primero los que empiezan por el texto, luego los que lo contienen. */
export function rankResults(all: SearchResult[], query: string, limit = 150): SearchResult[] {
  const q = query.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!q) return all.slice(0, limit);
  const starts: SearchResult[] = [];
  const contains: SearchResult[] = [];
  for (const r of all) {
    if (r.symbol.startsWith(q)) starts.push(r);
    else if (r.symbol.includes(q) || r.description.toUpperCase().replace(/[^A-Z0-9]/g, '').includes(q)) contains.push(r);
  }
  // Coincidencia exacta primero; el resto, en el orden de la fuente (pares en USDT antes).
  starts.sort((a, b) => (b.symbol === q ? 1 : 0) - (a.symbol === q ? 1 : 0));
  return [...starts, ...contains].slice(0, limit);
}
