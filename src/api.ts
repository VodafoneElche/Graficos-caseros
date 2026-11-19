import type { Drawing } from './core/types';

// Cliente del servidor propio (server/server.mjs): ajustes y dibujos guardados en SQLite.

type StatusCb = (ok: boolean) => void;
const statusCbs = new Set<StatusCb>();
let serverOk = true;

function setServerOk(ok: boolean) {
  if (ok === serverOk) return;
  serverOk = ok;
  statusCbs.forEach((cb) => cb(ok));
}

export function onServerStatus(cb: StatusCb) {
  statusCbs.add(cb);
  cb(serverOk);
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  try {
    const r = await fetch(url, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    setServerOk(true);
    const text = await r.text();
    return (text ? JSON.parse(text) : null) as T;
  } catch (e) {
    setServerOk(false);
    throw e;
  }
}

export const api = {
  async getSetting<T>(key: string): Promise<T | null> {
    const r = await req<{ value: T | null }>('GET', `/api/settings/${encodeURIComponent(key)}`);
    return r?.value ?? null;
  },
  putSetting(key: string, value: unknown) {
    return req('PUT', `/api/settings/${encodeURIComponent(key)}`, { value });
  },
  listDrawings(symbol: string) {
    return req<Drawing[]>('GET', `/api/drawings?symbol=${encodeURIComponent(symbol)}`);
  },
  saveDrawing(d: Drawing) {
    return req('PUT', `/api/drawings/${encodeURIComponent(d.id)}`, d);
  },
  deleteDrawing(id: string) {
    return req('DELETE', `/api/drawings/${encodeURIComponent(id)}`);
  },
};
