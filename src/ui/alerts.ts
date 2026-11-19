import './alerts.css';
import type { DrawingsStore } from '../core/drawings';

// ─────────────────────────────────────────────────────────────────────────────
// ALERTAS (fase 2): botón "Alertas" de la barra superior, ventana con la lista,
// el historial y la configuración de Telegram, y el botón ⏰ del editor de la
// línea horizontal para crear una alerta en su precio.
//
// Quien vigila los precios es el SERVIDOR (server/alerts.mjs), no esta ventana:
// las alertas saltan aunque la app esté cerrada mientras el servidor siga en marcha.
// Aquí sólo se crean/editan y se muestran los avisos en directo (con sonido).
// ─────────────────────────────────────────────────────────────────────────────

export type AlertCond = 'cross' | 'up' | 'down';
export interface Alert {
  id: string;
  symbol: string;
  kind: 'price' | 'rsi';
  cond: AlertCond;
  repeat: 'once' | 'always';
  note: string;
  active: boolean;
  price?: number;
  drawingId?: string;
  tf?: '1h' | '4h' | '1d' | '1w' | '1M';
  level?: number;
  length?: number;
  lastValue?: number;
  lastPrice?: number;
  fireCount?: number;
  lastFired?: number;
  createdAt: number;
  error?: string;
}
interface LogEntry {
  seq: number;
  alertId: string;
  symbol: string;
  text: string;
  value: number;
  at: number;
  telegram: string;
}
interface Status {
  feed: 'live' | 'polling' | 'down' | 'idle' | 'offline';
  feedError: string;
  symbols: string[];
  active: number;
  telegram: { hasToken: boolean; chatId: string; botName: string; enabled: boolean; fromEnv: boolean };
}

const COND_TXT: Record<AlertCond, string> = { cross: 'Cruce', up: 'Cruce hacia arriba', down: 'Cruce hacia abajo' };
const TF_TXT: Record<string, string> = { '1h': '1 hora', '4h': '4 horas', '1d': 'Diario (D)', '1w': 'Semanal (S)', '1M': 'Mensual (M)' };

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data as T;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string | null | false)[]) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    if (k === 'class') e.className = v;
    else if (k in e) (e as any)[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) if (c !== null && c !== false) e.append(c);
  return e;
}

export function fmtNum(n: number | undefined, ref = n ?? 0): string {
  if (n === undefined || !Number.isFinite(n)) return '—';
  const abs = Math.abs(ref);
  const s = String(ref);
  const dot = s.indexOf('.');
  const own = dot < 0 ? 0 : s.length - dot - 1;
  const min = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const dec = Math.min(8, Math.max(min, own));
  return n.toLocaleString('es-ES', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtRsi(n: number | undefined) {
  return n === undefined ? '—' : n.toLocaleString('es-ES', { maximumFractionDigits: 2 });
}
function parseNum(s: string): number {
  // Admite "64.663,50", "64663,5" y "64663.5".
  let t = s.trim().replace(/\s/g, '');
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  return parseFloat(t);
}
function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
function newId() {
  return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** Pitido corto (sin ficheros de sonido). */
function beep() {
  try {
    const ctx = new AudioContext();
    const play = (f: number, t0: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t0);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t0 + 0.25);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t0);
      o.stop(ctx.currentTime + t0 + 0.3);
    };
    play(880, 0);
    play(1320, 0.18);
    setTimeout(() => ctx.close(), 800);
  } catch {
    /* sin audio */
  }
}

// ── Estado compartido ───────────────────────────────────────────────────────
class AlertsStore {
  items: Alert[] = [];
  status: Status | null = null;
  private listeners = new Set<() => void>();
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit() {
    this.listeners.forEach((f) => f());
  }
  async refresh() {
    try {
      const [items, status] = await Promise.all([call<Alert[]>('GET', '/api/alerts'), call<Status>('GET', '/api/alerts-status')]);
      this.items = items;
      this.status = status;
      this.emit();
    } catch {
      /* sin servidor */
    }
  }
  forDrawing(drawingId: string) {
    return this.items.find((a) => a.drawingId === drawingId);
  }
  /** Ids de las líneas con alerta activa (para dibujar la campanita). */
  activeDrawingIds(): Set<string> {
    return new Set(this.items.filter((a) => a.active && a.drawingId).map((a) => a.drawingId!));
  }
  async save(a: Alert) {
    const saved = await call<Alert>('PUT', `/api/alerts/${encodeURIComponent(a.id)}`, a);
    await this.refresh();
    return saved;
  }
  async remove(id: string) {
    await call('DELETE', `/api/alerts/${encodeURIComponent(id)}`);
    await this.refresh();
  }
}
export const alertsStore = new AlertsStore();

