export function istWindow(date: string, time: string, minutes: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time))
    return null;
  const from = new Date(`${date}T${time}:00+05:30`);
  if (!Number.isFinite(from.getTime())) return null;
  const roundTrip = new Date(from.getTime() + 19800000).toISOString();
  if (roundTrip.slice(0, 10) !== date || roundTrip.slice(11, 16) !== time)
    return null;
  return {
    validFrom: from.toISOString(),
    validUntil: new Date(from.getTime() + minutes * 60000).toISOString(),
  };
}
export function istFields(at: number) {
  const text = new Date(at + 19800000).toISOString();
  return { date: text.slice(0, 10), time: text.slice(11, 16) };
}
export const istLabel = (value: string) =>
  `${new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} IST`;
