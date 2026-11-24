// Aviso de actualizaciones dentro de la app (solo en el programa de escritorio).
// El programa (electron/updater.mjs) busca versiones nuevas en GitHub, las
// descarga solo y aquí se muestra el estado junto a la versión, arriba a la
// derecha, más una tarjeta con "Reiniciar y actualizar" cuando está lista.

interface UpdateStatus {
  state: 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error' | 'dev';
  current: string;
  version?: string;
  percent?: number;
  message?: string;
}

interface GraficosApp {
  updateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): void;
  onUpdateStatus(cb: (s: UpdateStatus) => void): () => void;
}

const RELEASES_URL = 'https://github.com/VodafoneElche/Graficos-caseros/releases';

export function initUpdates(versionEl: HTMLElement): void {
  const bridge = (window as unknown as { graficosApp?: GraficosApp }).graficosApp;
  if (!bridge) return; // en el navegador no hay actualizaciones automáticas

  const pill = document.createElement('button');
  pill.className = 'upd-pill';
  pill.style.display = 'none';
  versionEl.after(pill);

  versionEl.classList.add('clickable');
  versionEl.title += ' · Clic para buscar actualizaciones';

  let card: HTMLElement | null = null;
  let dismissedFor = '';
  let hideTimer = 0;

  function showCard(version: string) {
    if (card || dismissedFor === version) return;
    card = document.createElement('div');
    card.className = 'upd-card';
    card.innerHTML = `
      <div class="upd-title">Hay una versión nueva: v${version}</div>
      <div class="upd-text">Ya está descargada. Al reiniciar se instala sola (tarda unos segundos) y el programa se vuelve a abrir. Tus líneas, alertas y ajustes se conservan.</div>
      <div class="upd-buttons">
        <a class="upd-notes" href="${RELEASES_URL}/tag/v${version}" target="_blank" rel="noopener">Novedades</a>
        <button class="upd-later">Más tarde</button>
        <button class="upd-now">Reiniciar y actualizar</button>
      </div>`;
    card.querySelector('.upd-now')!.addEventListener('click', () => {
      (card!.querySelector('.upd-now') as HTMLButtonElement).textContent = 'Instalando…';
      bridge!.installUpdate();
    });
    card.querySelector('.upd-later')!.addEventListener('click', () => {
      dismissedFor = version;
      card?.remove();
      card = null;
    });
    document.body.appendChild(card);
  }

  function render(s: UpdateStatus) {
    clearTimeout(hideTimer);
    pill.className = 'upd-pill';
    pill.onclick = null;
    let text = '';
    switch (s.state) {
      case 'checking':
        text = 'Buscando actualizaciones…';
        break;
      case 'none':
        text = '✓ Estás en la última versión';
        pill.classList.add('ok');
        hideTimer = window.setTimeout(() => (pill.style.display = 'none'), 5000);
        break;
      case 'downloading':
        text = `⬇ Descargando v${s.version ?? ''}… ${s.percent ?? 0}%`;
        break;
      case 'ready':
        text = `⟳ Actualizar a v${s.version}`;
        pill.classList.add('ready');
        pill.title = 'Reiniciar el programa e instalar la versión nueva';
        pill.onclick = () => {
          dismissedFor = '';
          showCard(s.version!);
        };
        showCard(s.version!);
        break;
      case 'error':
        text = '⚠ No se pudo buscar actualizaciones';
        pill.classList.add('err');
        pill.title = s.message ?? '';
        hideTimer = window.setTimeout(() => (pill.style.display = 'none'), 10000);
        break;
      case 'dev':
        text = 'Actualizaciones: solo en el programa instalado';
        hideTimer = window.setTimeout(() => (pill.style.display = 'none'), 5000);
        break;
      default:
        pill.style.display = 'none';
        return;
    }
    pill.textContent = text;
    pill.style.display = '';
  }

  versionEl.addEventListener('click', () => {
    bridge.checkForUpdates().then(render, () => {});
  });
  bridge.onUpdateStatus(render);
  bridge.updateStatus().then(render, () => {});
}
