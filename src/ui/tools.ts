// Herramienta de dibujo activa.

export type Tool =
  | 'none' | 'hline' | 'vline' | 'fibext' | 'fib' | 'long' | 'short' | 'measure'
  | 'trend' | 'rect' | 'path' | 'note' | 'comment';

/** Herramientas que crean una forma (`Shape`). */
export const SHAPE_TOOLS = ['trend', 'rect', 'path', 'note', 'comment'] as const;
export function isShapeTool(t: Tool): t is (typeof SHAPE_TOOLS)[number] {
  return (SHAPE_TOOLS as readonly string[]).includes(t);
}

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
