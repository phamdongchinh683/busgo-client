export function buildYearOptions(anchorYear = new Date().getFullYear(), span = 2): number[] {
  const years: number[] = [];
  for (let offset = -span; offset <= span; offset += 1) {
    years.push(anchorYear + offset);
  }
  return years;
}
