import type { LayoutCfg, MaCfg, MtfCfg, PanelCfg, TfId } from '../core/types';

// Colores y configuración por defecto, copiados de la configuración de TradingView de Jose.

export const THEME = {
  bg: '#000d2e', // fondo del gráfico (Lienzo → Fondo sólido)
  grid: 'rgba(0,0,0,0)', // líneas de cuadrícula transparentes
  scaleText: '#b2b5be',
  scaleLine: 'rgba(0,0,0,0)',
  crosshair: '#8e939c',
  crosshairLabel: '#363a45',
  // Velas: alcistas huecas con borde y mecha blancos; bajistas gris #4a4a4a.
  upBody: 'rgba(0,0,0,0)',
  upBorder: '#ffffff',
  downBody: '#4a4a4a',
  downBorder: '#4a4a4a',
  // Para textos de la leyenda (TradingView usa verde/rojo en los valores O H L C).
  up: '#089981',
  down: '#f23645',
  volUp: 'rgba(8,153,129,0.5)',
  volDown: 'rgba(242,54,69,0.5)',
  volMa: '#ffffff',
  rsi: '#7e57c2',
  rsiMa: '#f7c80a',
  rsiBand: 'rgba(126,87,194,0.10)',
  pivots: '#f39100',
};

export const COLORS = {
  white: '#ffffff',
  red: '#f23645',
  orange: '#ff9800',
  purple: '#7e57c2',
  cyan: '#00bcd4',
};

/** Símbolos de la watchlist de Jose (en el orden de su lista de TradingView). */
export const DEFAULT_WATCHLIST = [
  'LINKUSDT', 'SOLUSDT', 'BNBUSDT', 'THETAUSDT', 'SANDUSDT', 'BCHUSDT', 'BTCUSDT',
  'XAGUSD', 'XAUUSD', 'MSTR', 'CRCL', 'MARA', 'WDC', 'SNDK', 'AXTI', 'LITE', 'COHR', 'QBTS',
  'MSFT', 'AAPL', 'SPCX', 'PLTR', 'INTC', 'ORCL', 'RIOT', 'RKLB', 'GOOG',
];

/** Orden de los 6 gráficos: columna izquierda 1D, 4h, 1h; columna derecha 15m, 5m, 45s. */
export const GRID_TFS: TfId[] = ['1D', '4h', '1h', '15m', '5m', '45s'];

let seq = 0;
export function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;
}

type MaVis = { ema18?: boolean; ema20?: boolean; ema50?: boolean; sma200?: boolean };

export function defaultMas(v: MaVis = { ema20: true, ema50: true, sma200: true }): MaCfg[] {
  return [
    { id: 'ema50', type: 'EMA', period: 50, color: COLORS.red, width: 1, visible: !!v.ema50 },
    { id: 'sma200', type: 'SMA', period: 200, color: COLORS.purple, width: 1, visible: !!v.sma200 },
    { id: 'ema20', type: 'EMA', period: 20, color: COLORS.white, width: 1, visible: !!v.ema20 },
    { id: 'ema18', type: 'EMA', period: 18, color: COLORS.white, width: 1, visible: !!v.ema18 },
  ];
}

function mtf(type: 'EMA' | 'SMA', period: number, tf: TfId, color = COLORS.orange, visible = true): MtfCfg {
  return { id: uid('m'), type, period, tf, color, width: 1, visible };
}

/** Configuración de cada gráfico, según los pantallazos de Jose. */
export function defaultPanel(tf: TfId): PanelCfg {
  const base: PanelCfg = { tf, mas: defaultMas(), mtf: [], mtfVisible: true, rsi: false, volume: false, pivots: false, legendOpen: true };
  switch (tf) {
    case '1D':
      return { ...base, mas: defaultMas({ ema20: true, ema50: true, sma200: true }) };
    case '4h':
      return { ...base, mas: defaultMas({ ema50: true, sma200: true }), mtf: [mtf('EMA', 50, '1h')], legendOpen: false };
    case '1h':
      return { ...base, mas: defaultMas({ ema20: true, ema50: true }), mtf: [mtf('EMA', 50, '4h')], volume: true };
    case '15m':
      return { ...base, mas: defaultMas({ ema50: true }), mtf: [mtf('EMA', 50, '5m')], pivots: true };
    case '5m':
      return { ...base, mas: defaultMas({ ema18: true }), mtf: [mtf('EMA', 50, '15m')], pivots: true, rsi: true };
    case '45s':
      return { ...base, mas: defaultMas({ ema20: true, ema50: true }), mtf: [mtf('EMA', 20, '1h', COLORS.orange, false)], pivots: true };
    default:
      return { ...base, mas: defaultMas({ ema20: true, ema50: true }) };
  }
}

export function defaultLayout(): LayoutCfg {
  return {
    symbol: 'BTCUSDT',
    mode: 'grid',
    grid: GRID_TFS.map(defaultPanel),
    single: defaultPanel('4h'),
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
