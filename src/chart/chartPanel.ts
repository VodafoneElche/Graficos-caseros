import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  LineSeries,
  LineStyle,
  LineType,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type LineData,
  type MouseEventParams,
  type Time,
} from 'lightweight-charts';
import type { DataHub, SeriesStore, StoreEvent } from '../core/store';
import type { DrawingsStore } from '../core/drawings';
import { candleIndexAtOrBefore, TIMEFRAMES, tfLabel } from '../core/timeframes';
import type { Candle, PanelCfg, TfId } from '../core/types';
import { buildPivots, movingAverage, pivotTfFor, projectSeries, rsi, sma, type Values } from '../indicators/indicators';
import type { SymbolInfo } from '../providers/provider';
import { THEME } from '../ui/defaults';
import { tools } from '../ui/tools';
import type { CrosshairSync } from './crosshairSync';
import { formatPrice, formatVolumeEs, makeTimeFormatter, tickMarkFormatter } from './format';
import { PivotsPrimitive } from './pivotsPrimitive';

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

function toLine(candles: Candle[], values: Values): LineData<Time>[] {
  const out: LineData<Time>[] = [];
  for (let i = 0; i < candles.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v)) out.push({ time: candles[i].time as Time, value: v });
  }
  return out;
}

const EYE_ON = '<svg viewBox="0 0 18 18" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M1.5 9s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z"/><circle cx="9" cy="9" r="2.2" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 18 18" width="14" height="14"><path fill="none" stroke="currentColor" stroke-width="1.3" d="M1.5 9s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5z"/><path stroke="currentColor" stroke-width="1.3" d="M3 15L15 3"/></svg>';

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
  private mtfSeries = new Map<string, LineApi>();
  private rsiSeries: LineApi | null = null;
  private rsiMaSeries: LineApi | null = null;
  private pivots = new PivotsPrimitive();
  private priceLines = new Map<string, IPriceLine>();

  private symbol = '';
  private info: SymbolInfo = { symbol: '', description: '', precision: 2, minMove: 0.01 };
  private store: SeriesStore | null = null;
  private unsubs: (() => void)[] = [];
  private dataUnsubs: (() => void)[] = [];
  private extraUnsubs = new Map<string, () => void>();
  private mtfStores = new Map<string, SeriesStore>();
  private pivotStore: SeriesStore | null = null;

  private maValues = new Map<string, Values>();
  private mtfValues = new Map<string, Values>();
  private rsiValues: Values = [];
  private rsiMaValues: Values = [];
  private volMaValues: Values = [];

  private renderedCount = 0;
  private updateScheduled = false;
  private extrasTimer: number | null = null;
  private hovering = false;
  private legendIdx: number | null = null;
  private dragId: string | null = null;
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
    this.el.append(this.chartEl, this.legendEl, this.statusEl);
    parent.appendChild(this.el);

    this.chart = createChart(this.chartEl, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.scaleText,
        fontSize: 12,
        // Enlace de atribución de TradingView Lightweight Charts (requisito de la licencia).
        attributionLogo: true,
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
      const { y } = this.local(e);
      if (y > this.chartEl.clientHeight - 30) this.deps.onMaximize();
    });
    this.legendEl.addEventListener('click', (e) => this.onLegendClick(e));
    this.installPointerHandlers();
    this.unsubs.push(this.deps.drawings.subscribe(() => this.syncPriceLines()));
    this.unsubs.push(tools.subscribe(() => this.updateCursor()));

    this.deps.sync.register(this);
    this.applyTfOptions();
    this.buildIndicatorSeries();
  }

  setActive(active: boolean) {
    this.el.classList.toggle('active', active);
  }

  // ── Configuración ─────────────────────────────────────────────────────────

  /** Aplica una configuración nueva (desde el diálogo de ajustes). */
  setConfig(cfg: PanelCfg) {
    const tfChanged = cfg.tf !== this.cfg.tf;
    this.cfg = structuredClone(cfg);
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

  private lineOpts(color: string, width: number, step = false) {
    return {
      color,
      lineWidth: width as 1 | 2 | 3 | 4,
      lineType: step ? LineType.WithSteps : LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: true, // valor en el eje derecho
      crosshairMarkerVisible: false,
      priceFormat: this.priceFormat(),
    };
  }

  private buildIndicatorSeries() {
    for (const s of this.maSeries.values()) this.chart.removeSeries(s);
    for (const s of this.mtfSeries.values()) this.chart.removeSeries(s);
    this.maSeries.clear();
    this.mtfSeries.clear();
    if (this.volume) this.chart.removeSeries(this.volume);
    if (this.volumeMa) this.chart.removeSeries(this.volumeMa);
    this.volume = this.volumeMa = null;
    if (this.rsiSeries) this.chart.removeSeries(this.rsiSeries);
    if (this.rsiMaSeries) this.chart.removeSeries(this.rsiMaSeries);
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
    for (const m of this.cfg.mas) this.maSeries.set(m.id, this.chart.addSeries(LineSeries, this.lineOpts(m.color, m.width)));
    for (const m of this.cfg.mtf) this.mtfSeries.set(m.id, this.chart.addSeries(LineSeries, this.lineOpts(m.color, m.width, true)));

    if (this.cfg.rsi) {
      const base = {
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'custom' as const, minMove: 0.01, formatter: (v: number) => formatPrice(v, 2) },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      };
      this.rsiSeries = this.chart.addSeries(LineSeries, { ...base, color: THEME.rsi, lineWidth: 1 }, 1);
      this.rsiMaSeries = this.chart.addSeries(LineSeries, { ...base, color: THEME.rsiMa, lineWidth: 1 }, 1);
      for (const level of [70, 50, 30]) {
        this.rsiSeries.createPriceLine({
          price: level,
          color: level === 50 ? 'rgba(120,123,134,0.35)' : 'rgba(120,123,134,0.7)',
          lineWidth: 1,
          lineStyle: LineStyle.Dashed,
          axisLabelVisible: false,
          title: '',
        });
      }
      const panes = this.chart.panes();
      panes[0]?.setStretchFactor(3);
      panes[1]?.setStretchFactor(1);
    }
    this.applyVisibility();
  }

  private applyVisibility() {
    for (const m of this.cfg.mas) this.maSeries.get(m.id)?.applyOptions({ visible: m.visible });
    for (const m of this.cfg.mtf) this.mtfSeries.get(m.id)?.applyOptions({ visible: m.visible && this.cfg.mtfVisible });
    this.pivots.setVisible(this.cfg.pivots);
  }

  // ── Datos ─────────────────────────────────────────────────────────────────

  setSymbol(symbol: string, info: SymbolInfo) {
    this.symbol = symbol;
    this.info = info;
    const pf = this.priceFormat();
    this.candle.applyOptions({ priceFormat: pf });
    for (const s of [...this.maSeries.values(), ...this.mtfSeries.values()]) s.applyOptions({ priceFormat: pf });
    this.pivots.formatPrice = (p) => formatPrice(p, info.precision);
    this.subscribeData();
    this.syncPriceLines();
  }

  private subscribeData() {
    this.unsubData();
    if (!this.symbol) return;
    this.renderedCount = 0;
    this.candle.setData([]);
    this.volume?.setData([]);
    this.volumeMa?.setData([]);
    for (const s of [...this.maSeries.values(), ...this.mtfSeries.values()]) s.setData([]);
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
    this.store = null;
  }

  /** Suscribe los datos de otras temporalidades que hacen falta (medias MTF y pivots). */
  private subscribeExtras() {
    if (!this.symbol) return;
    const wanted = new Map<string, TfId>();
    if (this.cfg.mtfVisible) for (const m of this.cfg.mtf) if (m.visible) wanted.set(`mtf:${m.tf}`, m.tf);
    if (this.cfg.pivots) wanted.set(`piv:${pivotTfFor(this.cfg.tf)}`, pivotTfFor(this.cfg.tf));
    for (const [key, un] of this.extraUnsubs) {
      if (!wanted.has(key)) {
        un();
        this.extraUnsubs.delete(key);
      }
    }
    this.mtfStores.clear();
    this.pivotStore = null;
    for (const [key, tf] of wanted) {
      const st = this.deps.hub.get(this.symbol, tf);
      if (key.startsWith('mtf:')) this.mtfStores.set(tf, st);
      else this.pivotStore = st;
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

  private computeOwnIndicators() {
    const cs = this.candles;
    const closes = cs.map((c) => c.close);
    this.maValues.clear();
    for (const m of this.cfg.mas) this.maValues.set(m.id, movingAverage(m.type, closes, m.period));
    if (this.cfg.rsi) {
      this.rsiValues = rsi(closes, 14);
      this.rsiMaValues = sma(this.rsiValues, 14);
    }
    if (this.cfg.volume) this.volMaValues = sma(cs.map((c) => c.volume), 20);
  }

  private computeMtf() {
    const cs = this.candles;
    this.mtfValues.clear();
    for (const m of this.cfg.mtf) {
      const st = this.mtfStores.get(m.tf);
      if (!st || !st.loaded) continue;
      const src = st.candles;
      const vals = movingAverage(m.type, src.map((c) => c.close), m.period);
      this.mtfValues.set(m.id, projectSeries(cs, this.cfg.tf, src, m.tf, vals));
    }
  }

  private volColor(c: Candle) {
    return c.close >= c.open ? THEME.volUp : THEME.volDown;
  }

  private fullRedraw() {
    const cs = this.candles;
    if (!this.store?.loaded) return;
    this.candle.setData(cs.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    this.volume?.setData(cs.map((c) => ({ time: c.time as Time, value: c.volume, color: this.volColor(c) })));
    this.computeOwnIndicators();
    this.volumeMa?.setData(toLine(cs, this.volMaValues));
    for (const m of this.cfg.mas) this.maSeries.get(m.id)?.setData(toLine(cs, this.maValues.get(m.id) ?? []));
    if (this.rsiSeries) {
      this.rsiSeries.setData(toLine(cs, this.rsiValues));
      this.rsiMaSeries?.setData(toLine(cs, this.rsiMaValues));
    }
    this.renderedCount = cs.length;
    this.redrawExtras();
    this.updateLegend();
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
      for (const m of this.cfg.mas) upd(this.maSeries.get(m.id), this.maValues.get(m.id)?.[i], t);
      upd(this.rsiSeries, this.rsiValues[i], t);
      upd(this.rsiMaSeries, this.rsiMaValues[i], t);
    }
    this.renderedCount = n;
    if (appended) this.redrawExtras();
    else this.scheduleExtras();
    if (!this.hovering) this.updateLegend();
  }

  /** Medias MTF y pivots: se recalculan como mucho una vez por segundo. */
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
    for (const m of this.cfg.mtf) this.mtfSeries.get(m.id)?.setData(toLine(cs, this.mtfValues.get(m.id) ?? []));
    if (this.cfg.pivots && this.pivotStore?.loaded) this.pivots.setData(buildPivots(cs, this.pivotStore.candles));
    else this.pivots.setData([]);
    if (!this.hovering) this.updateLegend();
  }

  // ── Leyenda (estilo TradingView) ──────────────────────────────────────────

  private fmt(v: number | null | undefined): string {
    return v == null ? '∅' : formatPrice(v, this.info.precision);
  }

  private updateLegend(idx?: number | null) {
    if (idx !== undefined) this.legendIdx = idx;
    const cs = this.candles;
    const c = cs.length ? cs[this.legendIdx == null || this.legendIdx < 0 || this.legendIdx >= cs.length ? cs.length - 1 : this.legendIdx] : null;
    const i = c ? cs.indexOf(c) : -1;
    const cfg = this.cfg;
    const tfName = tfLabel(cfg.tf);
    const src = this.deps.hub.provider.label.toUpperCase();
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
    html += `<span class="lg-tools"><button data-act="settings" title="Configurar indicadores">⚙</button><button data-act="max" title="Ver en grande / volver a los 6 (doble clic abajo en las fechas)">⤢</button></span></div>`;

    type Item = { key: string; name: string; value: string; color: string; visible: boolean };
    const items: Item[] = [];
    if (cfg.volume) items.push({ key: 'vol', name: 'Vol · 20', value: c ? `${formatVolumeEs(c.volume)} ${this.volMaValues[i] != null ? formatVolumeEs(this.volMaValues[i]!) : ''}` : '', color: THEME.scaleText, visible: true });
    for (const m of cfg.mas) items.push({ key: `ma:${m.id}`, name: `${m.type} ${m.period} close`, value: this.fmt(this.maValues.get(m.id)?.[i]), color: m.color, visible: m.visible });
    for (const m of cfg.mtf) {
      items.push({ key: `mtf:${m.id}`, name: `${m.type} · ${tfLabel(m.tf)} ${m.period} close`, value: this.fmt(this.mtfValues.get(m.id)?.[i]), color: m.color, visible: m.visible && cfg.mtfVisible });
    }
    items.push({ key: 'piv', name: `Pivots Traditional Auto`, value: '', color: THEME.pivots, visible: cfg.pivots });
    if (cfg.rsi) {
      const r = this.rsiValues[i];
      const rm = this.rsiMaValues[i];
      items.push({ key: 'rsi', name: 'RSI 14 close', value: `${r == null ? '∅' : formatPrice(r, 2)} <span style="color:${THEME.rsiMa}">${rm == null ? '' : formatPrice(rm, 2)}</span>`, color: THEME.rsi, visible: true });
    }

    if (cfg.legendOpen) {
      for (const it of items) {
        html += `<div class="lg-row lg-ind${it.visible ? '' : ' off'}"><span class="lg-name">${esc(it.name)}</span>
          <button class="lg-eye" data-act="eye" data-key="${it.key}" title="${it.visible ? 'Ocultar' : 'Mostrar'}">${it.visible ? EYE_ON : EYE_OFF}</button>
          ${it.visible && it.value ? `<span class="lg-val" style="color:${it.color}">${it.value}</span>` : ''}</div>`;
      }
      html += `<div class="lg-row"><button class="lg-collapse" data-act="collapse" title="Ocultar la lista de indicadores">⌃</button></div>`;
    } else {
      html += `<div class="lg-row"><button class="lg-collapse" data-act="expand" title="Mostrar la lista de indicadores">⌄ ${items.length}</button></div>`;
    }
    this.legendEl.innerHTML = html;
  }

  private onLegendClick(e: MouseEvent) {
    const btn = (e.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    const cfg = this.cfg;
    if (act === 'settings') return this.deps.onOpenSettings(this);
    if (act === 'max') return this.deps.onMaximize();
    if (act === 'collapse' || act === 'expand') {
      cfg.legendOpen = act === 'expand';
      this.deps.onConfigChange(structuredClone(cfg));
      return this.updateLegend();
    }
    if (act === 'eye') {
      const key = btn.dataset.key || '';
      if (key === 'piv') {
        cfg.pivots = !cfg.pivots;
        return this.configChanged(false);
      }
      if (key === 'vol') {
        cfg.volume = false;
        return this.configChanged(true);
      }
      if (key === 'rsi') {
        cfg.rsi = false;
        return this.configChanged(true);
      }
      const [kind, id] = key.split(':');
      const list = kind === 'ma' ? cfg.mas : cfg.mtf;
      const m = list.find((x) => x.id === id);
      if (m) {
        if (kind === 'mtf' && !cfg.mtfVisible) {
          cfg.mtfVisible = true;
          m.visible = true;
        } else m.visible = !m.visible;
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

  // ── Líneas horizontales ───────────────────────────────────────────────────

  private syncPriceLines() {
    const d = this.deps.drawings;
    const items = d.symbol === this.symbol ? d.items : [];
    const seen = new Set<string>();
    for (const it of items) {
      if (it.type !== 'hline') continue;
      seen.add(it.id);
      const opts = {
        price: it.price,
        color: it.color,
        lineWidth: Math.min(4, it.width + (d.selectedId === it.id ? 1 : 0)) as 1 | 2 | 3 | 4,
        lineStyle: it.style,
        axisLabelVisible: true,
        title: '',
      };
      const pl = this.priceLines.get(it.id);
      if (pl) pl.applyOptions(opts);
      else this.priceLines.set(it.id, this.candle.createPriceLine(opts));
    }
    for (const [id, pl] of this.priceLines) {
      if (!seen.has(id)) {
        this.candle.removePriceLine(pl);
        this.priceLines.delete(id);
      }
    }
  }

  private local(e: { clientX: number; clientY: number }) {
    const r = this.chartEl.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private inMainPane(x: number, y: number): boolean {
    const h = this.chart.panes()[0]?.getHeight() ?? 0;
    return x >= 0 && x <= this.chart.timeScale().width() && y >= 0 && y <= h;
  }

  private hitLine(y: number): string | null {
    let best: string | null = null;
    let bestD = HIT_PX + 1;
    for (const it of this.deps.drawings.items) {
      const yy = this.candle.priceToCoordinate(it.price);
      if (yy == null) continue;
      const dist = Math.abs(yy - y);
      if (dist < bestD) {
        bestD = dist;
        best = it.id;
      }
    }
    return bestD <= HIT_PX ? best : null;
  }

  private roundPrice(p: number): number {
    const mm = this.info.minMove || 0.01;
    return +(Math.round(p / mm) * mm).toFixed(this.info.precision);
  }

  private updateCursor(e?: { clientX: number; clientY: number }) {
    if (tools.active === 'hline') {
      this.chartEl.style.cursor = 'crosshair';
      return;
    }
    if (this.dragId) {
      this.chartEl.style.cursor = 'ns-resize';
      return;
    }
    if (e) {
      const { x, y } = this.local(e);
      this.chartEl.style.cursor = this.inMainPane(x, y) && this.hitLine(y) ? 'ns-resize' : '';
    } else this.chartEl.style.cursor = '';
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
        const { x, y } = this.local(e);
        if (!this.inMainPane(x, y)) return;
        const d = this.deps.drawings;
        if (tools.active === 'hline') {
          const price = this.candle.coordinateToPrice(y);
          if (price == null) return;
          stop(e);
          this.suppressMouse = true;
          d.addHLine(this.roundPrice(price));
          tools.set('none');
          setTimeout(() => (this.suppressMouse = false), 400);
          return;
        }
        const hit = this.hitLine(y);
        if (hit) {
          stop(e);
          this.suppressMouse = true;
          d.select(hit);
          this.startDrag(hit, e);
          return;
        }
        if (d.selectedId) d.select(null);
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

  private startDrag(id: string, e: PointerEvent) {
    const d = this.deps.drawings;
    this.dragId = id;
    d.dragging = true;
    const startY = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (Math.abs(ev.clientY - startY) < 3 && !moved) return;
      moved = true;
      const { y } = this.local(ev);
      const p = this.candle.coordinateToPrice(y);
      if (p != null) d.update(id, { price: this.roundPrice(p) }, -1);
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
