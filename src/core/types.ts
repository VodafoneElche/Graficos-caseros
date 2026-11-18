// Tipos básicos compartidos por toda la aplicación.

/** Una vela. `time` es el inicio de la vela en SEGUNDOS UTC. */
export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type Unsubscribe = () => void;

/** Identificadores de temporalidad usados en toda la app. */
export type TfId =
  | '1s' | '45s' | '1m' | '2m' | '3m' | '5m' | '10m' | '15m' | '30m'
  | '1h' | '2h' | '3h' | '4h' | '1D' | '1W' | '1M' | '12M';

export type MaType = 'EMA' | 'SMA';

/** Media móvil normal (sobre la temporalidad del propio gráfico). */
export interface MaCfg {
  id: string;
  type: MaType;
  period: number;
  color: string;
  width: number;
  visible: boolean;
}

/** Media de OTRA temporalidad dibujada sobre el gráfico actual. */
export interface MtfCfg {
  id: string;
  type: MaType;
  period: number;
  tf: TfId;
  color: string;
  width: number;
  visible: boolean;
}

/** Configuración de un gráfico (panel). */
export interface PanelCfg {
  tf: TfId;
  mas: MaCfg[];
  mtf: MtfCfg[];
  mtfVisible: boolean;
  rsi: boolean;
  volume: boolean;
  pivots: boolean;
  /** Leyenda de indicadores desplegada (como el "⌄ 5" de TradingView). */
  legendOpen: boolean;
  /** Escala de precios logarítmica. */
  logScale?: boolean;
}

export interface LayoutCfg {
  symbol: string;
  mode: 'grid' | 'single';
  grid: PanelCfg[];
  single: PanelCfg;
}

/** Línea horizontal dibujada (por símbolo). */
export interface HLine {
  id: string;
  symbol: string;
  type: 'hline';
  price: number;
  color: string;
  width: number;
  style: 0 | 1 | 2; // 0 sólida, 1 punteada, 2 discontinua
}
