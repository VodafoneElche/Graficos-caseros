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
import type { TwoYmaCfg } from '../core/types';
import type { Values } from '../indicators/indicators';

// Fondos del indicador 2YMA: verde azulado entre el precio y la media de 2 años
// cuando el precio está por DEBAJO de ella (zona barata) y rojo entre el precio y
// la media x 5 cuando está por ENCIMA (zona cara).

export class TwoYmaFill implements ISeriesPrimitive<Time> {
  private chart: IChartApi | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private cfg: TwoYmaCfg | null = null;
  private close: number[] = [];
  private ma: Values = [];
  private x5: Values = [];
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

  setStyle(cfg: TwoYmaCfg | null) {
    this.cfg = cfg;
    this.requestUpdate?.();
  }

  setData(close: number[], ma: Values, x5: Values) {
    this.close = close;
    this.ma = ma;
    this.x5 = x5;
    this.requestUpdate?.();
  }

  updateAllViews() {}

  paneViews() {
    return [this.view];
  }

  private draw(target: CanvasRenderingTarget2D) {
    const cfg = this.cfg;
    if (!cfg || !this.chart || !this.series || !this.close.length) return;
    const ts = this.chart.timeScale();
    const s = this.series;
    const range = ts.getVisibleLogicalRange();
    if (!range) return;
    const from = Math.max(0, Math.floor(range.from) - 1);
    const to = Math.min(this.close.length - 1, Math.ceil(range.to) + 1);
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
      const band = (other: Values, cond: (c: number, o: number) => boolean, color: string) => {
        ctx.fillStyle = color;
        for (let i = from; i < to; i++) {
          const c1 = this.close[i];
          const c2 = this.close[i + 1];
          const o1 = other[i];
          const o2 = other[i + 1];
          if (o1 == null || o2 == null || !cond(c1, o1) || !cond(c2, o2)) continue;
          const xa = ts.logicalToCoordinate(i as any);
          const xb = ts.logicalToCoordinate((i + 1) as any);
          const ya = s.priceToCoordinate(c1);
          const yb = s.priceToCoordinate(c2);
          const za = s.priceToCoordinate(o1);
          const zb = s.priceToCoordinate(o2);
          if (xa == null || xb == null || ya == null || yb == null || za == null || zb == null) continue;
          ctx.beginPath();
          ctx.moveTo(xa * hr, ya * vr);
          ctx.lineTo(xb * hr, yb * vr);
          ctx.lineTo(xb * hr, zb * vr);
          ctx.lineTo(xa * hr, za * vr);
          ctx.closePath();
          ctx.fill();
        }
      };
      band(this.ma, (c, o) => c < o, cfg.fillLow);
      band(this.x5, (c, o) => c > o, cfg.fillHigh);
    });
  }
}
