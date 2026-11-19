import type { DataHub } from '../core/store';
import type { DayTicker } from '../providers/provider';
import { formatPrice } from '../chart/format';

// Lista lateral de símbolos con último precio, cambio y % del día.

export class Watchlist {
  private symbols: string[] = [];
  private rows = new Map<string, HTMLElement>();
  private unsubs = new Map<string, () => void>();
  private active = '';
  private listEl: HTMLDivElement;

  constructor(
    private root: HTMLElement,
    private hub: DataHub,
    private onSelect: (symbol: string) => void,
    private onChange: (symbols: string[]) => void,
  ) {
    root.innerHTML = `
      <div class="wl-title">Lista de seguimiento</div>
      <div class="wl-row wl-cols"><span>Símbolo</span><span>Último<i class="wl-rs" data-c="2"></i></span><span>Cambio<i class="wl-rs" data-c="3"></i></span><span>%<i class="wl-rs" data-c="4"></i></span><span></span></div>
      <div class="wl-list"></div>
      <form class="wl-add"><input placeholder="Añadir símbolo (p. ej. ETHUSDT)" spellcheck="false" autocapitalize="characters"><button>+</button></form>
      <div class="wl-msg dim"></div>`;
    this.listEl = root.querySelector('.wl-list')!;
    this.installColumnResize();
    const form = root.querySelector('form')!;
    const input = form.querySelector('input')!;
    const msg = root.querySelector('.wl-msg') as HTMLElement;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const s = input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!s) return;
      if (this.symbols.includes(s)) {
        msg.textContent = `${s} ya está en la lista`;
        return;
      }
      msg.textContent = 'Comprobando…';
      try {
        if (this.hub.provider.supportsSymbol(s)) await this.hub.provider.getSymbolInfo(s);
        this.setSymbols([...this.symbols, s]);
        this.onChange(this.symbols);
        input.value = '';
        msg.textContent = '';
      } catch (err) {
        msg.textContent = `No encuentro ${s} en ${this.hub.provider.label}`;
      }
    };
  }

  /** Columnas ajustables arrastrando su borde izquierdo en la cabecera (se recuerda en este equipo). */
  private installColumnResize() {
    const KEY = 'wlCols';
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) for (const k of ['2', '3', '4']) if (saved[k]) this.root.style.setProperty(`--c${k}`, `${saved[k]}px`);
    } catch {
      /* sin almacenamiento */
    }
    this.root.querySelectorAll<HTMLElement>('.wl-rs').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const c = h.dataset.c!;
        const startX = e.clientX;
        const startW = (h.parentElement as HTMLElement).getBoundingClientRect().width;
        h.classList.add('drag');
        document.body.classList.add('resizing');
        const move = (ev: PointerEvent) => {
          const w = Math.max(30, Math.min(220, Math.round(startW - (ev.clientX - startX))));
          this.root.style.setProperty(`--c${c}`, `${w}px`);
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          h.classList.remove('drag');
          document.body.classList.remove('resizing');
          const out: Record<string, number> = {};
          for (const k of ['2', '3', '4']) out[k] = parseInt(getComputedStyle(this.root).getPropertyValue(`--c${k}`)) || 0;
          try {
            localStorage.setItem(KEY, JSON.stringify(out));
          } catch {
            /* sin almacenamiento */
          }
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
  }

  setSymbols(list: string[]) {
    this.symbols = [...list];
    for (const [s, un] of this.unsubs) {
      if (!list.includes(s)) {
        un();
        this.unsubs.delete(s);
        this.rows.delete(s);
      }
    }
    this.listEl.innerHTML = '';
    for (const s of list) {
      let row = this.rows.get(s);
      if (!row) {
        row = document.createElement('div');
        row.className = 'wl-row';
        row.innerHTML = `<span class="wl-sym"></span><span class="wl-last">…</span><span class="wl-ch"></span><span class="wl-pct"></span><button class="wl-del" title="Quitar de la lista">✕</button>`;
        row.querySelector('.wl-sym')!.textContent = s;
        const supported = this.hub.provider.supportsSymbol(s);
        row.onclick = (e) => {
          if ((e.target as HTMLElement).classList.contains('wl-del')) return;
          if (supported) this.onSelect(s);
        };
        row.querySelector('.wl-del')!.addEventListener('click', () => {
          this.setSymbols(this.symbols.filter((x) => x !== s));
          this.onChange(this.symbols);
        });
        this.rows.set(s, row);
        const r = row;
        if (!supported) {
          r.classList.add('wl-pending');
          r.title = 'Sin datos todavía: oro, plata y acciones llegan en la fase 4';
          r.querySelector('.wl-last')!.textContent = '—';
          this.unsubs.set(s, () => {});
          row.classList.toggle('active', s === this.active);
          this.listEl.appendChild(row);
          continue;
        }
        let precision = 2;
        this.hub.provider
          .getSymbolInfo(s)
          .then((i) => (precision = i.precision))
          .catch((e) => {
            // Sólo se tacha si el proveedor dice que el símbolo no existe (no por un fallo de red).
            if (e instanceof Error && /no encontrado|Invalid symbol|Binance:/i.test(e.message)) r.classList.add('wl-bad');
          });
        this.unsubs.set(
          s,
          this.hub.provider.subscribeDayTicker(s, (t) => this.paint(r, t, precision)),
        );
      }
      row.classList.toggle('active', s === this.active);
      this.listEl.appendChild(row);
    }
  }

  setActive(symbol: string) {
    this.active = symbol;
    for (const [s, row] of this.rows) row.classList.toggle('active', s === symbol);
  }

  private paint(row: HTMLElement, t: DayTicker, precision: number) {
    const ch = t.last - t.dayOpen;
    const pct = t.dayOpen ? (ch / t.dayOpen) * 100 : 0;
    const cls = ch > 0 ? 'up' : ch < 0 ? 'down' : '';
    const lastEl = row.querySelector('.wl-last') as HTMLElement;
    const prev = parseFloat(lastEl.dataset.v || 'NaN');
    lastEl.textContent = formatPrice(t.last, precision);
    lastEl.dataset.v = String(t.last);
    if (!Number.isNaN(prev) && prev !== t.last) {
      lastEl.classList.remove('flash-up', 'flash-down');
      void lastEl.offsetWidth;
      lastEl.classList.add(t.last > prev ? 'flash-up' : 'flash-down');
    }
    const chEl = row.querySelector('.wl-ch') as HTMLElement;
    const pctEl = row.querySelector('.wl-pct') as HTMLElement;
    chEl.textContent = (ch > 0 ? '+' : '') + formatPrice(ch, precision);
    pctEl.textContent = (pct > 0 ? '+' : '') + formatPrice(pct, 2) + '%';
    chEl.className = 'wl-ch ' + cls;
    pctEl.className = 'wl-pct ' + cls;
  }
}
