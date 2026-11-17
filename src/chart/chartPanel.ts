import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  HistogramSeries,
  LineSeries,
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
import { candleIndexAtOrBefore, TIMEFRAMES, tfLabel, USER_TFS } from '../core/timeframes';
import type { Candle, MaCfg, MtfCfg, PanelCfg, TfId } from '../core/types';
import { buildPivots, movingAverage, pivotTfFor, projectSeries, rsi, sma, type Values } from '../indicators/indicators';
import type { SymbolInfo } from '../providers/provider';
import { THEME } from '../ui/defaults';
import { tools } from '../ui/tools';
import type { CrosshairSync } from './crosshairSync';
import { formatVolume, makeTimeFormatter, tickMarkFormatter } from './format';
import { PivotsPrimitive } from './pivotsPrimitive';

// Un gráfico completo: velas, volumen, medias, medias de otra temporalidad, RSI,
// pivots, líneas horizontales, leyenda y cabecera con botones.

export interface PanelDeps {
  hub: DataHub;
  drawings: DrawingsStore;
  sync: CrosshairSync;
  /** Se llama cuando el usuario cambia la configuración del gráfico (para guardarla). */
  onConfigChange: (cfg: PanelCfg) => void;
  /** Botón de maximizar / volver a la cuadrícula. */
  onMaximize: () => void;
  onOpenSettings: (panel: ChartPanel) => void;
  maximizeLabel: string;
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

function maLabel(m: { type: string; period: number }): string {
  return `${m.type} ${m.period}`;
}

export class ChartPanel {
  readonly el: HTMLDivElement;
  readonly chart: IChartApi;
  cfg: PanelCfg;
  private deps: PanelDeps;
  private head: HTMLDivElement;
  private chartEl: HTMLDivElement;
  private legendEl: HTMLDivElement;
  private statusEl: HTMLDivElement;
  private candle: ISeriesApi<'Candlestick'>;
  private volume: ISeriesApi<'Histogram'> | null = null;
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
  private mtfStores = new Map<string, SeriesStore>();
  private pivotStore: SeriesStore | null = null;

  private maValues = new Map<string, Values>();
  private mtfValues = new Map<string, Values>();
  private rsiValues: Values = [];
  private rsiMaValues: Values = [];

  private renderedCount = 0;
  private updateScheduled = false;
  private extrasTimer: number | null = null;
  private hovering = false;
  private hoverIdx: number | null = null;
  private dragId: string | null = null;
  private suppressMouse = false;
  private disposed = false;

  constructor(parent: HTMLElement, cfg: PanelCfg, deps: PanelDeps) {
    this.cfg = structuredClone(cfg);
    this.deps = deps;

    this.el = document.createElement('div');
    this.el.className = 'panel';
    this.head = document.createElement('div');
    this.head.className = 'panel-head';
    const body = document.createElement('div');
    body.className = 'panel-body';
    this.chartEl = document.createElement('div');
    this.chartEl.className = 'panel-chart';
    this.legendEl = document.createElement('div');
    this.legendEl.className = 'legend';
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'panel-status';
    body.append(this.chartEl, this.legendEl, this.statusEl);
    this.el.append(this.head, body);
    parent.appendChild(this.el);

    this.chart = createChart(this.chartEl, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: THEME.bg },
        textColor: THEME.text,
        fontSize: 11,
        // Enlace de atribución de TradingView Lightweight Charts (requisito de la licencia).
        attributionLogo: true,
        panes: { separatorColor: THEME.border, separatorHoverColor: 'rgba(120,140,190,0.25)', enableResize: true },
      },
      grid: { vertLines: { color: THEME.grid }, horzLines: { color: THEME.grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: THEME.border, minimumWidth: 74 },
      timeScale: { borderColor: THEME.border, rightOffset: 6, tickMarkFormatter: tickMarkFormatter as any },
      localization: { locale: 'es-ES' },
    });

