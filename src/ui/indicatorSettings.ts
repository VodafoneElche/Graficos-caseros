import { tfLabel, USER_TFS } from '../core/timeframes';
import type {
  FibExt,
  LineStyleId,
  MaCfg,
  PivotCfg,
  PivotLevelName,
  PivotTf,
  PivotType,
  PriceSource,
  RsiBand,
  RsiCfg,
  SmoothingType,
  TfGroup,
  TfId,
  TwoYmaCfg,
} from '../core/types';

// Ventanas de configuración con el mismo aspecto y orden que las de TradingView:
// título, pestañas ("Entradas de datos", "Estilo", "Visibilidad") y botones
// Cancelar / Aceptar abajo.

type Tab = { name: string; render: (box: HTMLElement) => void };

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k in e) (e as any)[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function openDialog(title: string, tabs: Tab[], onOk: () => void) {
  const dlg = h('dialog', { class: 'tvdlg' });
  document.body.appendChild(dlg);
  let current = 0;
  const close = () => {
    dlg.close();
    dlg.remove();
  };
  const body = h('div', { class: 'tvdlg-body' });
  const tabBar = h('div', { class: 'tvdlg-tabs' });
  const renderTabs = () => {
    tabBar.innerHTML = '';
    tabs.forEach((t, i) => {
      const b = h('button', { class: 'tvdlg-tab' + (i === current ? ' on' : ''), type: 'button' }, t.name);
      b.onclick = () => {
        current = i;
        renderTabs();
      };
      tabBar.appendChild(b);
    });
    body.innerHTML = '';
    tabs[current].render(body);
  };
  const ok = h('button', { class: 'tvdlg-ok', type: 'button' }, 'Aceptar');
  ok.onclick = () => {
    onOk();
    close();
  };
  const cancel = h('button', { class: 'tvdlg-cancel', type: 'button' }, 'Cancelar');
  cancel.onclick = close;
  const x = h('button', { class: 'tvdlg-x', type: 'button', title: 'Cerrar' }, '✕');
  x.onclick = close;
  dlg.append(h('div', { class: 'tvdlg-head' }, h('span', { class: 'tvdlg-title' }, title), x), tabBar, body, h('div', { class: 'tvdlg-foot' }, cancel, ok));
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'SELECT') {
      e.preventDefault();
      ok.click();
    }
  });
  renderTabs();
  dlg.showModal();
}

// ── Controles ────────────────────────────────────────────────────────────────

function row(label: string, ...controls: (Node | string)[]) {
  return h('div', { class: 'tv-row' }, h('span', { class: 'tv-label' }, label), h('span', { class: 'tv-ctl' }, ...controls));
}

function section(title: string) {
  return h('div', { class: 'tv-section' }, title);
}

function num(value: number, onChange: (v: number) => void, opts: { min?: number; max?: number; step?: number; disabled?: boolean } = {}) {
  const i = h('input', { type: 'number', class: 'tv-num', value: String(value), step: String(opts.step ?? 1), disabled: !!opts.disabled });
  if (opts.min != null) i.min = String(opts.min);
  if (opts.max != null) i.max = String(opts.max);
  i.oninput = () => {
    const v = parseFloat(i.value.replace(',', '.'));
    if (Number.isFinite(v) && (opts.min == null || v >= opts.min) && (opts.max == null || v <= opts.max)) onChange(v);
  };
  return i;
}

function select<T extends string>(value: T, options: [T, string][], onChange: (v: T) => void, disabled = false) {
  const s = h('select', { class: 'tv-sel', disabled });
  for (const [v, l] of options) s.append(h('option', { value: v }, l));
  s.value = value;
  s.onchange = () => onChange(s.value as T);
  return s;
}

function check(value: boolean, label: string, onChange: (v: boolean) => void) {
  const c = h('input', { type: 'checkbox', checked: value });
  c.onchange = () => onChange(c.checked);
  return h('label', { class: 'tv-check' }, c, label);
}

function color(value: string, onChange: (v: string) => void) {
  const i = h('input', { type: 'color', class: 'tv-color', value: toHex(value) });
  i.oninput = () => onChange(i.value);
  return i;
}

