import type { FibExt, Position } from './types';

// Configuración de las herramientas de dibujo de la FASE 3, copiada de los menús
// de TradingView de Jose. Se deja aquí ya preparada para usarla al construirlas.

/** Retroceso de Fibonacci (menú "Estilo"). */
export const FIB_DEFAULTS = {
  trendLine: { visible: true, color: '#787b86', style: 'dashed' as const },
  levelsLine: { style: 'solid' as const, width: 1 },
  extend: 'none' as const, // "No ampliar"
  levels: [
    { value: 0, color: '#787b86', visible: true },
    { value: 0.236, color: '#f23645', visible: false },
    { value: 0.382, color: '#522f90', visible: true },
    { value: 0.5, color: '#3c8540', visible: true },
    { value: 0.618, color: '#b81a51', visible: true },
    { value: 0.75, color: '#4c4e57', visible: true },
    { value: 1, color: '#2e2e2e', visible: true },
    { value: 1.618, color: '#2962ff', visible: false },
    { value: 2.618, color: '#f23645', visible: false },
  ],
  useOneColor: false,
  background: false,
  reverse: false,
  prices: true, // muestra "0,5 (68.079,34)"
  labelsPosition: 'right' as const, // etiquetas a la derecha, como en sus gráficos
};

/** Herramienta de posición larga/corta. */
export const POSITION_DEFAULTS = {
  accountSize: 10000,
  lotSize: 1,
  risk: 2,
  riskUnit: '%' as const,
  lineColor: '#787b86',
  stopColor: 'rgba(242,54,69,0.2)',
  targetColor: 'rgba(8,153,129,0.2)',
  textColor: '#ffffff',
  textSize: 12,
  priceLabels: true,
  stats: 'priceDeviation' as const, // "Desviación de precio"
  compactStats: true,
  alwaysShowStats: false,
};

/**
 * Extensión de Fibonacci en función de la tendencia, como la tiene Jose en TradingView:
 * activados 0,618 (gris), 1 (cian), 1,272 (azul) y 1,618 (verde azulado); línea de
 * tendencia gris discontinua; sin ampliar.
 */
export function fibExtDefaults(): Omit<FibExt, 'id' | 'symbol' | 'type' | 'points'> {
  const lv = (value: number, color: string, on = false) => ({ value, color, on });
  return {
    trendLine: true,
    trendColor: '#787b86',
    trendStyle: 2,
    levelsWidth: 1,
    levelsStyle: 0,
    extend: 'none',
    showLabels: true,
    showPrices: true,
    background: false,
    levels: [
      lv(0, '#787b86'),
      lv(0.236, '#f23645'),
      lv(0.382, '#ff9800'),
      lv(0.5, '#4caf50'),
      lv(0.618, '#787b86', true),
      lv(0.786, '#00bcd4'),
      lv(1, '#00bcd4', true),
      lv(1.272, '#1848cc', true),
      lv(1.414, '#f23645'),
      lv(1.618, '#42bda8', true),
      lv(2, '#089981'),
      lv(2.272, '#ff9800'),
      lv(2.414, '#4caf50'),
      lv(2.618, '#f23645'),
      lv(3, '#00bcd4'),
      lv(3.618, '#9c27b0'),
      lv(4.236, '#e91e63'),
    ],
  };
}

/** Retroceso de Fibonacci como lo tiene Jose (ver FIB_DEFAULTS). */
export function fibDefaults(): Omit<FibExt, 'id' | 'symbol' | 'type' | 'points'> {
  return {
    trendLine: FIB_DEFAULTS.trendLine.visible,
    trendColor: FIB_DEFAULTS.trendLine.color,
    trendStyle: 2,
    levelsWidth: FIB_DEFAULTS.levelsLine.width,
    levelsStyle: 0,
    extend: 'none',
    showLabels: true,
    showPrices: FIB_DEFAULTS.prices,
    background: FIB_DEFAULTS.background,
    levels: FIB_DEFAULTS.levels.map((l) => ({ value: l.value, color: l.color, on: l.visible })),
  };
}

/** Posición larga/corta como la tiene Jose (ver POSITION_DEFAULTS). */
export function positionDefaults(): Pick<
  Position,
  'account' | 'lot' | 'risk' | 'riskUnit' | 'lineColor' | 'stopColor' | 'targetColor' | 'textColor' | 'textSize' | 'compact' | 'alwaysStats'
> {
  const p = POSITION_DEFAULTS;
  return {
    account: p.accountSize,
    lot: p.lotSize,
    risk: p.risk,
    riskUnit: p.riskUnit,
    lineColor: p.lineColor,
    stopColor: p.stopColor,
    targetColor: p.targetColor,
    textColor: p.textColor,
    textSize: p.textSize,
    compact: p.compactStats,
    alwaysStats: p.alwaysShowStats,
  };
}