    this.candle = this.chart.addSeries(CandlestickSeries, {
      upColor: THEME.up,
      downColor: THEME.down,
      borderUpColor: THEME.up,
      borderDownColor: THEME.down,
      wickUpColor: THEME.up,
      wickDownColor: THEME.down,
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
    this.installPointerHandlers();
    this.unsubs.push(this.deps.drawings.subscribe(() => this.syncPriceLines()));
    this.unsubs.push(tools.subscribe(() => this.updateCursor()));

    this.deps.sync.register(this);
    this.applyTfOptions();
    this.buildIndicatorSeries();
    this.renderHead();
  }

  // ── Cabecera ──────────────────────────────────────────────────────────────

  private renderHead() {
    const c = this.cfg;
    this.head.innerHTML = '';
    const sym = document.createElement('span');
    sym.className = 'ph-sym';
    sym.textContent = this.symbol;
    const tf = document.createElement('select');
    tf.className = 'ph-tf';
    tf.title = 'Temporalidad';
    for (const t of USER_TFS) {
      const o = document.createElement('option');
      o.value = t;
      o.textContent = tfLabel(t);
      tf.appendChild(o);
    }
    if (!USER_TFS.includes(c.tf)) {
      const o = document.createElement('option');
      o.value = c.tf;
      o.textContent = tfLabel(c.tf);
      tf.appendChild(o);
    }
    tf.value = c.tf;
    tf.onchange = () => this.setTimeframe(tf.value as TfId);

    const chips = document.createElement('div');
    chips.className = 'ph-chips';
    const chip = (label: string, on: boolean, color: string | null, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = 'chip' + (on ? ' on' : '');
      b.title = title;
      if (color) {
        const dot = document.createElement('i');
        dot.style.background = color;
        b.appendChild(dot);
      }
      b.append(label);
      b.onclick = fn;
      chips.appendChild(b);
    };
    for (const m of c.mas) {
      chip(maLabel(m).replace('EMA ', 'E').replace('SMA ', 'S'), m.visible, m.color, `Mostrar/ocultar ${maLabel(m)}`, () => {
        m.visible = !m.visible;
        this.configChanged(false);
      });
    }
    if (c.mtf.length) {
      chip('MTF', c.mtfVisible, null, 'Medias de otra temporalidad: ' + c.mtf.map((m) => `${maLabel(m)} (${tfLabel(m.tf)})`).join(', '), () => {
        c.mtfVisible = !c.mtfVisible;
        this.configChanged(false);
      });
    }
    chip('RSI', c.rsi, null, 'RSI 14 con su media', () => {
      c.rsi = !c.rsi;
      this.configChanged(true);
    });
    chip('Vol', c.volume, null, 'Volumen', () => {
      c.volume = !c.volume;
      this.configChanged(true);
    });
    chip('Piv', c.pivots, null, `Pivots Traditional (${tfLabel(pivotTfFor(c.tf))})`, () => {
      c.pivots = !c.pivots;
      this.configChanged(false);
    });

    const gear = document.createElement('button');
    gear.className = 'icon-btn';
    gear.title = 'Configurar indicadores de este gráfico';
    gear.textContent = '⚙';
    gear.onclick = () => this.deps.onOpenSettings(this);
    const max = document.createElement('button');
    max.className = 'icon-btn';
    max.title = this.deps.maximizeLabel;
    max.textContent = this.deps.maximizeLabel.startsWith('Volver') ? '▦' : '⤢';
    max.onclick = () => this.deps.onMaximize();

    this.head.append(sym, tf, chips, gear, max);
    this.head.ondblclick = (e) => {
      if ((e.target as HTMLElement).closest('button,select')) return;
      this.deps.onMaximize();
    };
  }

  /** Aplica una configuración nueva (desde el diálogo de ajustes). */
  setConfig(cfg: PanelCfg) {
    const tfChanged = cfg.tf !== this.cfg.tf;
    this.cfg = structuredClone(cfg);
    if (tfChanged) this.applyTfOptions();
    this.configChanged(true, tfChanged);
  }

  private configChanged(rebuildSeries: boolean, reloadData = false) {
    this.deps.onConfigChange(structuredClone(this.cfg));
    this.renderHead();
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

  // ── Series de indicadores ─────────────────────────────────────────────────

  private lineOpts(color: string, width: number, step = false) {
    return {
      color,
      lineWidth: width as 1 | 2 | 3 | 4,
      lineType: step ? LineType.WithSteps : LineType.Simple,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      priceFormat: { type: 'price' as const, precision: this.info.precision, minMove: this.info.minMove },
    };
  }

  private buildIndicatorSeries() {
    for (const s of this.maSeries.values()) this.chart.removeSeries(s);
    for (const s of this.mtfSeries.values()) this.chart.removeSeries(s);
    this.maSeries.clear();
    this.mtfSeries.clear();
    if (this.volume) this.chart.removeSeries(this.volume);
    this.volume = null;
    if (this.rsiSeries) this.chart.removeSeries(this.rsiSeries);
    if (this.rsiMaSeries) this.chart.removeSeries(this.rsiMaSeries);
    this.rsiSeries = this.rsiMaSeries = null;

    if (this.cfg.volume) {
      this.volume = this.chart.addSeries(HistogramSeries, {
        priceScaleId: 'vol',
        priceFormat: { type: 'volume' },
        lastValueVisible: false,
        priceLineVisible: false,
      });
      this.volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    }
    for (const m of this.cfg.mas) this.maSeries.set(m.id, this.chart.addSeries(LineSeries, this.lineOpts(m.color, m.width)));
    for (const m of this.cfg.mtf) this.mtfSeries.set(m.id, this.chart.addSeries(LineSeries, this.lineOpts(m.color, m.width, true)));

    if (this.cfg.rsi) {
      const base = {
        priceLineVisible: false,
        crosshairMarkerVisible: false,
        priceFormat: { type: 'price' as const, precision: 2, minMove: 0.01 },
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
      };
      this.rsiSeries = this.chart.addSeries(LineSeries, { ...base, color: THEME.rsi, lineWidth: 1 }, 1);
      this.rsiMaSeries = this.chart.addSeries(LineSeries, { ...base, color: THEME.rsiMa, lineWidth: 1, lastValueVisible: false }, 1);
      for (const level of [70, 50, 30]) {
        this.rsiSeries.createPriceLine({
          price: level,
          color: level === 50 ? 'rgba(160,170,200,0.25)' : 'rgba(160,170,200,0.45)',
          lineWidth: 1,
          lineStyle: 2,
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
    const pf = { type: 'price' as const, precision: info.precision, minMove: info.minMove };
    this.candle.applyOptions({ priceFormat: pf });
    for (const s of [...this.maSeries.values(), ...this.mtfSeries.values()]) s.applyOptions({ priceFormat: pf });
    this.pivots.formatPrice = (p) => p.toFixed(info.precision);
    this.renderHead();
    this.subscribeData();
    this.syncPriceLines();
  }

  private subscribeData() {
    this.unsubData();
    if (!this.symbol) return;
    this.renderedCount = 0;
    this.candle.setData([]);
    this.volume?.setData([]);
    for (const s of [...this.maSeries.values(), ...this.mtfSeries.values()]) s.setData([]);
    this.rsiSeries?.setData([]);
    this.rsiMaSeries?.setData([]);
    this.pivots.setData([]);
    this.setStatus('Cargando…');
    const store = this.deps.hub.get(this.symbol, this.cfg.tf);
    this.store = store;
    this.dataUnsubs.push(store.subscribe((ev, info) => this.onStoreEvent(ev, info?.added)));
    if (store.loaded) this.onStoreEvent('reset');
    this.subscribeExtras();
  }

  private dataUnsubs: (() => void)[] = [];
  private extraUnsubs = new Map<string, () => void>();

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

  private fullRedraw() {
    const cs = this.candles;
    if (!this.store?.loaded) return;
    this.candle.setData(cs.map((c) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close })));
    this.volume?.setData(cs.map((c) => ({ time: c.time as Time, value: c.volume, color: c.close >= c.open ? THEME.volUp : THEME.volDown })));
    this.computeOwnIndicators();
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
    for (const i of idxs) {
      const c = cs[i];
      const t = c.time as Time;
      this.candle.update({ time: t, open: c.open, high: c.high, low: c.low, close: c.close });
      this.volume?.update({ time: t, value: c.volume, color: c.close >= c.open ? THEME.volUp : THEME.volDown });
      for (const m of this.cfg.mas) {
        const v = this.maValues.get(m.id)?.[i];
        if (v != null) this.maSeries.get(m.id)?.update({ time: t, value: v });
      }
      const r = this.rsiValues[i];
      if (this.rsiSeries && r != null) this.rsiSeries.update({ time: t, value: r });
      const rm = this.rsiMaValues[i];
      if (this.rsiMaSeries && rm != null) this.rsiMaSeries.update({ time: t, value: rm });
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
    if (this.cfg.pivots && this.pivotStore?.loaded) {
      let htf = this.pivotStore.candles;
      this.pivots.setData(buildPivots(cs, htf));
    } else this.pivots.setData([]);
  }

  // ── Leyenda y cruz ────────────────────────────────────────────────────────

  private fmt(v: number | null | undefined): string {
    return v == null ? '—' : v.toFixed(this.info.precision);
  }

  private updateLegend(idx?: number | null) {
    const cs = this.candles;
    if (!cs.length) {
      this.legendEl.innerHTML = '';
      return;
    }
    const i = idx == null || idx < 0 || idx >= cs.length ? cs.length - 1 : idx;
    const c = cs[i];
    const prev = i > 0 ? cs[i - 1].close : c.open;
    const ch = c.close - prev;
    const pct = prev ? (ch / prev) * 100 : 0;
    const col = ch >= 0 ? THEME.up : THEME.down;
    const v = (x: number) => `<b style="color:${col}">${this.fmt(x)}</b>`;
    let html = `<div class="lg-row"><span class="lg-title">${this.symbol} · ${tfLabel(this.cfg.tf)} · ${this.deps.hub.provider.label}</span>
      <span>O${v(c.open)} H${v(c.high)} L${v(c.low)} C${v(c.close)}</span>
      <b style="color:${col}">${ch >= 0 ? '+' : ''}${this.fmt(ch)} (${ch >= 0 ? '+' : ''}${pct.toFixed(2)}%)</b>
      ${this.cfg.volume ? `<span>Vol <b>${formatVolume(c.volume)}</b></span>` : ''}</div>`;
    const items: string[] = [];
    for (const m of this.cfg.mas) {
      if (!m.visible) continue;
      items.push(`<span style="color:${m.color}">${maLabel(m)} ${this.fmt(this.maValues.get(m.id)?.[i])}</span>`);
    }
    if (this.cfg.mtfVisible) {
      for (const m of this.cfg.mtf) {
        if (!m.visible) continue;
        items.push(`<span style="color:${m.color}">${maLabel(m)} (${tfLabel(m.tf)}) ${this.fmt(this.mtfValues.get(m.id)?.[i])}</span>`);
      }
    }
    if (items.length) html += `<div class="lg-row">${items.join('')}</div>`;
    if (this.cfg.rsi) {
      const r = this.rsiValues[i];
      const rm = this.rsiMaValues[i];
      html += `<div class="lg-row lg-rsi"><span style="color:${THEME.rsi}">RSI 14 ${r == null ? '—' : r.toFixed(2)}</span><span style="color:${THEME.rsiMa}">MA 14 ${rm == null ? '—' : rm.toFixed(2)}</span></div>`;
    }
    this.legendEl.innerHTML = html;
  }

  private onCrosshair(p: MouseEventParams<Time>) {
    if (!this.hovering) return; // movimientos provocados por la sincronización
    const t = p.time as number | undefined;
    if (t == null || !p.point) {
      this.updateLegend();
      this.deps.sync.move(this, null, null);
      return;
    }
    const idx = candleIndexAtOrBefore(this.candles, t);
    this.hoverIdx = idx;
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
    this.updateLegend();
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