// ── Avisos en directo ──────────────────────────────────────────────────────
let toastBox: HTMLElement | null = null;
function toast(entry: LogEntry, onClick: () => void) {
  if (!toastBox) {
    toastBox = el('div', { class: 'al-toasts' });
    document.body.appendChild(toastBox);
  }
  const t = el(
    'div',
    { class: 'al-toast', title: 'Clic para ir al símbolo' },
    el('div', { class: 'al-toast-h' }, '🔔 ', el('b', {}, entry.symbol), el('span', { class: 'dim' }, ' · ' + fmtDate(entry.at))),
    el('div', {}, entry.text.replace(entry.symbol + ' ', '')),
  );
  const x = el('button', { class: 'al-x', title: 'Cerrar' }, '✕');
  x.onclick = (e) => {
    e.stopPropagation();
    t.remove();
  };
  t.prepend(x);
  t.onclick = () => {
    onClick();
    t.remove();
  };
  toastBox.prepend(t);
  while (toastBox.children.length > 6) toastBox.lastElementChild!.remove();
}

// ── Ventana de crear/editar alerta ─────────────────────────────────────────
export function openAlertEditor(init: Partial<Alert> & { symbol: string }, onDone?: () => void) {
  const a: Alert = {
    id: init.id || newId(),
    symbol: init.symbol,
    kind: init.kind || 'price',
    cond: init.cond || 'cross',
    repeat: init.repeat || 'once',
    note: init.note || '',
    active: true,
    price: init.price,
    drawingId: init.drawingId,
    tf: init.tf || '1d',
    level: init.level ?? 70,
    length: init.length ?? 14,
    createdAt: init.createdAt || Date.now(),
  };
  const editing = !!init.id;
  const dlg = el('dialog', { class: 'settings al-dlg' });
  document.body.appendChild(dlg);
  const close = () => {
    dlg.close();
    dlg.remove();
  };

  const kindSel = el('select', {}, el('option', { value: 'price' }, 'Precio'), el('option', { value: 'rsi' }, 'RSI'));
  kindSel.value = a.kind;
  kindSel.disabled = !!a.drawingId;
  const condSel = el('select', {}, ...(['cross', 'up', 'down'] as AlertCond[]).map((c) => el('option', { value: c }, COND_TXT[c])));
  condSel.value = a.cond;
  const priceIn = el('input', { type: 'text', inputMode: 'decimal', value: a.price !== undefined ? fmtNum(a.price) : '', class: 'al-in' });
  const tfSel = el('select', {}, ...['1d', '1w', '1M', '4h', '1h'].map((t) => el('option', { value: t }, TF_TXT[t])));
  tfSel.value = a.tf!;
  const levelIn = el('input', { type: 'text', inputMode: 'decimal', value: String(a.level).replace('.', ','), class: 'al-in num' });
  const lenIn = el('input', { type: 'number', min: 2, max: 100, value: a.length, class: 'num' });
  const repSel = el('select', {}, el('option', { value: 'once' }, 'Sólo una vez'), el('option', { value: 'always' }, 'Cada vez (máx. 1 por minuto)'));
  repSel.value = a.repeat;
  const noteIn = el('input', { type: 'text', maxLength: 200, value: a.note, placeholder: 'Opcional: p. ej. "resistencia diaria"', class: 'al-in wide' });
  const err = el('div', { class: 'al-err' });

  const priceRow = el('div', { class: 'row' }, el('label', { class: 'al-lbl' }, 'Valor'), priceIn, a.drawingId ? el('span', { class: 'dim small' }, 'sigue a la línea si la mueves') : null);
  const rsiRows = el(
    'div',
    {},
    el('div', { class: 'row' }, el('label', { class: 'al-lbl' }, 'Temporalidad'), tfSel),
    el('div', { class: 'row' }, el('label', { class: 'al-lbl' }, 'Valor del RSI'), levelIn, el('span', { class: 'dim small' }, 'Longitud'), lenIn),
  );
  const sync = () => {
    priceRow.style.display = kindSel.value === 'price' ? '' : 'none';
    rsiRows.style.display = kindSel.value === 'rsi' ? '' : 'none';
  };
  kindSel.onchange = sync;
  sync();

  const save = async () => {
    err.textContent = '';
    a.kind = kindSel.value as Alert['kind'];
    a.cond = condSel.value as AlertCond;
    a.repeat = repSel.value as Alert['repeat'];
    a.note = noteIn.value.trim();
    a.active = true;
    if (a.kind === 'price') {
      const p = parseNum(priceIn.value);
      if (!(p > 0)) return (err.textContent = 'Escribe un precio válido.');
      a.price = p;
    } else {
      const l = parseNum(levelIn.value);
      if (!(l > 0 && l < 100)) return (err.textContent = 'El RSI va de 0 a 100.');
      a.level = l;
      a.tf = tfSel.value as Alert['tf'];
      a.length = Math.round(+lenIn.value || 14);
      a.drawingId = undefined;
    }
    try {
      await alertsStore.save(a);
      close();
      onDone?.();
    } catch (e: any) {
      err.textContent = 'No se pudo guardar: ' + e.message;
    }
  };

  const tg = alertsStore.status?.telegram;
  dlg.append(
    el('h3', {}, (editing ? 'Editar alerta · ' : 'Crear alerta · ') + a.symbol),
    el('div', { class: 'row' }, el('label', { class: 'al-lbl' }, 'Condición'), kindSel, condSel),
    priceRow,
    rsiRows,
    el('div', { class: 'row' }, el('label', { class: 'al-lbl' }, 'Activar'), repSel),
    el('div', { class: 'row' }, el('label', { class: 'al-lbl' }, 'Nota'), noteIn),
    tg && !(tg.hasToken && tg.chatId)
      ? el('p', { class: 'al-hint' }, '⚠ Telegram aún no está configurado: la alerta sólo se verá en la app. Configúralo en Alertas → Telegram.')
      : "",
    err,
    el(
      'div',
      { class: 'actions' },
      el('button', { class: 'tb', onclick: close }, 'Cancelar'),
      el('button', { class: 'tb install', onclick: save }, editing ? 'Guardar' : 'Crear'),
    ),
  );
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') {
      e.preventDefault();
      save();
    }
  });
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  (a.kind === 'price' ? priceIn : levelIn).focus();
  (a.kind === 'price' ? priceIn : levelIn).select();
}

