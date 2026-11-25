import './styles.css';
import { api, onServerStatus } from './api';
import { ChartPanel } from './chart/chartPanel';
import { CrosshairSync } from './chart/crosshairSync';
import { DrawingsStore, LINE_COLORS } from './core/drawings';
import { DataHub } from './core/store';
import type { LayoutCfg, PanelCfg } from './core/types';
import { createProvider } from './providers';
import type { SymbolInfo } from './providers/provider';
import { DEFAULT_WATCHLIST, normalizeLayout } from './ui/defaults';
import { tfLabel, USER_TFS } from './core/timeframes';
import { openPanelSettings } from './ui/panelSettings';
import { SHAPE_TOOLS, tools } from './ui/tools';
import { Watchlist } from './ui/watchlist';
import { openSymbolSearch } from './ui/symbolSearch';
import { initAlerts } from './ui/alerts';
import { openDataSources } from './ui/dataSources';
import { initUpdates } from './ui/updates';

// Punto de entrada: monta la barra superior, la watchlist y los gráficos.

const provider = createProvider();
const hub = new DataHub(provider);
const drawings = new DrawingsStore();
const sync = new CrosshairSync();

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;

let layout: LayoutCfg = normalizeLayout(null);
let panels: ChartPanel[] = [];
let symbolInfo: SymbolInfo | null = null;
const chartsEl = $('#charts');

// ── Guardado de ajustes (servidor + copia local) ───────────────────────────
let saveTimer: number | null = null;
function saveLayout() {
  try {
    localStorage.setItem('layout2', JSON.stringify(layout));
  } catch {
    /* sin almacenamiento local */
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => api.putSetting('layout2', layout).catch(() => {}), 800);
}

// ── Gráficos ───────────────────────────────────────────────────────────────
function buildPanels() {
  panels.forEach((p) => p.dispose());
  panels = [];
  chartsEl.className = layout.mode === 'grid' ? 'grid6' : 'single';
  // En grande se ve uno de los 6 gráficos (el mismo, con su configuración), como al maximizar en TradingView.
  const singleIdx = layout.singleIdx ?? 0;
  const cfgs = layout.mode === 'grid' ? layout.grid : [layout.grid[singleIdx]];
  cfgs.forEach((cfg, idx) => {
    const panel: ChartPanel = new ChartPanel(chartsEl, cfg, {
      hub,
      drawings,
      sync,
      onActivate: (p) => setActivePanel(p),
      onConfigChange: (c: PanelCfg) => {
        if (layout.mode === 'grid') layout.grid[idx] = c;
        else layout.grid[singleIdx] = c;
        saveLayout();
      },
      onMaximize: () => {
        if (layout.mode === 'grid') {
          layout.singleIdx = idx;
          layout.mode = 'single';
        } else layout.mode = 'grid';
        saveLayout();
        buildPanels();
        renderModeButtons();
      },
      onOpenSettings: (p) => openIndicators(p),
    });
    if (symbolInfo) panel.setSymbol(layout.symbol, symbolInfo);
    panels.push(panel);
  });
  if (layout.mode === 'single') activeIdx = singleIdx;
  const keep = layout.mode === 'grid' ? Math.min(activeIdx, panels.length - 1) : 0;
  setActivePanel(panels[keep]);
}

function openIndicators(p: ChartPanel | null) {
  if (!p) return;
  openPanelSettings(p.cfg, (c) => {
    p.setConfig(c);
    renderTfButtons();
  });
}

// ── Gráfico activo y botones de temporalidad ───────────────────────────────
let activeIdx = 0;
let activePanel: ChartPanel | null = null;
function setActivePanel(p: ChartPanel) {
  activePanel = p;
  if (layout.mode === 'grid') activeIdx = panels.indexOf(p);
  panels.forEach((x) => x.setActive(x === p && layout.mode === 'grid'));
  renderTfButtons();
}
function renderTfButtons() {
  const box = $('#tf-buttons');
  box.innerHTML = '';
  for (const tf of USER_TFS) {
    const b = document.createElement('button');
    b.className = 'tfb' + (activePanel?.cfg.tf === tf ? ' on' : '');
    b.textContent = tfLabel(tf);
    b.title = layout.mode === 'grid' ? 'Cambia la temporalidad del gráfico seleccionado (borde azul)' : 'Temporalidad';
    b.onclick = () => {
      activePanel?.setTimeframe(tf);
      renderTfButtons();
    };
    box.appendChild(b);
  }
}

