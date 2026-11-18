// Herramienta de dibujo activa (de momento sólo "línea horizontal").

export type Tool = 'none' | 'hline' | 'measure';

class ToolState {
  active: Tool = 'none';
  private listeners = new Set<(t: Tool) => void>();

  set(t: Tool) {
    this.active = t;
    this.listeners.forEach((l) => l(t));
  }

  toggle(t: Tool) {
    this.set(this.active === t ? 'none' : t);
  }

  subscribe(fn: (t: Tool) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const tools = new ToolState();
