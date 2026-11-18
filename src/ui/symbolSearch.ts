import type { DataProvider, SearchResult } from '../providers/provider';

// Buscador de símbolos como el de TradingView: caja de búsqueda, pestañas por tipo
// y lista de resultados con la fuente de datos a la derecha. Busca en todas las
// fuentes que tenga la app (de momento Binance; OANDA y acciones en la fase 4).

type Kind = 'all' | SearchResult['kind'];

const TABS: [Kind, string][] = [
  ['all', 'Todos'],
  ['crypto', 'Cripto'],
  ['stock', 'Acciones'],
  ['forex', 'Forex'],
  ['index', 'Índices'],
  ['commodity', 'Materias primas'],
];

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function openSymbolSearch(providers: DataProvider[], initial: string, onPick: (symbol: string) => void) {
  const dlg = document.createElement('dialog');
  dlg.className = 'symsearch';
  dlg.innerHTML = `
    <div class="ss-head">
      <svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7.5" cy="7.5" r="5"/><path d="M11.2 11.2 16 16"/></svg>
      <input class="ss-input" spellcheck="false" autocomplete="off" placeholder="Símbolo, p. ej. ETHUSDT" />
      <button class="ss-x" title="Cerrar">✕</button>
    </div>
    <div class="ss-tabs"></div>
    <div class="ss-list"></div>`;
  document.body.appendChild(dlg);
  const input = dlg.querySelector('.ss-input') as HTMLInputElement;
  const list = dlg.querySelector('.ss-list') as HTMLDivElement;
  const tabsEl = dlg.querySelector('.ss-tabs') as HTMLDivElement;
  let kind: Kind = 'all';
  let results: SearchResult[] = [];
  let sel = 0;
  let seq = 0;

  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const pick = (s: string) => {
    close();
    onPick(s);
  };

  const renderTabs = () => {
    tabsEl.innerHTML = '';
    for (const [k, label] of TABS) {
      const b = document.createElement('button');
      b.className = 'ss-tab' + (k === kind ? ' on' : '');
      b.textContent = label;
      b.onclick = () => {
        kind = k;
        renderTabs();
        renderList();
        input.focus();
      };
      tabsEl.appendChild(b);
    }
  };

  const renderList = () => {
    const shown = results.filter((r) => kind === 'all' || r.kind === kind);
    if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
    if (!shown.length) {
      const soon = kind === 'stock' || kind === 'forex' || kind === 'index' || kind === 'commodity';
      list.innerHTML = `<div class="ss-empty">${soon ? 'Esta categoría llegará en la fase 4 (acciones, oro, plata y forex con OANDA / Alpaca).' : 'Sin resultados.'}</div>`;
      return;
    }
    list.innerHTML = shown
      .map(
        (r, i) => `<div class="ss-row${i === sel ? ' on' : ''}" data-s="${esc(r.symbol)}">
          <span class="ss-sym">${esc(r.symbol)}</span>
          <span class="ss-desc">${esc(r.description)} <span class="ss-tag">${r.kind === 'crypto' ? 'CONTADO CRIPTO' : r.kind.toUpperCase()}</span></span>
          <span class="ss-src">${esc(r.source)}</span></div>`,
      )
      .join('');
  };

  const search = async () => {
    const my = ++seq;
    const q = input.value;
    list.classList.add('loading');
    const all = await Promise.all(providers.map((p) => p.searchSymbols(q).catch(() => [] as SearchResult[])));
    if (my !== seq) return;
    list.classList.remove('loading');
    results = all.flat();
    sel = 0;
    if (!results.length && providers.length) list.innerHTML = '<div class="ss-empty">Buscando…</div>';
    renderList();
  };

  let timer: number | null = null;
  input.oninput = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(search, 120);
  };
  input.onkeydown = (e) => {
    const rows = list.querySelectorAll<HTMLElement>('.ss-row');
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      sel = Math.max(0, Math.min(rows.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
      rows.forEach((r, i) => r.classList.toggle('on', i === sel));
      rows[sel]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const r = rows[sel];
      if (r) pick(r.dataset.s!);
      else if (input.value.trim()) pick(input.value.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''));
    }
  };
  list.onclick = (e) => {
    const r = (e.target as HTMLElement).closest('.ss-row') as HTMLElement | null;
    if (r) pick(r.dataset.s!);
  };
  (dlg.querySelector('.ss-x') as HTMLButtonElement).onclick = close;
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) close(); // clic fuera
  });

  renderTabs();
  input.value = initial;
  dlg.showModal();
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
  search();
}
