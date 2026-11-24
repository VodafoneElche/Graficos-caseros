import type { Shape } from '../core/types';

// Geometría de las formas (en píxeles CSS del gráfico), compartida entre el
// dibujo (DrawingsPrimitive) y la detección del ratón (ChartPanel).

export type Pt = { x: number; y: number };

export const SHAPE_FONT = '-apple-system, Segoe UI, Roboto, sans-serif';
/** Largo del palito de la "nota con poste". */
export const NOTE_STEM = 36;

/** Segmento A→B ampliado hasta salirse del gráfico por el lado pedido. */
export function extendSegment(a: Pt, b: Pt, extend: Shape['extend'], W: number, H: number): [Pt, Pt] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len || !extend || extend === 'none') return [a, b];
  const k = ((W + H) * 4) / len;
  const left = extend === 'left' || extend === 'both';
  const right = extend === 'right' || extend === 'both';
  // "Izquierda/derecha" en el sentido del tiempo: el punto más a la izquierda es el que se alarga a la izquierda.
  const [p, q] = a.x <= b.x ? [a, b] : [b, a];
  const ux = (q.x - p.x) / len;
  const uy = (q.y - p.y) / len;
  const P = left ? { x: p.x - ux * k * len, y: p.y - uy * k * len } : p;
  const Q = right ? { x: q.x + ux * k * len, y: q.y + uy * k * len } : q;
  return [P, Q];
}

export function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / L)) : 0;
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy));
}

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, font: string): number {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * 7;
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

export function shapeLines(d: Shape): string[] {
  const t = (d.text ?? '').trim() ? d.text! : 'Texto';
  return t.split('\n');
}

/** Cuadro de texto de una nota o comentario, anclado en (ax, ay). */
export function textBox(d: Shape, ax: number, ay: number): { x: number; y: number; w: number; h: number; lines: string[]; fs: number; lh: number; padX: number; padY: number } {
  const fs = d.fontSize ?? 12;
  const font = `${fs}px ${SHAPE_FONT}`;
  const lines = shapeLines(d);
  const lh = Math.round(fs * 1.3);
  const padX = 8;
  const padY = 5;
  const w = Math.max(...lines.map((l) => measure(l, font))) + padX * 2;
  const h = lines.length * lh + padY * 2;
  if (d.type === 'note') return { x: ax - w / 2, y: ay - NOTE_STEM - h, w, h, lines, fs, lh, padX, padY };
  // Comentario: la esquina de abajo a la izquierda (en pico) toca el punto.
  return { x: ax, y: ay - h, w, h, lines, fs, lh, padX, padY };
}

/** Las 4 esquinas del rectángulo: 0 y 1 son los puntos guardados; 2 = (x0, y1); 3 = (x1, y0). */
export function rectCorners(a: Pt, b: Pt): Pt[] {
  return [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }];
}
