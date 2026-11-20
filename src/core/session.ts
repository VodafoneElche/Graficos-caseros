// ─────────────────────────────────────────────────────────────────────────────
// HORARIOS DE MERCADO ("sesiones")
//
// Cripto cotiza 24/7 y sus velas se cortan en horas UTC redondas. Acciones y
// forex NO: TradingView corta sus velas según el horario de Nueva York.
//
//  - Acciones EE. UU. (sólo horario regular, como TradingView por defecto):
//      de 9:30 a 16:00 hora de Nueva York. La vela de 1h va de 9:30 a 10:30,
//      la de 4h de 9:30 a 13:30 y de 13:30 a 16:00.
//  - Forex: el día empieza a las 17:00 de Nueva York (la vela diaria del
//      lunes empieza el domingo a las 17:00, y lleva la fecha del lunes).
//  - Oro y plata: igual, pero el día empieza a las 18:00 de Nueva York.
//
// Las velas diarias, semanales y mensuales se guardan con la hora 00:00 UTC de su
// FECHA de negociación (así el eje muestra la misma fecha que TradingView).
// Las velas de menos de un día llevan la hora real de inicio.
// ─────────────────────────────────────────────────────────────────────────────

const H = 3600;
const D = 86400;

/** Domingo número `n` (1 = primero) de un mes, a 00:00 UTC (segundos). */
function nthSunday(year: number, month: number, n: number): number {
  const first = Date.UTC(year, month, 1) / 1000;
  const dow = new Date(first * 1000).getUTCDay(); // 0 = domingo
  return first + (((7 - dow) % 7) + (n - 1) * 7) * D;
}

const dstCache = new Map<number, [number, number]>();

/** Diferencia de Nueva York con UTC en segundos (-4 h en verano, -5 h en invierno). */
export function nyOffset(t: number): number {
  const year = new Date(t * 1000).getUTCFullYear();
  let r = dstCache.get(year);
  if (!r) {
    // Horario de verano: del 2.º domingo de marzo a las 2:00 (7:00 UTC)
    // al 1.er domingo de noviembre a las 2:00 (6:00 UTC).
    r = [nthSunday(year, 2, 2) + 7 * H, nthSunday(year, 10, 1) + 6 * H];
    dstCache.set(year, r);
  }
  return t >= r[0] && t < r[1] ? -4 * H : -5 * H;
}

export interface MarketSession {
  readonly id: string;
  /** Fecha de negociación (00:00 UTC de esa fecha) del instante `t`. Si `t` ya es una fecha, la devuelve igual. */
  date(t: number): number;
  /** Instante real en que abre el día de negociación `dateLabel`. */
  dateOpen(dateLabel: number): number;
  /** Instante real en que cierra el día de negociación que contiene `t`. */
  close(t: number): number;
  /** ¿Se negocia en el instante `t`? (fuera de horario los datos se ignoran) */
  inSession(t: number): boolean;
}

/** Acciones EE. UU., horario regular 9:30-16:00 de Nueva York, de lunes a viernes. */
class UsStockSession implements MarketSession {
  readonly id = 'us-stocks';
  date(t: number): number {
    if (t % D === 0) return t; // ya es una fecha (nunca hay negociación a las 00:00 UTC)
    const local = t + nyOffset(t);
    return Math.floor(local / D) * D;
  }
  dateOpen(label: number): number {
    return label + 9.5 * H - nyOffset(label + 12 * H);
  }
  close(t: number): number {
    const label = this.date(t);
    return label + 16 * H - nyOffset(label + 12 * H);
  }
  inSession(t: number): boolean {
    const local = t + nyOffset(t);
    const dow = (Math.floor(local / D) + 4) % 7; // 0 = domingo
    if (dow === 0 || dow === 6) return false;
    const sec = ((local % D) + D) % D;
    return sec >= 9.5 * H && sec < 16 * H;
  }
}

/** Forex y metales: día de 24 h que empieza a `startHour` de Nueva York; cerrado el fin de semana. */
class FxSession implements MarketSession {
  constructor(readonly id: string, private startHour: number) {}
  date(t: number): number {
    const local = t + nyOffset(t) + (24 - this.startHour) * H;
    return Math.floor(local / D) * D;
  }
  dateOpen(label: number): number {
    const approx = label - (24 - this.startHour) * H;
    return approx - nyOffset(approx + 5 * H);
  }
  close(t: number): number {
    return this.dateOpen(this.date(t) + D);
  }
  inSession(t: number): boolean {
    // Del domingo a `startHour` al viernes a las 17:00 de Nueva York.
    const local = t + nyOffset(t);
    const dow = (Math.floor(local / D) + 4) % 7;
    const sec = ((local % D) + D) % D;
    if (dow === 6) return false;
    if (dow === 0) return sec >= this.startHour * H;
    if (dow === 5) return sec < 17 * H;
    return true;
  }
}

export const US_STOCKS: MarketSession = new UsStockSession();
export const FOREX: MarketSession = new FxSession('forex', 17);
export const METALS: MarketSession = new FxSession('metals', 18);
