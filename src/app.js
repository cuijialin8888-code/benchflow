import { emptyWorkspace, validateWorkspace, parseBackup, createProject, createExperiment, createRun, createNote, removeProject, removeExperiment, timestamp, STATUSES } from './model.js';
import { loadWorkspace, saveWorkspace, previousWorkspace } from './storage.js';
import { parseCSV, csvPoints, measurementsCSV, summaryCSV } from './csv.js';
import { aggregate, runSummary, formatNumber as num } from './stats.js';
import { chartSVG, legend } from './chart.js';
import { demoWorkspace } from './demo.js';

const $ = selector => document.querySelector(selector);
const h = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m6-16v16M5 8h2m4 0h2m4 0h2M5 12h2m4 0h2"/>',
  chart: '<path d="M4 3v17h17M7 15l4-5 4 2 6-7"/>',
  note: '<rect x="5" y="3" width="15" height="18" rx="2"/><path d="M3 7h4M3 12h4M3 17h4m3-10h7m-7 5h7m-7 5h4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor"/><circle cx="15" cy="17" r="3" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  flask: '<path d="M8 3h8m-6 0v7L4 20h16l-6-10V3M7 15h10"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', check: '<path d="m5 12 4 4L19 6"/>',
  upload: '<path d="M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6"/>',
  download: '<path d="M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7l-4-4L5 15z"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  folder: '<path d="M3 6V4h6l3 3h9v13H3z"/>', shield: '<path d="m12 3 8 3v6q0 6-8 10-8-4-8-10V6zM8 12l3 3 5-6"/>',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.flask}</svg>`;
