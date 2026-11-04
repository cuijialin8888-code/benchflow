import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace, validateWorkspace, validatePoints, createProject, createExperiment, createRun, createNote, removeProject, removeExperiment, parseBackup } from '../src/model.js';
import { parseCSV, csvPoints, measurementsCSV, summaryCSV, csvCell } from '../src/csv.js';
import { describe, aggregate, runSummary } from '../src/stats.js';
import { demoWorkspace } from '../src/demo.js';
import { chartSVG, legend } from '../src/chart.js';

test('demo is valid, explicitly synthetic and has independent record IDs', () => {
  const data = demoWorkspace();
  assert.equal(validateWorkspace(data), data);
  assert.match(data.projects[0].description, /SYNTHETIC/);
  assert.equal(new Set(data.runs.map(r => r.id)).size, data.runs.length);
  assert.equal(data.runs.filter(r => r.points.length).length, 6);
});
test('JSON backup roundtrip preserves all allowed data', () => {
  const data = demoWorkspace();
  assert.deepEqual(parseBackup(JSON.stringify(data)), data);
});
test('backup removes unknown metadata and prototype-like fields', () => {
  const data = demoWorkspace(); data.extra = 'discard'; data.runs[0].unknown = 'discard';
  const restored = parseBackup(JSON.stringify(data));
  assert.equal(restored.extra, undefined); assert.equal(restored.runs[0].unknown, undefined);
});
test('invalid backups reject versions, duplicates, orphans, invalid statuses and NaN', () => {
  const source = demoWorkspace();
  for (const modify of [
    d => { d.version = 2; }, d => d.projects.push(d.projects[0]),
    d => { d.runs[0].experimentId = 'missing'; }, d => { d.notes[0].projectId = 'missing'; },
    d => { d.experiments[0].projectId = 'missing'; }, d => { d.runs[0].status = 'deleted'; },
    d => { d.runs[0].points[0].y = NaN; }, d => { d.projects[0].name = ' '; },
    d => { d.runs[0].group = ' '; }, d => { d.runs[0].createdAt = 'yesterday'; },
  ]) { const data = structuredClone(source); modify(data); assert.throws(() => validateWorkspace(data)); }
});
test('empty workspace and project without runs are valid', () => {
  const data = emptyWorkspace(); validateWorkspace(data);
  data.projects.push(createProject('Test')); validateWorkspace(data);
});
test('cascade deletion preserves unrelated project records', () => {
  const data = demoWorkspace();
  const p = createProject('Other'), e = createExperiment(p.id);
  data.projects.push(p); data.experiments.push(e); data.runs.push(createRun(e.id)); data.notes.push(createNote(p.id, 'Note', 'Text'));
  removeProject(data, data.projects[0].id); validateWorkspace(data);
  assert.equal(data.projects.length, 1); assert.equal(data.runs.length, 1); assert.equal(data.notes.length, 1);
  removeExperiment(data, e.id); validateWorkspace(data);
  assert.equal(data.runs.length, 0); assert.equal(data.projects.length, 1); assert.equal(data.notes.length, 1);
});
test('point validation rejects duplicate X, descending X and out-of-range values', () => {
  for (const points of [[{ x: 1, y: 1 }, { x: 1, y: 2 }], [{ x: 2, y: 1 }, { x: 1, y: 2 }], [{ x: 0, y: 1e13 }], [{ x: '1', y: 1 }]]) assert.throws(() => validatePoints(points));
});
test('CSV supports BOM, CRLF, quoted headers and multiline unused cells', () => {
  const table = parseCSV('\uFEFF"Time","Response","Note"\r\n1,2,"a\r\nb"\r\n0,0,"say ""hi"""\r\n');
  assert.equal(table.rows[0][2], 'a\r\nb');
  assert.deepEqual(csvPoints(table, 0, 1), [{ x: 0, y: 0 }, { x: 1, y: 2 }]);
});
test('CSV supports explicit semicolon and tab delimiters', () => {
  assert.deepEqual(csvPoints(parseCSV('x;y\n0;1\n1;2', ';'), 0, 1), [{ x: 0, y: 1 }, { x: 1, y: 2 }]);
  assert.equal(parseCSV('x\ty\n0\t1', '\t').rows[0][1], '1');
});
test('CSV accepts decimal and scientific notation without silently coercing blanks', () => {
  assert.deepEqual(csvPoints(parseCSV('x,y\n-1e2,+.5\n0,1.'), 0, 1), [{ x: -100, y: .5 }, { x: 0, y: 1 }]);
  for (const value of ['', 'NaN', 'Infinity', '0xFF', '2 kg', 'null']) assert.throws(() => csvPoints(parseCSV(`x,y\n0,${value}`), 0, 1));
});
for (const [label, raw] of [
  ['unterminated quotes', 'x,y\n0,"1'], ['ragged rows', 'x,y\n0,1,2'],
  ['duplicate headers', 'x,x\n0,1'], ['blank headers', 'x,\n0,1'],
  ['quotes in unquoted values', 'x,y\n0,1"'], ['junk after closing quote', 'x,y\n0,"1"z'],
  ['header only', 'x,y\n'],
]) test(`CSV rejects ${label}`, () => assert.throws(() => parseCSV(raw)));
test('CSV mapping rejects same columns and duplicated numeric X', () => {
  const table = parseCSV('x,y\n1,2\n1.0,3');
  assert.throws(() => csvPoints(table, 0, 0));
  assert.throws(() => csvPoints(table, 0, 1));
  assert.throws(() => csvPoints(table, -1, 1));
});
test('text CSV exports guard spreadsheet formulas; numeric negatives remain numeric', () => {
  assert.equal(csvCell('=2+2'), "'=2+2"); assert.equal(csvCell(' @SUM(A1)'), "' @SUM(A1)");
  assert.equal(csvCell(-5), '-5'); assert.equal(csvCell('a,"b"'), '"a,""b"""');
  const run = createRun('e', { name: '=BAD()', points: [{ x: -1, y: 3 }] });
  assert.match(measurementsCSV([run]), /'=BAD\(\)/);
});
test('sample SD uses n-1; one observation has undefined SD', () => {
  assert.deepEqual(describe([1, 2, 3]), { n: 3, mean: 2, sd: 1, min: 1, max: 3 });
  assert.equal(describe([7]).sd, null); assert.equal(describe([]).mean, null);
  assert.throws(() => describe([Infinity]));
});
test('exact-X aggregation does not interpolate missing values or pool groups', () => {
  const runs = [
    createRun('e', { group: 'A', points: [{ x: 0, y: 2 }, { x: 1, y: 4 }] }),
    createRun('e', { group: 'A', points: [{ x: 0, y: 4 }, { x: 2, y: 8 }] }),
    createRun('e', { group: 'B', points: [{ x: 0, y: 100 }] }),
  ];
  const result = aggregate(runs);
  assert.equal(result[0].points[0].mean, 3); assert.equal(result[0].points[0].n, 2);
  assert.equal(result[0].points[1].n, 1); assert.equal(result[0].points[1].sd, null);
  assert.equal(result[1].points[0].mean, 100);
  assert.match(summaryCSV(result), /A,0,2,3,/);
});
test('trapezoidal area uses irregular X intervals and reports single-point area as undefined', () => {
  assert.equal(runSummary([{ x: 0, y: 0 }, { x: 2, y: 4 }, { x: 5, y: 4 }]).area, 16);
  assert.equal(runSummary([{ x: 0, y: 9 }]).area, null);
  assert.equal(runSummary([]).min, null);
});
test('SVG escapes labels, displays constant series and includes SD whiskers', () => {
  const exp = createExperiment('p', { name: '<script>x</script>' });
  const runs = [createRun(exp.id, { name: '<img>', group: 'A&Z', points: [{ x: 0, y: 4 }] }), createRun(exp.id, { group: 'A&Z', points: [{ x: 0, y: 4 }] })];
  const svg = chartSVG(runs, exp, 'mean');
  assert.ok(!svg.includes('<script>')); assert.ok(!svg.includes('NaN')); assert.ok(!svg.includes('Infinity'));
  assert.match(svg, /&lt;script&gt;/); assert.match(legend(runs), /A&amp;Z/);
  const exported = chartSVG(runs, exp, 'mean', true);
  assert.match(exported, /Mean ± sample SD/); assert.match(exported, /A&amp;Z/);
});
test('large series plotting does not mutate or discard stored data', () => {
  const run = createRun('e', { points: Array.from({ length: 5000 }, (_, x) => ({ x, y: Math.sin(x) })) });
  const svg = chartSVG([run], createExperiment('p'));
  assert.equal(run.points.length, 5000); assert.ok(svg.length < 60000);
});