// ── Ventana principal "Alertas" ────────────────────────────────────────────
type Tab = 'list' | 'log' | 'telegram';
let mainDlg: HTMLDialogElement | null = null;

function describe(a: Alert) {
  if (a.kind === 'rsi') return `RSI ${a.length || 14} ${TF_TXT[a.tf!] || a.tf} · ${COND_TXT[a.cond].toLowerCase()} ${fmtRsi(a.level)}`;
  return `${COND_TXT[a.cond]} ${fmtNum(a.price)}`;
}

export function openAlertsWindow(opts: { getSymbol: () => string; goSymbol: (s: string) => void; tab?: Tab }) {
  if (mainDlg) mainDlg.remove();
  const dlg = el('dialog', { class: 'settings al-main' });
  mainDlg = dlg;
  document.body.appendChild(dlg);
  let tab: Tab = opts.tab || 'list';
  let onlySymbol = false;
  const body = el('div', { class: 'al-body' });
  const tabs = el('div', { class: 'al-tabs' });
  const close = () => {
    unsub();
    dlg.close();
    dlg.remove();
    mainDlg = null;
  };

  const renderTabs = () => {
    tabs.innerHTML = '';
    const mk = (t: Tab, label: string) => {
      const b = el('button', { class: 'al-tab' + (tab === t ? ' on' : '') }, label);
      b.onclick = () => {
        tab = t;
        render();
      };
      tabs.append(b);
    };
    mk('list', `Alertas (${alertsStore.items.filter((a) => a.active).length})`);
    mk('log', 'Historial');
    mk('telegram', 'Telegram' + (alertsStore.status?.telegram.chatId ? ' ✓' : ''));
  };

  const renderList = () => {
    const sym = opts.getSymbol();
    const items = alertsStore.items
      .filter((a) => !onlySymbol || a.symbol === sym)
      .sort((x, y) => Number(y.active) - Number(x.active) || x.symbol.localeCompare(y.symbol) || (x.price ?? 0) - (y.price ?? 0));
    const filter = el('input', { type: 'checkbox', checked: onlySymbol });
    filter.onchange = () => {
      onlySymbol = filter.checked;
      render();
    };
    const st = alertsStore.status;
    const feedTxt =
      st?.feed === 'live'
        ? '● Vigilando precios en tiempo real'
        : st?.feed === 'polling'
          ? '● Vigilando (consulta cada 5 s; el tiempo real se está reconectando)'
          : st?.feed === 'down'
            ? '● Sin conexión con Binance: reintentando…'
            : st?.feed === 'offline'
              ? '● Vigilancia desactivada'
              : '○ No hay alertas de precio activas';
    body.append(
      el(
        'div',
        { class: 'row al-top' },
        el('button', { class: 'tb install', onclick: () => openAlertEditor({ symbol: sym }) }, '＋ Nueva alerta de ' + sym),
        el('label', { class: 'small' }, filter, ' Sólo ' + sym),
        el('span', { class: 'grow' }),
        el('span', { class: 'small al-feed ' + (st?.feed || '') , title: st?.feedError || '' }, feedTxt),
      ),
    );
    if (!items.length) {
      body.append(el('p', { class: 'dim al-empty' }, 'No hay alertas. Crea una con el botón de arriba o seleccionando una línea horizontal y pulsando ⏰.'));
      return;
    }
    const table = el('div', { class: 'al-list' });
    for (const a of items) {
      const sw = el('input', { type: 'checkbox', checked: a.active, title: a.active ? 'Activa (clic para pausar)' : 'Parada (clic para activar)' });
      sw.onchange = async () => {
        await alertsStore.save({ ...a, active: sw.checked }).catch(() => {});
        render();
      };
      const extra =
        a.kind === 'rsi'
          ? a.error
            ? '⚠ ' + a.error
            : a.lastValue !== undefined
              ? 'RSI ahora ' + fmtRsi(a.lastValue)
              : ''
          : a.lastPrice !== undefined
            ? 'precio ' + fmtNum(a.lastPrice, a.price)
            : '';
      table.append(
        el(
          'div',
          { class: 'al-row' + (a.active ? '' : ' off') },
          sw,
          el('a', { class: 'al-sym', href: '#', onclick: (e: Event) => (e.preventDefault(), opts.goSymbol(a.symbol)) }, a.symbol),
          el(
            'div',
            { class: 'al-desc' },
            el('div', {}, describe(a), a.drawingId ? el('span', { class: 'al-tag', title: 'Ligada a una línea horizontal' }, 'línea') : null, a.repeat === 'always' ? el('span', { class: 'al-tag' }, 'cada vez') : null),
            el('div', { class: 'dim small' }, [a.note, extra, a.fireCount ? `saltó ${a.fireCount}× (última ${fmtDate(a.lastFired!)})` : ''].filter(Boolean).join(' · ')),
          ),
          el('button', { class: 'link', title: 'Editar', onclick: () => openAlertEditor(a, render) }, '✎'),
          el(
            'button',
            {
              class: 'link danger',
              title: 'Borrar',
              onclick: async () => {
                await alertsStore.remove(a.id).catch(() => {});
                render();
              },
            },
            '✕',
          ),
        ),
      );
    }
    body.append(table);
  };

  const renderLog = async () => {
    const box = el('div', { class: 'al-log' }, el('p', { class: 'dim' }, 'Cargando…'));
    const clear = el('button', { class: 'tb' }, 'Vaciar historial');
    clear.onclick = async () => {
      await call('DELETE', '/api/alerts-log').catch(() => {});
      render();
    };
    body.append(el('div', { class: 'row al-top' }, el('span', { class: 'grow dim small' }, 'Últimos avisos (los más recientes arriba)'), clear), box);
    try {
      const log = await call<LogEntry[]>('GET', '/api/alerts-log?limit=200');
      box.innerHTML = '';
      if (!log.length) box.append(el('p', { class: 'dim al-empty' }, 'Todavía no ha saltado ninguna alerta.'));
      for (const e of log) {
        const tg = e.telegram === 'ok' ? '✓ Telegram' : e.telegram === 'off' ? 'sin Telegram' : e.telegram ? '⚠ ' + e.telegram : '…';
        box.append(
          el(
            'div',
            { class: 'al-row' },
            el('span', { class: 'dim small al-when' }, fmtDate(e.at)),
            el('div', { class: 'al-desc' }, e.text),
            el('span', { class: 'small ' + (e.telegram === 'ok' ? 'up' : 'dim') }, tg),
          ),
        );
      }
    } catch (e: any) {
      box.innerHTML = '';
      box.append(el('p', { class: 'al-err' }, 'No se pudo leer: ' + e.message));
    }
  };

  const renderTelegram = () => {
    const tg = alertsStore.status?.telegram;
    const tokenIn = el('input', { type: 'password', class: 'al-in wide', placeholder: tg?.hasToken ? '•••••••• (ya guardado; pega otro para cambiarlo)' : '123456789:AAH…', autocomplete: 'off' });
    const msg = el('div', { class: 'al-msg' });
    const say = (t: string, ok = true) => {
      msg.textContent = t;
      msg.className = 'al-msg ' + (ok ? 'ok' : 'bad');
    };
    const saveToken = el('button', { class: 'tb install' }, 'Guardar token');
    saveToken.onclick = async () => {
      if (!tokenIn.value.trim()) return say('Pega primero el token que te dio BotFather.', false);
      say('Comprobando con Telegram…');
      try {
        const r = await call<{ botName: string }>('PUT', '/api/telegram', { token: tokenIn.value.trim() });
        await alertsStore.refresh();
        render();
        say(`Token correcto: tu bot es @${r.botName}. Ahora haz el paso 3.`);
      } catch (e: any) {
        say(e.message, false);
      }
    };
    const detect = el('button', { class: 'tb install', disabled: !tg?.hasToken }, 'Buscar mi chat');
    detect.onclick = async () => {
      say('Buscando…');
      try {
        const r = await call<{ chatId: string; who: string }>('POST', '/api/telegram/detect');
        await alertsStore.refresh();
        render();
        say(`Encontrado: ${r.who || 'chat'} (${r.chatId}). Pulsa "Enviar prueba".`);
      } catch (e: any) {
        say(e.message, false);
      }
    };
    const test = el('button', { class: 'tb install', disabled: !tg?.chatId }, 'Enviar prueba');
    test.onclick = async () => {
      say('Enviando…');
      try {
        await call('POST', '/api/telegram/test');
        say('Enviado. Mira tu Telegram: tiene que haber llegado "Las alertas llegarán a este chat".');
      } catch (e: any) {
        say('No se pudo enviar: ' + e.message, false);
      }
    };
    const enabled = el('input', { type: 'checkbox', checked: tg?.enabled ?? true });
    enabled.onchange = async () => {
      await call('PUT', '/api/telegram', { enabled: enabled.checked }).catch(() => {});
      await alertsStore.refresh();
    };
    const forget = el('button', { class: 'link danger' }, 'Olvidar bot');
    forget.onclick = async () => {
      await call('PUT', '/api/telegram', { token: '', chatId: '' }).catch(() => {});
      await alertsStore.refresh();
      render();
    };
    const done = (ok: boolean) => el('span', { class: ok ? 'up' : 'dim' }, ok ? ' ✓' : '');

    body.append(
      el(
        'div',
        { class: 'al-steps' },
        el('h4', {}, '1. Crea tu bot (sólo una vez)', done(!!tg?.hasToken)),
        el(
          'ol',
          {},
          el('li', {}, 'En Telegram, busca ', el('b', {}, '@BotFather'), ' (el que tiene la marca azul de verificado) y ábrelo.'),
          el('li', {}, 'Pulsa ', el('b', {}, 'INICIAR'), ' y escribe ', el('code', {}, '/newbot'), '.'),
          el('li', {}, 'Te pide un nombre (p. ej. ', el('i', {}, 'Alertas Jose'), ') y luego un usuario que acabe en ', el('b', {}, 'bot'), ' (p. ej. ', el('i', {}, 'alertas_jose_elche_bot'), ').'),
          el('li', {}, 'Te contesta con un ', el('b', {}, 'token'), ' parecido a ', el('code', {}, '7123456789:AAHk…'), '. Cópialo. Es como una contraseña: no lo compartas.'),
        ),
        el('h4', {}, '2. Pega aquí el token', done(!!tg?.hasToken)),
        tg?.fromEnv
          ? el('p', { class: 'dim small' }, 'El token está puesto en el servidor (variable TELEGRAM_BOT_TOKEN).')
          : el('div', { class: 'row' }, tokenIn, saveToken),
        tg?.botName ? el('p', { class: 'small' }, 'Bot: ', el('b', {}, '@' + tg.botName)) : null,
        el('h4', {}, '3. Saluda a tu bot', done(!!tg?.chatId)),
        el(
          'p',
          { class: 'small' },
          'En Telegram abre tu bot nuevo',
          tg?.botName ? el('span', {}, ' (', el('a', { href: `https://t.me/${tg.botName}`, target: '_blank' }, '@' + tg.botName), ')') : '',
          ', pulsa ',
          el('b', {}, 'INICIAR'),
          ' y después pulsa aquí:',
        ),
        el('div', { class: 'row' }, detect, tg?.chatId ? el('span', { class: 'small dim' }, 'Chat: ' + tg.chatId) : null),
        el('h4', {}, '4. Prueba'),
        el('div', { class: 'row' }, test, el('label', { class: 'small' }, enabled, ' Enviar las alertas a Telegram'), el('span', { class: 'grow' }), tg?.hasToken && !tg.fromEnv ? forget : null),
        msg,
      ),
    );
  };

  const render = () => {
    renderTabs();
    body.innerHTML = '';
    if (tab === 'list') renderList();
    else if (tab === 'log') renderLog();
    else renderTelegram();
  };
  const unsub = alertsStore.subscribe(() => {
    if (tab !== 'telegram') render();
    else renderTabs();
  });

  dlg.append(el('div', { class: 'al-head' }, el('h3', {}, 'Alertas'), el('button', { class: 'icon-btn', title: 'Cerrar', onclick: close }, '✕')), tabs, body);
  dlg.addEventListener('close', () => {
    unsub();
    dlg.remove();
    if (mainDlg === dlg) mainDlg = null;
  });
  render();
  dlg.showModal();
  alertsStore.refresh();
}

