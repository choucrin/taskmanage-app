/** ローカルタイムゾーンでの YYYY-MM-DD 文字列を返す(toISOStringはUTC変換されるため使わない) */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey(): string {
  return toDateKey(new Date());
}

/** 0=日曜〜6=土曜 */
export function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

export const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'];
