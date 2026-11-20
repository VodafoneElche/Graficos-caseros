import type { DataHub } from '../core/store';
import type { DayTicker } from '../providers/provider';
import { formatPrice } from '../chart/format';

type ColKey = 'last' | 'ch' | 'pct';
const COLS: ColKey[] = ['last', 'ch', 'pct'];

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
      <div class="wl-row wl-cols"><span class="wl-h-sym">Símbolo</span><span class="wl-h" data-k="last" title="Arrastra para cambiar el orden de las columnas">Último<i class="wl-rs" data-k="last"></i></span><span class="wl-h" data-k="ch" title="Arrastra para cambiar el orden de las columnas">Cambio<i class="wl-rs" data-k="ch"></i></span><span class="wl-h" data-k="pct" title="Arrastra para cambiar el orden de las columnas">%<i class="wl-rs" data-k="pct"></i></span><span class="wl-h-end"></span></div>
      <div class="wl-list"></div>
      <form class="wl-add"><input placeholder="Añadir símbolo (p. ej. ETHUSDT, AAPL)" spellcheck="false" autocapitalize="characters"><button>+</button></form>
      <div class="wl-msg dim"></div>`;
    this.listEl = root.querySelector('.wl-list')!;
    this.installColumns();
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
        const src = this.hub.provider.sourceLabel?.(s) ?? this.hub.provider.label;
        msg.textContent = err instanceof Error && /Faltan/.test(err.message) ? err.message : `No encuentro ${s} en ${src}`;
      }
    };
  }

  // ---- Columnas: ancho (arrastrar el borde) y orden (arrastrar el título). Se recuerda en este equipo.
  private colOrder: ColKey[] = ['last', 'ch', 'pct'];
  private colW: Record<ColKey, number> = { last: 82, ch: 66, pct: 60 };

  private loadCols() {
    try {
      const w = JSON.parse(localStorage.getItem('wlCols') || 'null');
      if (w) {
        // Formato antiguo (v0.2.0): por posición 2/3/4.
        if (w['2']) Object.assign(w, { last: w['2'], ch: w['3'], pct: w['4'] });
        for (const k of COLS) if (w[k] > 0) this.colW[k] = w[k];
      }
      const o = JSON.parse(localStorage.getItem('wlOrder') || 'null');
      if (Array.isArray(o) && o.length === 3 && COLS.every((k) => o.includes(k))) this.colOrder = o;
    } catch {
      /* sin almacenamiento */
    }
  }

  private saveCols() {
    try {
      localStorage.setItem('wlCols', JSON.stringify(this.colW));
      localStorage.setItem('wlOrder', JSON.stringify(this.colOrder));
    } catch {
      /* sin almacenamiento */
    }
  }

  private applyCols() {
    const st = this.root.style;
    this.colOrder.forEach((k, i) => {
      st.setProperty(`--o-${k}`, String(i + 1));
      st.setProperty(`--c${i + 2}`, `${this.colW[k]}px`);
    });
  }

  private installColumns() {
    this.loadCols();
    this.applyCols();
    // Ancho: borde izquierdo de cada título.
    this.root.querySelectorAll<HTMLElement>('.wl-rs').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const k = h.dataset.k as ColKey;
        const startX = e.clientX;
        const startW = this.colW[k];
        h.classList.add('drag');
        document.body.classList.add('resizing');
        const move = (ev: PointerEvent) => {
          this.colW[k] = Math.max(30, Math.min(220, Math.round(startW - (ev.clientX - startX))));
          this.applyCols();
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          h.classList.remove('drag');
          document.body.classList.remove('resizing');
          this.saveCols();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
    // Orden: arrastrar el título a izquierda o derecha.
    const head = this.root.querySelector('.wl-cols') as HTMLElement;
    head.querySelectorAll<HTMLElement>('.wl-h').forEach((h) => {
      h.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const k = h.dataset.k as ColKey;
        const startX = e.clientX;
        let dragging = false;
        let target = this.colOrder.indexOf(k);
        const marker = document.createElement('div');
        marker.className = 'wl-colmark';
        const move = (ev: PointerEvent) => {
          if (!dragging && Math.abs(ev.clientX - startX) < 5) return;
          if (!dragging) {
            dragging = true;
            h.classList.add('wl-moving');
            document.body.classList.add('moving-col');
            head.appendChild(marker);
          }
          // Hueco más cercano entre columnas (0 = antes de la primera).
          const rects = this.colOrder.map((c) => (head.querySelector(`.wl-h[data-k="${c}"]`) as HTMLElement).getBoundingClientRect());
          const edges = [rects[0].left, ...rects.map((r) => r.right)];
          let best = 0;
          edges.forEach((x, i) => {
            if (Math.abs(ev.clientX - x) < Math.abs(ev.clientX - edges[best])) best = i;
          });
          target = best;
          const hr = head.getBoundingClientRect();
          marker.style.left = `${edges[best] - hr.left - 1}px`;
        };
        const up = () => {
          window.removeEventListener('pointermove', move);
          window.removeEventListener('pointerup', up);
          if (!dragging) return;
          h.classList.remove('wl-moving');
          document.body.classList.remove('moving-col');
          marker.remove();
          const from = this.colOrder.indexOf(k);
          const order = this.colOrder.filter((c) => c !== k);
          order.splice(target > from ? target - 1 : target, 0, k);
          this.colOrder = order;
          this.applyCols();
          this.saveCols();
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    });
  }

  // ---- Filas: arrastrar un símbolo arriba o abajo para cambiar su posición.
  private suppressClick = false;

  private installRowDrag(row: HTMLElement, s: string) {
    row.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || (e.target as HTMLElement).classList.contains('wl-del')) return;
      const startY = e.clientY;
      let dragging = false;
      let target = this.symbols.indexOf(s);
      const marker = document.createElement('div');
      marker.className = 'wl-rowmark';
      const move = (ev: PointerEvent) => {
        if (!dragging && Math.abs(ev.clientY - startY) < 5) return;
        if (!dragging) {
          dragging = true;
          row.classList.add('wl-moving');
          document.body.classList.add('moving-row');
          this.listEl.appendChild(marker);
        }
        ev.preventDefault();
        const rows = this.symbols.map((x) => this.rows.get(x)!).filter(Boolean);
        const lr = this.listEl.getBoundingClientRect();
        // Desplaza la lista sola si se arrastra cerca del borde.
        if (ev.clientY < lr.top + 20) this.listEl.scrollTop -= 12;
        else if (ev.clientY > lr.bottom - 20) this.listEl.scrollTop += 12;
        let idx = rows.length;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i].getBoundingClientRect();
          if (ev.clientY < r.top + r.height / 2) {
            idx = i;
            break;
          }
        }
        target = idx;
        const y = idx < rows.length ? rows[idx].offsetTop : rows[rows.length - 1].offsetTop + rows[rows.length - 1].offsetHeight;
        marker.style.top = `${y - 1}px`;
      };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (!dragging) return;
        row.classList.remove('wl-moving');
        document.body.classList.remove('moving-row');
        marker.remove();
        this.suppressClick = true;
        setTimeout(() => (this.suppressClick = false), 0);
        const from = this.symbols.indexOf(s);
        const list = this.symbols.filter((x) => x !== s);
        list.splice(target > from ? target - 1 : target, 0, s);
        if (list.join() !== this.symbols.join()) {
          this.setSymbols(list);
          this.onChange(this.symbols);
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
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
        row.title = 'Clic: abrir · Arrastrar: cambiar de posición';
        this.installRowDrag(row, s);
        row.onclick = (e) => {
          if (this.suppressClick) return;
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
          r.title = 'No sé de qué fuente sacar los datos de este símbolo';
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
            if (e instanceof Error && /Faltan/.test(e.message)) r.title = e.message;
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
