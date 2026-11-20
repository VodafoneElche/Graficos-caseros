// ─────────────────────────────────────────────────────────────────────────────
// FUENTES DE DATOS CON CLAVE (fase 4): acciones (Alpaca) y oro/plata/forex (Capital.com).
//
// Las claves NUNCA van en el código: se pegan en la app (botón "Fuentes de datos")
// y se guardan en la base de datos local (tabla `secrets`), o se ponen en variables
// de entorno. El navegador nunca las ve: todas las peticiones pasan por aquí.
//
//   /proxy/alpaca/...    histórico de velas, operaciones e instantáneas (REST)
//   /proxy/capital/...   histórico de velas y datos de mercado (REST)
//   /stream/alpaca       tiempo real (operaciones) como "Server-Sent Events"
//   /stream/capital      tiempo real (precios bid/ask) como "Server-Sent Events"
//   /api/datasources     ver/guardar/probar las claves
//
// El servidor mantiene UNA sola conexión WebSocket con cada proveedor (Alpaca
// gratis sólo permite una) y la reparte entre todas las ventanas abiertas.
//
// Variables de entorno opcionales (tienen prioridad sobre lo guardado en la app):
//   ALPACA_KEY_ID, ALPACA_SECRET_KEY, ALPACA_PLAN (basic | sip)
//   CAPITAL_API_KEY, CAPITAL_EMAIL, CAPITAL_PASSWORD, CAPITAL_DEMO (1 | 0)
// ─────────────────────────────────────────────────────────────────────────────

const URLS = {
  alpacaData: process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets',
  alpacaTrading: process.env.ALPACA_TRADING_URL ? [process.env.ALPACA_TRADING_URL] : ['https://paper-api.alpaca.markets', 'https://api.alpaca.markets'],
  alpacaStream: process.env.ALPACA_STREAM_URL || 'wss://stream.data.alpaca.markets/v2',
  capitalDemo: process.env.CAPITAL_API_URL || 'https://demo-api-capital.backend-capital.com',
  capitalLive: process.env.CAPITAL_API_URL || 'https://api-capital.backend-capital.com',
  capitalStream: process.env.CAPITAL_STREAM_URL || 'wss://api-streaming-capital.backend-capital.com/connect',
};

const SYM_RE = /^[A-Z][A-Z0-9.]{0,9}$/;
const EPIC_RE = /^[A-Z0-9._]{1,40}$/;

function mask(s) {
  s = String(s || '');
  if (!s) return '';
  return s.length <= 6 ? '••••' : s.slice(0, 3) + '••••' + s.slice(-3);
}

