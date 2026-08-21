export function familiarityWeight(value: number) {
  const rating = Math.min(5, Math.max(0, Math.round(value)));
  return (6 - rating) ** 2;
}