/** Color con transparencia (para fondos). */
function colorAlpha(value: string, onChange: (v: string) => void) {
  const { hex, a } = parseRgba(value);
  let cur = { hex, a };
  const c = h('input', { type: 'color', class: 'tv-color', value: hex });
  const r = h('input', { type: 'range', min: '0', max: '100', value: String(Math.round(a * 100)), class: 'tv-range', title: 'Opacidad' });
  const emit = () => onChange(rgba(cur.hex, cur.a));
  c.oninput = () => ((cur.hex = c.value), emit());
  r.oninput = () => ((cur.a = +r.value / 100), emit());
  return h('span', { class: 'tv-ca' }, c, r);
}

function widthSel(value: number, onChange: (v: number) => void, allowHalf = false) {
  const opts: [string, string][] = (allowHalf ? [0.5, 1, 2, 3, 4] : [1, 2, 3, 4]).map((w) => [String(w), `${String(w).replace('.', ',')} px`]);
  return select(String(value), opts, (v) => onChange(+v));
}

function styleSel(value: LineStyleId, onChange: (v: LineStyleId) => void) {
  return select(String(value) as '0' | '1' | '2', [
    ['0', '──── Sólida'],
    ['2', '─ ─ ─ Discontinua'],
    ['1', '······ Punteada'],
  ], (v) => onChange(+v as LineStyleId));
}

function toHex(c: string): string {
  return parseRgba(c).hex;
}

