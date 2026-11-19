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
import type { RsiCfg } from '../core/types';
import type { Values } from '../indicators/indicators';

// Fondos del RSI como en TradingView: banda entre 30 y 70 ("RSI Background Fill")
// y degradados de sobrecompra (verde, por encima de 70) y sobreventa (rojo, por debajo de 30).

function rgba(color: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class RsiFill implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private cfg: RsiCfg | null = null;
  private values: Values = [];
  private view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t as unknown as CanvasRenderingTarget2D) };
    this.view = { zOrder: () => 'bottom', renderer: () => renderer };
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

  set(cfg: RsiCfg, values: Values) {
    this.cfg = cfg;
    this.values = values;
    this.requestUpdate?.();
  }

  updateAllViews() {}

  paneViews() {
    return [this.view];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const cfg = this.cfg;
    const s = this.series;
    if (!cfg || !s || !this.chart) return;
    const ts = this.chart.timeScale();
    const yUp = s.priceToCoordinate(cfg.upper.value);
    const yLo = s.priceToCoordinate(cfg.lower.value);
    const y100 = s.priceToCoordinate(100);
    const y0 = s.priceToCoordinate(0);
    if (yUp == null || yLo == null || y100 == null || y0 == null) return;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      ctx.save();
      if (cfg.bgFill) {
        ctx.fillStyle = cfg.bgColor;
        ctx.fillRect(0, Math.min(yUp, yLo) * vr, bitmapSize.width, Math.abs(yLo - yUp) * vr);
      }
      // Puntos visibles de la línea del RSI.
      const range = ts.getVisibleLogicalRange();
      if (range && (cfg.obFill || cfg.osFill)) {
        const from = Math.max(0, Math.floor(range.from) - 1);
        const to = Math.min(this.values.length - 1, Math.ceil(range.to) + 1);
        const pts: { x: number; y: number }[] = [];
        for (let i = from; i <= to; i++) {
          const v = this.values[i];
          if (v == null) continue;
          const x = ts.logicalToCoordinate(i as any);
          const y = s.priceToCoordinate(v);
          if (x == null || y == null) continue;
          pts.push({ x: x * hr, y: y * vr });
        }
        if (pts.length > 1) {
          const zone = (level: number, edge: number, color: string, above: boolean) => {
            ctx.save();
            ctx.beginPath();
            if (above) ctx.rect(0, 0, bitmapSize.width, level);
            else ctx.rect(0, level, bitmapSize.width, bitmapSize.height - level);
            ctx.clip();
            const g = ctx.createLinearGradient(0, edge, 0, level);
            g.addColorStop(0, rgba(color, 0.7));
            g.addColorStop(1, rgba(color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(pts[0].x, level);
            for (const p of pts) ctx.lineTo(p.x, p.y);
            ctx.lineTo(pts[pts.length - 1].x, level);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
          };
          if (cfg.obFill) zone(yUp * vr, y100 * vr, cfg.obColor, true);
          if (cfg.osFill) zone(yLo * vr, y0 * vr, cfg.osColor, false);
        }
      }
      ctx.restore();
    });
  }
}