async function setSymbol(symbol: string) {
  layout.symbol = symbol;
  saveLayout();
  watchlist.setActive(symbol);
  $('#cur-symbol').textContent = symbol;
  document.title = `${symbol} · Gráficos`;
  watchSymbolStatus(symbol);
  try {
    symbolInfo = await provider.getSymbolInfo(symbol);
  } catch (e) {
    symbolInfo = { symbol, description: symbol, precision: 2, minMove: 0.01 };
    console.warn(e);
  }
  drawings.setSymbol(symbol);
  for (const p of panels) p.setSymbol(symbol, symbolInfo);
}

// ── Barra superior ─────────────────────────────────────────────────────────
function renderModeButtons() {
  $('#btn-grid').classList.toggle('on', layout.mode === 'grid');
  $('#btn-single').classList.toggle('on', layout.mode === 'single');
}

$('#btn-grid').onclick = () => {
  if (layout.mode === 'grid') return;
  layout.mode = 'grid';
  saveLayout();
  buildPanels();
  renderModeButtons();
};
$('#btn-single').onclick = () => {
  if (layout.mode === 'single') return;
  layout.singleIdx = activeIdx; // el gráfico seleccionado (borde azul)
  layout.mode = 'single';
  saveLayout();
  buildPanels();
  renderModeButtons();
};
$('#btn-hline').onclick = () => tools.toggle('hline');
$('#btn-cursor').onclick = () => tools.set('none');
$('#btn-measure').onclick = () => tools.toggle('measure');
$('#btn-vline').onclick = () => tools.toggle('vline');
$('#btn-fibext').onclick = () => tools.toggle('fibext');
$('#btn-fib').onclick = () => tools.toggle('fib');
$('#btn-long').onclick = () => tools.toggle('long');
$('#btn-short').onclick = () => tools.toggle('short');
for (const t of SHAPE_TOOLS) $(`#btn-${t}`).onclick = () => tools.toggle(t);
$('#btn-indicators').onclick = () => openIndicators(activePanel);
$('#symbox').onclick = () => openSearch('');
function openSearch(initial: string) {
  openSymbolSearch([provider], initial, (s) => setSymbol(s));
}
tools.subscribe((t) => {
  $('#btn-measure').classList.toggle('on', t === 'measure');
  $('#btn-vline').classList.toggle('on', t === 'vline');
  $('#btn-fibext').classList.toggle('on', t === 'fibext');
  $('#btn-fib').classList.toggle('on', t === 'fib');
  $('#btn-long').classList.toggle('on', t === 'long');
  $('#btn-short').classList.toggle('on', t === 'short');
  $('#btn-hline').classList.toggle('on', t === 'hline');
  for (const st of SHAPE_TOOLS) $(`#btn-${st}`).classList.toggle('on', t === st);
  $('#btn-cursor').classList.toggle('on', t === 'none');
});
$('#btn-sidebar').onclick = () => document.body.classList.toggle('hide-sidebar');

