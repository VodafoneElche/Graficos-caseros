import type { LayoutCfg, MaCfg, MtfCfg, PanelCfg, TfId } from '../core/types';

// Colores del tema y configuración por defecto de los gráficos.

export const THEME = {
  bg: '#0c1426', // azul marino oscuro
  panel: '#101a30',
  grid: '#18233d',
  border: '#24304d',
  text: '#c3c8d4',
  textDim: '#7d869c',
  up: '#089981',
  down: '#f23645',
  volUp: 'rgba(8,153,129,0.35)',
  volDown: 'rgba(242,54,69,0.35)',
  rsi: '#b39ddb',
  rsiMa: '#ffd54f',
  pivots: '#f5a623',
};

export const DEFAULT_WATCHLIST = ['BTCUSDT', 'SOLUSDT', 'LINKUSDT', 'BNBUSDT', 'THETAUSDT', 'SANDUSDT', 'BCHUSDT'];

export const GRID_TFS: TfId[] = ['1D', '4h', '1h', '15m', '5m', '45s'];

let seq = 0;
export function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
}

export function defaultMas(): MaCfg[] {
  return [
    { id: 'ema18', type: 'EMA', period: 18, color: '#4dd0e1', width: 1, visible: false },
    { id: 'ema20', type: 'EMA', period: 20, color: '#2962ff', width: 1, visible: true },
    { id: 'ema50', type: 'EMA', period: 50, color: '#ff9800', width: 1, visible: true },
    { id: 'sma200', type: 'SMA', period: 200, color: '#e040fb', width: 2, visible: true },
  ];
}

function mtf(type: 'EMA' | 'SMA', period: number, tf: TfId, color: string): MtfCfg {
  return { id: uid('m'), type, period, tf, color, width: 2, visible: true };
}

/** Medias de otra temporalidad por defecto, según los ejemplos de Jose. */
export function defaultMtf(tf: TfId): MtfCfg[] {
  switch (tf) {
    case '45s':
      return [mtf('EMA', 50, '5m', '#ffeb3b')];
    case '5m':
      return [mtf('EMA', 50, '15m', '#ffeb3b')];
    case '15m':
      return [mtf('EMA', 50, '1h', '#ffeb3b'), mtf('EMA', 20, '1h', '#00e676')];
    case '1h':
      return [mtf('EMA', 50, '4h', '#ffeb3b')];
    case '4h':
      return [mtf('EMA', 50, '1h', '#00e676')];
    default:
      return [];
  }
}

export function defaultPanel(tf: TfId): PanelCfg {
  return { tf, mas: defaultMas(), mtf: defaultMtf(tf), mtfVisible: true, rsi: true, volume: true, pivots: true };
}

export function defaultLayout(): LayoutCfg {
  return {
    symbol: 'BTCUSDT',
    mode: 'grid',
    grid: GRID_TFS.map(defaultPanel),
    single: defaultPanel('15m'),
  };
}

/** Rellena campos que falten en una configuración guardada (por si cambia la versión). */
export function normalizeLayout(l: Partial<LayoutCfg> | null): LayoutCfg {
  const d = defaultLayout();
  if (!l) return d;
  const fixPanel = (p: Partial<PanelCfg> | undefined, fallback: PanelCfg): PanelCfg => ({ ...fallback, ...(p || {}) });
  return {
    symbol: l.symbol || d.symbol,
    mode: l.mode === 'single' ? 'single' : 'grid',
    grid: d.grid.map((g, i) => fixPanel(l.grid?.[i], g)),
    single: fixPanel(l.single, d.single),
  };
}
