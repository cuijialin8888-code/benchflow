export function describe(values) {
  if (!values.length) return { n: 0, mean: null, sd: null, min: null, max: null };
  let mean = 0, m2 = 0, n = 0, min = Infinity, max = -Infinity;
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error('Statistics require finite values.');
    n++;
    const delta = value - mean;
    mean += delta / n;
    m2 += delta * (value - mean);
    min = Math.min(min, value); max = Math.max(max, value);
  }
  return { n, mean, sd: n > 1 ? Math.sqrt(Math.max(0, m2 / (n - 1))) : null, min, max };
}

// One observation per run at an exact X. No interpolation, pooling, or inference.
export function aggregate(runs) {
  const groups = new Map();
  for (const run of runs) {
    if (!run.points.length) continue;
    if (!groups.has(run.group)) groups.set(run.group, new Map());
    const byX = groups.get(run.group);
    for (const point of run.points) {
      if (!byX.has(point.x)) byX.set(point.x, []);
      byX.get(point.x).push(point.y);
    }
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, points]) => ({
    name,
    points: [...points].sort(([a], [b]) => a - b).map(([x, values]) => ({ x, ...describe(values) })),
  }));
}

export function runSummary(points) {
  if (!points.length) return { count: 0, min: null, max: null, last: null, area: null };
  let area = 0, min = Infinity, max = -Infinity;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    min = Math.min(min, p.y); max = Math.max(max, p.y);
    if (i) area += (p.x - points[i - 1].x) * (p.y + points[i - 1].y) / 2;
  }
  return { count: points.length, min, max, last: points.at(-1).y, area: points.length > 1 ? area : null };
}
export function formatNumber(value) {
  if (value === null || value === undefined) return '—';
  if (value !== 0 && (Math.abs(value) >= 1e6 || Math.abs(value) < .001)) return value.toExponential(3);
  return Number(value.toPrecision(5)).toLocaleString('en-US', { maximumFractionDigits: 5 });
}
