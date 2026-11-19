import type { DataProvider } from '../providers/provider';
import { aggregate, bucketStart, planTimeframe, TIMEFRAMES, upsertCandle } from './timeframes';
import type { Candle, TfId, Unsubscribe } from './types';

// Almacén de velas: una única copia por (símbolo, temporalidad), compartida por todos
// los gráficos e indicadores que la necesiten. Se encarga de:
//   - cargar el histórico (varias páginas si hace falta),
//   - construir temporalidades no nativas agregando velas menores (45s ← 1s, etc.),
//   - mantenerla al día en tiempo real,
//   - recargar tras una reconexión,
//   - cargar más historia al desplazarse hacia la izquierda.

export type StoreEvent = 'reset' | 'update' | 'prepend';
type Listener = (ev: StoreEvent, info?: { added?: number }) => void;

const TARGET_BARS = 1000;

export class SeriesStore {
  readonly candles: Candle[] = [];
  loaded = false;
  error: string | null = null;
  noMoreHistory = false;
  private readonly base: TfId;
  private readonly aggregated: boolean;
  private listeners = new Set<Listener>();
  private loadingMore: Promise<void> | null = null;
  private loadPromise: Promise<void> | null = null;
  private unsubLive: Unsubscribe | null = null;
  private unsubReconnect: Unsubscribe | null = null;
  private queued: Candle[] = [];
  /** Velas base del cubo actual (sólo para temporalidades agregadas). */
  private bucketBase = new Map<number, Candle>();
  private bucketStartTime = -1;
  private idleTimer: number | null = null;

  constructor(
    private provider: DataProvider,
    readonly symbol: string,
    readonly tf: TfId,
    private onDispose: () => void,
  ) {
    const plan = planTimeframe(provider.nativeTimeframes, tf);
    this.base = plan.base;
    this.aggregated = plan.aggregated;
  }

  /** Cuántas velas base forman una de la temporalidad pedida (aprox.). */
  private factor(): number {
    return Math.max(1, Math.round(TIMEFRAMES[this.tf].seconds / TIMEFRAMES[this.base].seconds));
  }

  private maxPages(): number {
    // 45s sale de velas de 1s: 1000 por página = 22 velas de 45s. Pedimos más páginas.
    if (this.base === '1s') return 15;
    return Math.min(4, Math.ceil((TARGET_BARS * this.factor()) / this.provider.maxBarsPerRequest));
  }

  subscribe(fn: Listener): Unsubscribe {
    this.listeners.add(fn);
    if (this.idleTimer != null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.start();
    return () => {
      this.listeners.delete(fn);
      if (!this.listeners.size) {
        // Esperamos un poco antes de cerrar: si se vuelve al símbolo, no hay que recargar.
        this.idleTimer = window.setTimeout(() => this.dispose(), 60000);
      }
    };
  }

  private emit(ev: StoreEvent, info?: { added?: number }) {
    this.listeners.forEach((l) => l(ev, info));
  }

  private start() {
    if (this.unsubLive) return;
    this.unsubLive = this.provider.subscribeCandles(this.symbol, this.base, (c) => {
      if (!this.loaded) this.queued.push(c);
      else this.applyLive(c);
    });
    this.unsubReconnect = this.provider.onReconnect(() => this.resync());
    this.load();
  }

  load(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = (async () => {
        try {
          const baseCandles = await this.fetchBasePages(undefined, this.maxPages());
          this.setFromBase(baseCandles, true);
          this.loaded = true;
          this.error = null;
          for (const c of this.queued) this.applyLive(c, true);
          this.queued = [];
          this.emit('reset');
        } catch (e) {
          this.error = e instanceof Error ? e.message : String(e);
          this.loadPromise = null;
          this.emit('reset');
          // Reintento automático.
          setTimeout(() => {
            if (this.listeners.size && !this.loaded) this.load();
          }, 5000);
        }
      })();
    }
    return this.loadPromise;
  }

