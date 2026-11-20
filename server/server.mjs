// ─────────────────────────────────────────────────────────────────────────────
// Servidor de la app de gráficos.
//
// Sin dependencias externas: sólo necesita Node.js 22.13 o superior (trae SQLite).
//   - Sirve la aplicación ya compilada (carpeta dist/).
//   - Guarda dibujos y ajustes en SQLite (carpeta datos/graficos.db).
//   - Hace de intermediario con la API pública de Binance para el histórico de velas.
//   - Vigila las alertas de precio y RSI y avisa por Telegram (server/alerts.mjs).
//   - Datos de acciones (Alpaca) y oro/plata/forex (Capital.com) con las claves
//     que se pegan en la app (server/marketdata.mjs).
//
// Variables de entorno opcionales:
//   PORT=3000            puerto
//   HOST=127.0.0.1       127.0.0.1 = sólo este ordenador. (Abrirlo a la red de casa
//                        se hará en la fase 5, cuando haya usuario y contraseña.)
//   DATA_DIR=./datos     dónde se guarda la base de datos
//   OPEN_BROWSER=1       abrir el navegador al arrancar
//   TELEGRAM_BOT_TOKEN   (opcional) token del bot; si no, se pega en la app (Alertas → Telegram)
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

import { pathToFileURL } from 'node:url';
import { createAlertEngine } from './alerts.mjs';
import { createMarketData } from './marketdata.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USER = 'familia'; // fase 5: cada usuario tendrá el suyo

/**
 * Arranca el servidor. Lo usa tanto `node server/server.mjs` (iniciar.bat) como
 * el programa de escritorio (electron/main.mjs).
 * Devuelve { port, close }.
 */
