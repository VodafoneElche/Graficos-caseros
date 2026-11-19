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
import type { Drawing, FibExt, LineStyleId, Position } from '../core/types';

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
  /** Dibujo bajo el ratón (las estadísticas de la posición se ven al pasar por encima). */
  hoveredId(): string | null;
  /** Último precio (para la ganancia/pérdida abierta de la posición). */
  lastPrice(): number | null;
  /** ¿La línea tiene una alerta activa? (se pinta un despertador sobre ella) */
  hasAlert?(id: string): boolean;
}

/**
 * Precio de un nivel de Fibonacci.
 * Extensión: C + (B − A) × nivel. Retroceso: B + (A − B) × nivel (1 en A, 0 en B).
 */
export function fibExtPrice(d: FibExt, level: number): number {
  const [a, b, c] = d.points;
  if (d.type === 'fib') return b.price + (a.price - b.price) * level;
  return c.price + (b.price - a.price) * level;
}

/** Tramo horizontal (px) de los niveles: entre B y C en la extensión, entre A y B en el retroceso. */
export function fibLevelXs(d: FibExt, xs: number[], W: number): [number, number] {
  const [p, q] = d.type === 'fib' ? [xs[0], xs[1]] : [xs[1], xs[2]];
  const xa = Math.min(p, q);
  const xb = Math.max(p, q);
  return [d.extend === 'left' || d.extend === 'both' ? 0 : xa, d.extend === 'right' || d.extend === 'both' ? W : xb];
}

/** Cálculos de la posición, como las estadísticas de TradingView. */
export function positionStats(d: Position, last: number | null) {
  const dir = d.side === 'long' ? 1 : -1;
  const riskPer = Math.abs(d.entry.price - d.stop);
  const rewardPer = Math.abs(d.target - d.entry.price);
  const riskAmount = d.riskUnit === '%' ? (d.account * d.risk) / 100 : d.risk;
  const qty = riskPer > 0 ? riskAmount / riskPer / (d.lot || 1) : 0;
  const units = qty * (d.lot || 1);
  return {
    qty,
    riskAmount,
    rewardAmount: units * rewardPer,
    rr: riskPer > 0 ? rewardPer / riskPer : 0,
    stopPct: d.entry.price ? (riskPer / d.entry.price) * 100 : 0,
    targetPct: d.entry.price ? (rewardPer / d.entry.price) * 100 : 0,
    riskPer,
    rewardPer,
    pnl: last == null ? null : (last - d.entry.price) * dir * units,
  };
}

