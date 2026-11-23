export function assignWeeks(
  weeks: string[][],
  ids: string[],
  targets: number[],
  remove = false,
): string[][] {
  const chosen = new Set(ids);
  const target = new Set(targets);
  return weeks.map((week, index) => {
    if (!target.has(index)) return [...week];
    if (remove) return week.filter((id) => !chosen.has(id));
    const result = [...week];
    for (const id of ids) if (!result.includes(id)) result.push(id);
    return result;
  });
}
export function copyWeeks(
  weeks: string[][],
  source: number,
  targets: number[],
  confirmedSnapshot: string | null,
): string[][] | null {
  if (
    source < 0 ||
    source >= weeks.length ||
    targets.some((i) => i < 0 || i >= weeks.length || i === source)
  )
    return null;
  if (
    targets.some((i) => weeks[i].length) &&
    confirmedSnapshot !== JSON.stringify(weeks)
  )
    return null;
  return weeks.map((week, i) =>
    targets.includes(i) ? [...weeks[source]] : [...week],
  );
}
