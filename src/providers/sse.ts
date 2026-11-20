import type { Unsubscribe } from '../core/types';
import type { ConnectionStatus } from './provider';

// Tiempo real que llega de NUESTRO servidor (/stream/alpaca, /stream/capital) como
// "Server-Sent Events". El servidor mantiene la conexión con el proveedor (y las claves);
// aquí sólo pedimos la lista de símbolos que interesan y repartimos los mensajes.

type Cb = (data: any) => void;

export class SseHub {
  private es: EventSource | null = null;
  private subs = new Map<string, Set<Cb>>();
  private openKeys = '';
  private timer: number | null = null;
  private statusCbs = new Set<(s: ConnectionStatus, msg?: string) => void>();
  private reconnectCbs = new Set<() => void>();
  status: ConnectionStatus = 'closed';
  statusMsg = '';
  private hadError = false;
  private everOpen = false;

  constructor(
    private path: string,
    private param: string,
    private dataEvent: string,
    private keyOf: (data: any) => string,
  ) {}

  subscribe(key: string, cb: Cb): Unsubscribe {
    let set = this.subs.get(key);
    if (!set) {
      set = new Set();
      this.subs.set(key, set);
      this.schedule();
    }
    set.add(cb);
    return () => {
      const s = this.subs.get(key);
      if (!s) return;
      s.delete(cb);
      if (!s.size) {
        this.subs.delete(key);
        this.schedule();
      }
    };
  }

  onStatus(cb: (s: ConnectionStatus, msg?: string) => void): Unsubscribe {
    this.statusCbs.add(cb);
    cb(this.status, this.statusMsg);
    return () => this.statusCbs.delete(cb);
  }

  onReconnect(cb: () => void): Unsubscribe {
    this.reconnectCbs.add(cb);
    return () => this.reconnectCbs.delete(cb);
  }

  private setStatus(s: ConnectionStatus, msg = '') {
    this.status = s;
    this.statusMsg = msg;
    this.statusCbs.forEach((cb) => cb(s, msg));
  }

  /** Agrupa los cambios de lista (al cambiar de símbolo se piden varios de golpe). */
  private schedule() {
    if (this.timer != null) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      this.reopen();
    }, 250);
  }

  private reopen() {
    const keys = [...this.subs.keys()].sort().join(',');
    if (keys === this.openKeys && this.es) return;
    this.es?.close();
    this.es = null;
    this.openKeys = keys;
    if (!keys) {
      this.setStatus('closed');
      return;
    }
    const es = new EventSource(`${this.path}?${this.param}=${encodeURIComponent(keys)}`);
    this.es = es;
    es.addEventListener(this.dataEvent, (ev) => {
      let d: any;
      try {
        d = JSON.parse((ev as MessageEvent).data);
      } catch {
        return;
      }
      this.subs.get(this.keyOf(d))?.forEach((cb) => cb(d));
    });
    es.addEventListener('status', (ev) => {
      let d: any;
      try {
        d = JSON.parse((ev as MessageEvent).data);
      } catch {
        return;
      }
      const s: ConnectionStatus = d.state === 'open' ? 'open' : d.state === 'connecting' ? 'connecting' : 'closed';
      this.setStatus(s, d.msg || '');
      if (s === 'open') {
        // Tras un corte: recargar las últimas velas por si se perdió algo.
        if (this.everOpen && this.hadError) this.reconnectCbs.forEach((cb) => cb());
        this.everOpen = true;
        this.hadError = false;
      } else if (this.everOpen) this.hadError = true;
    });
    es.onerror = () => {
      // El navegador reintenta solo; avisamos para que se vea el punto rojo.
      if (this.everOpen) this.hadError = true;
      this.setStatus('connecting', 'Sin conexión con el servidor de la app');
    };
  }
}