// ── Puesta en marcha ───────────────────────────────────────────────────────
export function initAlerts(opts: { drawings: DrawingsStore; getSymbol: () => string; goSymbol: (s: string) => void }) {
  const { drawings } = opts;

  // Botón de la barra superior.
  const btn = el('button', { class: 'tb al-btn', title: 'Alertas de precio y RSI (avisos por Telegram)' }, '⏰ Alertas', el('span', { class: 'al-badge' }));
  btn.onclick = () => openAlertsWindow(opts);
  const anchor = document.querySelector('#server-warn') || document.querySelector('header .spacer');
  anchor?.parentElement?.insertBefore(btn, anchor);
  const badge = btn.querySelector('.al-badge') as HTMLElement;

  // Botón ⏰ en el editor de la línea seleccionada.
  const editor = document.querySelector('#line-editor');
  const bell = el('button', { class: 'tb al-bell', title: 'Añadir alerta en el precio de esta línea' }, '⏰');
  const cfgBtn = editor?.querySelector('.le-cfg');
  if (editor) editor.insertBefore(bell, cfgBtn || null);
  bell.onclick = () => {
    const d = drawings.selected;
    if (!d || d.type !== 'hline') return;
    const ex = alertsStore.forDrawing(d.id);
    if (ex) openAlertEditor(ex);
    else openAlertEditor({ symbol: d.symbol, price: d.price, drawingId: d.id, kind: 'price' });
  };
  const renderBell = () => {
    const d = drawings.selected;
    bell.style.display = d && d.type === 'hline' ? '' : 'none';
    const ex = d ? alertsStore.forDrawing(d.id) : undefined;
    bell.classList.toggle('on', !!ex?.active);
    bell.title = ex ? (ex.active ? 'Esta línea tiene una alerta activa (clic para editarla)' : 'Alerta parada (clic para editarla y reactivarla)') : 'Añadir alerta en el precio de esta línea';
  };
  drawings.subscribe(renderBell);

  alertsStore.subscribe(() => {
    const n = alertsStore.items.filter((a) => a.active).length;
    badge.textContent = n ? String(n) : '';
    const tg = alertsStore.status?.telegram;
    btn.classList.toggle('warn', n > 0 && !!tg && !(tg.hasToken && tg.chatId && tg.enabled));
    renderBell();
  });
  alertsStore.refresh();

  // Avisos en directo del servidor.
  if (typeof EventSource !== 'undefined') {
    const es = new EventSource('/api/events');
    let t: number | null = null;
    es.addEventListener('changed', () => {
      if (t) clearTimeout(t);
      t = window.setTimeout(() => alertsStore.refresh(), 150);
    });
    es.addEventListener('fired', (ev) => {
      const entry = JSON.parse((ev as MessageEvent).data) as LogEntry;
      beep();
      toast(entry, () => opts.goSymbol(entry.symbol));
      try {
        if ('Notification' in window && Notification.permission === 'granted' && document.hidden) new Notification('🔔 ' + entry.symbol, { body: entry.text });
      } catch {
        /* sin notificaciones */
      }
    });
    es.addEventListener('open', () => alertsStore.refresh());
  }
  // Por si acaso (p. ej. el lastPrice de la lista): refresco cada 30 s.
  setInterval(() => alertsStore.refresh(), 30_000);
}
