// ─────────────────────────────────────────────────────────────────────────────
// Programa de escritorio (Windows) de "Gráficos familia".
//
// Arranca el servidor interno (server/server.mjs) dentro del propio programa y
// abre una ventana propia, maximizada y sin barras de navegador.
//   F11        pantalla completa
//   F5         recargar
//   Ctrl+0/+/- zoom
// Los datos (líneas, ajustes) se guardan en %APPDATA%\Graficos familia\datos.
// ─────────────────────────────────────────────────────────────────────────────

import { app, BrowserWindow, dialog, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PREFERRED_PORT = 37420; // puerto fijo para que la app recuerde sus ajustes locales

// El aviso "SQLite is an experimental feature" no interesa al usuario.
process.removeAllListeners('warning');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let win = null;
  let srv = null;

  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.setAppUserModelId('es.familia.graficos');

  async function boot() {
    const dataDir = path.join(app.getPath('userData'), 'datos');
    const distDir = path.join(ROOT, 'dist');
    try {
      srv = await startServer({ port: PREFERRED_PORT, dataDir, distDir });
    } catch (e) {
      if (e && e.code === 'EADDRINUSE') srv = await startServer({ port: 0, dataDir, distDir });
      else throw e;
    }

    win = new BrowserWindow({
      width: 1600,
      height: 900,
      show: false,
      backgroundColor: '#000d2e',
      title: 'Gráficos familia',
      icon: path.join(ROOT, 'build', 'icon.png'),
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    win.removeMenu();
    win.once('ready-to-show', () => {
      win.maximize();
      win.show();
    });

    // Atajos de teclado (no hay menú).
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      if (input.key === 'F11') {
        win.setFullScreen(!win.isFullScreen());
        event.preventDefault();
      } else if (input.key === 'Escape' && win.isFullScreen()) {
        win.setFullScreen(false);
      } else if (input.key === 'F5' || (ctrl && input.key.toLowerCase() === 'r')) {
        win.webContents.reload();
        event.preventDefault();
      } else if (ctrl && (input.key === '+' || input.key === '=')) {
        win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5);
        event.preventDefault();
      } else if (ctrl && input.key === '-') {
        win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5);
        event.preventDefault();
      } else if (ctrl && input.key === '0') {
        win.webContents.setZoomLevel(0);
        event.preventDefault();
      } else if (ctrl && input.shift && input.key.toLowerCase() === 'i') {
        win.webContents.toggleDevTools();
        event.preventDefault();
      }
    });

    // Los enlaces externos (Binance, TradingView...) se abren en el navegador normal.
    const appOrigin = `http://127.0.0.1:${srv.port}`;
    win.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) shell.openExternal(url);
      return { action: 'deny' };
    });
    win.webContents.on('will-navigate', (e, url) => {
      if (!url.startsWith(appOrigin)) {
        e.preventDefault();
        shell.openExternal(url);
      }
    });

    win.on('closed', () => (win = null));
    await win.loadURL(`${appOrigin}/?app=1`);
  }

  app.whenReady().then(() =>
    boot().catch((e) => {
      dialog.showErrorBox('Gráficos familia', 'No se ha podido arrancar:\n\n' + (e && e.message ? e.message : String(e)));
      app.quit();
    }),
  );

  app.on('window-all-closed', () => {
    srv?.close();
    app.quit();
  });
}
