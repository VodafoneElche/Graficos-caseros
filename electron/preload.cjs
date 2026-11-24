// Puente seguro entre la ventana y el programa (solo para las actualizaciones).
// La página lo ve como window.graficosApp.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('graficosApp', {
  /** Estado actual de las actualizaciones. */
  updateStatus: () => ipcRenderer.invoke('update:status'),
  /** Buscar ahora (cuando se pulsa en la versión). */
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  /** Cerrar, instalar la versión descargada y volver a abrir. */
  installUpdate: () => ipcRenderer.send('update:install'),
  /** Avisos de cambios de estado. Devuelve una función para dejar de escuchar. */
  onUpdateStatus: (cb) => {
    const fn = (_e, s) => cb(s);
    ipcRenderer.on('update:status', fn);
    return () => ipcRenderer.removeListener('update:status', fn);
  },
});