function parseRgba(c: string): { hex: string; a: number } {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(c);
  if (m) {
    const hx = (n: string) => (+n).toString(16).padStart(2, '0');
    return { hex: `#${hx(m[1])}${hx(m[2])}${hx(m[3])}`, a: m[4] != null ? +m[4] : 1 };
  }
  if (/^#[0-9a-f]{6}$/i.test(c)) return { hex: c, a: 1 };
  return { hex: '#ffffff', a: 1 };
}

function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${+a.toFixed(2)})`;
}

const GROUPS: [TfGroup, string][] = [
  ['sec', 'Segundos'],
  ['min', 'Minutos'],
  ['hour', 'Horas'],
  ['day', 'Días'],
  ['week', 'Semanas'],
  ['month', 'Meses'],
];

function visibilityTab(hiddenOn: TfGroup[]): Tab {
  return {
    name: 'Visibilidad',
    render: (box) => {
      box.append(h('p', { class: 'tv-hint' }, 'En qué temporalidades se dibuja:'));
      for (const [g, label] of GROUPS) {
        box.append(
          h(
            'div',
            { class: 'tv-row' },
            check(!hiddenOn.includes(g), label, (v) => {
              const i = hiddenOn.indexOf(g);
              if (v && i >= 0) hiddenOn.splice(i, 1);
              if (!v && i < 0) hiddenOn.push(g);
            }),
          ),
        );
      }
    },
  };
}

// ── EMA / SMA ────────────────────────────────────────────────────────────────

const SOURCES: [PriceSource, string][] = [
  ['open', 'Apertura'],
  ['high', 'Máximo'],
  ['low', 'Mínimo'],
  ['close', 'Cierre'],
  ['hl2', '(máx + mín)/2'],
  ['hlc3', '(máx + mín + cierre)/3'],
  ['ohlc4', '(ap + máx + mín + cierre)/4'],
  ['hlcc4', '(máx + mín + cierre + cierre)/4'],
];

const SMOOTHINGS: [SmoothingType, string][] = [
  ['none', 'Ninguno'],
  ['SMA', 'SMA'],
  ['SMA+BB', 'SMA + Bandas de Bollinger'],
  ['EMA', 'EMA'],
  ['SMMA', 'SMMA (RMA)'],
  ['WMA', 'WMA'],
  ['VWMA', 'VWMA'],
];

export function openMaSettings(initial: MaCfg, chartTf: TfId, onApply: (m: MaCfg) => void) {
  const m: MaCfg = structuredClone(initial);
  m.hiddenOn = m.hiddenOn ? [...m.hiddenOn] : [];
  const inputs: Tab = {
    name: 'Entradas de datos',
    render: (box) => {
      const smoothLen = num(m.smoothingLength ?? 14, (v) => (m.smoothingLength = Math.round(v)), { min: 1, max: 5000, disabled: !m.smoothing || m.smoothing === 'none' });
      const bb = num(m.bbMult ?? 2, (v) => (m.bbMult = v), { min: 0.1, max: 50, step: 0.1, disabled: m.smoothing !== 'SMA+BB' });
      const wait = check(m.waitClose !== false, 'Espere al cierre de los intervalos de tiempo', (v) => (m.waitClose = v));
      const waitInput = wait.querySelector('input') as HTMLInputElement;
      waitInput.disabled = !m.tf;
      const tfOptions: [string, string][] = [['', 'Gráfico'], ...USER_TFS.map((t) => [t, tfLabel(t)] as [string, string])];
      box.append(
        row('Tipo', select(m.type, [['EMA', 'EMA (exponencial)'], ['SMA', 'SMA (simple)']], (v) => (m.type = v))),
        row('Longitud', num(m.period, (v) => (m.period = Math.round(v)), { min: 1, max: 5000 })),
        row('Fuente', select(m.source ?? 'close', SOURCES, (v) => (m.source = v))),
        row('Compensación', num(m.offset ?? 0, (v) => (m.offset = Math.round(v)), { min: -500, max: 500 })),
        section('SUAVIZADO'),
        row(
          'Tipo',
          select(m.smoothing ?? 'none', SMOOTHINGS, (v) => {
            m.smoothing = v;
            smoothLen.disabled = v === 'none';
            bb.disabled = v !== 'SMA+BB';
          }),
        ),
        row('Longitud', smoothLen),
        row('Desviación estándar BB', bb),
        section('CÁLCULO'),
        row(
          'Intervalo de tiempo',
          select((m.tf && m.tf !== chartTf ? m.tf : '') as string, tfOptions, (v) => {
            m.tf = (v || undefined) as TfId | undefined;
            waitInput.disabled = !m.tf;
          }),
        ),
        h('div', { class: 'tv-row' }, wait),
      );
    },
  };
  const style: Tab = {
    name: 'Estilo',
    render: (box) => {
      box.append(
        row(m.type, color(m.color, (v) => (m.color = v)), widthSel(m.width, (v) => (m.width = v)), styleSel(m.lineStyle ?? 0, (v) => (m.lineStyle = v))),
        row('Línea de suavizado', color(m.smoothingColor || '#ffeb3b', (v) => (m.smoothingColor = v))),
        section('VALORES DE SALIDA'),
        h('div', { class: 'tv-row' }, check(m.axisLabel !== false, 'Etiquetas en la escala de precios', (v) => (m.axisLabel = v))),
        h('div', { class: 'tv-row' }, check(m.statusValue !== false, 'Valores en la línea de estado', (v) => (m.statusValue = v))),
      );
    },
  };
  openDialog(m.type, [inputs, style, visibilityTab(m.hiddenOn)], () => onApply(m));
}

// ── RSI ─────────────────────────────────────────────────────────────────────

export function openRsiSettings(initial: RsiCfg, onApply: (c: RsiCfg) => void) {
  const c: RsiCfg = structuredClone(initial);
  c.hiddenOn = [...(c.hiddenOn || [])];
  const inputs: Tab = {
    name: 'Entradas de datos',
    render: (box) => {
      const smoothLen = num(c.smoothingLength, (v) => (c.smoothingLength = Math.round(v)), { min: 1, max: 5000, disabled: c.smoothing === 'none' });
      const bb = num(c.bbMult, (v) => (c.bbMult = v), { min: 0.1, max: 50, step: 0.1, disabled: c.smoothing !== 'SMA+BB' });
      const wait = check(c.waitClose, 'Espere al cierre de los intervalos de tiempo', (v) => (c.waitClose = v));
      const waitInput = wait.querySelector('input') as HTMLInputElement;
      waitInput.disabled = !c.tf;
      const tfOptions: [string, string][] = [['', 'Gráfico'], ...USER_TFS.map((t) => [t, tfLabel(t)] as [string, string])];
      box.append(
        section('CONFIGURACIÓN RSI'),
        row('Longitud RSI', num(c.length, (v) => (c.length = Math.round(v)), { min: 1, max: 500 })),
        row('Fuente', select(c.source, SOURCES, (v) => (c.source = v))),
        section('SUAVIZADO'),
        row(
          'Tipo',
          select(c.smoothing, SMOOTHINGS, (v) => {
            c.smoothing = v;
            smoothLen.disabled = v === 'none';
            bb.disabled = v !== 'SMA+BB';
          }),
        ),
        row('Longitud', smoothLen),
        row('Desviación estándar BB', bb),
        section('CÁLCULO'),
        row(
          'Intervalo de tiempo',
          select((c.tf ?? '') as string, tfOptions, (v) => {
            c.tf = (v || undefined) as TfId | undefined;
            waitInput.disabled = !c.tf;
          }),
        ),
        h('div', { class: 'tv-row' }, wait),
      );
    },
  };
  const band = (label: string, b: RsiBand) =>
    row(label, check(b.on, '', (v) => (b.on = v)), color(b.color, (v) => (b.color = v)), num(b.value, (v) => (b.value = v), { min: 0, max: 100 }));
  const style: Tab = {
    name: 'Estilo',
    render: (box) => {
      box.append(
        row('RSI', color(c.color, (v) => (c.color = v)), widthSel(c.width, (v) => (c.width = v))),
        row('RSI-based MA', check(c.showMa, '', (v) => (c.showMa = v)), color(c.maColor, (v) => (c.maColor = v))),
        band('RSI Upper Band', c.upper),
        band('RSI Middle Band', c.middle),
        band('RSI Lower Band', c.lower),
        row('RSI Background Fill', check(c.bgFill, '', (v) => (c.bgFill = v)), colorAlpha(c.bgColor, (v) => (c.bgColor = v))),
        row('Overbought Gradient Fill', check(c.obFill, '', (v) => (c.obFill = v)), color(c.obColor, (v) => (c.obColor = v))),
        row('Oversold Gradient Fill', check(c.osFill, '', (v) => (c.osFill = v)), color(c.osColor, (v) => (c.osColor = v))),
        row('Alto del panel (%)', num(Math.round(c.height * 100), (v) => (c.height = v / 100), { min: 10, max: 70 })),
        section('VALORES DE SALIDA'),
        h('div', { class: 'tv-row' }, check(c.axisLabel, 'Etiquetas en la escala de precios', (v) => (c.axisLabel = v))),
        h('div', { class: 'tv-row' }, check(c.statusValue, 'Valores en la línea de estado', (v) => (c.statusValue = v))),
      );
    },
  };
  openDialog('RSI', [inputs, style, visibilityTab(c.hiddenOn)], () => onApply(c));
}

// ── Pivots ──────────────────────────────────────────────────────────────────

export function openPivotSettings(initial: PivotCfg, onApply: (c: PivotCfg) => void) {
  const c: PivotCfg = structuredClone(initial);
  const inputs: Tab = {
    name: 'Entradas de datos',
    render: (box) => {
      const pos = select(c.labelsPos, [['left', 'Izq.'], ['right', 'Der.']], (v) => (c.labelsPos = v), !c.showLabels && !c.showPrices);
      const upd = () => (pos.disabled = !c.showLabels && !c.showPrices);
      box.append(
        row(
          'Tipo',
          select(c.type, [
            ['Traditional', 'Tradicional'],
            ['Fibonacci', 'Fibonacci'],
            ['Woodie', 'Woodie'],
            ['Classic', 'Clásico'],
            ['DM', 'DM'],
            ['Camarilla', 'Camarilla'],
          ] as [PivotType, string][], (v) => (c.type = v)),
        ),
        row(
          'Intervalo de tiempo del pivote',
          select(c.tf, [
            ['Auto', 'Automático'],
            ['1D', 'Diario'],
            ['1W', 'Semanal'],
            ['1M', 'Mensual'],
            ['12M', 'Anual'],
          ] as [PivotTf, string][], (v) => (c.tf = v)),
        ),
        row('Número de pivotes anteriores', num(c.count, (v) => (c.count = Math.round(v)), { min: 1, max: 200 })),
        h('div', { class: 'tv-row' }, check(c.useDaily, 'Usar valores diarios', (v) => (c.useDaily = v))),
        section('ETIQUETAS'),
        h('div', { class: 'tv-row' }, check(c.showLabels, 'Mostrar etiquetas', (v) => ((c.showLabels = v), upd()))),
        h('div', { class: 'tv-row' }, check(c.showPrices, 'Mostrar precios', (v) => ((c.showPrices = v), upd()))),
        row('Posición de las etiquetas', pos),
        section('NIVELES'),
        row('Ancho de línea', num(c.width, (v) => (c.width = v), { min: 0.5, max: 4, step: 0.5 })),
      );
      const lvl = (n: PivotLevelName) => {
        const st = c.levels[n];
        const cb = h('input', { type: 'checkbox', checked: st.on });
        cb.onchange = () => (st.on = cb.checked);
        return h('span', { class: 'tv-lvl' }, h('b', {}, n), color(st.color, (v) => (st.color = v)), cb);
      };
      box.append(h('div', { class: 'tv-row' }, lvl('P')));
      for (const k of [1, 2, 3, 4, 5]) box.append(h('div', { class: 'tv-row tv-2col' }, lvl(`S${k}` as PivotLevelName), lvl(`R${k}` as PivotLevelName)));
    },
  };
  openDialog('Pivots', [inputs], () => onApply(c));
}

// ── 2YMA ─────────────────────────────────────────────────────────────────────

export function openTwoYmaSettings(initial: TwoYmaCfg, onApply: (c: TwoYmaCfg) => void) {
  const c: TwoYmaCfg = structuredClone(initial);
  const style: Tab = {
    name: 'Estilo',
    render: (box) => {
      box.append(
        h('p', { class: 'tv-hint' }, 'Media simple de 730 días (2 años) sobre velas diarias y esa media multiplicada por 5.'),
        row('2Y-MA', color(c.maColor, (v) => (c.maColor = v))),
        row('2Y-MA x 5', color(c.x5Color, (v) => (c.x5Color = v))),
        row('Trazado del gráfico', check(c.showPlot, '', (v) => (c.showPlot = v)), color(c.plotColor, (v) => (c.plotColor = v))),
        section('FONDO DE LOS GRÁFICOS'),
        h('div', { class: 'tv-row' }, check(c.showFill, 'Rellenar fondos', (v) => (c.showFill = v))),
        row('Precio bajo la 2Y-MA', colorAlpha(c.fillLow, (v) => (c.fillLow = v))),
        row('Precio sobre la 2Y-MA x 5', colorAlpha(c.fillHigh, (v) => (c.fillHigh = v))),
      );
    },
  };
  openDialog('2YMA', [style], () => onApply(c));
}

// ── Extensión de Fibonacci ──────────────────────────────────────────────────

export function openFibSettings(initial: FibExt, onApply: (patch: Partial<FibExt>) => void) {
  const f: FibExt = structuredClone(initial);
  const style: Tab = {
    name: 'Estilo',
    render: (box) => {
      box.append(
        row('Línea de tendencia', check(f.trendLine, '', (v) => (f.trendLine = v)), color(f.trendColor, (v) => (f.trendColor = v)), styleSel(f.trendStyle, (v) => (f.trendStyle = v))),
        row('Línea de niveles', widthSel(f.levelsWidth, (v) => (f.levelsWidth = v), true), styleSel(f.levelsStyle, (v) => (f.levelsStyle = v))),
        row(
          'Ampliar',
          select(f.extend, [
            ['none', 'No ampliar'],
            ['left', 'Ampliar a la izquierda'],
            ['right', 'Ampliar a la derecha'],
            ['both', 'Ampliar a ambos lados'],
          ], (v) => (f.extend = v)),
        ),
      );
      const grid = h('div', { class: 'tv-fibgrid' });
      for (const l of f.levels) {
        const cb = h('input', { type: 'checkbox', checked: l.on });
        cb.onchange = () => (l.on = cb.checked);
        grid.append(h('span', { class: 'tv-fiblvl' }, cb, num(l.value, (v) => (l.value = v), { step: 0.001 }), color(l.color, (v) => (l.color = v))));
      }
      box.append(grid);
      box.append(
        h('div', { class: 'tv-row' }, check(f.background, 'Fondo', (v) => (f.background = v))),
        h('div', { class: 'tv-row' }, check(f.showLabels, 'Etiquetas (niveles)', (v) => (f.showLabels = v))),
        h('div', { class: 'tv-row' }, check(f.showPrices, 'Precios', (v) => (f.showPrices = v))),
      );
    },
  };
  openDialog('Extensión de Fibonacci en función de la tendencia', [style], () => {
    const { id, symbol, type, points, ...rest } = f;
    void id;
    void symbol;
    void type;
    void points;
    onApply(rest);
  });
}
