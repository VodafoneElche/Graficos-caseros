import { api } from '../api';
import { fibDefaults, fibExtDefaults, positionDefaults, shapeDefaults } from './toolDefaults';
import type { Drawing, FibExt, HLine, Position, Shape, ShapeType, VLine } from './types';

// Dibujos del símbolo activo: líneas horizontales y verticales y extensiones de Fibonacci.
// Una sola lista compartida por los 6 gráficos: si mueves una línea en uno, se mueve en todos.
// Se guardan en el servidor y se vuelven a leer cada 20 s y al volver a la ventana,
// para ver los cambios hechos desde otro dispositivo.

type Listener = () => void;

export const LINE_COLORS = ['#ffeb3b', '#f23645', '#ff9800', '#089981', '#2962ff', '#7e57c2', '#ffffff', '#787b86'];

const SHAPE_STYLE_KEY = 'shapeStyles';
type ShapeStyle = Partial<Pick<Shape, 'color' | 'width' | 'style' | 'extend' | 'fill' | 'fillColor' | 'arrow' | 'textColor' | 'fontSize'>>;

function loadShapeStyles(): Partial<Record<ShapeType, ShapeStyle>> {
  try {
    return JSON.parse(localStorage.getItem(SHAPE_STYLE_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

function newId(): string {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export class DrawingsStore {
  symbol = '';
  items: Drawing[] = [];
  selectedId: string | null = null;
  dragging = false;
  lastColor = LINE_COLORS[0];
  lastWidth = 1;
  /** Último estilo usado en cada forma (la siguiente línea de tendencia sale igual que la anterior). */
  private shapeStyles = loadShapeStyles();
  private listeners = new Set<Listener>();
  private saveTimers = new Map<string, number>();
  private loadSeq = 0;

  constructor() {
    setInterval(() => this.refresh(), 20000);
    window.addEventListener('focus', () => this.refresh());
  }

  subscribe(fn: Listener) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  async setSymbol(symbol: string) {
    this.symbol = symbol;
    this.items = [];
    this.selectedId = null;
    this.emit();
    await this.refresh();
  }

  async refresh() {
    if (!this.symbol || this.dragging || this.saveTimers.size) return;
    const seq = ++this.loadSeq;
    const sym = this.symbol;
    try {
      const list = await api.listDrawings(sym);
      if (seq !== this.loadSeq || sym !== this.symbol || this.dragging || this.saveTimers.size) return;
      if (JSON.stringify(list) !== JSON.stringify(this.items)) {
        this.items = list;
        if (this.selectedId && !list.find((d) => d.id === this.selectedId)) this.selectedId = null;
        this.emit();
      }
    } catch {
      /* sin servidor: se mantiene lo que hay */
    }
  }

  get selected(): Drawing | undefined {
    return this.items.find((d) => d.id === this.selectedId);
  }

  private add(d: Drawing) {
    this.items = [...this.items, d];
    this.selectedId = d.id;
    this.emit();
    this.persist(d.id, 0);
    return d;
  }

  addHLine(price: number): HLine {
    return this.add({ id: newId(), symbol: this.symbol, type: 'hline', price, color: this.lastColor, width: this.lastWidth, style: 0 }) as HLine;
  }

  addVLine(time: number): VLine {
    return this.add({ id: newId(), symbol: this.symbol, type: 'vline', time, color: this.lastColor, width: this.lastWidth, style: 0 }) as VLine;
  }

  /** Crea una extensión ('fibext') o un retroceso ('fib') de Fibonacci (sin guardar hasta que se termine de dibujar). */
  addFib(kind: FibExt['type'], points: FibExt['points'], persist: boolean): FibExt {
    const defs = kind === 'fib' ? fibDefaults() : fibExtDefaults();
    const d: FibExt = { id: newId(), symbol: this.symbol, type: kind, points, ...defs };
    this.items = [...this.items, d];
    this.selectedId = d.id;
    this.emit();
    if (persist) this.persist(d.id, 0);
    return d;
  }

  addPosition(p: Pick<Position, 'side' | 'entry' | 'endTime' | 'stop' | 'target'>): Position {
    return this.add({ id: newId(), symbol: this.symbol, type: 'position', ...positionDefaults(), ...p }) as Position;
  }

  /** Crea una forma (línea de tendencia, rectángulo, trayectoria o nota). Sin guardar si `persist` es false (mientras se dibuja). */
  addShape(type: ShapeType, points: Shape['points'], persist: boolean, extra: Partial<Shape> = {}): Shape {
    const d: Shape = { id: newId(), symbol: this.symbol, type, points, ...shapeDefaults(type), ...this.shapeStyles[type], ...extra };
    this.items = [...this.items, d];
    this.selectedId = d.id;
    this.emit();
    if (persist) this.persist(d.id, 0);
    return d;
  }

  update(id: string, patch: Partial<Drawing>, persistDelay = 400) {
    this.items = this.items.map((d) => (d.id === id ? ({ ...d, ...patch } as Drawing) : d));
    const anyPatch = patch as any;
    const cur = this.items.find((d) => d.id === id);
    if (cur?.type === 'hline' || cur?.type === 'vline') {
      if (anyPatch.color) this.lastColor = anyPatch.color;
      if (anyPatch.width) this.lastWidth = anyPatch.width;
    } else if (cur && ['trend', 'rect', 'path', 'note', 'comment'].includes(cur.type)) {
      const keys = ['color', 'width', 'style', 'extend', 'fill', 'fillColor', 'arrow', 'textColor', 'fontSize'] as const;
      const st: any = { ...this.shapeStyles[cur.type as ShapeType] };
      let changed = false;
      for (const k of keys) if (k in anyPatch) ((st[k] = anyPatch[k]), (changed = true));
      if (changed) {
        this.shapeStyles[cur.type as ShapeType] = st;
        try {
          localStorage.setItem(SHAPE_STYLE_KEY, JSON.stringify(this.shapeStyles));
        } catch {
          /* sin almacenamiento */
        }
      }
    }
    this.emit();
    if (persistDelay >= 0) this.persist(id, persistDelay);
  }

  remove(id: string) {
    this.items = this.items.filter((d) => d.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    const t = this.saveTimers.get(id);
    if (t) clearTimeout(t);
    this.saveTimers.delete(id);
    this.emit();
    api.deleteDrawing(id).catch(() => {});
  }

  select(id: string | null) {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit();
  }

  persist(id: string, delay: number) {
    const prev = this.saveTimers.get(id);
    if (prev) clearTimeout(prev);
    this.saveTimers.set(
      id,
      window.setTimeout(async () => {
        this.saveTimers.delete(id);
        const d = this.items.find((x) => x.id === id);
        if (!d) return;
        try {
          await api.saveDrawing(d);
        } catch {
          /* el aviso de "sin servidor" ya se muestra arriba */
        }
      }, delay),
    );
  }
}
