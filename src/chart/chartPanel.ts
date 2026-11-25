import { alertsStore } from '../ui/alerts';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import type { DataHub, SeriesStore, StoreEvent } from '../core/store';
import type { DrawingsStore } from '../core/drawings';
import { bucketStart, candleIndexAtOrBefore, nextBucketStart, TIMEFRAMES, tfGroup, tfLabel } from '../core/timeframes';
import type { Candle, Drawing, FibExt, MaCfg, PanelCfg, Position, Shape, ShapeType, TfId } from '../core/types';
import {
  buildPivots,
  movingAverage,
  pivotTfFor,
  projectSeries,
  rsi,
  shift,
  sma,
  smoothing,
  sourceValues,
  type Values,
} from '../indicators/indicators';
import type { SymbolInfo } from '../providers/provider';
import { THEME } from '../ui/defaults';
import { tools } from '../ui/tools';
import { extendSegment, NOTE_STEM, rectCorners, segDist, textBox, type Pt } from './shapeGeom';
import type { CrosshairSync } from './crosshairSync';
import { formatPrice, formatVolumeEs, makeTimeFormatter, tickMarkFormatter } from './format';
import { PivotsPrimitive } from './pivotsPrimitive';
import { MeasurePrimitive, type Measure } from './measurePrimitive';
import { DrawingsPrimitive, fibExtPrice, fibLevelXs } from './drawingsPrimitive';
import { TwoYmaFill } from './twoYmaFill';
import { RsiFill } from './rsiFill';
import { openMaSettings, openPivotSettings, openRsiSettings, openTwoYmaSettings, openFibSettings, openPositionSettings, openShapeSettings } from '../ui/indicatorSettings';

// Un gráfico completo: velas, volumen, medias, medias de otra temporalidad, RSI,
// pivots, líneas horizontales y leyenda tipo TradingView (arriba a la izquierda).
// Los valores de los indicadores se ven también en el eje de la derecha.

export interface PanelDeps {
  hub: DataHub;
  drawings: DrawingsStore;
  sync: CrosshairSync;
  /** Se llama cuando el usuario cambia la configuración del gráfico (para guardarla). */
  onConfigChange: (cfg: PanelCfg) => void;
  /** Maximizar / volver a la cuadrícula. */
  onMaximize: () => void;
  onOpenSettings: (panel: ChartPanel) => void;
  /** El usuario ha hecho clic en este gráfico (pasa a ser el gráfico activo). */
  onActivate: (panel: ChartPanel) => void;
}

type LineApi = ISeriesApi<'Line'>;

const HIT_PX = 6;

/**
 * Valores → puntos de la línea. Con `smooth` (medias de OTRA temporalidad) sólo se pone un
 * punto donde cambia el valor, y la línea los une en diagonal: sale suave, como en
 * TradingView, en vez de en escalones.
 */
function toLine(candles: Candle[], values: Values, smooth = false): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  const n = candles.length;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    if (v == null || !Number.isFinite(v)) continue;
    if (smooth && i > 0 && i < n - 1 && values[i - 1] === v) continue;
    out.push({ time: candles[i].time as Time, value: v });
  }
  return out;
}

const EYE_ON = '<svg viewBox="0 0 18 18" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M1.5 9s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z"/><circle cx="9" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const GEAR = '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><circle cx="9" cy="9" r="2.4"/><path d="M9 1.8v2.1M9 14.1v2.1M1.8 9h2.1M14.1 9h2.1M3.9 3.9l1.5 1.5M12.6 12.6l1.5 1.5M3.9 14.1l1.5-1.5M12.6 5.4l1.5-1.5"/></svg>';
const TRASH = '<svg viewBox="0 0 18 18" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 5h12M7 5V3h4v2M5 5l.8 10h6.4L13 5"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 18 18" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M1.5 9s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z"/><path stroke="currentColor" stroke-width="1.3" d="M3 15L15 3"/></svg>';

