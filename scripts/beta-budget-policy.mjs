/** Regression gates for the fixed installed-consumer fixtures, not runtime limits. */
export const policy = {
  warmup: 5, samples: 30, importWarmup: 1, importSamples: 5, lifecycleWarmup: 5, lifecycleSamples: 20,
  latency: { workspaceImport: 2000, workspaceSelection: 150, selectionRender: 100, coldPointerPreview: 150, warmPointerPreview: 100, commitRender: 1000 },
  memory: { heapGrowthBytes: 8 * 1024 * 1024, heapSlopeBytesPerCycle: 256 * 1024, nodesGrowth: 100, listenersGrowth: 20 },
};

export function summarize(samples) {
  if (!samples.length || samples.some(n => !Number.isFinite(n) || n < 0)) throw new Error('Expected nonempty finite nonnegative measurements.');
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: samples.length, median: sorted[Math.ceil(sorted.length / 2) - 1], p95: sorted[Math.ceil(sorted.length * 0.95) - 1], max: sorted.at(-1) };
}

export function assessLatency(name, samples) {
  if (!Object.hasOwn(policy.latency, name)) throw new Error(`Unknown metric: ${name}`);
  const expected = name === 'workspaceImport' ? policy.importSamples : policy.samples;
  if (samples.length !== expected) throw new Error(`${name}: expected ${expected} measured samples, received ${samples.length}.`);
  const stats = summarize(samples);
  return { ...stats, budgetMs: policy.latency[name], passed: stats.p95 <= policy.latency[name], samplesMs: samples };
}

export function assessMemory(baseline, samples) {
  if (samples.length !== policy.lifecycleSamples) throw new Error('Incomplete lifecycle measurements.');
  for (const key of ['heap', 'nodes', 'listeners']) summarize([baseline[key], ...samples.map(sample => sample[key])]);
  const n = samples.length; const meanX = (n - 1) / 2;
  const meanY = samples.reduce((sum, sample) => sum + sample.heap, 0) / n;
  let numerator = 0; let denominator = 0;
  samples.forEach((sample, i) => { numerator += (i - meanX) * (sample.heap - meanY); denominator += (i - meanX) ** 2; });
  const observed = {
    heapGrowthBytes: Math.max(0, ...samples.map(sample => sample.heap - baseline.heap)),
    heapSlopeBytesPerCycle: Math.max(0, numerator / denominator),
    nodesGrowth: Math.max(0, ...samples.map(sample => sample.nodes - baseline.nodes)),
    listenersGrowth: Math.max(0, ...samples.map(sample => sample.listeners - baseline.listeners)),
  };
  return { baseline, samples, observed, budgets: policy.memory,
    passed: Object.entries(observed).every(([key, value]) => value <= policy.memory[key]) };
}
