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

// Regla de medir (como la de TradingView): caja azul si sube, roja si baja,
// con la variación de precio, %, ticks, número de barras, tiempo y volumen.

export interface Measure {
  i1: number; // índice de vela (lógico) de inicio
  p1: number;
  i2: number;
  p2: number;
}

export interface MeasureInfo {
  lines: string[];
}

export class MeasurePrimitive implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private m: Measure | null = null;
  private info: MeasureInfo = { lines: [] };
  private view: IPrimitivePaneView;

  constructor() {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t as unknown as CanvasRenderingTarget2D) };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
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

  set(m: Measure | null, info?: MeasureInfo) {
    this.m = m;
    if (info) this.info = info;
    this.requestUpdate?.();
  }

  get value(): Measure | null {
    return this.m;
  }

  updateAllViews() {}

  paneViews() {
    return [this.view];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const m = this.m;
    if (!m || !this.chart || !this.series) return;
    const ts = this.chart.timeScale();
    const xa = ts.logicalToCoordinate(m.i1 as any);
    const xb = ts.logicalToCoordinate(m.i2 as any);
    const ya = this.series.priceToCoordinate(m.p1);
    const yb = this.series.priceToCoordinate(m.p2);
    if (xa == null || xb == null || ya == null || yb == null) return;
    const up = m.p2 >= m.p1;
    const fill = up ? 'rgba(41,98,255,0.22)' : 'rgba(242,54,69,0.22)';
    const stroke = up ? '#2962ff' : '#f23645';
    const labelBg = up ? '#2962ff' : '#f23645';

    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      ctx.save();
      const x1 = Math.round(Math.min(xa, xb) * hr);
      const x2 = Math.round(Math.max(xa, xb) * hr);
      const y1 = Math.round(Math.min(ya, yb) * vr);
      const y2 = Math.round(Math.max(ya, yb) * vr);
      ctx.fillStyle = fill;
      ctx.fillRect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1));

      // Flechas por el centro (horizontal en el sentido del tiempo, vertical en el del precio).
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, Math.round(hr));
      const cx = Math.round(((xa + xb) / 2) * hr) + 0.5;
      const cy = Math.round(((ya + yb) / 2) * vr) + 0.5;
      const ax2 = Math.round(xb * hr);
      const ay2 = Math.round(yb * vr);
      ctx.beginPath();
      ctx.moveTo(Math.round(xa * hr), cy);
      ctx.lineTo(ax2, cy);
      ctx.moveTo(cx, Math.round(ya * vr));
      ctx.lineTo(cx, ay2);
      ctx.stroke();
      const head = 6 * hr;
      const dx = xb >= xa ? -1 : 1;
      const dy = yb >= ya ? -1 : 1;
      if (Math.abs(x2 - x1) > head * 2) {
        ctx.beginPath();
        ctx.moveTo(ax2 + dx * head, cy - head * 0.7);
        ctx.lineTo(ax2, cy);
        ctx.lineTo(ax2 + dx * head, cy + head * 0.7);
        ctx.stroke();
      }
      if (Math.abs(y2 - y1) > head * 2) {
        ctx.beginPath();
        ctx.moveTo(cx - head * 0.7, ay2 + dy * head);
        ctx.lineTo(cx, ay2);
        ctx.lineTo(cx + head * 0.7, ay2 + dy * head);
        ctx.stroke();
      }

      // Etiqueta con los datos, debajo de la caja si baja y encima si sube.
      const lines = this.info.lines;
      if (lines.length) {
        const fs = Math.round(12 * vr);
        ctx.font = `${fs}px -apple-system, Segoe UI, Roboto, sans-serif`;
        const padX = 10 * hr;
        const padY = 6 * vr;
        const lh = Math.round(fs * 1.45);
        const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
        const h = lines.length * lh + padY * 2;
        let lx = cx - w / 2;
        let ly = up ? y1 - h - 8 * vr : y2 + 8 * vr;
        const W = ctx.canvas.width;
        const H = ctx.canvas.height;
        lx = Math.max(2, Math.min(W - w - 2, lx));
        ly = Math.max(2, Math.min(H - h - 2, ly));
        ctx.fillStyle = labelBg;
        const r = 4 * hr;
        ctx.beginPath();
        ctx.moveTo(lx + r, ly);
        ctx.arcTo(lx + w, ly, lx + w, ly + h, r);
        ctx.arcTo(lx + w, ly + h, lx, ly + h, r);
        ctx.arcTo(lx, ly + h, lx, ly, r);
        ctx.arcTo(lx, ly, lx + w, ly, r);
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        lines.forEach((l, k) => ctx.fillText(l, lx + w / 2, ly + padY + lh * k + lh / 2));
      }
      ctx.restore();
    });
  }
}