const button = (action, label, type = '', extra = '', glyph = '') => `<button class="button ${type}" data-action="${action}" ${extra}>${glyph ? icon(glyph) : ''}${h(label)}</button>`;
const smallIcon = (action, label, id, glyph) => `<button class="icon-button" data-action="${action}" data-id="${h(id)}" title="${h(label)}" aria-label="${h(label)}">${icon(glyph)}</button>`;
const dateText = value => new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const state = { data: emptyWorkspace(), revision: 0, project: null, experiment: null, view: 'overview', query: '', board: true, status: 'all', mode: 'individual', selected: null, completedOnly: true, conflict: false, saving: false };
const nav = [['overview', 'Overview', 'grid'], ['runs', 'Runs', 'board'], ['analysis', 'Analysis', 'chart'], ['notebook', 'Notebook', 'note'], ['settings', 'Workspace', 'settings']];
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('benchflow-changes') : null;
let toastTimer;
function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').className = `visible${error ? ' error' : ''}`;
  toastTimer = setTimeout(() => { $('#toast').className = ''; }, error ? 12000 : 4500);
}
function currentProject() { return state.data.projects.find(p => p.id === state.project); }
function experiments() { return state.data.experiments.filter(e => e.projectId === state.project); }
function currentExperiment() { return experiments().find(e => e.id === state.experiment); }
function runs() { return state.data.runs.filter(r => r.experimentId === state.experiment); }
function projectRuns() { const ids = new Set(experiments().map(e => e.id)); return state.data.runs.filter(r => ids.has(r.experimentId)); }
function repairSelection() {
  if (!currentProject()) state.project = state.data.projects[0]?.id || null;
  if (!currentExperiment()) { state.experiment = experiments()[0]?.id || null; state.selected = null; }
}
async function commit(mutator, message = 'Saved to this browser.') {
  if (state.saving) throw new Error('A save is already in progress. Please wait.');
  const next = structuredClone(state.data);
  mutator(next);
  validateWorkspace(next);
  state.saving = true;
  try {
    const revision = await saveWorkspace(next, state.revision);
    state.data = next; state.revision = revision;
    channel?.postMessage(revision);
    repairSelection(); render(); toast(message);
  } finally { state.saving = false; }
}
async function replaceWorkspace(data, message) {
  await commit(next => Object.assign(next, data), message);
}
function download(name, data, type) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
function backup() {
  download(`benchflow-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(state.data, null, 2), 'application/json');
  toast('Backup download started. Keep a copy outside this browser.');
}
function heading(title, subtitle, actions = '') {
  return `<div class="page-title"><div><div class="eyebrow">Your experimental workspace</div><h1>${h(title)}</h1><p class="subtitle">${h(subtitle)}</p></div><div class="actions">${actions}</div></div>`;
}
function empty(title, description, action = '') {
  return `<div class="empty-state">${icon('flask')}<h2>${h(title)}</h2><p>${h(description)}</p><div class="actions">${action}</div></div>`;
}
function tabs() {
  return `<div class="experiment-tabs" aria-label="Experiments">${experiments().map(e => `<button class="experiment-tab ${e.id === state.experiment ? 'active' : ''}" data-action="select-experiment" data-id="${e.id}" aria-pressed="${e.id === state.experiment}">${h(e.name)}</button>`).join('')}${button('new-experiment', 'New experiment', 'small ghost', '', 'plus')}</div>`;
}
function welcome() {
  return `<div class="welcome"><div class="hero"><div><span class="pill">LOCAL FIRST · OPEN SOURCE</span><h2>Less scattered data.<br>More connected discoveries.</h2><p>Your experiments, curves and observations in one calm workspace. Stored in your browser. No account, no cloud, no setup.</p></div></div>${empty('Make room for your next idea.', 'Start with an empty project, or explore a fully populated workspace with clearly labelled synthetic data.', button('new-project', 'Create a project', 'primary', '', 'plus') + button('load-demo', 'Explore demo', '', '', 'arrow'))}<p class="notice info">Your browser is your workspace. Export JSON backups regularly; clearing site data removes local records. Nothing here is uploaded to a server.</p></div>`;
}
function metric(title, value, foot, glyph) {
  return `<div class="metric"><div class="metric-top">${h(title)}${icon(glyph)}</div><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></div>`;
}
function overview() {
  const all = projectRuns(), completed = all.filter(r => r.status === 'complete');
  const exp = currentExperiment();
  const recent = [...all].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  const curves = runs().filter(r => r.status === 'complete' && r.points.length);
  return heading('Workspace overview', 'A little structure. A clearer picture of your research.', button('new-experiment', 'New experiment', 'primary', '', 'plus'))
    + `<div class="hero"><div><span class="pill">${currentProject().description.includes('SYNTHETIC') ? 'SYNTHETIC DEMO DATA' : 'ACTIVE PROJECT'}</span><h2>${h(currentProject().name)}</h2><p>${h(currentProject().description || 'Keep every run connected to the question it helps answer.')}</p></div><svg class="hero-art" viewBox="0 0 120 95" aria-hidden="true"><path d="M8 80H114M20 15v65" fill="none" stroke="#b2c3a2"/><path d="M22 72C44 68 50 28 70 24S96 20 112 9M22 73C45 73 57 50 76 45S98 44 112 32M22 75C48 77 55 65 76 62S98 61 112 54" fill="none" stroke="#71905c" stroke-width="2"/><circle cx="70" cy="24" r="3" fill="#d2a26c"/><circle cx="76" cy="45" r="3" fill="#d2a26c"/></svg></div>`
    + `<div class="metrics">${metric('Experiments', experiments().length, 'In this project', 'flask')}${metric('Total runs', all.length, `<strong>${completed.length} completed</strong> across experiments`, 'board')}${metric('Data points', all.reduce((n, r) => n + r.points.length, 0).toLocaleString(), 'Raw observations, preserved', 'chart')}${metric('Notebook entries', state.data.notes.filter(n => n.projectId === state.project).length, 'Context alongside your data', 'note')}</div>`
    + `<div class="content-grid"><section class="card"><div class="card-head"><div><h2>Curve preview</h2><p>${h(exp?.name || 'No experiment selected')} · completed runs</p></div>${button('go-analysis', 'Explore', 'small ghost', '', 'arrow')}</div><div class="chart-wrap">${exp ? chartSVG(curves, exp) : '<div class="chart-empty">Create an experiment to get started.</div>'}</div><div class="legend">${legend(curves)}</div></section><section class="card"><div class="card-head"><div><h2>Recent records</h2><p>Your latest recorded changes</p></div>${icon('clock')}</div><div class="card-body activity">${recent.length ? recent.map(r => `<div class="activity-item"><div class="activity-symbol">${icon(r.status === 'complete' ? 'check' : 'flask')}</div><div><strong>${h(r.name)}</strong><p>${h(r.sample || r.group)} · ${h(r.status)}<br>${dateText(r.updatedAt)} · ${r.points.length} points</p></div></div>`).join('') : '<p class="help">New runs will appear here.</p>'}</div></section></div>`
    + `<div class="section-title"><h2>Your experiments</h2>${button('edit-project', 'Edit project', 'small ghost', `data-id="${state.project}"`, 'edit')}</div><div class="experiment-grid">${experiments().map(e => { const er = state.data.runs.filter(r => r.experimentId === e.id); return `<article class="experiment-card"><div class="actions">${icon('flask')}<span class="tag">${er.filter(r => r.status === 'complete').length} / ${er.length} complete</span></div><h3>${h(e.name)}</h3><p>${h(e.description || `${e.yLabel} against ${e.xLabel}`)}</p><div class="experiment-footer"><span>${dateText(e.createdAt)}</span>${button('open-experiment', 'Open experiment', 'small ghost', `data-id="${e.id}"`, 'arrow')}</div></article>`; }).join('')}</div>`;
}
function visibleRuns() {
  const q = state.query.toLowerCase();
  return runs().filter(r => (state.status === 'all' || r.status === state.status) && [r.name, r.sample, r.group, r.notes].some(s => s.toLowerCase().includes(q)));
}
function runActions(run) {
  return `<div class="run-actions">${smallIcon('import-run', `Import data: ${run.name}`, run.id, 'upload')}${smallIcon('edit-run', `Edit run: ${run.name}`, run.id, 'edit')}${smallIcon('duplicate-run', `Duplicate setup: ${run.name}`, run.id, 'copy')}</div>`;
}
function runCard(run) {
  return `<article class="run-card"><span class="tag">${h(run.group)}</span><h3>${h(run.name)}</h3><p>${h(run.sample || 'No sample ID')} · ${run.points.length} points</p><div class="run-meta"><select data-status-id="${run.id}" aria-label="Status: ${h(run.name)}">${STATUSES.map(s => `<option value="${s}" ${run.status === s ? 'selected' : ''}>${s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>${runActions(run)}</div></article>`;
}
function runsPage() {
  if (!currentExperiment()) return heading('Runs', 'Every observation starts with a run.') + empty('Create your first experiment.', 'Define the X and Y axes once, then organize samples and import data for each run.', button('new-experiment', 'Create experiment', 'primary', '', 'plus'));
  const list = visibleRuns(), exp = currentExperiment();
  const toolbar = `<div class="toolbar"><div class="actions"><div class="segmented" aria-label="Run layout"><button data-action="board-view" class="${state.board ? 'active' : ''}" aria-pressed="${state.board}">Board</button><button data-action="table-view" class="${!state.board ? 'active' : ''}" aria-pressed="${!state.board}">Table</button></div><select id="status-filter" aria-label="Filter runs by status"><option value="all">All statuses</option>${STATUSES.map(s => `<option ${state.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select><span class="help">${list.length} runs${state.query ? ` matching “${h(state.query)}”` : ''}</span></div><div class="actions">${button('edit-experiment', 'Experiment settings', 'small ghost', `data-id="${exp.id}"`, 'settings')}${button('export-data', 'Export CSV', 'small', '', 'download')}</div></div>`;
  return heading('Experiment runs', 'Plan, record and compare. Keep each independent run distinct.', button('import-new', 'Import CSV', '', '', 'upload') + button('new-run', 'New run', 'primary', '', 'plus')) + tabs() + toolbar
    + (state.board ? `<div class="board">${STATUSES.map(s => `<section class="column"><div class="column-head ${s}"><i class="dot"></i>${s[0].toUpperCase() + s.slice(1)}<span>${list.filter(r => r.status === s).length}</span></div><div class="column-body">${list.filter(r => r.status === s).map(runCard).join('') || '<div class="empty-column">No runs here yet.</div>'}</div></section>`).join('')}</div>` : `<div class="card table-scroll"><table><thead><tr><th>Run</th><th>Sample</th><th>Group</th><th>Status</th><th>Points</th><th>Actions</th></tr></thead><tbody>${list.map(r => `<tr><td>${h(r.name)}</td><td>${h(r.sample || '—')}</td><td>${h(r.group)}</td><td><span class="badge ${r.status}">${r.status}</span></td><td>${r.points.length}</td><td>${runActions(r)}</td></tr>`).join('') || '<tr><td colspan="6">No runs match your filter.</td></tr>'}</tbody></table></div>`);
}
function eligibleRuns() { return runs().filter(r => r.points.length && (!state.completedOnly || r.status === 'complete')); }
function selectedRuns() { return eligibleRuns().filter(r => !state.selected || state.selected.has(r.id)); }
function analysisPage() {
  const exp = currentExperiment();
  if (!exp) return heading('Analysis', 'See what your observations have in common.') + empty('Add an experiment first.', 'Import numeric X/Y data to compare runs and group summaries.', button('new-experiment', 'Create experiment', 'primary', '', 'plus'));
  const selected = selectedRuns(), summary = aggregate(selected);
  const summaryRows = summary.flatMap(group => group.points.map(p => `<tr><td>${h(group.name)}</td><td>${num(p.x)}</td><td>${p.n}</td><td>${num(p.mean)}</td><td>${num(p.sd)}</td></tr>`));
  return heading('Data, in perspective.', 'Compare individual runs or explore group means with sample standard deviation.', button('export-chart', 'Export SVG', '', '', 'download') + button('export-summary', 'Export summary', 'primary', '', 'download')) + tabs()
    + `<div class="toolbar"><div class="segmented" aria-label="Chart mode"><button data-action="individual-mode" class="${state.mode === 'individual' ? 'active' : ''}" aria-pressed="${state.mode === 'individual'}">Individual runs</button><button data-action="mean-mode" class="${state.mode === 'mean' ? 'active' : ''}" aria-pressed="${state.mode === 'mean'}">Mean ± SD</button></div><label class="check-chip"><input id="completed-only" type="checkbox" ${state.completedOnly ? 'checked' : ''}>Completed runs only</label></div>`
    + `<section class="card"><div class="card-head"><div><h2>${h(exp.name)}</h2><p>${selected.length} selected runs · ${h(exp.yLabel)} / ${h(exp.xLabel)}</p></div>${button('select-all-runs', 'Select all', 'small ghost')}</div><div class="run-selector">${eligibleRuns().map(r => `<label class="check-chip"><input type="checkbox" data-select-run="${r.id}" ${!state.selected || state.selected.has(r.id) ? 'checked' : ''}>${h(r.name)}</label>`).join('') || '<span class="help">No eligible data. Import a CSV or include unfinished runs.</span>'}</div><div class="chart-wrap">${chartSVG(selected, exp, state.mode)}</div><div class="legend">${legend(selected)}</div></section>`
    + `<p class="notice info">Means combine only identical numeric X values within each group. <strong>n</strong> counts runs contributing at that X; SD uses n − 1 and is undefined for n = 1. No interpolation or significance test is performed. Confirm that your selected runs are independent and use matching units. Plots over 1,200 points per curve are sampled for display only; statistics and exports retain all data.</p>`
    + `<section class="card"><div class="card-head"><div><h2>${state.mode === 'mean' ? 'Group summary' : 'Run summary'}</h2><p>${state.mode === 'mean' ? 'Exact-X aggregation · sample SD' : 'Area uses the trapezoidal rule in X-unit × Y-unit'}</p></div></div><div class="table-scroll"><table>${state.mode === 'mean' ? `<thead><tr><th>Group</th><th>X</th><th>n</th><th>Mean</th><th>Sample SD</th></tr></thead><tbody>${summaryRows.slice(0, 200).join('') || '<tr><td colspan="5">No selected data.</td></tr>'}</tbody>` : `<thead><tr><th>Run</th><th>Points</th><th>Minimum Y</th><th>Maximum Y</th><th>Last Y</th><th>Area</th></tr></thead><tbody>${selected.map(r => { const s = runSummary(r.points); return `<tr><td>${h(r.name)}</td><td>${s.count}</td><td>${num(s.min)}</td><td>${num(s.max)}</td><td>${num(s.last)}</td><td>${num(s.area)}</td></tr>`; }).join('') || '<tr><td colspan="6">No selected data.</td></tr>'}</tbody>`}</table></div>${state.mode === 'mean' && summaryRows.length > 200 ? '<p class="help card-body">Showing the first 200 rows. Export summary for all rows.</p>' : ''}</section>`;
}
function notebookPage() {
  const q = state.query.toLowerCase();
  const notes = state.data.notes.filter(n => n.projectId === state.project && `${n.title}\n${n.body}`.toLowerCase().includes(q)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return heading('The context behind the curves.', 'Observations, decisions and small details worth keeping.', button('new-note', 'New note', 'primary', '', 'plus'))
    + (notes.length ? `<div class="notes-grid">${notes.map(n => `<article class="note"><div class="note-header"><span>${dateText(n.updatedAt)} · PROJECT NOTE</span><div class="actions">${smallIcon('edit-note', `Edit note: ${n.title}`, n.id, 'edit')}${smallIcon('delete-note', `Delete note: ${n.title}`, n.id, 'trash')}</div></div><h2>${h(n.title)}</h2><div class="note-body">${h(n.body)}</div></article>`).join('')}</div>` : empty('Leave a note for your future self.', 'Record what happened and why. Notes are plain text and stay with their project.', button('new-note', 'Write a note', 'primary', '', 'note')));
}
function settingsPage() {
  return heading('Your workspace. Your data.', 'Manage projects, portable backups and local storage.', button('new-project', 'New project', 'primary', '', 'plus'))
    + `<div class="settings-grid"><section class="card settings-card">${icon('shield')}<h2>Local by design</h2><p>Records live in this browser’s IndexedDB. No login, analytics, or data upload. The same app on a different address or browser has a separate workspace.</p><div class="storage-details">Storage origin: ${h(location.origin)}<br>Saved revision: ${state.revision}<br>${state.data.projects.length} projects · ${state.data.experiments.length} experiments · ${state.data.runs.length} runs</div></section><section class="card settings-card">${icon('download')}<h2>A backup you can take anywhere</h2><p>Export all projects, notes and full-resolution data as one JSON file. Importing replaces this browser’s workspace after validation and confirmation.</p><div class="actions">${button('backup', 'Export backup', 'primary', '', 'download')}${button('restore', 'Restore backup', '', '', 'upload')}</div></section><section class="card settings-card">${icon('clock')}<h2>Undo your last save</h2><p>Recover the previous saved workspace, including the last deletion or import. Only one previous version is retained. This is not a substitute for backups.</p>${button('undo', 'Restore previous save', '', '', 'clock')}</section><section class="card settings-card">${icon('flask')}<h2>Explore without real data</h2><p>Load a synthetic materials study to try the run board, curve comparison and notebook. Loading replaces the current workspace only after you confirm.</p>${button('load-demo', 'Load synthetic demo', '', '', 'arrow')}</section></div>`
    + `<div class="section-title"><h2>Projects</h2><span class="help">Deleting a project also removes its experiments, runs and notes.</span></div><div class="card table-scroll"><table><thead><tr><th>Project</th><th>Experiments</th><th>Created</th><th>Manage</th></tr></thead><tbody>${state.data.projects.map(p => `<tr><td>${h(p.name)}</td><td>${state.data.experiments.filter(e => e.projectId === p.id).length}</td><td>${dateText(p.createdAt)}</td><td><div class="actions">${smallIcon('edit-project', `Edit project: ${p.name}`, p.id, 'edit')}${smallIcon('delete-project', `Delete project: ${p.name}`, p.id, 'trash')}</div></td></tr>`).join('') || '<tr><td colspan="4">No projects yet.</td></tr>'}</tbody></table></div><p class="notice">Browser data can be cleared or evicted. Export a backup before clearing site data, changing browser, moving between the hosted and local versions, or making major changes. BenchFlow has no automatic cloud recovery.</p>`;
}
function render() {
  repairSelection();
  const project = currentProject();
  const activeNav = nav.find(n => n[0] === state.view);
  const page = !project && state.view !== 'settings' ? welcome() : ({ overview, runs: runsPage, analysis: analysisPage, notebook: notebookPage, settings: settingsPage }[state.view])();
  $('#app').innerHTML = `<div class="app-shell"><aside class="sidebar"><div class="brand"><img src="./assets/icon.svg" alt=""><div>BenchFlow<span>RESEARCH, CONNECTED</span></div></div><nav class="nav" aria-label="Main navigation">${nav.map(([key, title, glyph]) => `<button data-view="${key}" class="${state.view === key ? 'active' : ''}" ${state.view === key ? 'aria-current="page"' : ''}>${icon(glyph)}${title}</button>`).join('')}</nav><div class="side-label">CURRENT PROJECT</div><select id="project-picker" class="project-picker" aria-label="Current project">${state.data.projects.map(p => `<option value="${p.id}" ${p.id === state.project ? 'selected' : ''}>${h(p.name)}</option>`).join('') || '<option>No project yet</option>'}</select><div class="sidebar-bottom"><div class="local-mark"><i class="dot"></i>Saved on this device</div><p>A little structure for<br>your next discovery.<br>v0.1.0 · Open source</p></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">Workspace <span>/</span><strong>${h(activeNav[1])}</strong></div><div class="top-right"><label class="search">${icon('search')}<input id="search" type="search" value="${h(state.query)}" placeholder="Search runs & notes" aria-label="Search runs and notes"><span class="keycap">/</span></label><div class="avatar" aria-label="Local workspace">BF</div></div></header>${state.conflict ? '<div class="conflict-banner">Another tab changed this workspace. Reload before editing.<button class="button small" data-action="reload">Reload</button></div>' : ''}<main id="main" tabindex="-1">${page}<footer class="footer"><span>BenchFlow · A thoughtful space for experimental work.</span><span>Local first. Always yours.</span></footer></main></div></div>`;
}

function showDialog(title, body, onSubmit, submitLabel = 'Save', left = '') {
  const modal = $('#modal');
  modal.innerHTML = `<form><header class="modal-head"><h2 id="dialog-title">${h(title)}</h2><button type="button" class="icon-button" data-action="close-modal" aria-label="Close dialog">${icon('close')}</button></header><div class="modal-body">${body}<p class="form-error" role="alert"></p></div><footer class="modal-foot"><div>${left}</div><div class="actions"><button type="button" class="button" data-action="close-modal">Cancel</button><button type="submit" class="button primary">${h(submitLabel)}</button></div></footer></form>`;
  modal.querySelector('form').onsubmit = async event => {
    event.preventDefault();
    const submit = modal.querySelector('[type=submit]');
    if (submit.disabled) return;
    submit.disabled = true;
    modal.querySelector('.form-error').textContent = '';
    try { await onSubmit(new FormData(event.target)); modal.close(); }
    catch (error) { modal.querySelector('.form-error').textContent = error.message; }
    finally { submit.disabled = false; }
  };
  if (!modal.open) modal.showModal();
  requestAnimationFrame(() => modal.querySelector('input:not([type=file]),textarea,select')?.focus());
}
const field = (name, label, value = '', max = 100, required = true, type = 'input') => `<label class="field">${h(label)}${type === 'textarea' ? `<textarea name="${name}" rows="4" maxlength="${max}" ${required ? 'required' : ''}>${h(value)}</textarea>` : `<input name="${name}" value="${h(value)}" maxlength="${max}" ${required ? 'required' : ''}>`}</label>`;
function projectDialog(id) {
  const p = state.data.projects.find(p => p.id === id);
  showDialog(p ? 'Edit project' : 'Create project', field('name', 'Project name', p?.name) + field('description', 'Description', p?.description, 2000, false, 'textarea'), async form => {
    const name = form.get('name').trim(), description = form.get('description');
    const created = p ? null : createProject(name, description);
    await commit(data => { if (p) Object.assign(data.projects.find(x => x.id === id), { name, description, updatedAt: timestamp() }); else data.projects.push(created); }, p ? 'Project updated.' : 'Project created.');
    if (created) { state.project = created.id; state.experiment = null; state.view = 'overview'; render(); }
  });
}
function experimentDialog(id) {
  if (!state.project) return projectDialog();
  const e = state.data.experiments.find(e => e.id === id);
  showDialog(e ? 'Experiment settings' : 'Create experiment', field('name', 'Experiment name', e?.name) + field('description', 'Description', e?.description, 2000, false, 'textarea') + `<div class="form-grid">${field('xLabel', 'X axis label', e?.xLabel ?? 'Time', 80)}${field('xUnit', 'X unit', e?.xUnit ?? 's', 30, false)}${field('yLabel', 'Y axis label', e?.yLabel ?? 'Response', 80)}${field('yUnit', 'Y unit', e?.yUnit, 30, false)}</div><p class="help spaced">Changing labels does not convert existing numeric values. Keep units consistent across runs.</p>`, async form => {
    const values = Object.fromEntries([...form].map(([k, v]) => [k, v.trim()]));
    const created = e ? null : createExperiment(state.project, values);
    await commit(data => { if (e) Object.assign(data.experiments.find(x => x.id === id), values, { updatedAt: timestamp() }); else data.experiments.push(created); });
    if (created) { state.experiment = created.id; state.view = 'runs'; render(); }
  }, 'Save experiment', e ? button('delete-experiment', 'Delete', 'danger small', `type="button" data-id="${e.id}"`, 'trash') : '');
}
function runDialog(id) {
  const exp = currentExperiment(); if (!exp) return experimentDialog();
  const run = runs().find(r => r.id === id);
  showDialog(run ? 'Edit run' : 'Create run', field('name', 'Run name', run?.name) + `<div class="form-grid">${field('sample', 'Sample ID', run?.sample, 100, false)}${field('group', 'Group / formulation', run?.group ?? 'Control', 80)}</div><label class="field spaced">Status<select name="status">${STATUSES.map(s => `<option ${run?.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>` + field('notes', 'Run notes', run?.notes, 10000, false, 'textarea') + (run ? `<p class="help">${run.points.length} stored points. Use Import data on the run card to add or replace its curve.</p>` : ''), async form => {
    const values = Object.fromEntries(form); values.name = values.name.trim(); values.group = values.group.trim();
    await commit(data => { if (run) Object.assign(data.runs.find(r => r.id === id), values, { updatedAt: timestamp() }); else data.runs.push(createRun(exp.id, values)); });
  }, 'Save run', run ? button('delete-run', 'Delete', 'danger small', `type="button" data-id="${run.id}"`, 'trash') : '');
}
function noteDialog(id) {
  const note = state.data.notes.find(n => n.id === id);
  showDialog(note ? 'Edit note' : 'Write a note', field('title', 'Note title', note?.title, 150) + field('body', 'Observations and context', note?.body, 20000, false, 'textarea'), async form => {
    await commit(data => { if (note) Object.assign(data.notes.find(n => n.id === id), { title: form.get('title').trim(), body: form.get('body'), updatedAt: timestamp() }); else data.notes.push(createNote(state.project, form.get('title'), form.get('body'))); });
  }, 'Save note');
}
function confirmDialog(title, description, fn, label = 'Confirm') {
  showDialog(title, `<p>${h(description)}</p>`, fn, label);
}
function importDialog(runId) {
  const exp = currentExperiment(); if (!exp) return experimentDialog();
  const target = runs().find(r => r.id === runId);
  let table = null, raw = '';
  showDialog(target ? `Import data: ${target.name}` : 'Import a new run', `<p>Select a CSV with a header row and numeric X/Y columns. Preview and map the columns before saving. Limits: 10 MB and 10,000 rows.</p><div class="drop-zone"><label class="field">CSV file<input id="csv-file" type="file" accept=".csv,.tsv,.txt,text/csv" required></label><label class="field">Delimiter<select id="delimiter"><option value=",">Comma (,)</option><option value=";">Semicolon (;)</option><option value="tab">Tab</option></select></label></div><div id="csv-preview" class="preview"></div><div class="form-grid spaced"><label class="field">X column<select id="x-column" required disabled></select></label><label class="field">Y column<select id="y-column" required disabled></select></label></div>${target ? `<p class="notice">This replaces ${target.points.length} existing points in this run. Its status will be set to complete. Other metadata stays unchanged.</p>` : field('name', 'Run name') + field('group', 'Group / formulation', 'Control', 80) + field('sample', 'Sample ID', '', 100, false)}<p id="point-preview" class="help spaced"></p>`, async form => {
    if (!table) throw new Error('Select and preview a valid CSV first.');
    const points = csvPoints(table, Number($('#x-column').value), Number($('#y-column').value));
    await commit(data => {
      if (target) Object.assign(data.runs.find(r => r.id === target.id), { points, status: 'complete', updatedAt: timestamp() });
      else data.runs.push(createRun(exp.id, { name: form.get('name').trim(), group: form.get('group').trim(), sample: form.get('sample').trim(), status: 'complete', points }));
    }, `Imported ${points.length} points. Original numeric values preserved.`);
  }, target ? 'Replace data' : 'Import run');
  function pointPreview() {
    if (!table) return;
    try {
      const points = csvPoints(table, Number($('#x-column').value), Number($('#y-column').value));
      $('#point-preview').textContent = `${points.length} points · X range ${num(points[0].x)}–${num(points.at(-1).x)} · Rows will be sorted by X. Duplicate X values are rejected.`;
      $('#modal .form-error').textContent = '';
    } catch (error) { $('#point-preview').textContent = ''; $('#modal .form-error').textContent = error.message; }
  }
  function preview() {
    table = null;
    try {
      table = parseCSV(raw, $('#delimiter').value === 'tab' ? '\t' : $('#delimiter').value);
      $('#csv-preview').innerHTML = `<h3>Preview · ${table.rows.length} rows</h3><div class="table-scroll"><table><thead><tr>${table.headers.map(v => `<th>${h(v)}</th>`).join('')}</tr></thead><tbody>${table.rows.slice(0, 5).map(row => `<tr>${row.map(v => `<td>${h(v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
      for (const id of ['x-column', 'y-column']) { $(`#${id}`).disabled = false; $(`#${id}`).innerHTML = table.headers.map((value, i) => `<option value="${i}">${h(value)}</option>`).join(''); }
      $('#y-column').value = '1'; pointPreview();
    } catch (error) {
      $('#csv-preview').textContent = ''; $('#point-preview').textContent = '';
      $('#x-column').disabled = true; $('#y-column').disabled = true;
      $('#modal .form-error').textContent = error.message;
    }
  }
  $('#csv-file').onchange = async event => {
    const file = event.target.files[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('CSV exceeds the 10 MB input limit.');
      raw = await file.text();
      if (!target && !$('#modal [name=name]').value) $('#modal [name=name]').value = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
      preview();
    } catch (error) { table = null; $('#modal .form-error').textContent = error.message; }
  };
  $('#delimiter').onchange = () => { if (raw) preview(); };
  $('#x-column').onchange = pointPreview; $('#y-column').onchange = pointPreview;
}

async function action(name, id) {
  if (name === 'close-modal') return $('#modal').close();
  if (name === 'reload') return location.reload();
  if (name === 'new-project' || name === 'edit-project') return projectDialog(id);
  if (name === 'new-experiment' || name === 'edit-experiment') return experimentDialog(id);
  if (name === 'new-run' || name === 'edit-run') return runDialog(id);
  if (name === 'new-note' || name === 'edit-note') return noteDialog(id);
  if (name === 'import-run' || name === 'import-new') return importDialog(id);
  if (name === 'backup') return backup();
  if (name === 'restore') return $('#backup-input').click();
  if (name === 'load-demo') {
    const apply = async () => { await replaceWorkspace(demoWorkspace(), 'Synthetic demo loaded.'); state.view = 'overview'; state.query = ''; state.selected = null; render(); };
    if (!state.data.projects.length) return apply();
    return confirmDialog('Replace workspace with demo?', 'This replaces all projects with synthetic examples. Export a JSON backup first if you want to keep the current workspace.', apply, 'Replace with demo');
  }
  if (name === 'undo') {
    const previous = await previousWorkspace();
    if (!previous) throw new Error('No previous save is available yet.');
    return confirmDialog('Restore the previous save?', 'The entire workspace will return to its previous saved state. Export a backup first if needed.', () => replaceWorkspace(previous, 'Previous save restored.'), 'Restore previous save');
  }
  if (name === 'delete-project') {
    const p = state.data.projects.find(p => p.id === id);
    return confirmDialog('Delete project?', `Delete “${p.name}” and all associated experiments, runs and notes?`, () => commit(data => removeProject(data, id), 'Project deleted.'), 'Delete project');
  }
  if (name === 'delete-experiment') return confirmDialog('Delete experiment?', 'This also deletes every run and data point in this experiment.', () => commit(data => removeExperiment(data, id)), 'Delete experiment');
  if (name === 'delete-run') return confirmDialog('Delete run?', 'The run, its notes and all its data points will be removed.', () => commit(data => { data.runs = data.runs.filter(r => r.id !== id); }), 'Delete run');
  if (name === 'delete-note') return confirmDialog('Delete note?', 'This note will be removed from the project.', () => commit(data => { data.notes = data.notes.filter(n => n.id !== id); }), 'Delete note');
  if (name === 'duplicate-run') {
    const run = runs().find(r => r.id === id);
    return commit(data => data.runs.push(createRun(run.experimentId, { name: `${run.name.slice(0, 85)} · copy`, group: run.group, sample: '', notes: run.notes })), 'Setup duplicated with no measurements or sample ID.');
  }
  if (name === 'export-data') {
    if (!runs().some(r => r.points.length)) throw new Error('This experiment has no data to export.');
    return download('benchflow-measurements.csv', measurementsCSV(runs()), 'text/csv;charset=utf-8');
  }
  if (name === 'export-summary') {
    if (!selectedRuns().length) throw new Error('Select at least one run with data.');
    return download('benchflow-summary.csv', summaryCSV(aggregate(selectedRuns())), 'text/csv;charset=utf-8');
  }
  if (name === 'export-chart') {
    if (!selectedRuns().length) throw new Error('Select at least one run with data.');
    return download('benchflow-chart.svg', chartSVG(selectedRuns(), currentExperiment(), state.mode, true), 'image/svg+xml');
  }
  if (name === 'open-experiment' || name === 'select-experiment') { state.experiment = id; state.selected = null; if (name === 'open-experiment') state.view = 'runs'; }
  if (name === 'go-analysis') state.view = 'analysis';
  if (name === 'board-view') state.board = true;
  if (name === 'table-view') state.board = false;
  if (name === 'individual-mode') state.mode = 'individual';
  if (name === 'mean-mode') state.mode = 'mean';
  if (name === 'select-all-runs') state.selected = null;
  render();
}

document.addEventListener('click', async event => {
  const target = event.target.closest('[data-action],[data-view]'); if (!target) return;
  if (target.dataset.view) { state.view = target.dataset.view; state.query = ''; render(); return; }
  event.preventDefault();
  try { await action(target.dataset.action, target.dataset.id); }
  catch (error) { toast(error.message, true); }
});
document.addEventListener('change', async event => {
  const target = event.target;
  try {
    if (target.id === 'project-picker') { state.project = target.value; state.experiment = null; state.query = ''; render(); }
    if (target.id === 'status-filter') { state.status = target.value; render(); }
    if (target.dataset.statusId) await commit(data => Object.assign(data.runs.find(r => r.id === target.dataset.statusId), { status: target.value, updatedAt: timestamp() }));
    if (target.id === 'completed-only') { state.completedOnly = target.checked; state.selected = null; render(); }
    if (target.dataset.selectRun) { if (!state.selected) state.selected = new Set(eligibleRuns().map(r => r.id)); if (target.checked) state.selected.add(target.dataset.selectRun); else state.selected.delete(target.dataset.selectRun); render(); }
  } catch (error) { render(); toast(error.message, true); }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'search') return;
  const value = event.target.value, position = event.target.selectionStart;
  state.query = value;
  if (!['runs', 'notebook'].includes(state.view)) state.view = 'runs';
  render(); $('#search').focus();
  try { $('#search').setSelectionRange(position, position); } catch { /* search input may not expose caret selection */ }
});
document.addEventListener('keydown', event => {
  if (event.key === '/' && !event.ctrlKey && !event.metaKey && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName) && !$('#modal').open) { event.preventDefault(); $('#search').focus(); }
});
$('#backup-input').addEventListener('change', async event => {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('Backup exceeds the 30 MB input limit.');
    const data = parseBackup(await file.text());
    showDialog('Restore this backup?', `<p>Validated backup: ${h(file.name)}. Restoring replaces every project currently in this browser. Export your current workspace first if needed.</p><div class="restore-stats"><strong>${data.projects.length} projects</strong><strong>${data.experiments.length} experiments</strong><strong>${data.runs.length} runs</strong></div>`, () => replaceWorkspace(data, 'Backup restored.'), 'Replace workspace');
  } catch (error) { toast(error.message, true); }
});
if (channel) channel.onmessage = event => { if (event.data > state.revision) { state.conflict = true; if (!$('#modal').open) render(); else toast('Another tab saved changes. Reload before saving this form.', true); } };

try {
  const loaded = await loadWorkspace(); state.data = loaded.data; state.revision = loaded.revision; render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => { /* Local data works without offline caching. */ });
} catch (error) {
  $('#app').innerHTML = `<main class="boot"><h1>Could not open your workspace.</h1><p>${h(error.message)}</p><p>Try a regular browser window with site storage enabled. Existing data has not been replaced.</p><button class="button" data-action="reload">Reload</button></main>`;
}
