// Ventana "Fuentes de datos": dónde se pegan las claves de Alpaca (acciones) y
// Capital.com (oro, plata y forex). Las claves se guardan en el servidor de la app
// (en este ordenador) y nunca vuelven al navegador: aquí sólo se ve si están puestas.

interface Info {
  alpaca: { configured: boolean; keyId: string; plan: 'basic' | 'sip'; fromEnv: boolean; stream: string; streamMsg: string };
  capital: { configured: boolean; email: string; apiKey: string; demo: boolean; fromEnv: boolean; stream: string; streamMsg: string };
}

type Tab = 'alpaca' | 'capital' | 'diff';

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

const link = (href: string, text: string) => el('a', { href, target: '_blank', rel: 'noopener' }, text);

/** Abre la ventana. Al cerrarla, si se cambiaron claves, se llama a `onChanged` (para recargar los gráficos). */
export function openDataSources(onChanged: () => void, startTab: Tab = 'alpaca') {
  let changed = false;
  const onSaved = () => (changed = true);
  const dlg = el('dialog', { class: 'settings al-main ds-dlg' });
  document.body.appendChild(dlg);
  let tab: Tab = startTab;
  let info: Info | null = null;
  const body = el('div', { class: 'al-body' });
  const tabs = el('div', { class: 'al-tabs' });
  const close = () => dlg.close();

  const renderTabs = () => {
    tabs.innerHTML = '';
    const mk = (t: Tab, label: string, ok?: boolean) => {
      const b = el('button', { class: 'al-tab' + (tab === t ? ' on' : '') }, label, ok === undefined ? null : el('span', { class: ok ? 'up' : 'dim' }, ok ? ' ✓' : ' ·'));
      b.onclick = () => {
        tab = t;
        render();
      };
      tabs.append(b);
    };
    mk('alpaca', 'Acciones (Alpaca)', info?.alpaca.configured);
    mk('capital', 'Oro, plata y forex (Capital.com)', info?.capital.configured);
    mk('diff', 'Diferencias con TradingView');
  };

  const msgBox = () => {
    const msg = el('div', { class: 'al-msg' });
    const say = (t: string, ok = true) => {
      msg.textContent = t;
      msg.className = 'al-msg ' + (ok ? 'ok' : 'bad');
    };
    return { msg, say };
  };

  const streamLine = (state: string, m: string) =>
    el(
      'p',
      { class: 'small ' + (state === 'open' ? 'up' : state === 'error' ? 'al-err' : 'dim') },
      state === 'open' ? 'Tiempo real: conectado.' : state === 'error' ? `Tiempo real: ${m}` : state === 'connecting' ? `Tiempo real: conectando… ${m}` : 'Tiempo real: se conecta al abrir un símbolo de esta fuente.',
    );

  const renderAlpaca = () => {
    const a = info!.alpaca;
    const keyIn = el('input', { class: 'al-in wide', placeholder: a.configured ? `${a.keyId} (ya guardado; pega otro para cambiarlo)` : 'PK…', autocomplete: 'off', spellcheck: false });
    const secIn = el('input', { class: 'al-in wide', type: 'password', placeholder: a.configured ? '•••••••• (ya guardado)' : 'Secret Key', autocomplete: 'off' });
    const plan = el(
      'select',
      { class: 'al-in' },
      el('option', { value: 'basic', selected: a.plan !== 'sip' }, 'Gratis (Basic): tiempo real de IEX'),
      el('option', { value: 'sip', selected: a.plan === 'sip' }, 'De pago (Algo Trader Plus, 99 $/mes): todas las bolsas'),
    );
    const { msg, say } = msgBox();
    const save = el('button', { class: 'tb install' }, 'Guardar y probar');
    save.onclick = async () => {
      if (!a.configured && (!keyIn.value.trim() || !secIn.value.trim())) return say('Pega el Key ID y el Secret Key.', false);
      say('Guardando…');
      try {
        info = await call<Info>('PUT', '/api/datasources/alpaca', { keyId: keyIn.value, secret: secIn.value, plan: plan.value });
        const t = await call<{ ok: boolean; msg: string }>('POST', '/api/datasources/alpaca/test');
        sayAfter(t.msg, t.ok);
        onSaved();
      } catch (e: any) {
        say(e.message, false);
      }
    };
    const test = el('button', { class: 'tb', disabled: !a.configured }, 'Probar');
    test.onclick = async () => {
      say('Probando…');
      const t = await call<{ ok: boolean; msg: string }>('POST', '/api/datasources/alpaca/test').catch((e) => ({ ok: false, msg: e.message }));
      say(t.msg, t.ok);
    };
    const forget = el('button', { class: 'link danger', disabled: !a.configured || a.fromEnv }, 'Borrar claves');
    forget.onclick = async () => {
      info = await call<Info>('DELETE', '/api/datasources/alpaca');
      render();
      onSaved();
    };
    body.append(
      el(
        'div',
        { class: 'al-steps' },
        el('p', { class: 'small' }, 'Datos de acciones de Nasdaq y NYSE. El plan gratuito basta para empezar.'),
        el('h4', {}, '1. Crea la cuenta (gratis, sólo una vez)', el('span', { class: a.configured ? 'up' : 'dim' }, a.configured ? ' ✓' : '')),
        el(
          'ol',
          {},
          el('li', {}, 'Entra en ', link('https://app.alpaca.markets/signup', 'alpaca.markets'), ' y regístrate con tu correo. Basta con la cuenta ', el('b', {}, 'Paper'), ' (dinero ficticio): no hace falta enviar documentos.'),
          el('li', {}, 'En el panel de ', el('b', {}, 'Paper Trading'), ', a la derecha, busca ', el('b', {}, 'API Keys'), ' y pulsa ', el('b', {}, 'Generate New Keys'), '.'),
          el('li', {}, 'Copia el ', el('b', {}, 'Key ID'), ' y el ', el('b', {}, 'Secret Key'), '. El Secret sólo se ve una vez.'),
        ),
        el('h4', {}, '2. Pega aquí las claves'),
        a.fromEnv
          ? el('p', { class: 'dim small' }, 'Las claves están puestas en el servidor (variables ALPACA_KEY_ID y ALPACA_SECRET_KEY).')
          : el('div', {}, el('div', { class: 'row' }, el('span', { class: 'al-lbl' }, 'Key ID'), keyIn), el('div', { class: 'row' }, el('span', { class: 'al-lbl' }, 'Secret Key'), secIn)),
        el('div', { class: 'row' }, el('span', { class: 'al-lbl' }, 'Plan'), plan),
        el('div', { class: 'row' }, save, test, el('span', { class: 'grow' }), forget),
        msg,
        a.configured ? streamLine(a.stream, a.streamMsg) : null,
        el(
          'p',
          { class: 'dim small' },
          'Las claves se guardan sólo en este ordenador (en la base de datos de la app), nunca en el código ni en internet. Si cambias al plan de pago en Alpaca, elige aquí "De pago".',
        ),
      ),
    );
  };

  const renderCapital = () => {
    const c = info!.capital;
    const keyIn = el('input', { class: 'al-in wide', placeholder: c.configured ? `${c.apiKey} (ya guardada; pega otra para cambiarla)` : 'Clave API', autocomplete: 'off', spellcheck: false });
    const mailIn = el('input', { class: 'al-in wide', type: 'email', placeholder: c.configured ? c.email : 'tu correo de Capital.com', autocomplete: 'off' });
    const passIn = el('input', { class: 'al-in wide', type: 'password', placeholder: c.configured ? '•••••••• (ya guardada)' : 'contraseña de la CLAVE API', autocomplete: 'new-password' });
    const demo = el('input', { type: 'checkbox', checked: c.demo });
    const { msg, say } = msgBox();
    const save = el('button', { class: 'tb install' }, 'Guardar y probar');
    save.onclick = async () => {
      if (!c.configured && (!keyIn.value.trim() || !mailIn.value.trim() || !passIn.value)) return say('Rellena la clave API, el correo y la contraseña de la clave.', false);
      say('Guardando y entrando en Capital.com…');
      try {
        info = await call<Info>('PUT', '/api/datasources/capital', { apiKey: keyIn.value, email: mailIn.value, password: passIn.value, demo: demo.checked });
        const t = await call<{ ok: boolean; msg: string }>('POST', '/api/datasources/capital/test');
        sayAfter(t.msg, t.ok);
        onSaved();
      } catch (e: any) {
        say(e.message, false);
      }
    };
    const test = el('button', { class: 'tb', disabled: !c.configured }, 'Probar');
    test.onclick = async () => {
      say('Probando…');
      const t = await call<{ ok: boolean; msg: string }>('POST', '/api/datasources/capital/test').catch((e) => ({ ok: false, msg: e.message }));
      say(t.msg, t.ok);
    };
    const forget = el('button', { class: 'link danger', disabled: !c.configured || c.fromEnv }, 'Borrar datos');
    forget.onclick = async () => {
      info = await call<Info>('DELETE', '/api/datasources/capital');
      render();
      onSaved();
    };
    body.append(
      el(
        'div',
        { class: 'al-steps' },
        el('p', { class: 'small' }, 'Oro (XAUUSD), plata (XAGUSD) y pares de divisas (EURUSD…). Gratis con una cuenta demo. (OANDA no deja abrir cuentas demo desde España.)'),
        el('h4', {}, '1. Crea la cuenta demo y la clave (sólo una vez)', el('span', { class: c.configured ? 'up' : 'dim' }, c.configured ? ' ✓' : '')),
        el(
          'ol',
          {},
          el('li', {}, 'Entra en ', link('https://capital.com/', 'capital.com'), ' y abre una cuenta ', el('b', {}, 'demo'), '.'),
          el('li', {}, 'En ', el('b', {}, 'Ajustes'), ', activa la ', el('b', {}, 'verificación en dos pasos (2FA)'), '. Sin ella no deja crear la clave.'),
          el('li', {}, 'En ', el('b', {}, 'Ajustes → API integrations → Generate new key'), '. Te pide inventar una ', el('b', {}, 'contraseña para la clave'), ' (distinta de la de tu cuenta).'),
          el('li', {}, 'Copia la ', el('b', {}, 'clave API'), '. Con ella, tu correo y esa contraseña, la app entra sola.'),
        ),
        el('h4', {}, '2. Pega aquí los datos'),
        c.fromEnv
          ? el('p', { class: 'dim small' }, 'Los datos están puestos en el servidor (variables CAPITAL_API_KEY, CAPITAL_EMAIL y CAPITAL_PASSWORD).')
          : el(
              'div',
              {},
              el('div', { class: 'row' }, el('span', { class: 'al-lbl' }, 'Clave API'), keyIn),
              el('div', { class: 'row' }, el('span', { class: 'al-lbl' }, 'Correo'), mailIn),
              el('div', { class: 'row' }, el('span', { class: 'al-lbl' }, 'Contraseña de la clave'), passIn),
              el('label', { class: 'row small' }, demo, ' Es una cuenta demo (déjalo marcado salvo que la clave sea de tu cuenta real)'),
            ),
        el('div', { class: 'row' }, save, test, el('span', { class: 'grow' }), forget),
        msg,
        c.configured ? streamLine(c.stream, c.streamMsg) : null,
        el('p', { class: 'dim small' }, 'Los datos se guardan sólo en este ordenador. La app sólo LEE precios: nunca abre operaciones.'),
      ),
    );
  };

  const renderDiff = () => {
    const li = (...c: (Node | string)[]) => el('li', {}, ...c);
    body.append(
      el(
        'div',
        { class: 'al-steps' },
        el('h4', {}, 'Acciones (Alpaca, plan gratuito)'),
        el(
          'ul',
          {},
          li(el('b', {}, 'Precio: '), 'prácticamente igual. Hasta hace 15 minutos las velas son de TODAS las bolsas; los últimos 15 minutos y el tiempo real vienen sólo de la bolsa IEX, así que los máximos y mínimos de esas velas pueden diferir unos céntimos.'),
          li(el('b', {}, 'Volumen: '), 'en las velas antiguas es el volumen total (más alto que el que ves en TradingView con "NASDAQ por Cboe One", que también es parcial). En los últimos 15 minutos y en tiempo real es sólo el de IEX (≈2-3 % del total), así que las barras recientes salen mucho más bajas.'),
          li(el('b', {}, 'Horario: '), 'sólo sesión regular (9:30-16:00 de Nueva York; 15:30-22:00 en España), como TradingView por defecto. Sin pre ni post.'),
          li(el('b', {}, 'Lista de seguimiento: '), 'se actualiza cada 5 segundos; el "Cambio" es frente al cierre anterior.'),
          li(el('b', {}, '45 segundos: '), 'se construye con las operaciones de IEX (hay pocas en valores con poco volumen).'),
          li(el('b', {}, 'Para tenerlo todo igual: '), 'el plan Algo Trader Plus de Alpaca (99 $/mes) da todas las bolsas en tiempo real.'),
        ),
        el('h4', {}, 'Oro, plata y forex (Capital.com)'),
        el(
          'ul',
          {},
          li(el('b', {}, 'Precio: '), 'es el de Capital.com (precio de venta, "bid"). Compáralo en TradingView con ', el('code', {}, 'CAPITALCOM:GOLD'), ', ', el('code', {}, 'CAPITALCOM:SILVER'), ' o ', el('code', {}, 'CAPITALCOM:EURUSD'), ' para que sea la misma fuente. Frente a OANDA:XAUUSD u otros brókers puede haber unos céntimos o décimas de diferencia.'),
          li(el('b', {}, 'Volumen: '), 'no hay (el oro al contado y el forex no tienen un volumen central).'),
          li(el('b', {}, 'Velas: '), 'el día empieza a las 17:00 de Nueva York (forex) o a las 18:00 (oro y plata), como TradingView. La vela de 45 segundos no tiene histórico: se va formando mientras la app está abierta.'),
        ),
        el('h4', {}, 'Cripto (Binance)'),
        el('p', { class: 'small' }, 'Sin cambios: igual que BINANCE:BTCUSDT en TradingView.'),
      ),
    );
  };

  let pending: { t: string; ok: boolean } | null = null;
  const sayAfter = (t: string, ok: boolean) => {
    pending = { t, ok };
    render();
  };

  const render = async () => {
    try {
      info = await call<Info>('GET', '/api/datasources');
    } catch (e: any) {
      body.innerHTML = '';
      body.append(el('p', { class: 'al-err' }, 'No se pudo hablar con el servidor de la app: ' + e.message));
      return;
    }
    renderTabs();
    body.innerHTML = '';
    if (tab === 'alpaca') renderAlpaca();
    else if (tab === 'capital') renderCapital();
    else renderDiff();
    if (pending) {
      const m = body.querySelector('.al-msg') as HTMLElement | null;
      if (m) {
        m.textContent = pending.t;
        m.className = 'al-msg ' + (pending.ok ? 'ok' : 'bad');
      }
      pending = null;
    }
  };

  dlg.append(el('div', { class: 'al-head' }, el('h3', {}, 'Fuentes de datos'), el('button', { class: 'icon-btn', title: 'Cerrar', onclick: close }, '✕')), tabs, body);
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (changed) onChanged();
  });
  dlg.showModal();
  render();
}
