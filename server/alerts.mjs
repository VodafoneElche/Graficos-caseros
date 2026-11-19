// ─────────────────────────────────────────────────────────────────────────────
// Motor de ALERTAS (fase 2).
//
// Vive dentro del servidor (server.mjs), así que vigila los precios mientras el
// servidor esté encendido, aunque no haya ninguna ventana de la app abierta.
//
//   - Alertas de PRECIO: cruce, cruce hacia arriba o hacia abajo de un precio.
//     Pueden ir ligadas a una línea horizontal: si mueves la línea, la alerta se
//     mueve con ella; si borras la línea, se borra la alerta.
//   - Alertas de RSI: el RSI (14 por defecto) de una temporalidad (D, S, M...)
//     cruza un valor.
//   - Avisos por un bot de Telegram (y en la propia app, con sonido).
//
// Precios en tiempo real: WebSocket público de Binance (operaciones, sin clave).
// Si el WebSocket se cae, mientras tanto se pregunta el precio cada 5 s por REST.
// Sin dependencias: usa fetch y WebSocket que trae Node.js 22.
// ─────────────────────────────────────────────────────────────────────────────

const BINANCE_REST = ['https://api.binance.com', 'https://data-api.binance.vision'];
const BINANCE_WS = ['wss://stream.binance.com:9443', 'wss://data-stream.binance.vision'];
const TELEGRAM_API = process.env.TELEGRAM_API || 'https://api.telegram.org';

const RSI_TFS = new Set(['1h', '4h', '1d', '1w', '1M']);
const TF_NAMES = { '1h': '1 hora', '4h': '4 horas', '1d': 'diario', '1w': 'semanal', '1M': 'mensual' };
const CONDS = new Set(['cross', 'up', 'down']);
const COND_TXT = { cross: 'cruza', up: 'cruza hacia arriba', down: 'cruza hacia abajo' };
/** "Cada vez": no repetir la misma alerta antes de este tiempo (evita ráfagas si el precio baila sobre la línea). */
const REPEAT_COOLDOWN_MS = 60_000;
const RSI_CHECK_MS = 60_000;

const SYMBOL_RE = /^[A-Z0-9._-]{1,30}$/;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// ── Formato español ─────────────────────────────────────────────────────────
function decimalsOf(n) {
  const s = String(n);
  if (s.includes('e-')) return Math.min(8, Number(s.split('e-')[1]) + 2);
  const i = s.indexOf('.');
  return i < 0 ? 0 : Math.min(8, s.length - i - 1);
}
export function fmtPrice(n, ref = n) {
  const abs = Math.abs(ref);
  const minDec = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  const dec = Math.max(minDec, decimalsOf(ref));
  return new Intl.NumberFormat('es-ES', { minimumFractionDigits: Math.min(dec, 8), maximumFractionDigits: Math.min(dec, 8), useGrouping: true }).format(n);
}
function fmtRsi(n) {
  return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 }).format(n);
}
function fmtTime(ms) {
  return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(ms);
}
function esc(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}

/** RSI de Wilder (igual que ta.rsi de TradingView). Devuelve el último valor o null. */
export function rsiLast(closes, len = 14) {
  if (closes.length < len + 1) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= len; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  let ag = gain / len;
  let al = loss / len;
  for (let i = len + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (len - 1) + (d > 0 ? d : 0)) / len;
    al = (al * (len - 1) + (d < 0 ? -d : 0)) / len;
  }
  if (al === 0) return ag === 0 ? 50 : 100;
  return 100 - 100 / (1 + ag / al);
}

/** ¿Pasar de `prev` a `cur` cruza `level` según la condición? */
export function crosses(cond, prev, cur, level) {
  if (!Number.isFinite(prev) || !Number.isFinite(cur)) return false;
  const up = prev < level && cur >= level;
  const down = prev > level && cur <= level;
  return cond === 'up' ? up : cond === 'down' ? down : up || down;
}

// ── Precios en tiempo real de Binance ───────────────────────────────────────
class BinanceFeed {
  constructor(onPrice, log) {
    this.onPrice = onPrice;
    this.log = log;
    this.symbols = new Set();
    this.ws = null;
    this.hostIdx = 0;
    this.retry = 0;
    this.connected = false;
    this.lastMsg = 0;
    this.lastError = '';
    this.closed = false;
    this.reconnectTimer = null;
    this.debounce = null;
    this.watchdog = setInterval(() => this.check(), 5000);
    this.pollBusy = false;
  }

