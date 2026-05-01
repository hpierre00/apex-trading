#!/usr/bin/env node
// Reads tests/fixtures.json, runs JS signal_engine on each, writes tests/js_results.json
'use strict';

const fs   = require('fs');
const path = require('path');
const { generateSignal, computeATR } = require('./signal_engine.js');

const fixturesPath = path.join(__dirname, 'tests', 'fixtures.json');
const outPath      = path.join(__dirname, 'tests', 'js_results.json');

const fixtures = JSON.parse(fs.readFileSync(fixturesPath, 'utf8'));

const results = fixtures.map(f => {
  let result;
  try {
    result = generateSignal(f.candles, f.verdicts, f.weights, f.last_signal, f.candle_idx);
  } catch (err) {
    result = { error: err.message };
  }
  return { id: f.id, group: f.group, desc: f.desc, result };
});

fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`Wrote ${results.length} results → ${outPath}`);

// Quick sanity summary
const nullCount   = results.filter(r => r.result === null).length;
const signalCount = results.filter(r => r.result && !r.result.error).length;
const errCount    = results.filter(r => r.result && r.result.error).length;
console.log(`  null (no signal): ${nullCount}`);
console.log(`  signal:           ${signalCount}`);
console.log(`  error:            ${errCount}`);