export function createMarketData({ db, log = console.log }) {
  db.exec(`CREATE TABLE IF NOT EXISTS secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);`);
  const qGet = db.prepare('SELECT value FROM secrets WHERE name = ?');
  const qPut = db.prepare(`INSERT INTO secrets (name, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`);
  const qDel = db.prepare('DELETE FROM secrets WHERE name = ?');

  function stored(name) {
    const r = qGet.get(name);
    try {
      return r ? JSON.parse(r.value) : null;
    } catch {
      return null;
    }
  }

  function alpacaCfg() {
    const s = stored('alpaca') || {};
    const keyId = process.env.ALPACA_KEY_ID || s.keyId || '';
    const secret = process.env.ALPACA_SECRET_KEY || s.secret || '';
    const plan = (process.env.ALPACA_PLAN || s.plan || 'basic') === 'sip' ? 'sip' : 'basic';
    return { keyId, secret, plan, ok: !!(keyId && secret), fromEnv: !!process.env.ALPACA_KEY_ID };
  }

  function capitalCfg() {
    const s = stored('capital') || {};
    const apiKey = process.env.CAPITAL_API_KEY || s.apiKey || '';
    const email = process.env.CAPITAL_EMAIL || s.email || '';
    const password = process.env.CAPITAL_PASSWORD || s.password || '';
    const demo = process.env.CAPITAL_DEMO != null ? process.env.CAPITAL_DEMO !== '0' : s.demo !== false;
    return { apiKey, email, password, demo, ok: !!(apiKey && email && password), fromEnv: !!process.env.CAPITAL_API_KEY };
  }

  // ══ ALPACA ══════════════════════════════════════════════════════════════════

  function alpacaHeaders() {
    const c = alpacaCfg();
    return { 'APCA-API-KEY-ID': c.keyId, 'APCA-API-SECRET-KEY': c.secret, Accept: 'application/json' };
  }

  function alpacaError(status, body) {
    let msg = '';
    try {
      msg = JSON.parse(body).message || '';
    } catch {
      msg = String(body || '').slice(0, 200);
    }
    if (status === 401) return 'Alpaca no acepta las claves (Key ID o Secret incorrectos). Revísalas en "Fuentes de datos".';
    if (status === 403) return `Alpaca: tu plan no incluye estos datos (${msg || 'prohibido'}).`;
    if (status === 429) return 'Alpaca: demasiadas peticiones seguidas; espera un minuto.';
    if (status === 422 || status === 400) return `Alpaca: ${msg || 'petición no válida'}`;
    if (status === 404) return `Alpaca: no encontrado (${msg || 'símbolo desconocido'})`;
    return `Alpaca: error ${status} ${msg}`;
  }

  let assetsCache = null; // { t, body }

  async function alpacaFetch(base, p) {
    const r = await fetch(base + p, { headers: alpacaHeaders(), signal: AbortSignal.timeout(15000) });
    const body = await r.text();
    return { status: r.status, body };
  }

  async function handleAlpacaProxy(req, res, url, send) {
    if (req.method !== 'GET') return send(res, 405, { error: 'sólo lectura' });
    if (!alpacaCfg().ok) return send(res, 412, { error: 'Faltan las claves de Alpaca: pégalas con el botón 🔑 de arriba a la derecha' });
    const p = url.pathname.replace(/^\/proxy\/alpaca/, '');
    const m = p.match(/^\/v2\/stocks\/([^/]+)\/(bars|trades)$/);
    const allowed = p === '/v2/stocks/bars' || p === '/v2/stocks/snapshots' || (m && SYM_RE.test(m[1]));
    try {
      if (p === '/v2/assets') {
        if (assetsCache && Date.now() - assetsCache.t < 12 * 3600_000) return send(res, 200, assetsCache.body, { 'Content-Type': 'application/json' });
        let last = null;
        for (const base of URLS.alpacaTrading) {
          last = await alpacaFetch(base, '/v2/assets?status=active&asset_class=us_equity');
          if (last.status === 200) {
            // Sólo lo que hace falta para el buscador (la lista completa pesa varios MB).
            const list = JSON.parse(last.body)
              .filter((a) => a.tradable && ['NASDAQ', 'NYSE', 'ARCA', 'AMEX', 'BATS'].includes(a.exchange))
              .map((a) => ({ s: a.symbol, n: a.name, x: a.exchange }));
            assetsCache = { t: Date.now(), body: JSON.stringify(list) };
            return send(res, 200, assetsCache.body, { 'Content-Type': 'application/json' });
          }
        }
        return send(res, last?.status || 502, { error: alpacaError(last?.status, last?.body) });
      }
      if (!allowed) return send(res, 404, { error: 'ruta no permitida' });
      const r = await alpacaFetch(URLS.alpacaData, p + url.search);
      if (r.status === 200) return send(res, 200, r.body, { 'Content-Type': 'application/json' });
      return send(res, r.status, { error: alpacaError(r.status, r.body) });
    } catch (e) {
      return send(res, 502, { error: `No se pudo contactar con Alpaca (${e.message})` });
    }
  }

  // Tiempo real: una conexión WebSocket con Alpaca, operaciones (trades) de los símbolos pedidos.
  const alpacaClients = new Set(); // { syms:Set, send(ev,data) }
  const alpacaStream = {
    ws: null,
    authed: false,
    subscribed: new Set(),
    state: 'closed',
    msg: '',
    retry: null,
    attempt: 0,
    idleTimer: null,
    blockedUntilKeysChange: false,
  };

  function alpacaStatus(state, msg = '') {
    alpacaStream.state = state;
    alpacaStream.msg = msg;
    for (const c of alpacaClients) c.send('status', { state, msg });
  }

  function alpacaWanted() {
    const all = new Set();
    for (const c of alpacaClients) for (const s of c.syms) all.add(s);
    return all;
  }

  function alpacaSync() {
    const st = alpacaStream;
    const want = alpacaWanted();
    if (!want.size) {
      // Nadie mira: cerrar al cabo de un rato.
      if (!st.idleTimer && st.ws) st.idleTimer = setTimeout(() => {
        st.idleTimer = null;
        if (!alpacaWanted().size && st.ws) st.ws.close();
      }, 60_000);
      return;
    }
    if (st.idleTimer) {
      clearTimeout(st.idleTimer);
      st.idleTimer = null;
    }
    if (!st.ws) return alpacaConnect();
    if (!st.authed) return;
    const add = [...want].filter((s) => !st.subscribed.has(s));
    const del = [...st.subscribed].filter((s) => !want.has(s));
    if (del.length) st.ws.send(JSON.stringify({ action: 'unsubscribe', trades: del }));
    if (add.length) st.ws.send(JSON.stringify({ action: 'subscribe', trades: add }));
    st.subscribed = want;
  }

  function alpacaConnect() {
    const st = alpacaStream;
    const cfg = alpacaCfg();
    if (st.ws || st.retry || st.blockedUntilKeysChange) return;
    if (!cfg.ok) return alpacaStatus('error', 'Faltan las claves de Alpaca');
    if (typeof WebSocket === 'undefined') return alpacaStatus('error', 'Este Node.js no trae WebSocket');
    const feed = cfg.plan === 'sip' ? 'sip' : 'iex';
    alpacaStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(`${URLS.alpacaStream}/${feed}`);
    } catch (e) {
      return alpacaRetry(e.message);
    }
    st.ws = ws;
    st.authed = false;
    st.subscribed = new Set();
    let lastMsg = Date.now();
    const watchdog = setInterval(() => {
      // Alpaca no manda nada si no hay operaciones (p. ej. de noche): sólo vigilamos que responda al conectar.
      if (!st.authed && Date.now() - lastMsg > 20_000) ws.close();
    }, 5000);
    ws.onmessage = (ev) => {
      lastMsg = Date.now();
      let arr;
      try {
        arr = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      } catch {
        return;
      }
      for (const m of Array.isArray(arr) ? arr : [arr]) {
        if (m.T === 't') {
          const t = Date.parse(m.t);
          const data = { S: m.S, p: m.p, s: m.s, t };
          for (const c of alpacaClients) if (c.syms.has(m.S)) c.send('trade', data);
        } else if (m.T === 'success' && m.msg === 'connected') {
          const c = alpacaCfg();
          ws.send(JSON.stringify({ action: 'auth', key: c.keyId, secret: c.secret }));
        } else if (m.T === 'success' && m.msg === 'authenticated') {
          st.authed = true;
          st.attempt = 0;
          alpacaStatus('open');
          alpacaSync();
        } else if (m.T === 'error') {
          const code = m.code;
          log(`[alpaca] error ${code}: ${m.msg}`);
          if (code === 402) {
            st.blockedUntilKeysChange = true;
            alpacaStatus('error', 'Alpaca no acepta las claves');
          } else if (code === 406) {
            alpacaStatus('error', 'Alpaca sólo permite una conexión en tiempo real con el plan gratuito: ¿tienes la app abierta en otro ordenador?');
          } else if (code === 405) {
            alpacaStatus('error', 'Alpaca: demasiados símbolos a la vez (máximo 30 con el plan gratuito)');
          } else if (code === 409) {
            st.blockedUntilKeysChange = true;
            alpacaStatus('error', 'Alpaca: tu plan no incluye este tiempo real (¿has marcado "de pago" sin tenerlo?)');
          } else alpacaStatus('error', `Alpaca: ${m.msg}`);
        }
      }
    };
    ws.onclose = () => {
      clearInterval(watchdog);
      if (st.ws === ws) {
        st.ws = null;
        st.authed = false;
        st.subscribed = new Set();
        if (alpacaWanted().size && !st.blockedUntilKeysChange) alpacaRetry();
        else if (!st.blockedUntilKeysChange) alpacaStatus('closed');
      }
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  }

  function alpacaRetry(msg) {
    const st = alpacaStream;
    st.attempt++;
    const delay = [2000, 5000, 10000, 30000][Math.min(st.attempt - 1, 3)];
    if (st.state !== 'error') alpacaStatus('connecting', msg || '');
    st.retry = setTimeout(() => {
      st.retry = null;
      if (alpacaWanted().size) alpacaConnect();
    }, delay);
  }

  function alpacaReset() {
    const st = alpacaStream;
    st.blockedUntilKeysChange = false;
    st.attempt = 0;
    if (st.retry) clearTimeout(st.retry);
    st.retry = null;
    if (st.ws) {
      const ws = st.ws;
      st.ws = null;
      try {
        ws.close();
      } catch {}
    }
    assetsCache = null;
    if (alpacaWanted().size) alpacaConnect();
  }

  // ══ CAPITAL.COM ═════════════════════════════════════════════════════════════

  const cap = { cst: '', sec: '', login: null, lastUse: 0, base: '', lastLogin: 0 };

  function capitalBase() {
    return capitalCfg().demo ? URLS.capitalDemo : URLS.capitalLive;
  }

  function capitalError(status, body) {
    let code = '';
    try {
      code = JSON.parse(body).errorCode || '';
    } catch {
      code = String(body || '').slice(0, 200);
    }
    if (/invalid\.details|invalid\.api\.key|null\.api\.key/i.test(code)) return 'Capital.com no acepta los datos: revisa la clave API, el correo y la CONTRASEÑA DE LA CLAVE (no la de tu cuenta), y si es cuenta demo o real.';
    if (/not-found|notFound|epic/i.test(code)) return `Capital.com: mercado no encontrado (${code})`;
    if (status === 429 || /too-many/i.test(code)) return 'Capital.com: demasiadas peticiones seguidas; espera un momento.';
    return `Capital.com: error ${status} ${code}`;
  }

  async function capitalLogin(force = false) {
    const cfg = capitalCfg();
    if (!cfg.ok) throw Object.assign(new Error('Faltan los datos de Capital.com: pégalos con el botón 🔑 de arriba a la derecha'), { status: 412 });
    const base = capitalBase();
    if (!force && cap.cst && cap.base === base && Date.now() - cap.lastUse < 8 * 60_000) return;
    if (!cap.login) {
      cap.login = (async () => {
        // Capital.com admite 1 inicio de sesión por segundo.
        const wait = cap.lastLogin + 1100 - Date.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        cap.lastLogin = Date.now();
        const r = await fetch(base + '/api/v1/session', {
          method: 'POST',
          headers: { 'X-CAP-API-KEY': cfg.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ identifier: cfg.email, password: cfg.password, encryptedPassword: false }),
          signal: AbortSignal.timeout(15000),
        });
        const body = await r.text();
        if (!r.ok) throw Object.assign(new Error(capitalError(r.status, body)), { status: r.status === 429 ? 429 : 401 });
        cap.cst = r.headers.get('cst') || '';
        cap.sec = r.headers.get('x-security-token') || '';
        cap.base = base;
        cap.lastUse = Date.now();
        if (!cap.cst || !cap.sec) throw new Error('Capital.com no devolvió la sesión');
        log('[capital] sesión iniciada');
      })().finally(() => {
        cap.login = null;
      });
    }
    return cap.login;
  }

  async function capitalGet(p) {
    for (let i = 0; i < 2; i++) {
      await capitalLogin(i > 0);
      const r = await fetch(cap.base + p, {
        headers: { CST: cap.cst, 'X-SECURITY-TOKEN': cap.sec, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      const body = await r.text();
      if (r.status === 401 && i === 0) {
        cap.cst = '';
        continue; // sesión caducada: entrar otra vez
      }
      if (r.ok) cap.lastUse = Date.now();
      return { status: r.status, body };
    }
  }

  async function handleCapitalProxy(req, res, url, send) {
    if (req.method !== 'GET') return send(res, 405, { error: 'sólo lectura' });
    const p = url.pathname.replace(/^\/proxy\/capital/, '');
    const m = p.match(/^\/api\/v1\/(prices|markets)(?:\/([^/]+))?$/);
    if (!m || (m[1] === 'prices' && !m[2]) || (m[2] && !EPIC_RE.test(m[2]))) return send(res, 404, { error: 'ruta no permitida' });
    try {
      const r = await capitalGet(p + url.search);
      if (r.status === 200) return send(res, 200, r.body, { 'Content-Type': 'application/json' });
      return send(res, r.status, { error: capitalError(r.status, r.body), detail: r.body.slice(0, 300) });
    } catch (e) {
      return send(res, e.status || 502, { error: e.status ? e.message : `No se pudo contactar con Capital.com (${e.message})` });
    }
  }

  const capClients = new Set(); // { epics:Set, send }
  const capStream = { ws: null, subscribed: new Set(), state: 'closed', msg: '', retry: null, attempt: 0, ping: null, idleTimer: null, corr: 1, blocked: false };

  function capStatus(state, msg = '') {
    capStream.state = state;
    capStream.msg = msg;
    for (const c of capClients) c.send('status', { state, msg });
  }

  function capWanted() {
    const all = new Set();
    for (const c of capClients) for (const s of c.epics) all.add(s);
    return all;
  }

  function capSend(destination, payload) {
    const ws = capStream.ws;
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({ destination, correlationId: String(capStream.corr++), cst: cap.cst, securityToken: cap.sec, payload }));
  }

  function capSync() {
    const st = capStream;
    const want = capWanted();
    if (!want.size) {
      if (!st.idleTimer && st.ws) st.idleTimer = setTimeout(() => {
        st.idleTimer = null;
        if (!capWanted().size && st.ws) st.ws.close();
      }, 60_000);
      return;
    }
    if (st.idleTimer) {
      clearTimeout(st.idleTimer);
      st.idleTimer = null;
    }
    if (!st.ws) return capConnect();
    if (st.ws.readyState !== 1) return;
    const add = [...want].filter((s) => !st.subscribed.has(s));
    const del = [...st.subscribed].filter((s) => !want.has(s));
    if (del.length) capSend('marketData.unsubscribe', { epics: del });
    // Máximo 40 mercados por conexión.
    if (add.length) capSend('marketData.subscribe', { epics: add.slice(0, 40) });
    st.subscribed = want;
  }

  async function capConnect() {
    const st = capStream;
    if (st.ws || st.retry || st.blocked) return;
    if (typeof WebSocket === 'undefined') return capStatus('error', 'Este Node.js no trae WebSocket');
    capStatus('connecting');
    st.ws = { readyState: 0, close() {} }; // marcador mientras se inicia sesión
    try {
      await capitalLogin(true);
    } catch (e) {
      st.ws = null;
      if (e.status === 412 || e.status === 401) {
        st.blocked = true;
        return capStatus('error', e.message);
      }
      return capRetry(e.message);
    }
    let ws;
    try {
      ws = new WebSocket(URLS.capitalStream);
    } catch (e) {
      st.ws = null;
      return capRetry(e.message);
    }
    st.ws = ws;
    st.subscribed = new Set();
    ws.onopen = () => {
      st.attempt = 0;
      capStatus('open');
      capSync();
      // Hay que dar señales de vida al menos cada 10 minutos (al WebSocket y a la sesión).
      st.ping = setInterval(() => {
        capSend('ping', undefined);
        capitalGet('/api/v1/ping').catch(() => {});
      }, 5 * 60_000);
    };
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
      } catch {
        return;
      }
      if (m.destination === 'quote' && m.payload) {
        const q = m.payload;
        const data = { e: q.epic, b: q.bid, a: q.ofr, t: q.timestamp };
        for (const c of capClients) if (c.epics.has(q.epic)) c.send('quote', data);
      } else if (m.status && m.status !== 'OK') {
        log('[capital] mensaje de error del WebSocket:', JSON.stringify(m).slice(0, 300));
      }
    };
    ws.onclose = () => {
      clearInterval(st.ping);
      if (st.ws === ws) {
        st.ws = null;
        st.subscribed = new Set();
        if (capWanted().size) capRetry();
        else capStatus('closed');
      }
    };
    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  }

  function capRetry(msg) {
    const st = capStream;
    st.attempt++;
    const delay = [2000, 5000, 10000, 30000][Math.min(st.attempt - 1, 3)];
    capStatus('connecting', msg || '');
    st.retry = setTimeout(() => {
      st.retry = null;
      if (capWanted().size) capConnect();
    }, delay);
  }

  function capReset() {
    const st = capStream;
    st.blocked = false;
    st.attempt = 0;
    cap.cst = '';
    if (st.retry) clearTimeout(st.retry);
    st.retry = null;
    if (st.ws) {
      const ws = st.ws;
      st.ws = null;
      try {
        ws.close();
      } catch {}
    }
    if (capWanted().size) capConnect();
  }

  // ══ SSE (navegador ← servidor) ═════════════════════════════════════════════

  function openSse(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
    return {
      send(event, data) {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      },
      onClose(fn) {
        req.on('close', () => {
          clearInterval(ping);
          fn();
        });
      },
    };
  }

  function parseList(url, name, re) {
    return new Set(
      (url.searchParams.get(name) || '')
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter((s) => re.test(s)),
    );
  }

  function handleStream(req, res, url) {
    const which = url.pathname.split('/')[2];
    const sse = openSse(req, res);
    if (which === 'alpaca') {
      const c = { syms: parseList(url, 'symbols', SYM_RE), send: sse.send };
      alpacaClients.add(c);
      sse.send('status', { state: alpacaStream.state, msg: alpacaStream.msg });
      sse.onClose(() => {
        alpacaClients.delete(c);
        alpacaSync();
      });
      alpacaSync();
    } else {
      const c = { epics: parseList(url, 'epics', EPIC_RE), send: sse.send };
      capClients.add(c);
      sse.send('status', { state: capStream.state, msg: capStream.msg });
      sse.onClose(() => {
        capClients.delete(c);
        capSync();
      });
      capSync();
    }
  }

  // ══ API de ajustes ═════════════════════════════════════════════════════════

  function publicInfo() {
    const a = alpacaCfg();
    const c = capitalCfg();
    return {
      alpaca: { configured: a.ok, keyId: mask(a.keyId), plan: a.plan, fromEnv: a.fromEnv, stream: alpacaStream.state, streamMsg: alpacaStream.msg },
      capital: { configured: c.ok, email: c.email ? c.email.replace(/^(.).*(@.*)$/, '$1•••$2') : '', apiKey: mask(c.apiKey), demo: c.demo, fromEnv: c.fromEnv, stream: capStream.state, streamMsg: capStream.msg },
    };
  }

  async function testAlpaca() {
    if (!alpacaCfg().ok) return { ok: false, msg: 'Faltan el Key ID y el Secret.' };
    try {
      const plan = alpacaCfg().plan;
      const snap = await alpacaFetch(URLS.alpacaData, `/v2/stocks/snapshots?symbols=AAPL&feed=${plan === 'sip' ? 'sip' : 'iex'}`);
      if (snap.status !== 200) return { ok: false, msg: alpacaError(snap.status, snap.body) };
      const j = JSON.parse(snap.body);
      const s = j.AAPL || j.snapshots?.AAPL;
      const p = s?.latestTrade?.p;
      return { ok: true, msg: `Conectado a Alpaca${plan === 'sip' ? ' (plan de pago, todas las bolsas)' : ' (plan gratuito, IEX)'}. Último precio de AAPL: ${p ?? '¿?'} $` };
    } catch (e) {
      return { ok: false, msg: `No se pudo contactar con Alpaca (${e.message})` };
    }
  }

  async function testCapital() {
    if (!capitalCfg().ok) return { ok: false, msg: 'Faltan la clave API, el correo o la contraseña de la clave.' };
    try {
      await capitalLogin(true);
      const r = await capitalGet('/api/v1/markets/GOLD');
      if (r.status !== 200) return { ok: false, msg: capitalError(r.status, r.body) };
      const j = JSON.parse(r.body);
      return { ok: true, msg: `Conectado a Capital.com (${capitalCfg().demo ? 'cuenta demo' : 'cuenta real'}). Oro: ${j.snapshot?.bid ?? '¿?'} $` };
    } catch (e) {
      return { ok: false, msg: e.status ? e.message : `No se pudo contactar con Capital.com (${e.message})` };
    }
  }

  async function handleApi(req, res, url, parts, { send, readJson }) {
    if (parts[1] !== 'datasources') return false;
    const which = parts[2];
    if (req.method === 'GET' && !which) {
      send(res, 200, publicInfo());
      return true;
    }
    if (which !== 'alpaca' && which !== 'capital') {
      send(res, 404, { error: 'no encontrado' });
      return true;
    }
    if (req.method === 'POST' && parts[3] === 'test') {
      send(res, 200, which === 'alpaca' ? await testAlpaca() : await testCapital());
      return true;
    }
    if (req.method === 'PUT') {
      const b = (await readJson(req)) || {};
      const prev = stored(which) || {};
      const str = (v, old) => (typeof v === 'string' && v.trim() ? v.trim() : old || '');
      if (which === 'alpaca') {
        qPut.run('alpaca', JSON.stringify({ keyId: str(b.keyId, prev.keyId), secret: str(b.secret, prev.secret), plan: b.plan === 'sip' ? 'sip' : 'basic' }), Date.now());
        alpacaReset();
      } else {
        qPut.run('capital', JSON.stringify({ apiKey: str(b.apiKey, prev.apiKey), email: str(b.email, prev.email), password: typeof b.password === 'string' && b.password ? b.password : prev.password || '', demo: b.demo !== false }), Date.now());
        capReset();
      }
      send(res, 200, publicInfo());
      return true;
    }
    if (req.method === 'DELETE') {
      qDel.run(which);
      if (which === 'alpaca') alpacaReset();
      else capReset();
      send(res, 200, publicInfo());
      return true;
    }
    send(res, 405, { error: 'método no permitido' });
    return true;
  }

  return {
    handleApi,
    handleAlpacaProxy,
    handleCapitalProxy,
    handleStream,
    close() {
      for (const st of [alpacaStream, capStream]) {
        if (st.retry) clearTimeout(st.retry);
        if (st.idleTimer) clearTimeout(st.idleTimer);
        try {
          st.ws?.close();
        } catch {}
      }
      clearInterval(capStream.ping);
    },
  };
}
