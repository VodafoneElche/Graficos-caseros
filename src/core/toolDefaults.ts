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
