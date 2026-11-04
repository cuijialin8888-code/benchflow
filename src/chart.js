import { aggregate, formatNumber } from './stats.js';

export const PALETTE = ['#167969', '#d47a3b', '#5877b4', '#9b6caa', '#b24e65', '#72833d', '#227e9c', '#8d6b4f'];
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const label = (name, unit) => `${name}${unit ? ` (${unit})` : ''}`;

export function chartSVG(runs, experiment, mode = 'individual', standalone = false) {
  const groups = [...new Set(runs.filter(r => r.points.length).map(r => r.group))].sort();
  const colors = new Map(groups.map((group, i) => [group, PALETTE[i % PALETTE.length]]));
  const series = mode === 'mean'
    ? aggregate(runs).map(group => ({ name: group.name, color: colors.get(group.name), points: group.points.map(p => ({ ...p, y: p.mean })) }))
    : runs.filter(run => run.points.length).map(run => ({ name: run.name, color: colors.get(run.group), points: run.points }));
  if (!series.length) return '<div class="chart-empty"><span>⌁</span><h3>Your next discovery starts with data.</h3><p>Import a CSV into a run to draw your first curve.</p></div>';
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const line of series) for (const p of line.points) {
    xMin = Math.min(xMin, p.x); xMax = Math.max(xMax, p.x);
    yMin = Math.min(yMin, p.y - (p.sd || 0)); yMax = Math.max(yMax, p.y + (p.sd || 0));
  }
  if (xMin === xMax) { xMin -= 1; xMax += 1; }
  const yPad = yMax === yMin ? Math.max(1, Math.abs(yMin) * .1) : (yMax - yMin) * .1;
  yMin -= yPad; yMax += yPad;
  const width = 900, height = 350, left = 78, top = 25, right = 28, bottom = 62;
  const plotWidth = width - left - right, plotHeight = height - top - bottom;
  const x = value => left + (value - xMin) / (xMax - xMin) * plotWidth;
  const y = value => top + (yMax - value) / (yMax - yMin) * plotHeight;
  const f = value => value.toFixed(2);
  let grid = '';
  for (let i = 0; i <= 5; i++) {
    const xv = xMin + (xMax - xMin) * i / 5, yv = yMin + (yMax - yMin) * i / 5;
    grid += `<line x1="${left}" y1="${f(y(yv))}" x2="${width - right}" y2="${f(y(yv))}" class="gridline"/><text x="${left - 12}" y="${f(y(yv) + 4)}" text-anchor="end">${esc(formatNumber(yv))}</text><text x="${f(x(xv))}" y="${height - bottom + 23}" text-anchor="middle">${esc(formatNumber(xv))}</text>`;
  }
  const lines = series.map((line, index) => {
    // Bound SVG size while preserving the full data for all statistics/exports.
    const stride = Math.max(1, Math.ceil(line.points.length / 1200));
    const visible = line.points.filter((_, i) => i % stride === 0 || i === line.points.length - 1);
    const d = visible.map((p, i) => `${i ? 'L' : 'M'}${f(x(p.x))},${f(y(p.y))}`).join(' ');
    const errors = mode === 'mean' ? visible.filter(p => p.sd !== null).map(p => `<path d="M${f(x(p.x))},${f(y(p.y - p.sd))}V${f(y(p.y + p.sd))}M${f(x(p.x) - 3)},${f(y(p.y - p.sd))}h6M${f(x(p.x) - 3)},${f(y(p.y + p.sd))}h6" stroke="${line.color}" opacity=".4" fill="none"/>`).join('') : '';
    const dots = visible.length <= 60 ? visible.map(p => `<circle cx="${f(x(p.x))}" cy="${f(y(p.y))}" r="3" fill="${line.color}"><title>${esc(line.name)}: ${esc(formatNumber(p.x))}, ${esc(formatNumber(p.y))}${p.n ? `; n=${p.n}, SD=${esc(formatNumber(p.sd))}` : ''}</title></circle>`).join('') : '';
    return `<g>${errors}<path d="${d}" stroke="${line.color}" stroke-width="2.3" stroke-dasharray="${mode === 'individual' && index % 2 ? '6 3' : 'none'}" fill="none" stroke-linejoin="round"><title>${esc(line.name)}</title></path>${dots}</g>`;
  }).join('');
  const legendRows = standalone ? Math.ceil(groups.length / 3) : 0;
  const exportHeight = height + (standalone ? 54 + legendRows * 22 : 0);
  const exportLegend = standalone ? `<text x="${left}" y="${height + 18}" class="axis-label">${esc(experiment.name)} · ${mode === 'mean' ? 'Mean ± sample SD' : 'Individual runs'}</text>${groups.map((group, i) => `<circle cx="${left + i % 3 * 270}" cy="${height + 38 + Math.floor(i / 3) * 22}" r="4" fill="${colors.get(group)}"/><text x="${left + 12 + i % 3 * 270}" y="${height + 42 + Math.floor(i / 3) * 22}">${esc(group.length > 30 ? group.slice(0, 29) + '…' : group)}<title>${esc(group)}</title></text>`).join('')}` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${exportHeight}" role="img" aria-label="${esc(experiment.name)}: ${mode === 'mean' ? 'group means with sample standard deviation' : 'individual runs'}" class="data-chart"><style>text{font:11px system-ui,sans-serif;fill:#66736e}.gridline{stroke:#e6ece8;stroke-width:1}.axis-label{font:12px system-ui,sans-serif;fill:#3e514a}</style><rect width="900" height="${exportHeight}" fill="white"/>${grid}${lines}<text x="${left + plotWidth / 2}" y="${height - 12}" text-anchor="middle" class="axis-label">${esc(label(experiment.xLabel, experiment.xUnit))}</text><text transform="translate(17 ${top + plotHeight / 2}) rotate(-90)" text-anchor="middle" class="axis-label">${esc(label(experiment.yLabel, experiment.yUnit))}</text>${exportLegend}</svg>`;
}

export function legend(runs) {
  return [...new Set(runs.filter(run => run.points.length).map(run => run.group))].sort().map((group, i) => `<span class="legend-item"><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(group)}</span>`).join('');
}