  /** Pide hasta `pages` páginas de velas base hacia atrás desde `end`. */
  private async fetchBasePages(end: number | undefined, pages: number): Promise<Candle[]> {
    const chunks: Candle[][] = [];
    let cursor = end;
    for (let i = 0; i < pages; i++) {
      const page = await this.provider.fetchCandles(this.symbol, this.base, {
        limit: this.provider.maxBarsPerRequest,
        end: cursor,
      });
      if (!page.length) {
        this.noMoreHistory = true;
        break;
      }
      chunks.unshift(page);
      cursor = page[0].time;
      if (page.length < this.provider.maxBarsPerRequest) {
        this.noMoreHistory = true;
        break;
      }
    }
    return chunks.flat();
  }

  /** Convierte velas base en velas de la temporalidad del almacén. */
  private toTarget(base: Candle[], dropPartialFirst: boolean): Candle[] {
    if (!this.aggregated) return base;
    let bars = aggregate(base, this.tf);
    if (dropPartialFirst && bars.length && base.length && bars[0].time !== base[0].time && !this.noMoreHistory) {
      bars = bars.slice(1); // el primer cubo está incompleto
    }
    return bars;
  }

  private rememberLastBucket(base: Candle[]) {
    if (!this.aggregated || !base.length) return;
    const last = bucketStart(this.tf, base[base.length - 1].time);
    this.bucketStartTime = last;
    this.bucketBase.clear();
    for (let i = base.length - 1; i >= 0 && base[i].time >= last; i--) this.bucketBase.set(base[i].time, base[i]);
  }

  private setFromBase(base: Candle[], replace: boolean) {
    const bars = this.toTarget(base, true);
    if (replace) this.candles.length = 0;
    for (const b of bars) upsertCandle(this.candles, b);
    this.rememberLastBucket(base);
  }

  private applyLive(c: Candle, silent = false) {
    let bar = c;
    if (this.aggregated) {
      const b = bucketStart(this.tf, c.time);
      if (b !== this.bucketStartTime) {
        if (b < this.bucketStartTime) return; // dato viejo
        this.bucketStartTime = b;
        this.bucketBase.clear();
      }
      this.bucketBase.set(c.time, c);
      const parts = [...this.bucketBase.values()].sort((x, y) => x.time - y.time);
      bar = aggregate(parts, this.tf)[0];
    }
    const n = this.candles.length;
    if (n && bar.time < this.candles[n - 1].time) return; // nunca reescribimos el pasado con datos en vivo
    upsertCandle(this.candles, bar);
    if (!silent) this.emit('update');
  }

  /** Tras reconectar: recargar la parte final por si se perdieron velas. */
  private async resync() {
    if (!this.loaded) return;
    try {
      const pages = this.base === '1s' ? 3 : 1;
      const base = await this.fetchBasePages(undefined, pages);
      const bars = this.toTarget(base, true);
      for (const b of bars) upsertCandle(this.candles, b);
      this.rememberLastBucket(base);
      this.emit('reset');
    } catch (e) {
      console.warn('[store] resync falló', e);
    }
  }

  /** Cargar velas más antiguas (al desplazarse hacia la izquierda). */
  loadMore(): Promise<void> {
    if (!this.loaded || this.noMoreHistory || !this.candles.length) return Promise.resolve();
    if (!this.loadingMore) {
      this.loadingMore = (async () => {
        try {
          const firstTime = this.candles[0].time;
          const pages = this.base === '1s' ? 8 : Math.max(1, Math.min(3, this.maxPages()));
          const base = await this.fetchBasePages(firstTime, pages);
          let bars = this.toTarget(base, true).filter((b) => b.time < firstTime);
          if (bars.length) {
            this.candles.unshift(...bars);
            this.emit('prepend', { added: bars.length });
          }
        } catch (e) {
          console.warn('[store] loadMore falló', e);
        } finally {
          this.loadingMore = null;
        }
      })();
    }
    return this.loadingMore;
  }

  private dispose() {
    this.unsubLive?.();
    this.unsubReconnect?.();
    this.unsubLive = null;
    this.unsubReconnect = null;
    this.onDispose();
  }
}

/** Punto de acceso único a los datos. */
export class DataHub {
  private stores = new Map<string, SeriesStore>();
  constructor(readonly provider: DataProvider) {}

  get(symbol: string, tf: TfId): SeriesStore {
    const key = `${symbol}|${tf}`;
    let s = this.stores.get(key);
    if (!s) {
      s = new SeriesStore(this.provider, symbol, tf, () => this.stores.delete(key));
      this.stores.set(key, s);
    }
    return s;
  }
}
