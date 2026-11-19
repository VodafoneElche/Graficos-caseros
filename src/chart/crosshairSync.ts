import type { ChartPanel } from './chartPanel';

// Cruz sincronizada: al mover el ratón en un gráfico, los demás muestran la cruz en
// el mismo precio y en la vela que contiene ese instante (cada uno con su temporalidad).

export class CrosshairSync {
  private panels = new Set<ChartPanel>();

  register(p: ChartPanel) {
    this.panels.add(p);
  }

  unregister(p: ChartPanel) {
    this.panels.delete(p);
  }

  move(src: ChartPanel, time: number | null, price: number | null) {
    for (const p of this.panels) {
      if (p === src) continue;
      if (time == null) p.clearCrosshair();
      else p.showCrosshair(time, price);
    }
  }
}
