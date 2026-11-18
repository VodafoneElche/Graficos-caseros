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

export interface DayTicker {
  symbol: string;
  last: number;
  /** Precio de apertura del día (UTC) = cierre del día anterior en cripto. */
  dayOpen: number;
}

export type ConnectionStatus = 'connecting' | 'open' | 'closed';

export interface DataProvider {
  readonly id: string;
  readonly label: string;
  /** Temporalidades que el proveedor da directamente. */
  readonly nativeTimeframes: TfId[];
  /** Máximo de velas por petición REST. */
  readonly maxBarsPerRequest: number;

  /** ¿Este proveedor da datos de este símbolo? (Los que no, se ven en gris en la watchlist.) */
  supportsSymbol(symbol: string): boolean;

  /** Comprueba que el símbolo existe y devuelve sus decimales. */
  getSymbolInfo(symbol: string): Promise<SymbolInfo>;

  /**
   * Velas históricas de una temporalidad nativa, ordenadas de antigua a reciente.
   * Si se pasa `end` (segundos), sólo velas con time < end.
   */
  fetchCandles(symbol: string, tf: TfId, opts: { limit: number; end?: number }): Promise<Candle[]>;

  /** Velas en tiempo real (la vela actual se actualiza muchas veces). */
  subscribeCandles(symbol: string, tf: TfId, cb: (c: Candle) => void): Unsubscribe;

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
