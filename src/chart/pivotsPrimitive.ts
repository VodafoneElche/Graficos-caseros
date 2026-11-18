import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { PivotPeriod } from '../indicators/indicators';
import type { PivotCfg, PivotLevelName } from '../core/types';

// Dibuja los pivots como tramos horizontales, uno por periodo (día/semana/mes),
// con su etiqueta (P, R1, S1...) a la izquierda, como en TradingView.

export class PivotsPrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private periods: PivotPeriod[] = [];
  private visible = true;
  color = '#f5a623';
  cfg: PivotCfg | null = null;
  formatPrice: (p: number) => string = (p) => p.toFixed(2);
  private view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t as unknown as CanvasRenderingTarget2D) };
    this.view = { zOrder: () => 'normal', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart as IChartApi;
    this.series = p.series as ISeriesApi<SeriesType>;
    this.requestUpdate = p.requestUpdate;
  }

  detached() {
    this.chart = null;
    this.series = null;
    this.requestUpdate = null;
  }

  setData(periods: PivotPeriod[]) {
    this.periods = periods;
    this.requestUpdate?.();
  }

  setVisible(v: boolean) {
    this.visible = v;
    this.requestUpdate?.();
  }

  updateAllViews() {}

  paneViews() {
    return [this.view];
  }

  private draw(target: CanvasRenderingTarget2D) {
    if (!this.visible || !this.chart || !this.series || !this.periods.length) return;
    const ts = this.chart.timeScale();
    const series = this.series;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      ctx.save();
      const cfg = this.cfg;
      ctx.lineWidth = Math.max(0.5, cfg?.width ?? 1) * hr;
      ctx.font = `${Math.round(11 * vr)}px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textBaseline = 'bottom';
      const half = (ts.options().barSpacing || 6) / 2;
      const showText = cfg ? cfg.showLabels || cfg.showPrices : true;
      const odd = Math.round(ctx.lineWidth) % 2 === 1 && ctx.lineWidth >= 1;
      for (const per of this.periods) {
        // logicalToCoordinate sólo admite índices enteros: sumamos media vela a mano.
        const ca = ts.logicalToCoordinate(per.i1 as any);
        const cb = ts.logicalToCoordinate(per.i2 as any);
        if (ca == null || cb == null) continue;
        const x1 = Math.round((ca - half) * hr);
        const x2 = Math.round((cb + half) * hr);
        if (x2 < 0 || x1 > bitmapSize.width) continue;
        const roomForText = x2 - x1 > 70 * hr;
        for (const lv of per.levels) {
          const st = cfg?.levels[lv.name as PivotLevelName];
          if (cfg && (!st || !st.on)) continue;
          const color = st?.color ?? this.color;
          const y = series.priceToCoordinate(lv.price);
          if (y == null) continue;
          const yy = Math.round(y * vr) + (odd ? 0.5 : 0);
          if (yy < -10 || yy > bitmapSize.height + 10) continue;
          ctx.strokeStyle = color;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(x1, yy);
          ctx.lineTo(x2, yy);
          ctx.stroke();
          if (showText && roomForText) {
            const parts: string[] = [];
            if (!cfg || cfg.showLabels) parts.push(lv.name);
            if (!cfg || cfg.showPrices) parts.push(cfg && !cfg.showLabels ? this.formatPrice(lv.price) : `(${this.formatPrice(lv.price)})`);
            const label = parts.join(' ');
            const w = ctx.measureText(label).width;
            const right = cfg?.labelsPos === 'right';
            ctx.fillText(label, right ? Math.max(x1 + 3 * hr, x2 - w - 3 * hr) : x1 + 3 * hr, yy - 2 * vr);
          }
        }
      }
      ctx.restore();
    });
  }
}
