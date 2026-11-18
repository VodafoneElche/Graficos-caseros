import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  ISeriesPrimitiveAxisView,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts';
import type { CanvasRenderingTarget2D } from 'fancy-canvas';
import type { Drawing, FibExt, LineStyleId } from '../core/types';

// Dibuja los dibujos del usuario: líneas horizontales y verticales (con grosor
// desde 0,5 px) y la extensión de Fibonacci en función de la tendencia.
// También pone sus etiquetas en el eje de precios (horizontales) y en el de tiempo (verticales).

export interface DrawingsHost {
  items(): Drawing[];
  selectedId(): string | null;
  /** Coordenada X (px CSS) de un instante, aunque no coincida con el inicio de una vela. */
  timeToX(t: number): number | null;
  formatPrice(p: number): string;
  formatTime(t: number): string;
}

/** Precio de un nivel de la extensión de Fibonacci: C + (B − A) × nivel. */
export function fibExtPrice(d: FibExt, level: number): number {
  const [a, b, c] = d.points;
  return c.price + (b.price - a.price) * level;
}

function textColorFor(bg: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(bg.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff';
}

function dash(style: LineStyleId, r: number): number[] {
  if (style === 1) return [1.5 * r, 2.5 * r];
  if (style === 2) return [6 * r, 4 * r];
  return [];
}

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export class DrawingsPrimitive implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private requestUpdate: (() => void) | null = null;
  private view: IPrimitivePaneView;

  constructor(private host: DrawingsHost) {
    const renderer: IPrimitivePaneRenderer = { draw: (t) => this.draw(t as unknown as CanvasRenderingTarget2D) };
    this.view = { zOrder: () => 'top', renderer: () => renderer };
  }

  attached(p: SeriesAttachedParameter<Time>) {
    this.series = p.series as ISeriesApi<SeriesType>;
    this.requestUpdate = p.requestUpdate;
  }

  detached() {
    this.series = null;
    this.requestUpdate = null;
  }

  update() {
    this.requestUpdate?.();
  }

  updateAllViews() {}

  paneViews() {
    return [this.view];
  }

  priceAxisViews(): ISeriesPrimitiveAxisView[] {
    const s = this.series;
    if (!s) return [];
    const out: ISeriesPrimitiveAxisView[] = [];
    for (const d of this.host.items()) {
      if (d.type !== 'hline') continue;
      const y = s.priceToCoordinate(d.price);
      if (y == null) continue;
      out.push({
        coordinate: () => y,
        text: () => this.host.formatPrice(d.price),
        textColor: () => textColorFor(d.color),
        backColor: () => d.color,
        visible: () => true,
        tickVisible: () => true,
      });
    }
    return out;
  }

  timeAxisViews(): ISeriesPrimitiveAxisView[] {
    const out: ISeriesPrimitiveAxisView[] = [];
    for (const d of this.host.items()) {
      if (d.type !== 'vline') continue;
      const x = this.host.timeToX(d.time);
      if (x == null) continue;
      out.push({
        coordinate: () => x,
        text: () => this.host.formatTime(d.time),
        textColor: () => textColorFor(d.color),
        backColor: () => d.color,
        visible: () => true,
        tickVisible: () => true,
      });
    }
    return out;
  }

  private draw(target: CanvasRenderingTarget2D) {
    const s = this.series;
    if (!s) return;
    const items = this.host.items();
    if (!items.length) return;
    const sel = this.host.selectedId();
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr, bitmapSize }) => {
      ctx.save();
      // Grosor real (admite 0,5 px). Con grosores enteros impares se alinea al píxel para que quede nítido.
      const setLine = (color: string, width: number, style: LineStyleId, r: number) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(0.5, width) * r;
        ctx.setLineDash(dash(style, r));
      };
      const crisp = (v: number, width: number, r: number) => {
        const lw = Math.max(0.5, width) * r;
        const rounded = Math.round(v);
        return lw >= 1 && Math.round(lw) % 2 === 1 ? rounded + 0.5 : rounded;
      };
      const handle = (x: number, y: number, color: string) => {
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(x, y, 4.5 * hr, 0, Math.PI * 2);
        ctx.fillStyle = '#000d2e';
        ctx.fill();
        ctx.lineWidth = 1.5 * hr;
        ctx.strokeStyle = color;
        ctx.stroke();
      };

      for (const d of items) {
        const selected = d.id === sel;
        if (d.type === 'hline') {
          const y0 = s.priceToCoordinate(d.price);
          if (y0 == null) continue;
          const y = crisp(y0 * vr, d.width, vr);
          setLine(d.color, d.width, d.style, vr);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(bitmapSize.width, y);
          ctx.stroke();
          if (selected) handle(bitmapSize.width / 2, y, d.color);
        } else if (d.type === 'vline') {
          const x0 = this.host.timeToX(d.time);
          if (x0 == null) continue;
          const x = crisp(x0 * hr, d.width, hr);
          setLine(d.color, d.width, d.style, hr);
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, bitmapSize.height);
          ctx.stroke();
          if (selected) handle(x, bitmapSize.height / 2, d.color);
        } else if (d.type === 'fibext') {
          this.drawFib(ctx, d, selected, hr, vr, bitmapSize.width, setLine, crisp, handle);
        }
      }
      ctx.restore();
    });
  }

  private drawFib(
    ctx: CanvasRenderingContext2D,
    d: FibExt,
    selected: boolean,
    hr: number,
    vr: number,
    W: number,
    setLine: (c: string, w: number, st: LineStyleId, r: number) => void,
    crisp: (v: number, w: number, r: number) => number,
    handle: (x: number, y: number, c: string) => void,
  ) {
    const s = this.series!;
    const pts = d.points.map((p) => {
      const x = this.host.timeToX(p.time);
      const y = s.priceToCoordinate(p.price);
      return x == null || y == null ? null : { x: x * hr, y: y * vr };
    });
    if (pts.some((p) => !p)) return;
    const [A, B, C] = pts as { x: number; y: number }[];

    // Línea de tendencia A → B → C.
    if (d.trendLine) {
      setLine(d.trendColor, 1, d.trendStyle, hr);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(B.x, B.y);
      if (d.points.length > 2) ctx.lineTo(C.x, C.y);
      ctx.stroke();
    }

    // Niveles: entre la X del punto B y la del punto C (como TradingView sin ampliar).
    const xa = Math.min(B.x, C.x);
    const xb = Math.max(B.x, C.x);
    const x1 = d.extend === 'left' || d.extend === 'both' ? 0 : xa;
    const x2 = d.extend === 'right' || d.extend === 'both' ? W : xb;
    const on = d.levels.filter((l) => l.on).sort((a, b) => a.value - b.value);
    const ys = on.map((l) => s.priceToCoordinate(fibExtPrice(d, l.value)));
    if (d.background) {
      for (let k = 0; k + 1 < on.length; k++) {
        const ya = ys[k];
        const yb = ys[k + 1];
        if (ya == null || yb == null) continue;
        ctx.fillStyle = hexToRgba(on[k + 1].color, 0.12);
        ctx.fillRect(x1, Math.min(ya, yb) * vr, x2 - x1, Math.abs(yb - ya) * vr);
      }
    }
    ctx.font = `${Math.round(12 * vr)}px -apple-system, Segoe UI, Roboto, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    on.forEach((l, k) => {
      const y0 = ys[k];
      if (y0 == null) return;
      const y = crisp(y0 * vr, d.levelsWidth, vr);
      setLine(l.color, d.levelsWidth, d.levelsStyle, hr);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      ctx.stroke();
      if (d.showLabels || d.showPrices) {
        const val = l.value.toLocaleString('es-ES', { maximumFractionDigits: 3 });
        const price = this.host.formatPrice(fibExtPrice(d, l.value));
        const txt = d.showLabels && d.showPrices ? `${val} (${price})` : d.showLabels ? val : price;
        ctx.fillStyle = l.color;
        ctx.fillText(txt, x2 + 6 * hr, y);
      }
    });

    if (selected) d.points.forEach((_, k) => handle(pts[k]!.x, pts[k]!.y, '#2962ff'));
  }
}