function formatDuration(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return s ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export class ChartPanel {
  readonly el: HTMLDivElement;
  readonly chart: IChartApi;
  cfg: PanelCfg;
  private deps: PanelDeps;
  private chartEl: HTMLDivElement;
  private legendEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private candle: ISeriesApi<'Candlestick'>;
  private volume: ISeriesApi<'Histogram'> | null = null;
  private volumeMa: LineApi | null = null;
  private maSeries = new Map<string, LineApi>();
  private smoothSeries = new Map<string, LineApi[]>();
  private tyMa: LineApi | null = null;
  private tyX5: LineApi | null = null;
  private tyPlot: LineApi | null = null;
  private tyFill = new TwoYmaFill();
  private tyValues: { ma: Values; x5: Values } = { ma: [], x5: [] };
  private dailyStore: SeriesStore | null = null;
  private rsiSeries: LineApi | null = null;
  private rsiMaSeries: LineApi | null = null;
  private rsiBbSeries: LineApi[] = [];
  private rsiFill = new RsiFill();
  private rsiBbValues: Values[] = [];
  private pivots = new PivotsPrimitive();
  private measure = new MeasurePrimitive();
  private measuring: 'idle' | 'drawing' | 'done' = 'idle';
  private logBtn!: HTMLButtonElement;
  private autoBtn!: HTMLButtonElement;
  private scaleBtns: HTMLDivElement;
  /** Momento del último clic usado por una herramienta (para no confundirlo con un doble clic). */
  private lastToolClick = 0;
  private drawPrim: DrawingsPrimitive;
  /**
   * Dibujo a medio hacer (Fibonacci, línea de tendencia, rectángulo o trayectoria):
   * `step` = puntos ya fijados; `n` = puntos totales (Infinity en la trayectoria).
   */
  private fibDraft: { id: string; step: number; n: number; tool: string; down: { x: number; y: number } } | null = null;
  /** Dibujo bajo el ratón. */
  private hoverId: string | null = null;

  private symbol = '';
  private info: SymbolInfo = { symbol: '', description: '', precision: 2, minMove: 0.01 };
  private store: SeriesStore | null = null;
  private unsubs: (() => void)[] = [];
  private dataUnsubs: (() => void)[] = [];
  private extraUnsubs = new Map<string, () => void>();
  private mtfStores = new Map<TfId, SeriesStore>();
  private pivotStore: SeriesStore | null = null;

  private maValues = new Map<string, Values>();
  private smoothValues = new Map<string, Values[]>();
  private rsiValues: Values = [];
  private rsiMaValues: Values = [];
  private volMaValues: Values = [];

  private renderedCount = 0;
  private updateScheduled = false;
  private extrasTimer: number | null = null;
  private hovering = false;
  private legendIdx: number | null = null;
  private dragId: string | null = null;
  private dragKind: 'ns' | 'ew' | 'move' = 'ns';
  private suppressMouse = false;
  private disposed = false;

  constructor(parent: HTMLElement, cfg: PanelCfg, deps: PanelDeps) {
    this.cfg = structuredClone(cfg);
    this.deps = deps;

    this.el = document.createElement('div');
    this.el.className = 'panel';
    this.chartEl = document.createElement('div');
    this.chartEl.className = 'panel-chart';
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'legend';
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'panel-status';
    // Botonera abajo a la derecha, como en TradingView: lupa −/+, A (auto) y L (log).
    this.scaleBtns = document.createElement('div');
    this.scaleBtns.className = 'scale-btns';
    const mk = (txt: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.innerHTML = txt;
      b.title = title;
      b.onclick = (e) => {
        e.stopPropagation();
        fn();
      };
      b.onpointerdown = (e) => e.stopPropagation();
      this.scaleBtns.appendChild(b);
      return b;
    };
    const lupa = (sign: string) =>
      `<svg viewBox="0 0 18 18" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="7.5" cy="7.5" r="5"/><path d="M11.2 11.2 16 16"/><path d="M5 7.5h5${sign === '+' ? 'M7.5 5v5' : ''}"/></svg>`;
    mk(lupa('-'), 'Alejar (Alt+−)', () => this.zoom(1.25));
    mk(lupa('+'), 'Acercar (Alt++)', () => this.zoom(0.8));
    this.autoBtn = mk('A', 'Encuadre automático del precio (Alt+A)', () => this.autoFit());
    this.logBtn = mk('L', 'Escala logarítmica (Alt+L)', () => this.toggleLog());
    this.el.append(this.chartEl, this.legendEl, this.statusEl, this.scaleBtns);
    this.el.addEventListener('pointerup', () =>
      setTimeout(() => {
        this.refreshAuto();
        this.saveRsiHeight();
      }, 0),
    );
    this.el.addEventListener('dblclick', () => setTimeout(() => this.refreshAuto(), 0));
    parent.appendChild(this.el);

    this.chart = createChart(this.chartEl, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.scaleText,
        fontSize: 12,
        // Sin el logo en cada gráfico: la atribución a TradingView Lightweight Charts
        // (que pide su licencia) está en el botón "ⓘ" de la barra superior.
        attributionLogo: false,
        panes: { separatorColor: '#2a2e39', separatorHoverColor: 'rgba(120,140,190,0.25)', enableResize: true },
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: THEME.crosshair, style: LineStyle.Dashed, width: 1, labelBackgroundColor: THEME.crosshairLabel },
        horzLine: { color: THEME.crosshair, style: LineStyle.Dashed, width: 1, labelBackgroundColor: THEME.crosshairLabel },
      },
      // Márgenes como en TradingView: arriba 10 %, abajo 8 %, derecha 10 barras.
      rightPriceScale: { borderColor: THEME.scaleLine, scaleMargins: { top: 0.1, bottom: 0.08 }, minimumWidth: 78 },
      timeScale: { borderColor: THEME.scaleLine, rightOffset: 10, tickMarkFormatter: tickMarkFormatter as any },
      localization: { locale: 'es-ES' },
    });

    this.candle = this.chart.addSeries(CandlestickSeries, {
      upColor: THEME.upBody,
      downColor: THEME.downBody,
      borderUpColor: THEME.upBorder,
      borderDownColor: THEME.downBorder,
      wickUpColor: THEME.upBorder,
      wickDownColor: THEME.downBorder,
      priceLineColor: THEME.crosshair,
    });
    this.pivots.color = THEME.pivots;
    this.candle.attachPrimitive(this.pivots);
    this.candle.attachPrimitive(this.measure);
    this.drawPrim = new DrawingsPrimitive({
      items: () => (this.deps.drawings.symbol === this.symbol ? this.deps.drawings.items : []),
      selectedId: () => this.deps.drawings.selectedId,
      timeToX: (t) => this.timeToX(t),
      formatPrice: (p) => formatPrice(p, this.info.precision),
      formatTime: (t) => this.formatTime(t),
      hoveredId: () => this.hoverId,
      lastPrice: () => (this.candles.length ? this.candles[this.candles.length - 1].close : null),
      candles: () => this.candles,
      hasAlert: (id) => alertsStore.alertDrawings.has(id),
    });
    this.candle.attachPrimitive(this.drawPrim);
    this.candle.attachPrimitive(this.tyFill);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === 'Enter') {
        if (this.fibDraft?.n === Infinity) return this.finishPath();
        if (e.key === 'Enter') return;
        this.clearMeasure();
        this.cancelFibDraft();
      }
    };
    window.addEventListener('keydown', onKey);
    this.unsubs.push(() => window.removeEventListener('keydown', onKey));

    this.chart.subscribeCrosshairMove((p) => this.onCrosshair(p));
    this.chart.timeScale().subscribeVisibleLogicalRangeChange((r) => {
      if (r && r.from < 30 && this.store?.loaded) this.store.loadMore();
    });

    this.chartEl.addEventListener('pointerenter', () => (this.hovering = true));
    this.chartEl.addEventListener('pointerleave', () => {
      this.hovering = false;
      this.deps.sync.move(this, null, null);
      this.chartEl.style.cursor = '';
    });
    this.el.addEventListener('pointerdown', () => this.deps.onActivate(this), { capture: true });
    this.chartEl.addEventListener('dblclick', (e) => {
      // Doble clic en la zona de la escala de tiempo: maximizar / volver (como Alt+Enter en TradingView).
      // Doble clic en el gráfico: en grande / volver a los 6 (salvo sobre un Fibonacci, que abre sus ajustes).
      const { x, y } = this.local(e);
      if (Date.now() - this.lastToolClick < 700 || tools.active !== 'none') return;
      const hit = this.inMainPane(x, y) ? this.hitDrawing(x, y) : null;
      if (hit?.d.type === 'fibext' || hit?.d.type === 'fib') return this.openFib(hit.d.id);
      if (hit?.d.type === 'position') return this.openPosition(hit.d.id);
      if (hit && hit.d.type !== 'hline' && hit.d.type !== 'vline') return this.openFib(hit.d.id);
      if (hit) return;
      if (x > this.chart.timeScale().width()) return; // doble clic en la escala de precios: la reajusta
      this.deps.onMaximize();
    });
    this.legendEl.addEventListener('pointerdown', () => (this.legendPressed = true));
    const release = () => setTimeout(() => (this.legendPressed = false), 0);
    this.legendEl.addEventListener('pointerup', release);
    this.legendEl.addEventListener('pointerleave', release);
    this.legendEl.addEventListener('click', (e) => {
      this.legendPressed = false;
      this.onLegendClick(e);
    });
    this.legendEl.addEventListener('dblclick', (e) => {
      const row = (e.target as HTMLElement).closest('[data-key]') as HTMLElement | null;
      if (row?.dataset.key) {
        e.stopPropagation();
        this.openIndicator(row.dataset.key);
      }
    });
    this.installPointerHandlers();
    this.unsubs.push(this.deps.drawings.subscribe(() => this.drawPrim.update()));
    this.unsubs.push(tools.subscribe(() => this.updateCursor()));

    this.deps.sync.register(this);
    this.applyLog();
    this.applyTfOptions();
    this.buildIndicatorSeries();
  }

  toggleLog() {
    this.cfg.logScale = !this.cfg.logScale;
    this.applyLog();
    this.deps.onConfigChange(structuredClone(this.cfg));
  }

  /** Zoom horizontal manteniendo la última vela a la vista (factor > 1 aleja). */
  zoom(factor: number) {
    const ts = this.chart.timeScale();
    const r = ts.getVisibleLogicalRange();
    if (!r) return;
    const width = Math.max(10, Math.min(5000, (r.to - r.from) * factor));
    ts.setVisibleLogicalRange({ from: r.to - width, to: r.to });
  }

  /** Vuelve a encuadrar el precio automáticamente (botón A). */
  autoFit() {
    this.chart.priceScale('right').applyOptions({ autoScale: true });
    this.refreshAuto();
  }

  private refreshAuto() {
    this.autoBtn.classList.toggle('on', this.chart.priceScale('right').options().autoScale !== false);
  }

  /** Si se ha arrastrado la separación del panel del RSI, se guarda su alto. */
  private saveRsiHeight() {
    const rc = this.cfg.rsiCfg;
    const panes = this.chart.panes();
    if (!this.rsiSeries || !rc || panes.length < 2) return;
    const a = panes[0].getHeight();
    const b = panes[1].getHeight();
    if (!a || !b) return;
    const h = +(b / (a + b)).toFixed(3);
    if (Math.abs(h - rc.height) > 0.02) {
      rc.height = h;
      this.deps.onConfigChange(structuredClone(this.cfg));
    }
  }

  private applyLog() {
    this.chart.priceScale('right', 0).applyOptions({ mode: this.cfg.logScale ? PriceScaleMode.Logarithmic : PriceScaleMode.Normal });
    if (this.chart.panes().length > 1) this.chart.priceScale('right', 1).applyOptions({ mode: PriceScaleMode.Normal });
    this.logBtn.classList.toggle('on', !!this.cfg.logScale);
    this.refreshAuto();
  }

  setActive(active: boolean) {
    this.el.classList.toggle('active', active);
  }

  // ── Configuración ─────────────────────────────────────────────────────────

  /** Aplica una configuración nueva (desde el diálogo de ajustes). */
  setConfig(cfg: PanelCfg) {
    const tfChanged = cfg.tf !== this.cfg.tf;
    this.cfg = structuredClone(cfg);
    this.applyLog();
    if (tfChanged) this.applyTfOptions();
    this.configChanged(true, tfChanged);
  }

  private configChanged(rebuildSeries: boolean, reloadData = false) {
    this.deps.onConfigChange(structuredClone(this.cfg));
    if (reloadData) {
      this.buildIndicatorSeries();
      this.subscribeData();
      return;
    }
    if (rebuildSeries) this.buildIndicatorSeries();
    this.applyVisibility();
    this.subscribeExtras();
    this.fullRedraw();
  }

  setTimeframe(tf: TfId) {
    if (tf === this.cfg.tf) return;
    this.cfg.tf = tf;
    this.applyTfOptions();
    this.configChanged(false, true);
  }

  private applyTfOptions() {
    const s = TIMEFRAMES[this.cfg.tf].seconds;
    const intraday = s < 86400;
    this.chart.applyOptions({
      timeScale: { timeVisible: intraday, secondsVisible: s < 60 },
      localization: { timeFormatter: makeTimeFormatter(intraday, s < 60) },
    });
  }

  private priceFormat() {
    const prec = this.info.precision;
    return { type: 'custom' as const, minMove: this.info.minMove, formatter: (p: number) => formatPrice(p, prec) };
  }

  private lineOpts(color: string, width: number, step = false, style: 0 | 1 | 2 = 0, axisLabel = true) {
    return {
      color,
      lineWidth: Math.max(1, Math.round(width)) as 1 | 2 | 3 | 4,
      lineStyle: style === 1 ? LineStyle.Dotted : style === 2 ? LineStyle.Dashed : LineStyle.Solid,
      lineType: step ? LineType.WithSteps : LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: axisLabel, // valor en el eje derecho
      crosshairMarkerVisible: false,
      priceFormat: this.priceFormat(),
    };
  }

  /** ¿Se ve esta media en la temporalidad actual? (ojo + pestaña "Visibilidad") */
  private maShown(m: MaCfg): boolean {
    return m.visible && !(m.hiddenOn || []).includes(tfGroup(this.cfg.tf));
  }

  private buildIndicatorSeries() {
    for (const s of this.maSeries.values()) this.chart.removeSeries(s);
    for (const list of this.smoothSeries.values()) for (const s of list) this.chart.removeSeries(s);
    this.maSeries.clear();
    this.smoothSeries.clear();
    for (const s of [this.tyMa, this.tyX5, this.tyPlot]) if (s) this.chart.removeSeries(s);
    this.tyMa = this.tyX5 = this.tyPlot = null;
    if (this.volume) this.chart.removeSeries(this.volume);
    if (this.volumeMa) this.chart.removeSeries(this.volumeMa);
    this.volume = this.volumeMa = null;
    if (this.rsiSeries) this.chart.removeSeries(this.rsiSeries);
    if (this.rsiMaSeries) this.chart.removeSeries(this.rsiMaSeries);
    for (const x of this.rsiBbSeries) this.chart.removeSeries(x);
    this.rsiBbSeries = [];
    this.rsiSeries = this.rsiMaSeries = null;

    if (this.cfg.volume) {
      const volFmt = { type: 'custom' as const, minMove: 1, formatter: (v: number) => formatVolumeEs(v) };
      this.volume = this.chart.addSeries(HistogramSeries, {
        priceScaleId: 'vol',
        priceFormat: volFmt,
        lastValueVisible: false,
        priceLineVisible: false,
      });
      this.volume.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
      this.volumeMa = this.chart.addSeries(LineSeries, {
        priceScaleId: 'vol',
        color: THEME.volMa,
        lineWidth: 2,
        priceFormat: volFmt,
        lastValueVisible: false,
        priceLineVisible: false,
        crosshairMarkerVisible: false,
      });
    }
    const ty = this.cfg.twoYma;
    if (ty?.on) {
      if (ty.showPlot) this.tyPlot = this.chart.addSeries(LineSeries, { ...this.lineOpts(ty.plotColor, 1, false, 0, false) });
      this.tyMa = this.chart.addSeries(LineSeries, this.lineOpts(ty.maColor, 2));
      // La media x 5 suele quedar muy lejos del precio: no cuenta para el encuadre automático.
      this.tyX5 = this.chart.addSeries(LineSeries, { ...this.lineOpts(ty.x5Color, 2), autoscaleInfoProvider: () => null });
    }
    this.tyFill.setStyle(ty?.on && ty.showFill ? ty : null);
    for (const m of this.cfg.mas) {
      this.maSeries.set(m.id, this.chart.addSeries(LineSeries, this.lineOpts(m.color, m.width, false, m.lineStyle ?? 0, m.axisLabel !== false)));
      if (m.smoothing && m.smoothing !== 'none') {
        const col = m.smoothingColor || '#ffeb3b';
        const list = [this.chart.addSeries(LineSeries, this.lineOpts(col, 1))];
        if (m.smoothing === 'SMA+BB') {
          list.push(this.chart.addSeries(LineSeries, this.lineOpts('#089981', 1)));
          list.push(this.chart.addSeries(LineSeries, this.lineOpts('#089981', 1)));
        }
        this.smoothSeries.set(m.id, list);
      }
    }

    const rc = this.cfg.rsiCfg;
    if (this.cfg.rsi && rc && this.rsiShown()) {
      const base = {
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'custom' as const, minMove: 0.01, formatter: (v: number) => formatPrice(v, 2) },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      };
      this.rsiSeries = this.chart.addSeries(
        LineSeries,
        { ...base, color: rc.color, lineWidth: Math.max(1, Math.round(rc.width)) as 1, lineType: LineType.Simple, lastValueVisible: rc.axisLabel },
        1,
      );
      if (rc.showMa && rc.smoothing !== 'none') {
        this.rsiMaSeries = this.chart.addSeries(LineSeries, { ...base, color: rc.maColor, lineWidth: 1, lastValueVisible: rc.axisLabel }, 1);
        if (rc.smoothing === 'SMA+BB') {
          for (let k = 0; k < 2; k++) this.rsiBbSeries.push(this.chart.addSeries(LineSeries, { ...base, color: '#089981', lineWidth: 1, lastValueVisible: false }, 1));
        }
      }
      for (const band of [rc.upper, rc.middle, rc.lower]) {
        if (!band.on) continue;
        this.rsiSeries.createPriceLine({ price: band.value, color: band.color, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' });
      }
      this.rsiSeries.attachPrimitive(this.rsiFill);
      // El panel del RSI siempre en escala normal 0-100 (aunque el precio esté en logarítmica).
      this.chart.priceScale('right', 1).applyOptions({ mode: PriceScaleMode.Normal, autoScale: true, scaleMargins: { top: 0.08, bottom: 0.08 } });
      const h = Math.max(0.1, Math.min(0.7, rc.height || 0.3));
      const panes = this.chart.panes();
      panes[0]?.setStretchFactor(1 - h);
      panes[1]?.setStretchFactor(h);
    }
    this.applyVisibility();
  }

  private applyVisibility() {
    for (const m of this.cfg.mas) {
      const v = this.maShown(m);
      this.maSeries.get(m.id)?.applyOptions({ visible: v });
      for (const s of this.smoothSeries.get(m.id) || []) s.applyOptions({ visible: v });
    }
    this.pivots.cfg = this.cfg.pivotCfg ?? null;
    this.pivots.setVisible(this.cfg.pivots);
  }

  // ── Datos ─────────────────────────────────────────────────────────────────

  setSymbol(symbol: string, info: SymbolInfo) {
    this.symbol = symbol;
    this.info = info;
    const pf = this.priceFormat();
    this.candle.applyOptions({ priceFormat: pf });
    for (const s of this.maSeries.values()) s.applyOptions({ priceFormat: pf });
    for (const list of this.smoothSeries.values()) for (const s of list) s.applyOptions({ priceFormat: pf });
    for (const s of [this.tyMa, this.tyX5, this.tyPlot]) s?.applyOptions({ priceFormat: pf });
    this.pivots.formatPrice = (p) => formatPrice(p, info.precision);
    this.cancelFibDraft();
    this.subscribeData();
    this.drawPrim.update();
  }

  private subscribeData() {
    this.unsubData();
    if (!this.symbol) return;
    this.renderedCount = 0;
    this.candle.setData([]);
    this.volume?.setData([]);
    this.volumeMa?.setData([]);
    for (const s of this.maSeries.values()) s.setData([]);
    for (const list of this.smoothSeries.values()) for (const s of list) s.setData([]);
    for (const s of [this.tyMa, this.tyX5, this.tyPlot]) s?.setData([]);
    this.tyFill.setData([], [], []);
    this.rsiSeries?.setData([]);
    this.rsiMaSeries?.setData([]);
    this.pivots.setData([]);
    this.updateLegend();
    this.setStatus('Cargando…');
    const store = this.deps.hub.get(this.symbol, this.cfg.tf);
    this.store = store;
    this.dataUnsubs.push(store.subscribe((ev, info) => this.onStoreEvent(ev, info?.added)));
    if (store.loaded) this.onStoreEvent('reset');
    this.subscribeExtras();
  }

  private unsubData() {
    this.dataUnsubs.forEach((u) => u());
    this.dataUnsubs = [];
    this.extraUnsubs.forEach((u) => u());
    this.extraUnsubs.clear();
    this.mtfStores.clear();
    this.pivotStore = null;
    this.dailyStore = null;
    this.store = null;
  }

  /** Horario del mercado del símbolo (acciones, forex) o null para cripto. */
  private sess() {
    return this.deps.hub.provider.sessionFor?.(this.symbol) ?? null;
  }

  private pivotTf(): TfId {
    const t = this.cfg.pivotCfg?.tf ?? 'Auto';
    return t === 'Auto' ? pivotTfFor(this.cfg.tf) : t;
  }

  /** Suscribe los datos de otras temporalidades que hacen falta (medias MTF, pivots y 2YMA). */
  private subscribeExtras() {
    if (!this.symbol) return;
    const wanted = new Map<string, TfId>();
    for (const m of this.cfg.mas) if (m.tf && m.tf !== this.cfg.tf && this.maShown(m)) wanted.set(`mtf:${m.tf}`, m.tf);
    const rtf = this.cfg.rsiCfg?.tf;
    if (this.cfg.rsi && rtf && rtf !== this.cfg.tf) wanted.set(`mtf:${rtf}`, rtf);
    if (this.cfg.pivots) wanted.set(`piv:${this.pivotTf()}`, this.pivotTf());
    if (this.cfg.twoYma?.on) wanted.set('2y:1D', '1D');
    for (const [key, un] of this.extraUnsubs) {
      if (!wanted.has(key)) {
        un();
        this.extraUnsubs.delete(key);
      }
    }
    this.mtfStores.clear();
    this.pivotStore = null;
    this.dailyStore = null;
    for (const [key, tf] of wanted) {
      const st = this.deps.hub.get(this.symbol, tf);
      if (key.startsWith('mtf:')) this.mtfStores.set(tf, st);
      else if (key.startsWith('piv:')) this.pivotStore = st;
      else this.dailyStore = st;
      if (!this.extraUnsubs.has(key)) this.extraUnsubs.set(key, st.subscribe(() => this.scheduleExtras()));
    }
  }

  private setStatus(text: string) {
    this.statusEl.textContent = text;
    this.statusEl.style.display = text ? '' : 'none';
  }

  private onStoreEvent(ev: StoreEvent, added?: number) {
    if (this.disposed || !this.store) return;
    if (this.store.error && !this.store.loaded) {
      this.setStatus(`Error al cargar datos: ${this.store.error}. Reintentando…`);
      return;
    }
    if (!this.store.loaded) return;
    this.setStatus('');
    if (ev === 'reset') this.fullRedraw();
    else if (ev === 'prepend') {
      const r = this.chart.timeScale().getVisibleLogicalRange();
      this.fullRedraw();
      if (r && added) this.chart.timeScale().setVisibleLogicalRange({ from: r.from + added, to: r.to + added });
    } else this.scheduleUpdate();
  }

  private get candles(): Candle[] {
    return this.store?.candles ?? [];
  }

  /** Valores de una media (con su fuente, compensación y suavizado) sobre unas velas. */
  private maOn(m: MaCfg, cs: Candle[]): { main: Values; smooth: Values[] } {
    const src = sourceValues(cs, m.source);
    const main = movingAverage(m.type, src, m.period);
    const smooth: Values[] = [];
    if (m.smoothing && m.smoothing !== 'none') {
      const r = smoothing(m.smoothing, main, m.smoothingLength || 14, cs.map((c) => c.volume), m.bbMult ?? 2);
      if (r) {
        smooth.push(r.line);
        if (r.upper && r.lower) smooth.push(r.upper, r.lower);
      }
    }
    return { main, smooth };
  }

  private computeOwnIndicators() {
    const cs = this.candles;
    const closes = cs.map((c) => c.close);
    for (const m of this.cfg.mas) {
      if (m.tf && m.tf !== this.cfg.tf) continue;
      const r = this.maOn(m, cs);
      const off = m.offset || 0;
      this.maValues.set(m.id, shift(r.main, off));
      this.smoothValues.set(
        m.id,
        r.smooth.map((v) => shift(v, off)),
      );
    }
    const rc = this.cfg.rsiCfg;
    if (this.cfg.rsi && rc && (!rc.tf || rc.tf === this.cfg.tf)) {
      const r = this.rsiOn(cs);
      this.rsiValues = r.rsi;
      this.rsiMaValues = r.ma;
      this.rsiBbValues = r.bb;
    }
    if (this.cfg.volume) this.volMaValues = sma(cs.map((c) => c.volume), 20);
  }

  /** RSI (con su media "RSI-based MA" y bandas de Bollinger) sobre unas velas. */
  private rsiOn(cs: Candle[]): { rsi: Values; ma: Values; bb: Values[] } {
    const rc = this.cfg.rsiCfg!;
    const r = rsi(sourceValues(cs, rc.source), rc.length);
    const sm = rc.smoothing !== 'none' ? smoothing(rc.smoothing, r, rc.smoothingLength, cs.map((c) => c.volume), rc.bbMult) : null;
    return { rsi: r, ma: sm?.line ?? [], bb: sm?.upper && sm.lower ? [sm.upper, sm.lower] : [] };
  }

  private rsiShown(): boolean {
    return !(this.cfg.rsiCfg?.hiddenOn || []).includes(tfGroup(this.cfg.tf));
  }

  private computeMtf() {
    const cs = this.candles;
    const rc = this.cfg.rsiCfg;
    if (this.cfg.rsi && rc?.tf && rc.tf !== this.cfg.tf) {
      const st = this.mtfStores.get(rc.tf);
      if (st?.loaded) {
        const r = this.rsiOn(st.candles);
        const proj = (v: Values) => projectSeries(cs, this.cfg.tf, st.candles, rc.tf!, v, rc.waitClose, this.sess());
        this.rsiValues = proj(r.rsi);
        this.rsiMaValues = proj(r.ma);
        this.rsiBbValues = r.bb.map(proj);
      }
    }
    for (const m of this.cfg.mas) {
      if (!m.tf || m.tf === this.cfg.tf) continue;
      const st = this.mtfStores.get(m.tf);
      if (!st || !st.loaded) {
        this.maValues.delete(m.id);
        continue;
      }
      const r = this.maOn(m, st.candles);
      const off = m.offset || 0;
      const proj = (v: Values) => shift(projectSeries(cs, this.cfg.tf, st.candles, m.tf!, v, m.waitClose !== false, this.sess()), 0);
      this.maValues.set(m.id, proj(shift(r.main, off)));
      this.smoothValues.set(
        m.id,
        r.smooth.map((v) => proj(shift(v, off))),
      );
    }
    // 2YMA: media simple de 730 días (sobre velas diarias) y esa media x 5.
    const ty = this.cfg.twoYma;
    if (ty?.on && this.dailyStore?.loaded) {
      const ds = this.dailyStore;
      if (ds.candles.length < 740 && !ds.noMoreHistory) ds.loadMore();
      const ma = sma(
        ds.candles.map((c) => c.close),
        730,
      );
      const proj = projectSeries(cs, this.cfg.tf, ds.candles, '1D', ma, false, this.sess());
      this.tyValues = { ma: proj, x5: proj.map((v) => (v == null ? null : v * 5)) };
    } else this.tyValues = { ma: [], x5: [] };
  }

  private volColor(c: Candle) {
    return c.close >= c.open ? THEME.volUp : THEME.volDown;
  }

  private setMaData() {
    const cs = this.candles;
    for (const m of this.cfg.mas) {
      const other = !!m.tf && m.tf !== this.cfg.tf;
      this.maSeries.get(m.id)?.setData(toLine(cs, this.maValues.get(m.id) ?? [], other));
      const sv = this.smoothValues.get(m.id) || [];
      (this.smoothSeries.get(m.id) || []).forEach((s, k) => s.setData(toLine(cs, sv[k] ?? [], other)));
    }
  }

  private fullRedraw() {
    const cs = this.candles;
    if (!this.store?.loaded) return;
    this.candle.setData(cs.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    this.volume?.setData(cs.map((c) => ({ time: c.time as Time, value: c.volume, color: this.volColor(c) })));
    this.computeOwnIndicators();
    this.volumeMa?.setData(toLine(cs, this.volMaValues));
    this.setMaData();
    this.setRsiData();
    this.renderedCount = cs.length;
    this.redrawExtras();
    this.updateLegend();
  }

  private setRsiData() {
    if (!this.rsiSeries) return;
    const cs = this.candles;
    const other = !!this.cfg.rsiCfg?.tf && this.cfg.rsiCfg.tf !== this.cfg.tf;
    this.rsiSeries.setData(toLine(cs, this.rsiValues, other));
    this.rsiMaSeries?.setData(toLine(cs, this.rsiMaValues, other));
    this.rsiBbSeries.forEach((x, k) => x.setData(toLine(cs, this.rsiBbValues[k] ?? [], other)));
    this.rsiFill.set(this.cfg.rsiCfg!, this.rsiValues);
  }

  private scheduleUpdate() {
    if (this.updateScheduled) return;
    this.updateScheduled = true;
    requestAnimationFrame(() => {
      this.updateScheduled = false;
      if (!this.disposed) this.flushUpdate();
    });
  }

  /** Actualización en vivo: sólo se tocan las últimas velas. */
  private flushUpdate() {
    const cs = this.candles;
    const n = cs.length;
    if (!n) return;
    if (n - this.renderedCount > 1 || n < this.renderedCount) return this.fullRedraw();
    const appended = n === this.renderedCount + 1;
    this.computeOwnIndicators();
    const idxs = appended && n >= 2 ? [n - 2, n - 1] : [n - 1];
    const upd = (s: LineApi | null | undefined, v: number | null | undefined, t: Time) => {
      if (s && v != null && Number.isFinite(v)) s.update({ time: t, value: v });
    };
    for (const i of idxs) {
      const c = cs[i];
      const t = c.time as Time;
      this.candle.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
      this.volume?.update({ time: t, value: c.volume, color: this.volColor(c) });
      upd(this.volumeMa, this.volMaValues[i], t);
      for (const m of this.cfg.mas) {
        if (m.tf && m.tf !== this.cfg.tf) continue;
        upd(this.maSeries.get(m.id), this.maValues.get(m.id)?.[i], t);
        const sv = this.smoothValues.get(m.id) || [];
        (this.smoothSeries.get(m.id) || []).forEach((s, k) => upd(s, sv[k]?.[i], t));
      }
      upd(this.tyPlot, c.close, t);
      if (!this.cfg.rsiCfg?.tf || this.cfg.rsiCfg.tf === this.cfg.tf) {
        upd(this.rsiSeries, this.rsiValues[i], t);
        upd(this.rsiMaSeries, this.rsiMaValues[i], t);
        this.rsiBbSeries.forEach((x, k) => upd(x, this.rsiBbValues[k]?.[i], t));
      }
    }
    this.renderedCount = n;
    if (appended) this.redrawExtras();
    else this.scheduleExtras();
    if (!this.hovering) this.updateLegend();
  }

  /** Medias MTF, pivots y 2YMA: se recalculan como mucho una vez por segundo. */
  private scheduleExtras() {
    if (this.extrasTimer != null) return;
    this.extrasTimer = window.setTimeout(() => {
      this.extrasTimer = null;
      if (!this.disposed) this.redrawExtras();
    }, 1000);
  }

  private redrawExtras() {
    const cs = this.candles;
    if (!this.store?.loaded) return;
    this.computeMtf();
    for (const m of this.cfg.mas) {
      if (!m.tf || m.tf === this.cfg.tf) continue;
      const other = !!m.tf && m.tf !== this.cfg.tf;
      this.maSeries.get(m.id)?.setData(toLine(cs, this.maValues.get(m.id) ?? [], other));
      const sv = this.smoothValues.get(m.id) || [];
      (this.smoothSeries.get(m.id) || []).forEach((s, k) => s.setData(toLine(cs, sv[k] ?? [], other)));
    }
    if (this.cfg.rsiCfg?.tf && this.cfg.rsiCfg.tf !== this.cfg.tf) this.setRsiData();
    else if (this.rsiSeries) this.rsiFill.set(this.cfg.rsiCfg!, this.rsiValues);
    if (this.cfg.twoYma?.on) {
      const other = this.cfg.tf !== '1D';
      this.tyMa?.setData(toLine(cs, this.tyValues.ma, other));
      this.tyX5?.setData(toLine(cs, this.tyValues.x5, other));
      this.tyPlot?.setData(cs.map((c) => ({ time: c.time as Time, value: c.close })));
      this.tyFill.setData(
        cs.map((c) => c.close),
        this.tyValues.ma,
        this.tyValues.x5,
      );
    }
    const pc = this.cfg.pivotCfg;
    if (this.cfg.pivots && this.pivotStore?.loaded) {
      const sess = this.sess();
      const ptf = this.pivotStore.tf;
      this.pivots.setData(buildPivots(cs, this.pivotStore.candles, pc?.count ?? 15, pc?.type ?? 'Traditional', sess ? (t) => bucketStart(ptf, t, sess) : undefined));
    }
    else this.pivots.setData([]);
    if (!this.hovering) this.updateLegend();
  }

  // ── Leyenda (estilo TradingView) ──────────────────────────────────────────

  private fmt(v: number | null | undefined): string {
    return v == null ? '∅' : formatPrice(v, this.info.precision);
  }

  private legendPressed = false;

  private updateLegend(idx?: number | null) {
    if (idx !== undefined) this.legendIdx = idx;
    // No rehacer la leyenda mientras se pulsa un botón suyo (se perdería el clic).
    if (this.legendPressed) return;
    const cs = this.candles;
    const c = cs.length ? cs[this.legendIdx == null || this.legendIdx < 0 || this.legendIdx >= cs.length ? cs.length - 1 : this.legendIdx] : null;
    const i = c ? cs.indexOf(c) : -1;
    const cfg = this.cfg;
    const tfName = tfLabel(cfg.tf);
    const prov = this.deps.hub.provider;
    const src = (prov.sourceLabel?.(this.symbol) ?? prov.label).toUpperCase();
    let html = `<div class="lg-row lg-main"><span class="lg-title" data-act="settings" title="Configurar indicadores">${esc(this.symbol)} · ${tfName} · ${esc(src)}</span>`;
    if (c) {
      const prev = i > 0 ? cs[i - 1].close : c.open;
      const ch = c.close - prev;
      const pct = prev ? (ch / prev) * 100 : 0;
      const col = c.close >= c.open ? THEME.up : THEME.down;
      const v = (x: number) => `<b style="color:${col}">${this.fmt(x)}</b>`;
      const sign = ch >= 0 ? '+' : '';
      html += `<span class="lg-ohlc">O${v(c.open)} H${v(c.high)} L${v(c.low)} C${v(c.close)} <b style="color:${col}">${sign}${this.fmt(ch)} (${sign}${formatPrice(pct, 2)}%)</b> <span>Vol.<b style="color:${col}">${formatVolumeEs(c.volume)}</b></span></span>`;
    }
    html += `<span class="lg-tools"><button data-act="settings" title="Configurar indicadores">⚙</button><button data-act="max" title="Ver en grande / volver a los 6 (o doble clic en el gráfico)">⤢</button></span></div>`;

    type Item = { key: string; name: string; value: string; color: string; visible: boolean; removable: boolean };
    const items: Item[] = [];
    if (cfg.volume) items.push({ key: 'vol', name: 'Vol · 20', value: c ? `${formatVolumeEs(c.volume)} ${this.volMaValues[i] != null ? formatVolumeEs(this.volMaValues[i]!) : ''}` : '', color: THEME.scaleText, visible: true, removable: true });
    for (const m of cfg.mas) {
      const tfTxt = m.tf && m.tf !== cfg.tf ? ` · ${tfLabel(m.tf)}` : '';
      const srcTxt = m.source || 'close';
      let val = m.statusValue === false ? '' : this.fmt(this.maValues.get(m.id)?.[i]);
      const sv = this.smoothValues.get(m.id) || [];
      if (val && sv.length) val += sv.map((v) => ` <span style="color:${m.smoothingColor || '#ffeb3b'}">${this.fmt(v?.[i])}</span>`).join('');
      items.push({ key: `ma:${m.id}`, name: `${m.type}${tfTxt} ${m.period} ${srcTxt}`, value: val, color: m.color, visible: this.maShown(m), removable: true });
    }
    if (cfg.twoYma?.on) {
      const ty = cfg.twoYma;
      const v1 = this.tyValues.ma[i];
      const v5 = this.tyValues.x5[i];
      items.push({
        key: '2y',
        name: '2YMA',
        value: `${this.fmt(v1)} <span style="color:${ty.x5Color}">${this.fmt(v5)}</span>${c && ty.showPlot ? ` <span style="color:${ty.plotColor}">${this.fmt(c.close)}</span>` : ''}`,
        color: ty.maColor,
        visible: true,
        removable: true,
      });
    }
    const pc = cfg.pivotCfg;
    items.push({ key: 'piv', name: `Pivots ${pc?.type ?? 'Traditional'} ${pc?.tf === 'Auto' || !pc ? 'Auto' : tfLabel(pc.tf as TfId)}`, value: '', color: THEME.pivots, visible: cfg.pivots, removable: false });
    if (cfg.rsi && cfg.rsiCfg) {
      const rc = cfg.rsiCfg;
      const r = this.rsiValues[i];
      const rm = rc.showMa ? this.rsiMaValues[i] : null;
      const tfTxt = rc.tf && rc.tf !== cfg.tf ? ` · ${tfLabel(rc.tf)}` : '';
      const val = rc.statusValue ? `${r == null ? '∅' : formatPrice(r, 2)}${rm == null ? '' : ` <span style="color:${rc.maColor}">${formatPrice(rm, 2)}</span>`}` : '';
      items.push({ key: 'rsi', name: `RSI${tfTxt} ${rc.length} ${rc.source}`, value: val, color: rc.color, visible: this.rsiShown(), removable: true });
    }

    if (cfg.legendOpen) {
      for (const it of items) {
        const gear = it.key === 'vol' ? '' : `<button class="lg-btn" data-act="cfg" data-key="${it.key}" title="Configuración">${GEAR}</button>`;
        const del = it.removable ? `<button class="lg-btn" data-act="del" data-key="${it.key}" title="Quitar del gráfico">${TRASH}</button>` : '';
        html += `<div class="lg-row lg-ind${it.visible ? '' : ' off'}" data-key="${it.key}"><span class="lg-name" title="Doble clic para configurar">${esc(it.name)}</span>
          <span class="lg-acts"><button class="lg-eye" data-act="eye" data-key="${it.key}" title="${it.visible ? 'Ocultar' : 'Mostrar'}">${it.visible ? EYE_ON : EYE_OFF}</button>${gear}${del}</span>
          ${it.visible && it.value ? `<span class="lg-val" style="color:${it.color}">${it.value}</span>` : ''}</div>`;
      }
      html += `<div class="lg-row"><button class="lg-collapse" data-act="collapse" title="Ocultar la lista de indicadores">⌃</button></div>`;
    } else {
      html += `<div class="lg-row"><button class="lg-collapse" data-act="expand" title="Mostrar la lista de indicadores">⌄ ${items.length}</button></div>`;
    }
    this.legendEl.innerHTML = html;
  }

  /** Ventana de ajustes de un Fibonacci (extensión o retroceso) o de una posición. */
  openFib(id: string) {
    const f = this.deps.drawings.items.find((x) => x.id === id);
    if (f?.type === 'position') return this.openPosition(id);
    if (f && f.type !== 'fibext' && f.type !== 'fib' && f.type !== 'hline' && f.type !== 'vline') return this.openShape(id);
    if (f?.type !== 'fibext' && f?.type !== 'fib') return;
    openFibSettings(f, (patch) => this.deps.drawings.update(id, patch, 0));
  }

  /** Ajustes de una forma (tendencia, rectángulo, trayectoria o nota). `isNew`: si se cancela, se borra. */
  openShape(id: string, isNew = false) {
    const sh = this.deps.drawings.items.find((x) => x.id === id) as Shape | undefined;
    if (!sh || !['trend', 'rect', 'path', 'note', 'comment'].includes(sh.type)) return;
    openShapeSettings(
      sh,
      (patch: Partial<Shape>) => this.deps.drawings.update(id, patch, 0),
      isNew ? () => this.deps.drawings.remove(id) : undefined,
    );
  }

  openPosition(id: string) {
    const p = this.deps.drawings.items.find((x) => x.id === id);
    if (p?.type !== 'position') return;
    openPositionSettings(p, (patch) => this.deps.drawings.update(id, patch, 0));
  }

  /** Abre la ventana de configuración de un indicador (como el ⚙ de TradingView). */
  openIndicator(key: string) {
    const cfg = this.cfg;
    if (key === 'piv') {
      return openPivotSettings(cfg.pivotCfg!, (pc) => {
        cfg.pivotCfg = pc;
        cfg.pivots = true;
        this.configChanged(false);
      });
    }
    if (key === 'rsi') {
      return openRsiSettings(cfg.rsiCfg!, (rc) => {
        cfg.rsiCfg = rc;
        cfg.rsi = true;
        this.configChanged(true);
      });
    }
    if (key === '2y') {
      return openTwoYmaSettings(cfg.twoYma!, (t) => {
        cfg.twoYma = t;
        this.configChanged(true);
      });
    }
    if (key.startsWith('ma:')) {
      const m = cfg.mas.find((x) => x.id === key.slice(3));
      if (!m) return;
      openMaSettings(m, cfg.tf, (nm) => {
        const idx = cfg.mas.findIndex((x) => x.id === nm.id);
        if (idx >= 0) cfg.mas[idx] = nm;
        this.configChanged(true);
      });
    }
  }

  private onLegendClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    const cfg = this.cfg;
    const key = btn.dataset.key || '';
    if (act === 'settings') return this.deps.onOpenSettings(this);
    if (act === 'max') return this.deps.onMaximize();
    if (act === 'cfg') return this.openIndicator(key);
    if (act === 'collapse' || act === 'expand') {
      cfg.legendOpen = act === 'expand';
      this.deps.onConfigChange(structuredClone(cfg));
      return this.updateLegend();
    }
    if (act === 'del') {
      if (key === 'vol') cfg.volume = false;
      else if (key === 'rsi') cfg.rsi = false;
      else if (key === '2y') cfg.twoYma!.on = false;
      else if (key.startsWith('ma:')) cfg.mas = cfg.mas.filter((m) => m.id !== key.slice(3));
      return this.configChanged(true);
    }
    if (act === 'eye') {
      if (key === 'piv') {
        cfg.pivots = !cfg.pivots;
        return this.configChanged(false);
      }
      if (key === 'vol') {
        cfg.volume = false;
        return this.configChanged(true);
      }
      if (key === 'rsi') {
        const rc = cfg.rsiCfg!;
        if (!this.rsiShown()) rc.hiddenOn = [];
        else cfg.rsi = false;
        return this.configChanged(true);
      }
      if (key === '2y') {
        cfg.twoYma!.on = false;
        return this.configChanged(true);
      }
      const m = cfg.mas.find((x) => x.id === key.slice(3));
      if (m) {
        if (m.visible && !this.maShown(m)) m.hiddenOn = [];
        else m.visible = !m.visible;
        this.configChanged(false);
      }
    }
  }

  private onCrosshair(p: MouseEventParams<Time>) {
    if (!this.hovering) return; // movimientos provocados por la sincronización
    const t = p.time as number | undefined;
    if (t == null || !p.point) {
      this.updateLegend(null);
      this.deps.sync.move(this, null, null);
      return;
    }
    const idx = candleIndexAtOrBefore(this.candles, t);
    this.updateLegend(idx);
    const paneIndex = (p as any).paneIndex ?? 0;
    const price = paneIndex === 0 ? this.candle.coordinateToPrice(p.point.y) : null;
    this.deps.sync.move(this, t, price);
  }

  showCrosshair(time: number, price: number | null) {
    const cs = this.candles;
    const i = candleIndexAtOrBefore(cs, time);
    if (i < 0) return this.clearCrosshair();
    const pr = price ?? cs[i].close;
    this.chart.setCrosshairPosition(pr, cs[i].time as Time, this.candle);
    this.updateLegend(i);
  }

  clearCrosshair() {
    this.chart.clearCrosshairPosition();
    this.updateLegend(null);
  }

  // ── Dibujos: líneas horizontales y verticales, extensión de Fibonacci ─────

  private tfSecs(): number {
    return TIMEFRAMES[this.cfg.tf].seconds;
  }

  private drawingItems(): Drawing[] {
    const d = this.deps.drawings;
    return d.symbol === this.symbol ? d.items : [];
  }

  /** X (px) de un instante cualquiera, interpolando dentro de la vela que lo contiene. */
  timeToX(t: number): number | null {
    const cs = this.candles;
    const n = cs.length;
    if (!n) return null;
    const ts = this.chart.timeScale();
    const spacing = ts.options().barSpacing;
    const i = candleIndexAtOrBefore(cs, t);
    let logical: number;
    if (i < 0) logical = (t - cs[0].time) / this.tfSecs();
    else {
      const start = cs[i].time;
      const end = i + 1 < n ? cs[i + 1].time : nextBucketStart(this.cfg.tf, start, this.sess());
      if (i === n - 1 && t >= end) logical = n - 1 + (t - start) / this.tfSecs();
      else logical = i + Math.min(0.999, (t - start) / Math.max(1, end - start));
    }
    const base = Math.floor(logical);
    const x0 = ts.logicalToCoordinate(base as any);
    if (x0 == null) return null;
    return x0 + (logical - base) * spacing;
  }

  /** Instante (inicio de la vela) bajo la X dada; más allá de la última vela, se extrapola. */
  private xToTime(x: number): number | null {
    const cs = this.candles;
    const n = cs.length;
    if (!n) return null;
    const l = this.chart.timeScale().coordinateToLogical(x);
    if (l == null) return null;
    const i = Math.round(l);
    if (i < 0) return cs[0].time + i * this.tfSecs();
    if (i >= n) return bucketStart(this.cfg.tf, cs[n - 1].time + (i - n + 1) * this.tfSecs());
    return cs[i].time;
  }

  formatTime(t: number): string {
    return makeTimeFormatter(this.tfSecs() < 86400, this.tfSecs() < 60)(t as Time);
  }

  private pointAtTime(e: { clientX: number; clientY: number }): { time: number; price: number } | null {
    const { x, y } = this.local(e);
    const time = this.xToTime(x);
    const price = this.candle.coordinateToPrice(y);
    if (time == null || price == null) return null;
    return { time, price: this.roundPrice(price) };
  }

  private fibPts(d: { points: { time: number; price: number }[] }): { x: number; y: number }[] | null {
    const pts = d.points.map((p) => {
      const x = this.timeToX(p.time);
      const y = this.candle.priceToCoordinate(p.price);
      return x == null || y == null ? null : { x, y };
    });
    return pts.some((p) => !p) ? null : (pts as { x: number; y: number }[]);
  }

  private hitDrawing(x: number, y: number): { d: Drawing; part: 'line' | 'body' | number } | null {
    let best: { d: Drawing; part: 'line' | 'body' | number } | null = null;
    let bestD = HIT_PX + 1;
    const consider = (d: Drawing, part: 'line' | 'body' | number, dist: number) => {
      if (dist < bestD) {
        bestD = dist;
        best = { d, part };
      }
    };
    for (const d of this.drawingItems()) {
      if (d.type === 'hline') {
        const yy = this.candle.priceToCoordinate(d.price);
        if (yy != null) consider(d, 'line', Math.abs(yy - y));
      } else if (d.type === 'vline') {
        const xx = this.timeToX(d.time);
        if (xx != null) consider(d, 'line', Math.abs(xx - x));
      } else if (d.type === 'position') {
        const g = this.positionPts(d);
        if (!g) continue;
        consider(d, 0, Math.hypot(g.x1 - x, g.yE - y) - 3);
        consider(d, 1, Math.hypot(g.x1 - x, g.yT - y) - 3);
        consider(d, 2, Math.hypot(g.x1 - x, g.yS - y) - 3);
        consider(d, 3, Math.hypot(g.x2 - x, g.yE - y) - 3);
        const top = Math.min(g.yT, g.yS);
        const bot = Math.max(g.yT, g.yS);
        if (x >= Math.min(g.x1, g.x2) && x <= Math.max(g.x1, g.x2) && y >= top && y <= bot) consider(d, 'body', HIT_PX - 0.5);
      } else if (d.type === 'fibext' || d.type === 'fib') {
        const pts = this.fibPts(d);
        if (!pts) continue;
        pts.forEach((p, k) => consider(d, k, Math.hypot(p.x - x, p.y - y) - 3));
        if (d.trendLine) for (let k = 0; k + 1 < pts.length; k++) consider(d, 'body', segDist(x, y, pts[k], pts[k + 1]));
        const W = this.chart.timeScale().width();
        const [xa, xb] = fibLevelXs(d, pts.map((p) => p.x), W);
        if (x >= xa - 3 && x <= xb + 3) {
          for (const l of d.levels) {
            if (!l.on) continue;
            const yy = this.candle.priceToCoordinate(fibExtPrice(d, l.value));
            if (yy != null) consider(d, 'body', Math.abs(yy - y));
          }
        }
      } else {
        const sh = d as Shape;
        const P = this.fibPts(sh as any);
        if (!P || !P.length) continue;
        const near = (p: Pt) => Math.hypot(p.x - x, p.y - y) - 3;
        if (sh.type === 'trend') {
          P.forEach((p, k) => consider(sh, k, near(p)));
          const W = this.chart.timeScale().width();
          const H = this.chart.panes()[0]?.getHeight() ?? 0;
          const [a, b] = extendSegment(P[0], P[1], sh.extend, W, H);
          consider(sh, 'body', segDist(x, y, a, b));
        } else if (sh.type === 'rect') {
          const C = rectCorners(P[0], P[1]);
          C.forEach((p, k) => consider(sh, k, near(p)));
          const [a, b, c, e] = C;
          for (const [u, v] of [[a, c], [c, b], [b, e], [e, a]]) consider(sh, 'body', segDist(x, y, u, v));
          const inside = x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) && y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y);
          if (inside && sh.fill) consider(sh, 'body', HIT_PX - 0.5);
        } else if (sh.type === 'path') {
          P.forEach((p, k) => consider(sh, k, near(p)));
          for (let k = 0; k + 1 < P.length; k++) consider(sh, 'body', segDist(x, y, P[k], P[k + 1]));
        } else if (sh.type === 'note' || sh.type === 'comment') {
          consider(sh, 0, near(P[0]));
          const bx = textBox(sh, P[0].x, P[0].y);
          if (x >= bx.x && x <= bx.x + bx.w && y >= bx.y && y <= bx.y + bx.h) consider(sh, 'body', HIT_PX - 1);
          if (sh.type === 'note') consider(sh, 'body', segDist(x, y, P[0], { x: P[0].x, y: P[0].y - NOTE_STEM }));
        }
      }
    }
    return bestD <= HIT_PX ? best : null;
  }

  /** Coordenadas (px) de la posición: x de entrada y final, y de entrada, stop y objetivo. */
  private positionPts(d: Position) {
    const x1 = this.timeToX(d.entry.time);
    const x2 = this.timeToX(d.endTime);
    const yE = this.candle.priceToCoordinate(d.entry.price);
    const yS = this.candle.priceToCoordinate(d.stop);
    const yT = this.candle.priceToCoordinate(d.target);
    if (x1 == null || x2 == null || yE == null || yS == null || yT == null) return null;
    return { x1, x2, yE, yS, yT };
  }

  /** Posición larga/corta: un clic pone la entrada; stop y objetivo salen a una distancia razonable y se ajustan arrastrando. */
  private addPosition(e: PointerEvent, side: 'long' | 'short') {
    const p = this.pointAtTime(e);
    if (!p) return;
    const { y } = this.local(e);
    const h = this.chart.panes()[0]?.getHeight() ?? 400;
    const off = Math.max(20, Math.min(60, h * 0.08));
    const up = this.candle.coordinateToPrice(y - off);
    const down = this.candle.coordinateToPrice(y + off);
    if (up == null || down == null) return;
    const dUp = Math.abs(up - p.price);
    const dDown = Math.abs(p.price - down);
    // Riesgo 1 : beneficio 2 (objetivo al doble de distancia que el stop).
    const stop = side === 'long' ? p.price - dDown : p.price + dUp;
    const target = side === 'long' ? p.price + 2 * dUp : p.price - 2 * dDown;
    const endTime = p.time + 25 * this.tfSecs();
    this.deps.drawings.addPosition({ side, entry: p, endTime, stop: this.roundPrice(stop), target: this.roundPrice(target) });
  }

  // Fibonacci: extensión (clic en A, B y C) o retroceso (clic en A y B), como en TradingView.
  private fibMove: ((ev: PointerEvent) => void) | null = null;

  private fibUp: ((ev: PointerEvent) => void) | null = null;

  /**
   * Empieza un dibujo de varios puntos: Fibonacci (2 o 3 clics), línea de tendencia y
   * rectángulo (2 clics, o pulsar y arrastrar) y trayectoria (clic en cada punto;
   * doble clic, Intro o Esc para terminar).
   */
  private startFib(e: PointerEvent, kind: FibExt['type'] | 'trend' | 'rect' | 'path') {
    const p = this.pointAtTime(e);
    if (!p) return;
    this.suppressMouse = true;
    const dr = this.deps.drawings;
    dr.dragging = true;
    const n = kind === 'fibext' ? 3 : kind === 'path' ? Infinity : 2;
    const two = [{ ...p }, { ...p }];
    const f =
      kind === 'fib' || kind === 'fibext'
        ? dr.addFib(kind, Array.from({ length: n }, () => ({ ...p })), false)
        : dr.addShape(kind, two, false);
    this.fibDraft = { id: f.id, step: 1, n, tool: kind, down: { x: e.clientX, y: e.clientY } };
    this.fibMove = (ev: PointerEvent) => {
      const q = this.pointAtTime(ev);
      const draft = this.fibDraft;
      if (!q || !draft) return;
      const cur = dr.items.find((x) => x.id === draft.id) as FibExt | Shape | undefined;
      if (!cur) return;
      const pts = cur.points.slice();
      for (let k = draft.step; k < pts.length; k++) pts[k] = q;
      dr.update(draft.id, { points: pts }, -1);
    };
    // Pulsar y arrastrar: al soltar lejos del primer punto se fija el segundo.
    this.fibUp = (ev: PointerEvent) => {
      const draft = this.fibDraft;
      if (!draft || draft.step !== 1 || draft.tool === 'fibext') return;
      if (Math.hypot(ev.clientX - draft.down.x, ev.clientY - draft.down.y) < 8) return;
      this.fibMove?.(ev);
      this.fibClick(ev);
    };
    window.addEventListener('pointermove', this.fibMove, true);
    window.addEventListener('pointerup', this.fibUp, true);
  }

  private fibClick(e?: { clientX: number; clientY: number }) {
    const draft = this.fibDraft;
    if (!draft) return;
    if (draft.n === Infinity) {
      // Trayectoria: cada clic fija un punto; un clic sobre el último punto (doble clic) termina.
      const dr = this.deps.drawings;
      const cur = dr.items.find((x) => x.id === draft.id) as Shape | undefined;
      if (!cur) return this.endFibDraft();
      const q = e ? this.pointAtTime(e) : null;
      const pts = cur.points.slice();
      if (q) pts[pts.length - 1] = q;
      const xy = this.fibPts({ points: pts });
      if (xy && xy.length >= 2) {
        const a = xy[xy.length - 1];
        const b = xy[xy.length - 2];
        if (Math.hypot(a.x - b.x, a.y - b.y) < 5) {
          dr.update(draft.id, { points: pts.slice(0, -1) }, -1);
          return this.finishPath();
        }
      }
      pts.push(pts[pts.length - 1]);
      draft.step = pts.length - 1;
      dr.update(draft.id, { points: pts }, -1);
      return;
    }
    draft.step++;
    if (draft.step < draft.n) return;
    this.endFibDraft();
    this.deps.drawings.persist(draft.id, 0);
  }

  /** Termina la trayectoria con los puntos ya fijados (quita el que sigue al ratón). */
  private finishPath() {
    const draft = this.fibDraft;
    if (!draft) return;
    const dr = this.deps.drawings;
    const cur = dr.items.find((x) => x.id === draft.id) as Shape | undefined;
    const pts = cur ? cur.points.slice(0, draft.step) : [];
    this.endFibDraft();
    if (pts.length < 2) return dr.remove(draft.id);
    dr.update(draft.id, { points: pts }, 0);
  }

  private endFibDraft() {
    if (this.fibMove) window.removeEventListener('pointermove', this.fibMove, true);
    if (this.fibUp) window.removeEventListener('pointerup', this.fibUp, true);
    this.fibMove = null;
    this.fibUp = null;
    const tool = this.fibDraft?.tool;
    this.fibDraft = null;
    this.deps.drawings.dragging = false;
    if (tool && tools.active === tool) tools.set('none');
    setTimeout(() => (this.suppressMouse = false), 0);
    this.updateCursor();
  }

  private cancelFibDraft() {
    const draft = this.fibDraft;
    if (!draft) return;
    this.endFibDraft();
    this.deps.drawings.remove(draft.id);
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.chartEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inMainPane(x: number, y: number): boolean {
    const h = this.chart.panes()[0]?.getHeight() ?? 0;
    return x >= 0 && x <= this.chart.timeScale().width() && y >= 0 && y <= h;
  }

  private roundPrice(p: number): number {
    const mm = this.info.minMove || 0.01;
    return +(Math.round(p / mm) * mm).toFixed(this.info.precision);
  }

  private updateCursor(e?: { clientX: number; clientY: number }) {
    const t = tools.active;
    if (t !== 'none' || this.measuring === 'drawing' || this.fibDraft) {
      this.chartEl.style.cursor = 'crosshair';
      return;
    }
    if (this.dragId) {
      this.chartEl.style.cursor = this.dragKind === 'ns' ? 'ns-resize' : this.dragKind === 'ew' ? 'ew-resize' : 'move';
      return;
    }
    if (e) {
      const { x, y } = this.local(e);
      const hit = this.inMainPane(x, y) ? this.hitDrawing(x, y) : null;
      this.setHover(hit?.d.id ?? null);
      this.chartEl.style.cursor = !hit
        ? ''
        : hit.d.type === 'hline'
          ? 'ns-resize'
          : hit.d.type === 'vline' || (hit.d.type === 'position' && hit.part === 3)
            ? 'ew-resize'
            : hit.d.type === 'position' && (hit.part === 1 || hit.part === 2)
              ? 'ns-resize'
              : typeof hit.part === 'number'
                ? 'pointer'
                : 'move';
    } else {
      this.chartEl.style.cursor = '';
      this.setHover(null);
    }
  }

  private setHover(id: string | null) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.drawPrim.update();
  }

  private installPointerHandlers() {
    const el = this.chartEl;
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    el.addEventListener('pointermove', (e) => this.updateCursor(e), { capture: true });
    el.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0) return;
        if (tools.active !== 'none' || this.fibDraft || this.measuring === 'drawing' || e.shiftKey) this.lastToolClick = Date.now();
        const { x, y } = this.local(e);
        if (!this.inMainPane(x, y)) return;
        const d = this.deps.drawings;
        // Regla de medir: con la herramienta activa (clic, clic) o con Mayús + arrastrar.
        if (this.measuring === 'drawing') {
          stop(e);
          this.finishMeasure();
          return;
        }
        if (tools.active === 'measure' || (e.shiftKey && tools.active === 'none')) {
          stop(e);
          this.startMeasure(e, e.shiftKey && tools.active === 'none');
          return;
        }
        if (this.measuring === 'done') this.clearMeasure();
        if (this.fibDraft) {
          stop(e);
          this.fibClick(e);
          return;
        }
        const ta = tools.active;
        if (ta === 'fibext' || ta === 'fib' || ta === 'trend' || ta === 'rect' || ta === 'path') {
          stop(e);
          this.startFib(e, ta);
          return;
        }
        if (ta === 'note' || ta === 'comment') {
          stop(e);
          const p = this.pointAtTime(e);
          if (!p) return;
          this.suppressMouse = true;
          const sh = d.addShape(ta as ShapeType, [p], false);
          tools.set('none');
          setTimeout(() => (this.suppressMouse = false), 400);
          // Se pide el texto; si se cancela, la nota nueva se borra.
          setTimeout(() => this.openShape(sh.id, true), 0);
          return;
        }
        if (tools.active === 'long' || tools.active === 'short') {
          stop(e);
          this.suppressMouse = true;
          this.addPosition(e, tools.active);
          tools.set('none');
          setTimeout(() => (this.suppressMouse = false), 400);
          return;
        }
        if (tools.active === 'hline' || tools.active === 'vline') {
          const price = this.candle.coordinateToPrice(y);
          const time = this.xToTime(x);
          if (price == null || time == null) return;
          stop(e);
          this.suppressMouse = true;
          if (tools.active === 'hline') d.addHLine(this.roundPrice(price));
          else d.addVLine(time);
          tools.set('none');
          setTimeout(() => (this.suppressMouse = false), 400);
          return;
        }
        const hit = this.hitDrawing(x, y);
        if (hit) {
          stop(e);
          this.suppressMouse = true;
          d.select(hit.d.id);
          this.startDrag(hit, e);
          return;
        }
        if (d.selectedId) d.select(null);
        // Arrastrar el gráfico: el desplazamiento horizontal lo hace la librería;
        // el vertical (subir/bajar el precio) lo añadimos aquí, como en TradingView.
        this.startPricePan(e);
      },
      { capture: true },
    );
    // Evitar que el gráfico se desplace mientras arrastramos una línea.
    for (const type of ['mousedown', 'touchstart'] as const) {
      el.addEventListener(
        type,
        (e) => {
          if (this.suppressMouse) stop(e);
        },
        { capture: true, passive: false },
      );
    }
  }

  /**
   * Mover el precio arriba/abajo arrastrando el gráfico. La librería ya lo hace (también en
   * escala logarítmica) cuando el encuadre automático está quitado; aquí sólo lo quitamos en
   * cuanto el arrastre tiene movimiento vertical, como hace TradingView (el botón A lo repone).
   */
  private startPricePan(e: PointerEvent) {
    const scale = this.chart.priceScale('right');
    if (scale.options().autoScale === false) return;
    const startY = e.clientY;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) < 5) return;
      scale.setAutoScale(false);
      this.refreshAuto();
      up();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  // ── Regla de medir ────────────────────────────────────────────────────────

  private pointAt(e: { clientX: number; clientY: number }): { i: number; p: number } | null {
    const { x, y } = this.local(e);
    const l = this.chart.timeScale().coordinateToLogical(x);
    const p = this.candle.coordinateToPrice(y);
    if (l == null || p == null) return null;
    return { i: Math.round(l), p };
  }

  private measureMove: ((ev: PointerEvent) => void) | null = null;
  private measureUp: (() => void) | null = null;

  private startMeasure(e: PointerEvent, dragMode: boolean) {
    const a = this.pointAt(e);
    if (!a) return;
    this.suppressMouse = true;
    this.measuring = 'drawing';
    this.setMeasure({ i1: a.i, p1: a.p, i2: a.i, p2: a.p });
    this.measureMove = (ev: PointerEvent) => {
      const b = this.pointAt(ev);
      const m = this.measure.value;
      if (b && m) this.setMeasure({ ...m, i2: b.i, p2: b.p });
    };
    window.addEventListener('pointermove', this.measureMove, true);
    if (dragMode) {
      this.measureUp = () => this.finishMeasure();
      window.addEventListener('pointerup', this.measureUp, true);
    }
  }

  private finishMeasure() {
    if (this.measureMove) window.removeEventListener('pointermove', this.measureMove, true);
    if (this.measureUp) window.removeEventListener('pointerup', this.measureUp, true);
    this.measureMove = this.measureUp = null;
    this.measuring = 'done';
    if (tools.active === 'measure') tools.set('none');
    setTimeout(() => (this.suppressMouse = false), 0);
    this.updateCursor();
  }

  private clearMeasure() {
    if (this.measuring === 'drawing') this.finishMeasure();
    this.measuring = 'idle';
    this.measure.set(null);
  }

  private setMeasure(m: Measure) {
    const cs = this.candles;
    const change = m.p2 - m.p1;
    const pct = m.p1 ? (change / m.p1) * 100 : 0;
    const mm = this.info.minMove || 0.01;
    const ticks = Math.round(change / mm);
    const bars = m.i2 - m.i1;
    const secs = Math.abs(bars) * TIMEFRAMES[this.cfg.tf].seconds;
    let vol = 0;
    const lo = Math.max(0, Math.min(m.i1, m.i2));
    const hi = Math.min(cs.length - 1, Math.max(m.i1, m.i2));
    for (let k = lo; k <= hi; k++) vol += cs[k].volume;
    const sign = change > 0 ? '' : change < 0 ? '' : '';
    const tickStr = formatPrice(ticks, 0);
    const lines = [
      `${sign}${formatPrice(change, this.info.precision)} (${formatPrice(pct, 2)}%) ${tickStr}`,
      `${bars} barras, ${formatDuration(secs)}`,
      `Vol. ${formatVolumeEs(vol)}`,
    ];
    this.measure.set(m, { lines });
  }

  private startDrag(hit: { d: Drawing; part: 'line' | 'body' | number }, e: PointerEvent) {
    const d = this.deps.drawings;
    const id = hit.d.id;
    const orig = structuredClone(hit.d);
    this.dragId = id;
    this.dragKind = orig.type === 'hline' ? 'ns' : orig.type === 'vline' ? 'ew' : 'move';
    d.dragging = true;
    const start = this.local(e);
    const startClient = { x: e.clientX, y: e.clientY };
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.abs(ev.clientY - startClient.y) < 3 && Math.abs(ev.clientX - startClient.x) < 3) return;
      moved = true;
      const { x, y } = this.local(ev);
      if (orig.type === 'hline') {
        const p = this.candle.coordinateToPrice(y);
        if (p != null) d.update(id, { price: this.roundPrice(p) }, -1);
      } else if (orig.type === 'vline') {
        const t = this.xToTime(x);
        if (t != null) d.update(id, { time: t }, -1);
      } else if (orig.type === 'position') {
        const q = this.pointAtTime(ev);
        const p = this.candle.coordinateToPrice(y);
        if (p == null) return;
        const price = this.roundPrice(p);
        if (hit.part === 0 && q) d.update(id, { entry: { time: q.time, price } }, -1);
        else if (hit.part === 1) d.update(id, { target: price }, -1);
        else if (hit.part === 2) d.update(id, { stop: price }, -1);
        else if (hit.part === 3) {
          const t = this.xToTime(x);
          if (t != null && t > orig.entry.time) d.update(id, { endTime: t }, -1);
        } else {
          const ts = this.chart.timeScale();
          const l0 = ts.coordinateToLogical(start.x);
          const l1 = ts.coordinateToLogical(x);
          const p0 = this.candle.coordinateToPrice(start.y);
          if (l0 == null || l1 == null || p0 == null) return;
          const dt = Math.round(l1 - l0) * this.tfSecs();
          const dp = p - p0;
          const r = (v: number) => this.roundPrice(v + dp);
          d.update(
            id,
            { entry: { time: orig.entry.time + dt, price: r(orig.entry.price) }, endTime: orig.endTime + dt, stop: r(orig.stop), target: r(orig.target) },
            -1,
          );
        }
      } else {
        if (typeof hit.part === 'number' && orig.type === 'rect' && hit.part >= 2) {
          // Esquinas mixtas del rectángulo: (tiempo del 0, precio del 1) y (tiempo del 1, precio del 0).
          const q = this.pointAtTime(ev);
          if (!q) return;
          const [a, b] = orig.points;
          const pts =
            hit.part === 2
              ? [{ time: q.time, price: a.price }, { time: b.time, price: q.price }]
              : [{ time: a.time, price: q.price }, { time: q.time, price: b.price }];
          d.update(id, { points: pts }, -1);
        } else if (typeof hit.part === 'number') {
          const q = this.pointAtTime(ev);
          if (!q) return;
          const pts = orig.points.slice();
          pts[hit.part] = q;
          d.update(id, { points: pts }, -1);
        } else {
          const ts = this.chart.timeScale();
          const l0 = ts.coordinateToLogical(start.x);
          const l1 = ts.coordinateToLogical(x);
          const p0 = this.candle.coordinateToPrice(start.y);
          const p1 = this.candle.coordinateToPrice(y);
          if (l0 == null || l1 == null || p0 == null || p1 == null) return;
          const dt = Math.round(l1 - l0) * this.tfSecs();
          const dp = p1 - p0;
          d.update(id, { points: orig.points.map((p) => ({ time: p.time + dt, price: this.roundPrice(p.price + dp) })) }, -1);
        }
      }
      ev.preventDefault();
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      this.dragId = null;
      d.dragging = false;
      if (moved) d.persist(id, 0);
      setTimeout(() => (this.suppressMouse = false), 0);
      this.updateCursor();
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
  }

  // ── Fin ───────────────────────────────────────────────────────────────────

  dispose() {
    this.disposed = true;
    this.unsubData();
    this.unsubs.forEach((u) => u());
    this.deps.sync.unregister(this);
    if (this.extrasTimer != null) clearTimeout(this.extrasTimer);
    this.chart.remove();
    this.el.remove();
  }
}
