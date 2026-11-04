import { validatePoints } from './model.js';

export function parseCSV(raw, delimiter = ',') {
  if (![',', ';', '\t'].includes(delimiter)) throw new Error('Unsupported delimiter.');
  if (raw.length > 10 * 1024 * 1024) throw new Error('CSV exceeds the 10 MB input limit.');
  const input = raw.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false;
  function pushField() { row.push(field); field = ''; closed = false; }
  function pushRow() {
    pushField();
    if (row.some(cell => cell.trim() !== '')) rows.push(row);
    row = [];
    if (rows.length > 10001) throw new Error('CSV exceeds 10,000 data rows.');
  }
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"') {
        if (input[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === delimiter) pushField();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      pushRow();
    } else if (char === '"' && field === '' && !closed) quoted = true;
    else if (closed || char === '"') throw new Error(`Malformed CSV near record ${rows.length + 1}.`);
    else field += char;
  }
  if (quoted) throw new Error('CSV ends inside a quoted field.');
  if (field !== '' || row.length || closed) pushRow();
  if (rows.length < 2) throw new Error('CSV needs a header and at least one data row.');
  const headers = rows.shift().map(header => header.trim());
  if (headers.length < 2 || headers.length > 100 || headers.some(h => !h) || new Set(headers).size !== headers.length) throw new Error('Use 2–100 nonempty, unique column headers.');
  rows.forEach((cells, i) => {
    if (cells.length !== headers.length) throw new Error(`Record ${i + 2} has ${cells.length} fields; expected ${headers.length}.`);
  });
  return { headers, rows };
}

export function csvPoints(table, xIndex, yIndex) {
  if (!Number.isInteger(xIndex) || !Number.isInteger(yIndex) || xIndex === yIndex
      || xIndex < 0 || yIndex < 0 || xIndex >= table.headers.length || yIndex >= table.headers.length) throw new Error('Choose two different X and Y columns.');
  const number = (cell, row) => {
    const value = cell.trim();
    if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) || !Number.isFinite(Number(value))) throw new Error(`Record ${row}: selected columns must contain decimal numbers (no blanks or missing values).`);
    return Number(value);
  };
  const points = table.rows.map((cells, i) => ({ x: number(cells[xIndex], i + 2), y: number(cells[yIndex], i + 2) })).sort((a, b) => a.x - b.x);
  return validatePoints(points);
}

export function csvCell(value) {
  let text = String(value);
  // Text exports are spreadsheet-safe. Numeric negatives stay numeric.
  if (typeof value !== 'number' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}
export function measurementsCSV(runs) {
  const rows = [['run', 'sample', 'group', 'status', 'x', 'y']];
  for (const run of runs) for (const point of run.points) rows.push([run.name, run.sample, run.group, run.status, point.x, point.y]);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
export function summaryCSV(series) {
  const rows = [['group', 'x', 'n', 'mean', 'sample_sd']];
  for (const group of series) for (const point of group.points) rows.push([group.name, point.x, point.n, point.mean, point.sd ?? '']);
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