// Ancho de la lista de seguimiento: se arrastra el separador (se recuerda en este equipo).
(function installSplitter() {
  const split = $('#wl-splitter');
  const wl = $('#watchlist');
  const KEY = 'wlWidth';
  const clamp = (w: number) => Math.max(170, Math.min(Math.round(window.innerWidth * 0.6), Math.round(w)));
  try {
    const w = parseInt(localStorage.getItem(KEY) || '');
    if (w) wl.style.width = `${clamp(w)}px`;
  } catch {
    /* sin almacenamiento */
  }
  split.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = wl.getBoundingClientRect().width;
    split.classList.add('drag');
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => (wl.style.width = `${clamp(startW - (ev.clientX - startX))}px`);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      split.classList.remove('drag');
      document.body.classList.remove('resizing');
      try {
        localStorage.setItem(KEY, String(Math.round(wl.getBoundingClientRect().width)));
      } catch {
        /* sin almacenamiento */
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
})();

// Estado de conexión: el de la fuente del símbolo que se está viendo.
let unStatus: (() => void) | null = null;
function paintStatus(s: string, src: string, msg = '') {
  const dot = $('#conn');
  dot.className = 'conn ' + s;
  dot.title = s === 'open' ? `Tiempo real conectado (${src})` : s === 'connecting' ? `Conectando con ${src}… ${msg}` : `Sin conexión en tiempo real con ${src}: reintentando… ${msg}`;
}
function watchSymbolStatus(symbol: string) {
  unStatus?.();
  const src = provider.sourceLabel?.(symbol) ?? provider.label;
  $('#provider-name').textContent = src;
  if (provider.onSymbolStatus) unStatus = provider.onSymbolStatus(symbol, (s, msg) => paintStatus(s, src, msg));
  else unStatus = provider.onStatus((s) => paintStatus(s, src));
}
$('#btn-sources').onclick = () =>
  openDataSources(() => {
    // Claves nuevas: se recarga la app para volver a pedir todo con ellas.
    location.reload();
  });
onServerStatus((ok) => {
  $('#server-warn').style.display = ok ? 'none' : '';
});

// ── Editor de la línea seleccionada ────────────────────────────────────────
const editor = $('#line-editor');
function renderEditor() {
  const d = drawings.selected;
  if (!d) {
    editor.style.display = 'none';
    return;
  }
  editor.style.display = '';
  const isLine = d.type === 'hline' || d.type === 'vline';
  const isShape = d.type === 'trend' || d.type === 'rect' || d.type === 'path' || d.type === 'note' || d.type === 'comment';
  const isText = d.type === 'note' || d.type === 'comment';
  for (const sel of ['.le-swatches', '.le-color']) (editor.querySelector(sel) as HTMLElement).style.display = isLine || isShape ? '' : 'none';
  for (const sel of ['.le-width', '.le-style']) (editor.querySelector(sel) as HTMLElement).style.display = isLine || (isShape && !isText) ? '' : 'none';
  (editor.querySelector('.le-cfg') as HTMLElement).style.display = isLine ? 'none' : '';
  const priceInput = editor.querySelector('input.le-price') as HTMLInputElement;
  priceInput.style.display = d.type === 'hline' ? '' : 'none';
  if (d.type === 'hline' && document.activeElement !== priceInput) priceInput.value = String(d.price);
  if (!isLine && !isShape) return;
  editor.querySelectorAll<HTMLButtonElement>('.swatch').forEach((b) => b.classList.toggle('on', b.dataset.c === d.color));
  (editor.querySelector('.le-width') as HTMLSelectElement).value = String(d.width);
  (editor.querySelector('.le-style') as HTMLSelectElement).value = String(d.style);
  (editor.querySelector('.le-color') as HTMLInputElement).value = d.color;
}
/** Color del dibujo seleccionado (en el rectángulo también cambia el fondo, translúcido). */
function setSelColor(c: string) {
  const d = drawings.selected;
  if (!d) return;
  const m = /^#?([0-9a-f]{6})$/i.exec(c);
  if (d.type === 'rect' && m) {
    const n = parseInt(m[1], 16);
    drawings.update(d.id, { color: c, fillColor: `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},0.2)` });
  } else drawings.update(d.id, { color: c });
}
(function buildEditor() {
  const sw = editor.querySelector('.le-swatches')!;
  for (const c of LINE_COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.c = c;
    b.style.background = c;
    b.title = c;
    b.onclick = () => setSelColor(c);
    sw.appendChild(b);
  }
  (editor.querySelector('.le-color') as HTMLInputElement).oninput = (e) => setSelColor((e.target as HTMLInputElement).value);
  (editor.querySelector('.le-width') as HTMLSelectElement).onchange = (e) =>
    drawings.selectedId && drawings.update(drawings.selectedId, { width: +(e.target as HTMLSelectElement).value });
  (editor.querySelector('.le-style') as HTMLSelectElement).onchange = (e) =>
    drawings.selectedId && drawings.update(drawings.selectedId, { style: +(e.target as HTMLSelectElement).value as 0 | 1 | 2 });
  (editor.querySelector('.le-price') as HTMLInputElement).onchange = (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value.replace(',', '.'));
    if (drawings.selectedId && Number.isFinite(v)) drawings.update(drawings.selectedId, { price: v });
  };
  (editor.querySelector('.le-cfg') as HTMLButtonElement).onclick = () => drawings.selectedId && activePanel?.openFib(drawings.selectedId);
  (editor.querySelector('.le-del') as HTMLButtonElement).onclick = () => drawings.selectedId && drawings.remove(drawings.selectedId);
  (editor.querySelector('.le-close') as HTMLButtonElement).onclick = () => drawings.select(null);
})();
drawings.subscribe(renderEditor);

