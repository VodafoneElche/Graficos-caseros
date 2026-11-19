import { tfLabel } from '../core/timeframes';
import type { MaCfg, PanelCfg } from '../core/types';
import { defaultMas, uid } from './defaults';
import { openMaSettings, openPivotSettings, openRsiSettings, openTwoYmaSettings } from './indicatorSettings';

// Ventana "Indicadores" de un gráfico: qué indicadores tiene y botón ⚙ para
// configurar cada uno con su ventana tipo TradingView.

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

function checkbox(value: boolean, onChange: (v: boolean) => void) {
  const c = el('input', { type: 'checkbox', checked: value });
  c.onchange = () => onChange(c.checked);
  return c;
}

function maName(m: MaCfg, chartTf: string) {
  const tf = m.tf && m.tf !== chartTf ? ` · ${tfLabel(m.tf)}` : '';
  return `${m.type}${tf} ${m.period} ${m.source || 'close'}`;
}

export function openPanelSettings(initial: PanelCfg, onApply: (cfg: PanelCfg) => void) {
  const cfg: PanelCfg = structuredClone(initial);
  const dlg = el('dialog', { class: 'settings' });
  document.body.appendChild(dlg);

  const gear = (fn: () => void) => el('button', { class: 'link', title: 'Configuración', onclick: fn }, '⚙');

  const render = () => {
    dlg.innerHTML = '';
    const maRows = cfg.mas.map((m, idx) =>
      el(
        'div',
        { class: 'row' },
        checkbox(m.visible, (v) => (m.visible = v)),
        el('span', { class: 'swatch-dot', style: `background:${m.color}` }),
        el('span', { class: 'grow' }, maName(m, cfg.tf)),
        gear(() =>
          openMaSettings(m, cfg.tf, (nm) => {
            cfg.mas[idx] = nm;
            render();
          }),
        ),
        el('button', { class: 'link danger', title: 'Quitar', onclick: () => (cfg.mas.splice(idx, 1), render()) }, '✕'),
      ),
    );

    const close = () => {
      dlg.close();
      dlg.remove();
    };
    const addMa = (type: 'EMA' | 'SMA') => {
      const m: MaCfg = { id: uid('a'), type, period: type === 'EMA' ? 50 : 200, color: '#2962ff', width: 1, visible: true, waitClose: true };
      openMaSettings(m, cfg.tf, (nm) => {
        cfg.mas.push(nm);
        render();
      });
    };

    dlg.append(
      el('h3', {}, `Indicadores del gráfico ${tfLabel(cfg.tf)}`),
      el('h4', {}, 'Medias móviles'),
      el('p', { class: 'dim' }, 'Con ⚙ se cambia longitud, fuente, compensación, suavizado, intervalo de tiempo (media de otra temporalidad), color y visibilidad. También con doble clic en su nombre en la leyenda del gráfico.'),
      ...maRows,
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'link', onclick: () => addMa('EMA') }, '+ Añadir EMA'),
        el('button', { class: 'link', onclick: () => addMa('SMA') }, '+ Añadir SMA'),
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
      el('h4', {}, 'Otros'),
      el(
        'div',
        { class: 'row' },
        el('label', {}, checkbox(cfg.rsi, (v) => (cfg.rsi = v)), ` RSI ${cfg.rsiCfg?.length ?? 14}`),
        gear(() => openRsiSettings(cfg.rsiCfg!, (rc) => ((cfg.rsiCfg = rc), (cfg.rsi = true), render()))),
      ),
      el('label', { class: 'row' }, checkbox(cfg.volume, (v) => (cfg.volume = v)), 'Volumen'),
      el(
        'div',
        { class: 'row' },
        el('label', {}, checkbox(cfg.pivots, (v) => (cfg.pivots = v)), ` Pivots ${cfg.pivotCfg?.type ?? ''}`),
        gear(() => openPivotSettings(cfg.pivotCfg!, (pc) => ((cfg.pivotCfg = pc), (cfg.pivots = true), render()))),
      ),
      el(
        'div',
        { class: 'row' },
        el('label', {}, checkbox(!!cfg.twoYma?.on, (v) => (cfg.twoYma!.on = v)), ' 2YMA (media de 2 años y x 5)'),
        gear(() => openTwoYmaSettings(cfg.twoYma!, (t) => ((cfg.twoYma = t), render()))),
      ),
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