  setSymbols(list) {
    const next = new Set(list.filter((s) => SYMBOL_RE.test(s)));
    const same = next.size === this.symbols.size && [...next].every((s) => this.symbols.has(s));
    if (same) return;
    this.symbols = next;
    clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.connect(), 500);
  }

  connect() {
    clearTimeout(this.reconnectTimer);
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      try {
        old.close();
      } catch {}
    }
    this.connected = false;
    if (this.closed || !this.symbols.size) return;
    if (typeof WebSocket === 'undefined') {
      this.lastError = 'Este Node.js no trae WebSocket: se usa el modo de consulta cada 5 s';
      return;
    }
    const streams = [...this.symbols].map((s) => s.toLowerCase() + '@aggTrade').join('/');
    const url = `${BINANCE_WS[this.hostIdx % BINANCE_WS.length]}/stream?streams=${streams}`;
    let ws;
    try {
      ws = new WebSocket(url);
    } catch (e) {
      this.lastError = e.message;
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.connected = true;
      this.retry = 0;
      this.lastMsg = Date.now();
      this.log(`[alertas] precios en tiempo real conectados (${this.symbols.size} símbolos)`);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastMsg = Date.now();
      try {
        const m = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString());
        const d = m.data || m;
        if (d && d.s && d.p) this.onPrice(d.s, Number(d.p), d.T || Date.now());
      } catch {}
    };
    ws.onerror = (ev) => {
      if (this.ws !== ws) return;
      this.lastError = (ev && ev.message) || 'error de WebSocket';
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.connected = false;
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (this.closed) return;
    clearTimeout(this.reconnectTimer);
    this.retry++;
    this.hostIdx++;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.retry, 6));
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  check() {
    if (this.closed || !this.symbols.size) return;
    // Sin mensajes en 60 s con el WebSocket "abierto": conexión zombi → reconectar.
    if (this.connected && Date.now() - this.lastMsg > 60_000) {
      this.log('[alertas] el WebSocket no da datos: reconectando');
      this.connect();
      return;
    }
    if (!this.connected) this.poll();
  }

  /** Plan B mientras no hay WebSocket: precio por REST. */
  async poll() {
    if (this.pollBusy) return;
    this.pollBusy = true;
    try {
      const syms = JSON.stringify([...this.symbols]);
      for (const host of BINANCE_REST) {
        try {
          const r = await fetch(`${host}/api/v3/ticker/price?symbols=${encodeURIComponent(syms)}`, { signal: AbortSignal.timeout(8000) });
          if (!r.ok) {
            this.lastError = `HTTP ${r.status}`;
            continue;
          }
          const arr = await r.json();
          const now = Date.now();
          for (const t of arr) this.onPrice(t.symbol, Number(t.price), now);
          this.lastPoll = now;
          break;
        } catch (e) {
          this.lastError = e.message;
        }
      }
    } finally {
      this.pollBusy = false;
    }
  }

  close() {
    this.closed = true;
    clearInterval(this.watchdog);
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.debounce);
    try {
      this.ws?.close();
    } catch {}
  }
}

async function binanceKlines(symbol, interval, limit = 500) {
  let last = '';
  for (const host of BINANCE_REST) {
    try {
      const r = await fetch(`${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`, { signal: AbortSignal.timeout(10000) });
      if (r.ok) return (await r.json()).map((k) => Number(k[4]));
      last = `HTTP ${r.status}`;
      if (r.status === 400) break;
    } catch (e) {
      last = e.message;
    }
  }
  throw new Error(last || 'sin respuesta');
}

// ── Motor ───────────────────────────────────────────────────────────────────
/**
 * @param {object} o
 * @param {import('node:sqlite').DatabaseSync} o.db
 * @param {(msg:string)=>void} [o.log]
 * @param {boolean} [o.offline]  no conectar a Binance (pruebas)
 * @param {(symbol:string, interval:string)=>Promise<number[]>} [o.klines]  para pruebas
 */
