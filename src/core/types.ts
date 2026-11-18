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

/** Fuente de datos de un indicador (como el desplegable "Fuente" de TradingView). */
export type PriceSource = 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3' | 'ohlc4' | 'hlcc4';

/** Suavizado de una media (TradingView: Ninguno, SMA, SMA + Bandas de Bollinger, EMA, SMMA (RMA), WMA, VWMA). */
export type SmoothingType = 'none' | 'SMA' | 'SMA+BB' | 'EMA' | 'SMMA' | 'WMA' | 'VWMA';

/** Grupos de temporalidades para la pestaña "Visibilidad". */
export type TfGroup = 'sec' | 'min' | 'hour' | 'day' | 'week' | 'month';

/** Media móvil configurable como la EMA/SMA de TradingView. */
export interface MaCfg {
  id: string;
  type: MaType;
  period: number;
  source?: PriceSource; // por defecto 'close'
  offset?: number; // "Compensación" (barras hacia la derecha)
  smoothing?: SmoothingType;
  smoothingLength?: number;
  bbMult?: number;
  /** "Intervalo de tiempo": vacío = el del gráfico; si no, media de otra temporalidad (MTF). */
  tf?: TfId;
  /** "Espere al cierre de los intervalos de tiempo" (sólo si tf está puesto). */
  waitClose?: boolean;
  color: string;
  width: number;
  lineStyle?: 0 | 1 | 2;
  smoothingColor?: string;
  /** Estilo: "Etiquetas en la escala de precios" y "Valores en la línea de estado". */
  axisLabel?: boolean;
  statusValue?: boolean;
  /** Visibilidad por grupos de temporalidad (vacío = en todas). */
  hiddenOn?: TfGroup[];
  visible: boolean;
}

/** Antiguo formato de media MTF (se convierte a MaCfg con `tf`). */
export interface MtfCfg {
  id: string;
  type: MaType;
  period: number;
  tf: TfId;
  color: string;
  width: number;
  visible: boolean;
}

export type PivotType = 'Traditional' | 'Fibonacci' | 'Woodie' | 'Classic' | 'DM' | 'Camarilla';
export type PivotTf = 'Auto' | '1D' | '1W' | '1M' | '12M';
export type PivotLevelName = 'P' | 'S1' | 'R1' | 'S2' | 'R2' | 'S3' | 'R3' | 'S4' | 'R4' | 'S5' | 'R5';

/** Pivots como el indicador "Pivots" (Pivot Points Standard) de TradingView. */
export interface PivotCfg {
  type: PivotType;
  tf: PivotTf;
  count: number; // "Número de pivotes anteriores"
  useDaily: boolean; // "Usar valores diarios"
  showLabels: boolean;
  showPrices: boolean;
  labelsPos: 'left' | 'right';
  width: number;
  levels: Record<PivotLevelName, { color: string; on: boolean }>;
}

/** Indicador 2YMA (media de 2 años y media de 2 años x 5). */
export interface TwoYmaCfg {
  on: boolean;
  maColor: string;
  x5Color: string;
  plotColor: string;
  showPlot: boolean;
  fillLow: string; // fondo cuando el precio está por debajo de la media de 2 años
  fillHigh: string; // fondo cuando el precio está por encima de la media x 5
  showFill: boolean;
}

/** Configuración de un gráfico (panel). */
export interface PanelCfg {
  tf: TfId;
  mas: MaCfg[];
  /** Obsoleto: las medias MTF ahora son medias con `tf`. Se migra al cargar. */
  mtf?: MtfCfg[];
  mtfVisible?: boolean;
  rsi: boolean;
  volume: boolean;
  pivots: boolean;
  pivotCfg?: PivotCfg;
  twoYma?: TwoYmaCfg;
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
  /** Qué gráfico de la cuadrícula se ve en grande (0-5). */
  singleIdx?: number;
}

/** Estilo de línea: 0 sólida, 1 punteada, 2 discontinua. */
export type LineStyleId = 0 | 1 | 2;

/** Línea horizontal dibujada (por símbolo). */
export interface HLine {
  id: string;
  symbol: string;
  type: 'hline';
  price: number;
  color: string;
  width: number; // admite 0,5
  style: LineStyleId;
}

/** Línea vertical (por símbolo): se ve en todas las temporalidades. */
export interface VLine {
  id: string;
  symbol: string;
  type: 'vline';
  time: number; // segundos UTC
  color: string;
  width: number;
  style: LineStyleId;
}

export interface FibLevel {
  value: number;
  color: string;
  on: boolean;
}

/** Extensión de Fibonacci en función de la tendencia (3 puntos). */
export interface FibExt {
  id: string;
  symbol: string;
  type: 'fibext';
  points: { time: number; price: number }[]; // A, B, C
  trendLine: boolean;
  trendColor: string;
  trendStyle: LineStyleId;
  levelsWidth: number;
  levelsStyle: LineStyleId;
  extend: 'none' | 'left' | 'right' | 'both';
  showLabels: boolean;
  showPrices: boolean;
  background: boolean;
  levels: FibLevel[];
}

export type Drawing = HLine | VLine | FibExt;
