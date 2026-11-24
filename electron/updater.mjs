// ─────────────────────────────────────────────────────────────────────────────
// Actualizaciones automáticas del programa de escritorio.
//
// Cómo funciona:
//   · Cada versión nueva se publica en GitHub Releases con su propia etiqueta
//     (v0.3.3, v0.3.4...) y los archivos Graficos-familia-Setup.exe,
//     Graficos-familia-Setup.exe.blockmap y latest.yml (ver
//     .github/workflows/instalador-windows.yml y PUBLICAR.md).
//   · Al abrir el programa (y luego cada 2 horas) se mira latest.yml de la
//     última release. Si la versión es mayor que la instalada, se descarga sola
//     en segundo plano.
//   · Cuando está descargada, la ventana muestra un aviso con el botón
//     "Reiniciar y actualizar". Si no se pulsa, se instala sola al cerrar.
//
// La ventana recibe el estado por IPC (electron/preload.cjs → window.graficosApp).
// ─────────────────────────────────────────────────────────────────────────────

import { app, ipcMain } from 'electron';
import updaterPkg from 'electron-updater';

const { autoUpdater } = updaterPkg;

const CHECK_EVERY_MS = 2 * 60 * 60 * 1000; // cada 2 horas
const FIRST_CHECK_MS = 8 * 1000; // 8 s después de abrir, para no frenar el arranque

/** Estado actual, para la ventana. state: idle | checking | none | downloading | ready | error | dev */
let status = { state: 'idle', current: app.getVersion() };
let getWindow = () => null;
let manualCheck = false;

function send(next) {
  status = { ...next, current: app.getVersion() };
  const win = getWindow();
  if (win && !win.isDestroyed()) win.webContents.send('update:status', status);
}

async function check(manual) {
  if (!app.isPackaged) {
    send({ state: 'dev' });
    return status;
  }
  if (status.state === 'downloading' || status.state === 'ready') return status;
  manualCheck = manual;
  try {
    await autoUpdater.checkForUpdates();
  } catch (e) {
    if (manual) send({ state: 'error', message: e?.message ? String(e.message) : String(e) });
  }
  return status;
}

/** Se llama una vez, tras crear la ventana. */
export function initUpdater(windowGetter) {
  getWindow = windowGetter;

  ipcMain.handle('update:status', () => status);
  ipcMain.handle('update:check', () => check(true));
  ipcMain.on('update:install', () => {
    if (status.state !== 'ready') return;
    // isSilent=true: sin asistente; isForceRunAfter=true: vuelve a abrir el programa.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
  });

  if (!app.isPackaged) {
    status = { state: 'dev', current: app.getVersion() };
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  // Solo para pruebas: otra dirección de la que bajar las versiones.
  if (process.env.GRAFICOS_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: 'generic', url: process.env.GRAFICOS_UPDATE_URL });
  }
  autoUpdater.logger = {
    info: (m) => console.log('[actualizaciones]', m),
    warn: (m) => console.warn('[actualizaciones]', m),
    error: (m) => console.error('[actualizaciones]', m),
    debug: () => {},
  };

  autoUpdater.on('checking-for-update', () => {
    if (manualCheck) send({ state: 'checking' });
  });
  autoUpdater.on('update-not-available', () => {
    send({ state: manualCheck ? 'none' : 'idle' });
    manualCheck = false;
  });
  autoUpdater.on('update-available', (info) => {
    manualCheck = false;
    send({ state: 'downloading', version: info.version, percent: 0 });
  });
  autoUpdater.on('download-progress', (p) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(p.percent / 100);
    send({ state: 'downloading', version: status.version, percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    send({ state: 'ready', version: info.version });
  });
  autoUpdater.on('error', (e) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.setProgressBar(-1);
    // Sin internet o GitHub caído: solo se avisa si se buscó a mano.
    if (manualCheck || status.state === 'downloading') {
      send({ state: 'error', message: e?.message ? String(e.message) : String(e) });
    } else {
      send({ state: 'idle' });
    }
    manualCheck = false;
  });

  setTimeout(() => check(false), FIRST_CHECK_MS);
  setInterval(() => check(false), CHECK_EVERY_MS);
}
