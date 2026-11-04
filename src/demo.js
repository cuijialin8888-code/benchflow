import { emptyWorkspace, createProject, createExperiment, createRun, createNote } from './model.js';

export function demoWorkspace() {
  const data = emptyWorkspace();
  const project = createProject('Foam stability study', 'SYNTHETIC DEMO · A fictional materials study for exploring the workspace. These curves are not experimental evidence.');
  data.projects.push(project);
  const experiment = createExperiment(project.id, { name: 'Drainage screening', description: 'Synthetic cumulative drainage curves, three fictional formulations, two runs each. No experimental protocol or formulation recommendation is implied.', xLabel: 'Elapsed time', xUnit: 's', yLabel: 'Drained liquid', yUnit: 'g' });
  data.experiments.push(experiment);
  const groups = ['Control', 'Formula A', 'Formula B'];
  for (let g = 0; g < groups.length; g++) for (let repeat = 0; repeat < 2; repeat++) {
    const points = Array.from({ length: 13 }, (_, i) => ({ x: i * 30, y: Number((50 * (1 - Math.exp(-i * 30 / (135 + g * 95 + repeat * 12)))).toFixed(2)) }));
    data.runs.push(createRun(experiment.id, { name: `${groups[g]} · R${repeat + 1}`, sample: `DEMO-${g + 1}0${repeat + 1}`, group: groups[g], status: 'complete', points, notes: 'Synthetic values generated from a mathematical curve, not measured in a laboratory.' }));
  }
  data.runs.push(createRun(experiment.id, { name: 'Formula C · pilot', sample: 'DEMO-401', group: 'Formula C', status: 'running', notes: 'Fictional in-progress record. Import a CSV to try the workflow.' }));
  data.runs.push(createRun(experiment.id, { name: 'Control · R3', sample: 'DEMO-103', group: 'Control' }));
  data.runs.push(createRun(experiment.id, { name: 'Formula A · R3', sample: 'DEMO-203', group: 'Formula A' }));
  data.notes.push(createNote(project.id, 'Start here: a traceable workflow', 'This workspace contains SYNTHETIC DEMO DATA only.\n\n1. Open Runs to inspect sample IDs, groups and status.\n2. Import a CSV into a new or existing run.\n3. Open Analysis to compare curves or group means.\n4. Export a JSON backup before moving browsers.\n\nStatistics use exact matching X values. Standard deviation uses n − 1 and is undefined for a single run. The software does not establish whether runs are scientifically independent.'));
  return data;
}
