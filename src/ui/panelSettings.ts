import { tfLabel, USER_TFS } from '../core/timeframes';
import type { MaType, PanelCfg, TfId } from '../core/types';
import { defaultMas, uid } from './defaults';

// Ventana de ajustes de un gráfico: medias (tipo, periodo, color, grosor) y
// medias de otra temporalidad (MTF).

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k in e) (e as any)[k] = v;
    else e.setAttribute(k, v);
  }
  e.append(...children);
  return e;
}

function typeSelect(value: MaType, onChange: (v: MaType) => void) {
  const s = el('select', {}, el('option', { value: 'EMA' }, 'EMA'), el('option', { value: 'SMA' }, 'SMA'));
  s.value = value;
  s.onchange = () => onChange(s.value as MaType);
  return s;
}

function numInput(value: number, onChange: (v: number) => void, min = 1, max = 1000) {
  const i = el('input', { type: 'number', min: String(min), max: String(max), value: String(value), class: 'num' });
  i.onchange = () => {
    const v = Math.round(+i.value);
    if (v >= min && v <= max) onChange(v);
  };
  return i;
}

function colorInput(value: string, onChange: (v: string) => void) {
  const i = el('input', { type: 'color', value });
  i.oninput = () => onChange(i.value);
  return i;
}

function widthSelect(value: number, onChange: (v: number) => void) {
  const s = el('select', { title: 'Grosor' });
  for (const w of [1, 2, 3, 4]) s.append(el('option', { value: String(w) }, `${w}px`));
  s.value = String(value);
  s.onchange = () => onChange(+s.value);
  return s;
}

function checkbox(value: boolean, onChange: (v: boolean) => void) {
  const c = el('input', { type: 'checkbox', checked: value });
  c.onchange = () => onChange(c.checked);
  return c;
}

export function openPanelSettings(initial: PanelCfg, onApply: (cfg: PanelCfg) => void) {
  const cfg: PanelCfg = structuredClone(initial);
  const dlg = el('dialog', { class: 'settings' });
  document.body.appendChild(dlg);

  const render = () => {
    dlg.innerHTML = '';
    const maRows = cfg.mas.map((m, idx) =>
      el(
        'div',
        { class: 'row' },
        checkbox(m.visible, (v) => (m.visible = v)),
        typeSelect(m.type, (v) => (m.type = v)),
        numInput(m.period, (v) => (m.period = v)),
        colorInput(m.color, (v) => (m.color = v)),
        widthSelect(m.width, (v) => (m.width = v)),
        el('button', { class: 'link danger', title: 'Quitar', onclick: () => (cfg.mas.splice(idx, 1), render()) }, '✕'),
      ),
    );
    const mtfRows = cfg.mtf.map((m, idx) => {
      const tfSel = el('select', { title: 'Temporalidad de la media' });
      for (const t of USER_TFS) tfSel.append(el('option', { value: t }, tfLabel(t)));
      tfSel.value = m.tf;
      tfSel.onchange = () => (m.tf = tfSel.value as TfId);
      return el(
        'div',
        { class: 'row' },
        checkbox(m.visible, (v) => (m.visible = v)),
        typeSelect(m.type, (v) => (m.type = v)),
        numInput(m.period, (v) => (m.period = v)),
        el('span', { class: 'dim' }, 'de'),
        tfSel,
        colorInput(m.color, (v) => (m.color = v)),
        widthSelect(m.width, (v) => (m.width = v)),
        el('button', { class: 'link danger', title: 'Quitar', onclick: () => (cfg.mtf.splice(idx, 1), render()) }, '✕'),
      );
    });

    const close = () => {
      dlg.close();
      dlg.remove();
    };

    dlg.append(
      el('h3', {}, `Indicadores del gráfico ${tfLabel(cfg.tf)}`),
      el('h4', {}, 'Medias móviles'),
      ...maRows,
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'link',
            onclick: () => {
              cfg.mas.push({ id: uid('a'), type: 'EMA', period: 100, color: '#90caf9', width: 1, visible: true });
              render();
            },
          },
          '+ Añadir media',
        ),
        el(
          'button',
          {
            class: 'link',
            onclick: () => {
              cfg.mas = defaultMas();
              render();
            },
          },
          'Restaurar EMA 18/20/50 y SMA 200',
        ),
      ),
      el('h4', {}, 'Medias de otra temporalidad (MTF)'),
      el('p', { class: 'dim' }, 'Ejemplo: "EMA 50 de 15m" sobre el gráfico de 5m. Se dibujan escalonadas.'),
      ...mtfRows,
      el(
        'div',
        { class: 'row' },
        el(
          'button',
          {
            class: 'link',
            onclick: () => {
              cfg.mtf.push({ id: uid('m'), type: 'EMA', period: 50, tf: '1h', color: '#ffeb3b', width: 2, visible: true });
              render();
            },
          },
          '+ Añadir media MTF',
        ),
      ),
      el('h4', {}, 'Otros'),
      el('label', { class: 'row' }, checkbox(cfg.rsi, (v) => (cfg.rsi = v)), 'RSI 14 con su media de 14'),
      el('label', { class: 'row' }, checkbox(cfg.volume, (v) => (cfg.volume = v)), 'Volumen'),
      el('label', { class: 'row' }, checkbox(cfg.pivots, (v) => (cfg.pivots = v)), 'Pivots Traditional (automáticos)'),
      el(
        'div',
        { class: 'actions' },
        el('button', { onclick: close }, 'Cancelar'),
        el(
          'button',
          {
            class: 'primary',
            onclick: () => {
              onApply(cfg);
              close();
            },
          },
          'Aplicar',
        ),
      ),
    );
  };
  render();
  dlg.addEventListener('cancel', () => dlg.remove());
  dlg.showModal();
}