const nf = (v: number, dec = 2) => v.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });

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
    const sel = this.host.selectedId();
    const push = (price: number, color: string) => {
      const y = s.priceToCoordinate(price);
      if (y == null) return;
      out.push({
        coordinate: () => y,
        text: () => this.host.formatPrice(price),
        textColor: () => textColorFor(color),
        backColor: () => color,
        visible: () => true,
        tickVisible: () => true,
      });
    };
    for (const d of this.host.items()) {
      if (d.type === 'hline') push(d.price, d.color);
      else if (d.type === 'position' && d.id === sel) {
        push(d.target, '#089981');
        push(d.entry.price, '#787b86');
        push(d.stop, '#f23645');
      }
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
          if (this.host.hasAlert?.(d.id)) {
            // Despertador junto al eje, como en TradingView.
            const cx = bitmapSize.width - 14 * hr;
            const r = 5 * vr;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.arc(cx, y, r + 2 * vr, 0, Math.PI * 2);
            ctx.fillStyle = '#000d2e';
            ctx.fill();
            ctx.lineWidth = 1.3 * hr;
            ctx.strokeStyle = d.color;
            ctx.beginPath();
            ctx.arc(cx, y, r, 0, Math.PI * 2);
            ctx.moveTo(cx, y - r * 0.6);
            ctx.lineTo(cx, y);
            ctx.lineTo(cx + r * 0.5, y + r * 0.3);
            ctx.stroke();
          }
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
        } else if (d.type === 'fibext' || d.type === 'fib') {
          this.drawFib(ctx, d, selected, hr, vr, bitmapSize.width, setLine, crisp, handle);
        } else if (d.type === 'position') {
          this.drawPosition(ctx, d, selected, hr, vr, bitmapSize.width, handle);
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
    const P = pts as { x: number; y: number }[];

    // Línea de tendencia A → B (→ C).
    if (d.trendLine) {
      setLine(d.trendColor, 1, d.trendStyle, hr);
      ctx.beginPath();
      ctx.moveTo(P[0].x, P[0].y);
      for (let k = 1; k < P.length; k++) ctx.lineTo(P[k].x, P[k].y);
      ctx.stroke();
    }

    // Niveles: extensión entre B y C; retroceso entre A y B (como TradingView sin ampliar).
    const [x1, x2] = fibLevelXs(d, P.map((p) => p.x), W);
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

  private drawPosition(
    ctx: CanvasRenderingContext2D,
    d: Position,
    selected: boolean,
    hr: number,
    vr: number,
    W: number,
    handle: (x: number, y: number, c: string) => void,
  ) {
    const s = this.series!;
    const xa = this.host.timeToX(d.entry.time);
    const xb = this.host.timeToX(d.endTime);
    const yE = s.priceToCoordinate(d.entry.price);
    const yS = s.priceToCoordinate(d.stop);
    const yT = s.priceToCoordinate(d.target);
    if (xa == null || xb == null || yE == null || yS == null || yT == null) return;
    const x1 = Math.min(xa, xb) * hr;
    const x2 = Math.max(xa, xb) * hr;
    const w = x2 - x1;
    const E = yE * vr;
    const S = yS * vr;
    const T = yT * vr;
    ctx.setLineDash([]);
    ctx.fillStyle = d.targetColor;
    ctx.fillRect(x1, Math.min(E, T), w, Math.abs(T - E));
    ctx.fillStyle = d.stopColor;
    ctx.fillRect(x1, Math.min(E, S), w, Math.abs(S - E));
    // Línea de entrada.
    ctx.strokeStyle = d.lineColor;
    ctx.lineWidth = Math.max(1, Math.round(hr));
    ctx.beginPath();
    ctx.moveTo(x1, Math.round(E) + 0.5);
    ctx.lineTo(x2, Math.round(E) + 0.5);
    ctx.stroke();

    const show = selected || d.alwaysStats || this.host.hoveredId() === d.id;
    if (show) {
      const st = positionStats(d, this.host.lastPrice());
      const fp = (v: number) => this.host.formatPrice(v);
      const qtyTxt = nf(st.qty, st.qty >= 100 ? 0 : st.qty >= 1 ? 2 : 4);
      const tgt = d.compact
        ? `Objetivo: ${fp(st.rewardPer)} (${nf(st.targetPct)}%) ${nf(st.rewardAmount)}`
        : `Objetivo: ${fp(st.rewardPer)} (${nf(st.targetPct)}%), Importe: ${nf(st.rewardAmount)}`;
      const stp = d.compact
        ? `Stop: ${fp(st.riskPer)} (${nf(st.stopPct)}%) ${nf(st.riskAmount)}`
        : `Stop: ${fp(st.riskPer)} (${nf(st.stopPct)}%), Importe: ${nf(st.riskAmount)}`;
      const mid: string[] = [];
      if (st.pnl != null) mid.push(`${d.compact ? 'P&L' : 'P&L abierta'}: ${nf(st.pnl)}`);
      mid.push(`Cantidad: ${qtyTxt}`);
      mid.push(`${d.compact ? 'R/B' : 'Ratio riesgo/beneficio'}: ${nf(st.rr)}`);
      const fs = Math.round(d.textSize * vr);
      ctx.font = `${fs}px -apple-system, Segoe UI, Roboto, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const box = (lines: string[], cx: number, cy: number, bg: string) => {
        const lh = fs * 1.35;
        const tw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 12 * hr;
        const th = lh * lines.length + 6 * vr;
        cx = Math.max(tw / 2 + 2, Math.min(W - tw / 2 - 2, cx)); // que no se salga del gráfico
        ctx.fillStyle = bg;
        ctx.beginPath();
        (ctx as any).roundRect ? (ctx as any).roundRect(cx - tw / 2, cy - th / 2, tw, th, 3 * hr) : ctx.rect(cx - tw / 2, cy - th / 2, tw, th);
        ctx.fill();
        ctx.fillStyle = d.textColor;
        lines.forEach((l, i) => ctx.fillText(l, cx, cy - th / 2 + 3 * vr + lh * (i + 0.5)));
        return th;
      };
      const cx = (x1 + x2) / 2;
      const off = (fs * 1.35 + 6 * vr) / 2 + 3 * vr;
      // Objetivo por fuera de su caja, stop por fuera de la suya; el resumen sobre la línea de entrada.
      const tOut = T < E ? T - off : T + off;
      const sOut = S < E ? S - off : S + off;
      box([tgt], cx, tOut, '#089981');
      box([stp], cx, sOut, '#f23645');
      box(mid, cx, E, d.side === 'long' ? 'rgba(8,153,129,0.9)' : 'rgba(242,54,69,0.9)');
    }

    if (selected) {
      handle(xa * hr, E, '#2962ff');
      handle(xa * hr, T, '#2962ff');
      handle(xa * hr, S, '#2962ff');
      handle(xb * hr, E, '#2962ff');
    }
  }
}
