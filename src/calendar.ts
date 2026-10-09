/** 服务月按日历月计，不满一个月不按天折算。 */

export function addMonths(isoDate: string, months: number): string {
  const [year, month, day] = parseIsoDate(isoDate);
  const monthIndex = month - 1 + months;
  const nextYear = year + Math.floor(monthIndex / 12);
  const nextMonth = ((monthIndex % 12) + 12) % 12;
  const lastDay = daysInMonth(nextYear, nextMonth);
  return formatIso(nextYear, nextMonth + 1, Math.min(day, lastDay));
}

export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = parseIsoDate(isoDate);
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return utc.toISOString().slice(0, 10);
}

/**
 * 已经走完的服务月数。某一服务月只有在暂停日不早于该月最后一天时才算走完。
 * 六个月服务、开始日 1 月 1 日、2 月最后一天暂停：走完 2 个月，剩下 4 个月。
 */
export function elapsedServiceMonths(start: string, pauseDate: string, durationMonths: number): number {
  let elapsed = 0;
  let cursor = start;
  while (elapsed < durationMonths) {
    const next = addMonths(cursor, 1);
    const lastDay = addDays(next, -1);
    if (pauseDate >= lastDay) {
      elapsed += 1;
      cursor = next;
    } else {
      break;
    }
  }
  return elapsed;
}

export function remainingServiceMonths(start: string, pauseDate: string, durationMonths: number): number {
  if (durationMonths < 1) {
    throw new Error("服务时长至少要有一个月");
  }
  return durationMonths - elapsedServiceMonths(start, pauseDate, durationMonths);
}

function parseIsoDate(isoDate: string): [number, number, number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`日期必须是 YYYY-MM-DD：${isoDate}`);
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function formatIso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
