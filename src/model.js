export const VERSION = 1;
export const STATUSES = ['planned', 'running', 'complete'];
export const LIMITS = { projects: 100, experiments: 500, runs: 2000, notes: 1000, pointsPerRun: 10000, totalPoints: 200000 };
export const uid = () => crypto.randomUUID();
export const timestamp = () => new Date().toISOString();
export const emptyWorkspace = () => ({ version: VERSION, projects: [], experiments: [], runs: [], notes: [] });

function fail(message) { throw new Error(message); }
function text(value, name, max = 200, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(`Invalid ${name} (maximum ${max} characters).`);
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value))) fail('Invalid timestamp.');
}
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value)) fail('Invalid record ID.'); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e12; }

export function validatePoints(points) {
  if (!Array.isArray(points) || points.length > LIMITS.pointsPerRun) fail(`A run supports at most ${LIMITS.pointsPerRun} points.`);
  let last = -Infinity;
  for (const point of points) {
    if (!point || !finite(point.x) || !finite(point.y)) fail('Points must be finite numbers between -1e12 and 1e12.');
    if (point.x <= last) fail('X values must be unique and sorted in increasing order.');
    last = point.x;
  }
  return points;
}

export function validateWorkspace(data) {
  if (!data || data.version !== VERSION) fail('Unsupported backup version. Expected version 1.');
  const indexes = {};
  for (const kind of ['projects', 'experiments', 'runs', 'notes']) {
    if (!Array.isArray(data[kind]) || data[kind].length > LIMITS[kind]) fail(`Invalid or oversized ${kind} list.`);
    indexes[kind] = new Set();
    for (const record of data[kind]) {
      if (!record || typeof record !== 'object') fail(`Invalid ${kind} record.`);
      id(record.id);
      if (indexes[kind].has(record.id)) fail(`Duplicate ${kind} ID.`);
      indexes[kind].add(record.id);
      date(record.createdAt);
      date(record.updatedAt);
    }
  }
  for (const project of data.projects) {
    text(project.name, 'project name', 100, false);
    text(project.description, 'project description', 2000);
  }
  for (const exp of data.experiments) {
    if (!indexes.projects.has(exp.projectId)) fail('An experiment references a missing project.');
    text(exp.name, 'experiment name', 100, false);
    for (const key of ['xLabel', 'yLabel']) text(exp[key], key, 80, false);
    for (const key of ['xUnit', 'yUnit']) text(exp[key], key, 30);
    text(exp.description, 'experiment description', 2000);
  }
  let total = 0;
  for (const run of data.runs) {
    if (!indexes.experiments.has(run.experimentId)) fail('A run references a missing experiment.');
    text(run.name, 'run name', 100, false);
    text(run.sample, 'sample', 100);
    text(run.group, 'group', 80, false);
    text(run.notes, 'run notes', 10000);
    if (!STATUSES.includes(run.status)) fail('Invalid run status.');
    validatePoints(run.points);
    total += run.points.length;
  }
  if (total > LIMITS.totalPoints) fail(`Workspace exceeds ${LIMITS.totalPoints} data points.`);
  for (const note of data.notes) {
    if (!indexes.projects.has(note.projectId)) fail('A note references a missing project.');
    text(note.title, 'note title', 150, false);
    text(note.body, 'note body', 20000);
  }
  return data;
}

export function createProject(name, description = '') {
  const now = timestamp();
  return { id: uid(), name: name.trim(), description, createdAt: now, updatedAt: now };
}
export function createExperiment(projectId, fields = {}) {
  const now = timestamp();
  return { id: uid(), projectId, name: 'Untitled experiment', description: '', xLabel: 'Time', xUnit: 's', yLabel: 'Response', yUnit: '', ...fields, createdAt: now, updatedAt: now };
}
export function createRun(experimentId, fields = {}) {
  const now = timestamp();
  return { id: uid(), experimentId, name: 'Untitled run', sample: '', group: 'Control', status: 'planned', notes: '', points: [], ...fields, createdAt: now, updatedAt: now };
}
export function createNote(projectId, title, body) {
  const now = timestamp();
  return { id: uid(), projectId, title: title.trim(), body, createdAt: now, updatedAt: now };
}

export function removeExperiment(data, id) {
  data.experiments = data.experiments.filter(exp => exp.id !== id);
  data.runs = data.runs.filter(run => run.experimentId !== id);
}
export function removeProject(data, id) {
  for (const exp of data.experiments.filter(exp => exp.projectId === id)) removeExperiment(data, exp.id);
  data.projects = data.projects.filter(project => project.id !== id);
  data.notes = data.notes.filter(note => note.projectId !== id);
}

export function parseBackup(raw) {
  if (raw.length > 30 * 1024 * 1024) fail('Backup exceeds the 30 MB input limit.');
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  validateWorkspace(parsed);
  // Rebuild allowed fields: unknown metadata and object prototypes never enter storage.
  const pick = (item, keys) => Object.fromEntries(keys.map(key => [key, item[key]]));
  const shared = ['id', 'createdAt', 'updatedAt'];
  return {
    version: VERSION,
    projects: parsed.projects.map(p => pick(p, [...shared, 'name', 'description'])),
    experiments: parsed.experiments.map(e => pick(e, [...shared, 'projectId', 'name', 'description', 'xLabel', 'xUnit', 'yLabel', 'yUnit'])),
    runs: parsed.runs.map(r => ({ ...pick(r, [...shared, 'experimentId', 'name', 'sample', 'group', 'status', 'notes']), points: r.points.map(p => ({ x: p.x, y: p.y })) })),
    notes: parsed.notes.map(n => pick(n, [...shared, 'projectId', 'title', 'body'])),
  };
}