export async function startServer(opts = {}) {
  const PORT = Number(opts.port ?? 3000);
  const HOST = opts.host ?? '127.0.0.1';
  const DATA_DIR = path.resolve(ROOT, opts.dataDir ?? 'datos');
  const DIST = opts.distDir ?? path.join(ROOT, 'dist');

  let DatabaseSync;
  try {
    ({ DatabaseSync } = await import('node:sqlite'));
  } catch {
    throw new Error('Tu versión de Node.js es demasiado antigua (' + process.version + '). Instala la LTS desde https://nodejs.org');
  }
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    throw new Error('No encuentro la aplicación compilada (carpeta dist). Ejecuta: npm install y npm run build');
  }

  // ── Base de datos ───────────────────────────────────────────────────────────
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(path.join(DATA_DIR, 'graficos.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS drawings (
      id TEXT PRIMARY KEY,
      user TEXT NOT NULL,
      symbol TEXT NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS drawings_user_symbol ON drawings(user, symbol);
    CREATE TABLE IF NOT EXISTS settings (
      user TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user, key)
    );
  `);

  const alerts = createAlertEngine({ db, offline: !!opts.offline, log: opts.log || console.log });
  const market = createMarketData({ db, log: opts.log || console.log });

  const q = {
    listDrawings: db.prepare('SELECT data FROM drawings WHERE user = ? AND symbol = ? ORDER BY created_at'),
    upsertDrawing: db.prepare(`
      INSERT INTO drawings (id, user, symbol, type, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, type = excluded.type, data = excluded.data, updated_at = excluded.updated_at
      WHERE drawings.user = excluded.user`),
    deleteDrawing: db.prepare('DELETE FROM drawings WHERE id = ? AND user = ?'),
    getSetting: db.prepare('SELECT value FROM settings WHERE user = ? AND key = ?'),
    putSetting: db.prepare(`
      INSERT INTO settings (user, key, value, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(user, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`),
  };

  // ── Utilidades HTTP ─────────────────────────────────────────────────────────
  function send(res, status, body, headers = {}) {
    const isBuf = Buffer.isBuffer(body);
    const data = isBuf ? body : typeof body === 'string' ? body : JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': isBuf || typeof body === 'string' ? headers['Content-Type'] || 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(data);
  }

  function readJson(req, limit = 1_000_000) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new Error('Petición demasiado grande'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null);
        } catch (e) {
          reject(e);
        }
      });
      req.on('error', reject);
    });
  }

  const SYMBOL_RE = /^[A-Z0-9._-]{1,30}$/;
  const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

  // ── API propia ──────────────────────────────────────────────────────────────
  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]

    if (parts[1] === 'health') return send(res, 200, { ok: true });

    if (await alerts.handleApi(req, res, url, parts, USER, { send, readJson })) return;
    if (await market.handleApi(req, res, url, parts, { send, readJson })) return;

    if (parts[1] === 'drawings') {
      if (req.method === 'GET' && parts.length === 2) {
        const symbol = (url.searchParams.get('symbol') || '').toUpperCase();
        if (!SYMBOL_RE.test(symbol)) return send(res, 400, { error: 'símbolo no válido' });
        const rows = q.listDrawings.all(USER, symbol);
        return send(res, 200, rows.map((r) => JSON.parse(r.data)));
      }
      const id = decodeURIComponent(parts[2] || '');
      if (!ID_RE.test(id)) return send(res, 400, { error: 'id no válido' });
      if (req.method === 'PUT') {
        const d = await readJson(req);
        if (!d || typeof d !== 'object' || !SYMBOL_RE.test(String(d.symbol || '').toUpperCase()) || typeof d.type !== 'string') {
          return send(res, 400, { error: 'dibujo no válido' });
        }
        d.id = id;
        d.symbol = String(d.symbol).toUpperCase();
        const now = Date.now();
        q.upsertDrawing.run(id, USER, d.symbol, d.type, JSON.stringify(d), now, now);
        alerts.onDrawingSaved(USER, d);
        return send(res, 200, { ok: true });
      }
      if (req.method === 'DELETE') {
        q.deleteDrawing.run(id, USER);
        alerts.onDrawingDeleted(USER, id);
        return send(res, 200, { ok: true });
      }
    }

    if (parts[1] === 'settings' && parts[2]) {
      const key = decodeURIComponent(parts[2]);
      if (!ID_RE.test(key)) return send(res, 400, { error: 'clave no válida' });
      if (req.method === 'GET') {
        const row = q.getSetting.get(USER, key);
        return send(res, 200, { value: row ? JSON.parse(row.value) : null });
      }
      if (req.method === 'PUT') {
        const body = await readJson(req);
        q.putSetting.run(USER, key, JSON.stringify(body?.value ?? null), Date.now());
        return send(res, 200, { ok: true });
      }
    }

    return send(res, 404, { error: 'no encontrado' });
  }

  // ── Intermediario con Binance (sólo lectura de datos de mercado públicos) ──
  const BINANCE_HOSTS = ['https://api.binance.com', 'https://data-api.binance.vision'];
  const BINANCE_PATHS = new Set(['/api/v3/klines', '/api/v3/exchangeInfo', '/api/v3/ticker/24hr']);
  const infoCache = new Map(); // exchangeInfo cambia poco: 1 hora de caché

  async function handleBinance(req, res, url) {
    const p = url.pathname.replace(/^\/proxy\/binance/, '');
    if (req.method !== 'GET' || !BINANCE_PATHS.has(p)) return send(res, 404, { error: 'ruta no permitida' });
    const qs = url.search;
    const cacheKey = p + qs;
    if (p === '/api/v3/exchangeInfo') {
      const hit = infoCache.get(cacheKey);
      if (hit && Date.now() - hit.t < 3600_000) return send(res, 200, hit.body, { 'Content-Type': 'application/json' });
    }
    let lastErr = null;
    for (const host of BINANCE_HOSTS) {
      try {
        const r = await fetch(host + p + qs, { signal: AbortSignal.timeout(10000) });
        const body = await r.text();
        if (r.ok) {
          if (p === '/api/v3/exchangeInfo') infoCache.set(cacheKey, { t: Date.now(), body });
          return send(res, 200, body, { 'Content-Type': 'application/json' });
        }
        if (r.status === 400) return send(res, 400, body, { 'Content-Type': 'application/json' });
        lastErr = `HTTP ${r.status} de ${host}`;
      } catch (e) {
        lastErr = `${host}: ${e.message}`;
      }
    }
    console.warn('[binance] fallo:', lastErr);
    return send(res, 502, { error: 'No se pudo contactar con Binance', detail: lastErr });
  }

  // ── Ficheros estáticos ──────────────────────────────────────────────────────
  const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
  };

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return send(res, 403, 'Prohibido');
    fs.stat(file, (err, st) => {
      const target = !err && st.isFile() ? file : path.join(DIST, 'index.html');
      fs.readFile(target, (e2, buf) => {
        if (e2) return send(res, 404, 'No encontrado');
        const ext = path.extname(target);
        const cache = target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
        send(res, 200, buf, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': cache });
      });
    });
  }

  // ── Servidor ──────────────────────────────────────────────────────────────
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
      if (url.pathname.startsWith('/proxy/binance/')) return await handleBinance(req, res, url);
      if (url.pathname.startsWith('/proxy/alpaca/')) return await market.handleAlpacaProxy(req, res, url, send);
      if (url.pathname.startsWith('/proxy/capital/')) return await market.handleCapitalProxy(req, res, url, send);
      if (url.pathname === '/stream/alpaca' || url.pathname === '/stream/capital') return market.handleStream(req, res, url);
      return serveStatic(req, res, url);
    } catch (e) {
      console.error(e);
      if (!res.headersSent) send(res, 500, { error: 'error interno' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(PORT, HOST, resolve);
  });
  return {
    port: server.address().port,
    dataFile: path.join(DATA_DIR, 'graficos.db'),
    alerts,
    close() {
      alerts.close();
      market.close();
      server.closeAllConnections?.();
      server.close();
      try {
        db.close();
      } catch {}
    },
  };
}

// ── Arranque desde la línea de comandos (iniciar.bat / npm start) ───────────
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const PORT = Number(process.env.PORT || 3000);
  try {
    const srv = await startServer({ port: PORT, host: process.env.HOST, dataDir: process.env.DATA_DIR });
    const url = `http://localhost:${srv.port}`;
    console.log('');
    console.log('  ✔ Gráficos en marcha.');
    console.log(`    Abre en el navegador:  ${url}`);
    console.log(`    Modo demostración:     ${url}/?demo=1`);
    console.log(`    Datos guardados en:    ${srv.dataFile}`);
    console.log('    Para pararlo, cierra esta ventana o pulsa Ctrl+C.');
    console.log('');
    if (process.env.OPEN_BROWSER === '1') {
      const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => {
        srv.close();
        process.exit(0);
      });
    }
  } catch (e) {
    if (e && e.code === 'EADDRINUSE') console.error(`\n  ERROR: el puerto ${PORT} ya está en uso. ¿Tienes la app abierta en otra ventana?\n`);
    else console.error('\n  ERROR: ' + (e && e.message ? e.message : e) + '\n');
    process.exit(1);
  }
}