// ── Atajos de teclado ──────────────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  const tag = (e.target as HTMLElement).tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (e.altKey && (e.key === 'l' || e.key === 'L')) {
    e.preventDefault();
    activePanel?.toggleLog();
  } else if (e.altKey && (e.key === 'a' || e.key === 'A')) {
    e.preventDefault();
    activePanel?.autoFit();
  } else if (e.altKey && (e.key === '+' || e.key === '=')) {
    e.preventDefault();
    activePanel?.zoom(0.8);
  } else if (e.altKey && e.key === '-') {
    e.preventDefault();
    activePanel?.zoom(1.25);
  } else if (e.altKey && (e.key === 'h' || e.key === 'H')) {
    e.preventDefault();
    tools.toggle('hline');
  } else if (e.altKey && (e.key === 'v' || e.key === 'V')) {
    e.preventDefault();
    tools.toggle('vline');
  } else if (e.altKey && (e.key === 'f' || e.key === 'F')) {
    e.preventDefault();
    tools.toggle('fib');
  } else if (e.altKey && (e.key === 't' || e.key === 'T')) {
    e.preventDefault();
    tools.toggle('trend');
  } else if (!e.altKey && !e.ctrlKey && !e.metaKey && /^[a-zA-Z0-9]$/.test(e.key) && !document.querySelector('dialog[open]')) {
    // Como en TradingView: empezar a escribir abre el buscador de símbolos.
    e.preventDefault();
    openSearch(e.key.toUpperCase());
  } else if (e.key === 'Tab' && !e.altKey && !e.ctrlKey && !document.querySelector('dialog[open]')) {
    // Tab / Mayús+Tab: siguiente / anterior gráfico (en grande cambia de gráfico; en la cuadrícula, cambia el seleccionado).
    e.preventDefault();
    const n = layout.grid.length;
    const step = e.shiftKey ? -1 : 1;
    if (layout.mode === 'single') {
      layout.singleIdx = ((layout.singleIdx ?? 0) + step + n) % n;
      saveLayout();
      buildPanels();
    } else setActivePanel(panels[(activeIdx + step + n) % n]);
  } else if (e.key === 'Escape') {
    tools.set('none');
    drawings.select(null);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && drawings.selectedId) {
    e.preventDefault();
    drawings.remove(drawings.selectedId);
  }
});

// ── Watchlist ──────────────────────────────────────────────────────────────
const watchlist = new Watchlist(
  $('#watchlist'),
  hub,
  (s) => setSymbol(s),
  (list) => api.putSetting('watchlist2', list).catch(() => {}),
);

// ── Alertas (fase 2) ───────────────────────────────────────────────────────
initAlerts({ drawings, getSymbol: () => layout.symbol, goSymbol: (s) => setSymbol(s) });

// ── Arranque ───────────────────────────────────────────────────────────────
(window as any).__app = { get panels() { return panels; }, hub, drawings };

(async function boot() {
  let saved: Partial<LayoutCfg> | null = null;
  let wl: string[] | null = null;
  try {
    [saved, wl] = await Promise.all([api.getSetting<LayoutCfg>('layout2'), api.getSetting<string[]>('watchlist2')]);
  } catch {
    try {
      saved = JSON.parse(localStorage.getItem('layout2') || 'null');
    } catch {
      saved = null;
    }
  }
  layout = normalizeLayout(saved);
  const ver = $('#app-version');
  ver.textContent = `v${__APP_VERSION__}`;
  ver.title = `Versión ${__APP_VERSION__} · compilada el ${__APP_BUILT__.split('-').reverse().join('/')}`;
  initUpdates(ver);
  watchlist.setSymbols(wl && wl.length ? wl : DEFAULT_WATCHLIST);
  renderModeButtons();
  buildPanels();
  await setSymbol(layout.symbol);
})();