export function createAlertEngine({ db, log = console.log, offline = false, klines = binanceKlines }) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      symbol TEXT NOT NULL,
      drawing_id TEXT,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS alerts_user ON alerts(user);
    CREATE INDEX IF NOT EXISTS alerts_drawing ON alerts(drawing_id);
    CREATE TABLE IF NOT EXISTS alert_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      alert_id TEXT NOT NULL,
      symbol TEXT NOT NULL,
      text TEXT NOT NULL,
      value REAL,
      at INTEGER NOT NULL,
      telegram TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS alert_log_user ON alert_log(user, seq);
    CREATE TABLE IF NOT EXISTS last_prices (
      symbol TEXT PRIMARY KEY,
      price REAL NOT NULL,
      at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS telegram (
      user TEXT PRIMARY KEY,
      token TEXT NOT NULL DEFAULT '',
      chat_id TEXT NOT NULL DEFAULT '',
      bot_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1
    );
  `);

  const q = {
    all: db.prepare('SELECT user, data FROM alerts'),
    listUser: db.prepare('SELECT data FROM alerts WHERE user = ? ORDER BY created_at'),
    get: db.prepare('SELECT user, data FROM alerts WHERE id = ?'),
    upsert: db.prepare(`
      INSERT INTO alerts (id, user, symbol, drawing_id, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, drawing_id = excluded.drawing_id, data = excluded.data, updated_at = excluded.updated_at
      WHERE alerts.user = excluded.user`),
    del: db.prepare('DELETE FROM alerts WHERE id = ? AND user = ?'),
    byDrawing: db.prepare('SELECT data FROM alerts WHERE user = ? AND drawing_id = ?'),
    delByDrawing: db.prepare('DELETE FROM alerts WHERE user = ? AND drawing_id = ?'),
    addLog: db.prepare('INSERT INTO alert_log (user, alert_id, symbol, text, value, at) VALUES (?, ?, ?, ?, ?, ?)'),
    setLogTg: db.prepare('UPDATE alert_log SET telegram = ? WHERE seq = ?'),
    listLog: db.prepare('SELECT seq, alert_id AS alertId, symbol, text, value, at, telegram FROM alert_log WHERE user = ? ORDER BY seq DESC LIMIT ?'),
    trimLog: db.prepare('DELETE FROM alert_log WHERE seq < (SELECT COALESCE(MAX(seq), 0) - 2000 FROM alert_log)'),
    clearLog: db.prepare('DELETE FROM alert_log WHERE user = ?'),
    lastPrices: db.prepare('SELECT symbol, price FROM last_prices'),
    putPrice: db.prepare('INSERT INTO last_prices (symbol, price, at) VALUES (?, ?, ?) ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, at = excluded.at'),
    tgGet: db.prepare('SELECT token, chat_id AS chatId, bot_name AS botName, enabled FROM telegram WHERE user = ?'),
    tgPut: db.prepare(`
      INSERT INTO telegram (user, token, chat_id, bot_name, enabled) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user) DO UPDATE SET token = excluded.token, chat_id = excluded.chat_id, bot_name = excluded.bot_name, enabled = excluded.enabled`),
  };

  /** id → { user, a } con todas las alertas en memoria. */
  const alerts = new Map();
  for (const r of q.all.all()) {
    try {
      const a = JSON.parse(r.data);
      alerts.set(a.id, { user: r.user, a });
    } catch {}
  }

  /** Último precio conocido de cada símbolo. Al arrancar, el último guardado: así
   *  una alerta que se cruzó con el servidor apagado salta en cuanto vuelve. */
  const last = new Map();
  const lastAt = new Map();
  for (const r of q.lastPrices.all()) last.set(r.symbol, r.price);
  const dirtyPrices = new Set();

  // Avisos en directo para la app (Server-Sent Events).
  const listeners = new Set();
  function broadcast(user, event, data) {
    for (const l of listeners) if (l.user === user) l.send(event, data);
  }

  const feed = offline ? null : new BinanceFeed(onPrice, log);

  function priceAlertsBySymbol() {
    const m = new Map();
    for (const { user, a } of alerts.values()) {
      if (!a.active || a.kind !== 'price') continue;
      let arr = m.get(a.symbol);
      if (!arr) m.set(a.symbol, (arr = []));
      arr.push({ user, a });
    }
    return m;
  }
  let bySymbol = priceAlertsBySymbol();
  function reindex() {
    bySymbol = priceAlertsBySymbol();
    feed?.setSymbols([...bySymbol.keys()]);
  }
  reindex();

  function save(user, a) {
    a.updatedAt = Date.now();
    q.upsert.run(a.id, user, a.symbol, a.drawingId || null, JSON.stringify(a), a.createdAt, a.updatedAt);
  }

  function onPrice(symbol, price, time = Date.now()) {
    if (!Number.isFinite(price) || price <= 0) return;
    const prev = last.get(symbol);
    last.set(symbol, price);
    lastAt.set(symbol, time);
    dirtyPrices.add(symbol);
    const list = bySymbol.get(symbol);
    if (!list) return;
    let changed = false;
    for (const { user, a } of list) {
      if (!a.active) continue;
      // Sin precio anterior (recién arrancado): se compara con el de cuando se creó.
      const from = prev ?? a.ref;
      if (crosses(a.cond, from, price, a.price)) {
        if (a.repeat === 'always' && a.lastFired && Date.now() - a.lastFired < REPEAT_COOLDOWN_MS) continue;
        fire(user, a, price, time, from);
        changed = true;
      }
    }
    if (changed) reindex();
  }

  // Guardar los últimos precios cada 15 s (no en cada operación).
  const persistTimer = setInterval(() => {
    const now = Date.now();
    for (const s of dirtyPrices) q.putPrice.run(s, last.get(s), now);
    dirtyPrices.clear();
  }, 15_000);

  function describe(a) {
    if (a.kind === 'rsi') return `RSI ${a.length || 14} ${TF_NAMES[a.tf] || a.tf} ${COND_TXT[a.cond]} ${fmtRsi(a.level)}`;
    return `${COND_TXT[a.cond]} ${fmtPrice(a.price)}`;
  }

  function fire(user, a, value, time, from) {
    a.lastFired = Date.now();
    a.fireCount = (a.fireCount || 0) + 1;
    if (a.repeat !== 'always') a.active = false;
    save(user, a);
    const what =
      a.kind === 'rsi'
        ? `RSI ${a.length || 14} (${TF_NAMES[a.tf] || a.tf}) ${COND_TXT[a.cond]} ${fmtRsi(a.level)} → ${fmtRsi(value)}`
        : `${value >= from ? '⬆' : '⬇'} ${COND_TXT[a.cond]} ${fmtPrice(a.price)} · precio ${fmtPrice(value, a.price)}`;
    const text = `${a.symbol} ${what}${a.note ? ` · ${a.note}` : ''}`;
    const info = q.addLog.run(user, a.id, a.symbol, text, value, time);
    const seq = Number(info.lastInsertRowid);
    if (seq % 200 === 0) q.trimLog.run();
    log(`[alertas] 🔔 ${text}`);
    const entry = { seq, alertId: a.id, symbol: a.symbol, text, value, at: time, telegram: '' };
    broadcast(user, 'fired', entry);
    broadcast(user, 'changed', {});
    const tgText =
      `🔔 <b>${esc(a.symbol)}</b>\n` +
      (a.kind === 'rsi'
        ? `RSI ${a.length || 14} ${esc(TF_NAMES[a.tf] || a.tf)} ${COND_TXT[a.cond]} <b>${fmtRsi(a.level)}</b>\nRSI ahora: ${fmtRsi(value)}`
        : `${value >= from ? '⬆️' : '⬇️'} ${COND_TXT[a.cond]} <b>${fmtPrice(a.price)}</b>\nPrecio: ${fmtPrice(value, a.price)}`) +
      (a.note ? `\n📝 ${esc(a.note)}` : '') +
      `\n🕒 ${fmtTime(time)}` +
      (a.repeat === 'always' ? '' : '\n<i>(alerta desactivada; vuelve a activarla en la app si la quieres otra vez)</i>');
    telegram
      .send(user, tgText)
      .then((r) => {
        q.setLogTg.run(r, seq);
        broadcast(user, 'telegram', { seq, telegram: r });
      })
      .catch(() => {});
  }

  // ── RSI: se revisa cada minuto ─────────────────────────────────────────────
  let rsiBusy = false;
  async function checkRsi() {
    if (rsiBusy) return;
    rsiBusy = true;
    try {
      const groups = new Map();
      for (const { user, a } of alerts.values()) {
        if (!a.active || a.kind !== 'rsi') continue;
        const k = `${a.symbol}|${a.tf}`;
        let g = groups.get(k);
        if (!g) groups.set(k, (g = []));
        g.push({ user, a });
      }
      for (const [k, list] of groups) {
        const [symbol, tf] = k.split('|');
        let closes;
        try {
          closes = await klines(symbol, tf);
        } catch (e) {
          for (const { a } of list) a.error = 'sin datos: ' + e.message;
          continue;
        }
        // La vela en curso usa el último precio en tiempo real si lo hay.
        const lp = last.get(symbol);
        if (lp && closes.length) closes[closes.length - 1] = lp;
        let changed = false;
        for (const { user, a } of list) {
          if (!a.active) continue;
          const v = rsiLast(closes, a.length || 14);
          if (v == null) continue;
          a.error = undefined;
          const prev = a.lastValue;
          a.lastValue = Math.round(v * 100) / 100;
          if (prev != null && crosses(a.cond, prev, v, a.level)) {
            if (!(a.repeat === 'always' && a.lastFired && Date.now() - a.lastFired < REPEAT_COOLDOWN_MS)) {
              fire(user, a, v, Date.now(), prev);
              changed = true;
              continue;
            }
          }
          save(user, a);
        }
        if (changed) reindex();
        await new Promise((r) => setTimeout(r, 150)); // no saturar a Binance
      }
    } finally {
      rsiBusy = false;
    }
  }
  const rsiTimer = offline ? null : setInterval(checkRsi, RSI_CHECK_MS);
  if (!offline) setTimeout(checkRsi, 3000);

  // ── Telegram ───────────────────────────────────────────────────────────────
  const telegram = {
    cfg(user) {
      const row = q.tgGet.get(user) || { token: '', chatId: '', botName: '', enabled: 1 };
      // Variables de entorno (servidor en internet): tienen prioridad.
      if (process.env.TELEGRAM_BOT_TOKEN) row.token = process.env.TELEGRAM_BOT_TOKEN;
      if (process.env.TELEGRAM_CHAT_ID && !row.chatId) row.chatId = process.env.TELEGRAM_CHAT_ID;
      return row;
    },
    async call(token, method, body) {
      const r = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: AbortSignal.timeout(15000),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) {
        const err = new Error(j.description || `HTTP ${r.status}`);
        err.status = r.status;
        err.retryAfter = j.parameters?.retry_after;
        throw err;
      }
      return j.result;
    },
    /** Envía con reintentos. Devuelve 'ok', 'off' o 'error: ...'. */
    async send(user, text) {
      const c = this.cfg(user);
      if (!c.token || !c.chatId || !c.enabled) return 'off';
      let lastErr = '';
      for (let i = 0; i < 5; i++) {
        try {
          await this.call(c.token, 'sendMessage', { chat_id: c.chatId, text, parse_mode: 'HTML', disable_web_page_preview: true });
          return 'ok';
        } catch (e) {
          lastErr = e.message;
          if (e.status === 401 || e.status === 400 || e.status === 403) break; // token o chat mal: no insistir
          await new Promise((r) => setTimeout(r, e.retryAfter ? e.retryAfter * 1000 : 2000 * 2 ** i));
        }
      }
      log('[telegram] no se pudo enviar: ' + lastErr);
      return 'error: ' + lastErr;
    },
  };

  // ── Validación de lo que manda la app ──────────────────────────────────────
  function clean(user, id, b, old) {
    if (!b || typeof b !== 'object') throw new Error('alerta no válida');
    const symbol = String(b.symbol || '').toUpperCase();
    if (!SYMBOL_RE.test(symbol)) throw new Error('símbolo no válido');
    const kind = b.kind === 'rsi' ? 'rsi' : 'price';
    const cond = CONDS.has(b.cond) ? b.cond : 'cross';
    const a = {
      id,
      symbol,
      kind,
      cond,
      repeat: b.repeat === 'always' ? 'always' : 'once',
      note: typeof b.note === 'string' ? b.note.slice(0, 200) : '',
      active: b.active !== false,
      createdAt: old?.createdAt || Date.now(),
      fireCount: old?.fireCount || 0,
      lastFired: old?.lastFired,
    };
    if (kind === 'price') {
      const price = Number(b.price);
      if (!(price > 0)) throw new Error('precio no válido');
      a.price = price;
      if (b.drawingId && ID_RE.test(b.drawingId)) a.drawingId = b.drawingId;
      // Precio de referencia al (re)activarla: así sabemos de qué lado estaba.
      const reactivated = a.active && (!old || !old.active || old.price !== price);
      a.ref = reactivated ? (last.get(symbol) ?? (Number(b.ref) > 0 ? Number(b.ref) : price)) : (old?.ref ?? price);
    } else {
      const tf = String(b.tf || '1d');
      if (!RSI_TFS.has(tf)) throw new Error('temporalidad no válida');
      const level = Number(b.level);
      if (!(level > 0 && level < 100)) throw new Error('nivel de RSI no válido (entre 0 y 100)');
      a.tf = tf;
      a.level = level;
      a.length = Math.max(2, Math.min(100, Math.round(Number(b.length) || 14)));
      a.lastValue = old && old.tf === tf && old.length === a.length && old.active ? old.lastValue : undefined;
    }
    return a;
  }

  function list(user) {
    return [...alerts.values()].filter((x) => x.user === user).map((x) => ({ ...x.a, lastPrice: last.get(x.a.symbol) }));
  }

  // ── API HTTP ───────────────────────────────────────────────────────────────
  /** Devuelve true si ha atendido la petición. */
  async function handleApi(req, res, url, parts, user, { send, readJson }) {
    if (parts[1] === 'alerts' && parts.length === 2 && req.method === 'GET') {
      const sym = (url.searchParams.get('symbol') || '').toUpperCase();
      const all = list(user);
      send(res, 200, sym ? all.filter((a) => a.symbol === sym) : all);
      return true;
    }
    if (parts[1] === 'alerts' && parts.length === 3) {
      const id = decodeURIComponent(parts[2]);
      if (!ID_RE.test(id)) return send(res, 400, { error: 'id no válido' }), true;
      const cur = alerts.get(id);
      if (cur && cur.user !== user) return send(res, 404, { error: 'no encontrada' }), true;
      if (req.method === 'PUT') {
        let a;
        try {
          a = clean(user, id, await readJson(req), cur?.a);
        } catch (e) {
          return send(res, 400, { error: e.message }), true;
        }
        alerts.set(id, { user, a });
        save(user, a);
        reindex();
        broadcast(user, 'changed', {});
        if (a.kind === 'rsi' && a.active && !offline) setTimeout(checkRsi, 200);
        send(res, 200, a);
        return true;
      }
      if (req.method === 'DELETE') {
        alerts.delete(id);
        q.del.run(id, user);
        reindex();
        broadcast(user, 'changed', {});
        send(res, 200, { ok: true });
        return true;
      }
    }
    if (parts[1] === 'alerts-log') {
      if (req.method === 'DELETE') {
        q.clearLog.run(user);
        send(res, 200, { ok: true });
        return true;
      }
      const limit = Math.max(1, Math.min(500, Number(url.searchParams.get('limit')) || 100));
      send(res, 200, q.listLog.all(user, limit));
      return true;
    }
    if (parts[1] === 'alerts-status') {
      const c = telegram.cfg(user);
      send(res, 200, {
        feed: offline ? 'offline' : feed.connected ? 'live' : feed.lastPoll && Date.now() - feed.lastPoll < 30_000 ? 'polling' : feed.symbols.size ? 'down' : 'idle',
        feedError: feed?.lastError || '',
        symbols: [...bySymbol.keys()],
        active: [...alerts.values()].filter((x) => x.user === user && x.a.active).length,
        telegram: { hasToken: !!c.token, chatId: c.chatId, botName: c.botName, enabled: !!c.enabled, fromEnv: !!process.env.TELEGRAM_BOT_TOKEN },
      });
      return true;
    }
    if (parts[1] === 'telegram') {
      const action = parts[2] || '';
      const c = telegram.cfg(user);
      if (req.method === 'PUT' && !action) {
        const b = (await readJson(req)) || {};
        let token = typeof b.token === 'string' ? b.token.trim() : c.token;
        if (token && !/^\d{5,}:[A-Za-z0-9_-]{20,}$/.test(token)) return send(res, 400, { error: 'El token no tiene el formato de BotFather (números:letras)' }), true;
        let botName = c.botName;
        if (token && token !== c.token) {
          try {
            const me = await telegram.call(token, 'getMe');
            botName = me.username || '';
          } catch (e) {
            return send(res, 400, { error: 'Telegram no acepta ese token: ' + e.message }), true;
          }
        }
        const chatId = typeof b.chatId === 'string' ? b.chatId.trim() : c.chatId;
        if (chatId && !/^-?\d{1,20}$/.test(chatId)) return send(res, 400, { error: 'El número de chat no es válido' }), true;
        const enabled = b.enabled === undefined ? c.enabled : b.enabled ? 1 : 0;
        q.tgPut.run(user, token || '', token ? chatId : '', token ? botName : '', enabled);
        send(res, 200, { ok: true, botName });
        return true;
      }
      if (req.method === 'POST' && action === 'detect') {
        // Busca el chat de quien escribió /start al bot.
        if (!c.token) return send(res, 400, { error: 'Primero pega el token del bot' }), true;
        try {
          const ups = await telegram.call(c.token, 'getUpdates', { limit: 100, timeout: 0 });
          const msgs = ups.map((u) => u.message || u.edited_message || u.my_chat_member).filter(Boolean);
          const m = msgs.reverse().find((x) => x.chat && x.chat.type === 'private') || msgs.find((x) => x.chat);
          if (!m) return send(res, 404, { error: 'No veo ningún mensaje. Abre tu bot en Telegram, pulsa INICIAR (o escribe /start) y vuelve a probar.' }), true;
          const chatId = String(m.chat.id);
          q.tgPut.run(user, c.token, chatId, c.botName, c.enabled ? 1 : 0);
          const who = [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.title || m.chat.username || '';
          send(res, 200, { chatId, who });
        } catch (e) {
          send(res, 400, { error: 'Telegram: ' + e.message });
        }
        return true;
      }
      if (req.method === 'POST' && action === 'test') {
        const r = await telegram.send(user, '✅ <b>Gráficos familia</b>\nLas alertas llegarán a este chat.');
        if (r === 'ok') send(res, 200, { ok: true });
        else send(res, 400, { error: r === 'off' ? 'Falta el token o el chat' : r });
        return true;
      }
    }
    if (parts[1] === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.write('retry: 3000\n\n');
      const l = {
        user,
        send(event, data) {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        },
      };
      listeners.add(l);
      const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
      req.on('close', () => {
        clearInterval(ping);
        listeners.delete(l);
      });
      return true;
    }
    return false;
  }

  // ── Enganche con los dibujos: la alerta sigue a su línea ──────────────────
  function onDrawingSaved(user, d) {
    if (!d || d.type !== 'hline') return;
    const rows = q.byDrawing.all(user, d.id);
    if (!rows.length) return;
    for (const r of rows) {
      const a = alerts.get(JSON.parse(r.data).id)?.a;
      if (!a || a.price === d.price) continue;
      a.price = d.price;
      if (a.active) {
        // Al mover la línea se "rearma": cuenta desde el precio actual.
        a.ref = last.get(a.symbol) ?? a.ref;
      }
      save(user, a);
    }
    reindex();
    broadcast(user, 'changed', {});
  }
  function onDrawingDeleted(user, id) {
    const rows = q.byDrawing.all(user, id);
    if (!rows.length) return;
    for (const r of rows) alerts.delete(JSON.parse(r.data).id);
    q.delByDrawing.run(user, id);
    reindex();
    broadcast(user, 'changed', {});
  }

  return {
    handleApi,
    onDrawingSaved,
    onDrawingDeleted,
    describe,
    /** Para pruebas: inyectar un precio como si llegara de Binance. */
    ingest: onPrice,
    checkRsi,
    close() {
      feed?.close();
      clearInterval(persistTimer);
      if (rsiTimer) clearInterval(rsiTimer);
      for (const s of dirtyPrices) q.putPrice.run(s, last.get(s), Date.now());
      for (const l of listeners) l.send('bye', {});
    },
  };
}
