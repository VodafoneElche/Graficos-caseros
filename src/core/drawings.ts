import { api } from '../api';
import type { HLine } from './types';

// Dibujos (de momento, líneas horizontales) del símbolo activo.
// Una sola lista compartida por los 6 gráficos: si mueves una línea en uno, se mueve en todos.
// Se guardan en el servidor y se vuelven a leer cada 20 s y al volver a la ventana,
// para ver los cambios hechos desde otro dispositivo.

type Listener = () => void;

export const LINE_COLORS = ['#ffeb3b', '#f23645', '#ff9800', '#089981', '#2962ff', '#7e57c2', '#ffffff', '#787b86'];

function newId(): string {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export class DrawingsStore {
  symbol = '';
  items: HLine[] = [];
  selectedId: string | null = null;
  dragging = false;
  lastColor = LINE_COLORS[0];
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

  get selected(): HLine | undefined {
    return this.items.find((d) => d.id === this.selectedId);
  }

  addHLine(price: number): HLine {
    const d: HLine = { id: newId(), symbol: this.symbol, type: 'hline', price, color: this.lastColor, width: 1, style: 0 };
    this.items = [...this.items, d];
    this.selectedId = d.id;
    this.emit();
    this.persist(d.id, 0);
    return d;
  }

  update(id: string, patch: Partial<HLine>, persistDelay = 400) {
    this.items = this.items.map((d) => (d.id === id ? { ...d, ...patch } : d));
    if (patch.color) this.lastColor = patch.color;
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
