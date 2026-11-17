import { TickMarkType, type Time } from 'lightweight-charts';

// Fechas y horas en la zona horaria del navegador (España), no en UTC.

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const pad = (n: number) => String(n).padStart(2, '0');

function toDate(t: Time): Date {
  return new Date((t as number) * 1000);
}

export function makeTimeFormatter(showTime: boolean, showSeconds: boolean) {
  return (t: Time): string => {
    const d = toDate(t);
    let s = `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
    if (showTime) s += `  ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    if (showSeconds) s += `:${pad(d.getSeconds())}`;
    return s;
  };
}

export function tickMarkFormatter(t: Time, type: TickMarkType): string {
  const d = toDate(t);
  switch (type) {
    case TickMarkType.Year:
      return String(d.getFullYear());
    case TickMarkType.Month:
      return MESES[d.getMonth()];
    case TickMarkType.DayOfMonth:
      return String(d.getDate());
    case TickMarkType.Time:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    case TickMarkType.TimeWithSeconds:
      return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return '';
}

export function formatVolume(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return v.toFixed(2);
}
