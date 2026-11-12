#!/usr/bin/env node
/**
 * Measures the face engine on a folder of photographs, one folder a person:
 *
 *   <dir>/<person>/*.jpg
 *
 *   npm run build && npm run face:models
 *   node scripts/face-benchmark.mjs /path/to/people [maxDifferentPairs]
 *
 * It compares every pair of photographs of the same person, and a sample of
 * pairs of different people, and prints what each threshold would do: how
 * many genuine pairs it would turn away (false rejects) and how many
 * strangers it would let through (false accepts).
 *
 * Use it to set the accept and reject thresholds from photographs that look
 * like real clock-ins: the phones, lighting and faces of the people who
 * will use it. Nothing is uploaded or stored; scores are printed and that
 * is all. Needs a machine ONNX Runtime has a build for (Linux, Apple silicon).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { OnnxFaceEngine } = require('../dist/face/onnx.engine.js');
const { cosine } = require('../dist/face/geometry.js');

const [dir, maxDifferentArg] = process.argv.slice(2);
if (!dir) {
  console.error('usage: node scripts/face-benchmark.mjs <dir of person folders> [maxDifferentPairs]');
  process.exit(2);
}
const maxDifferent = Number(maxDifferentArg || 20000);
const engine = await OnnxFaceEngine.load(process.env.FACE_MODEL_DIR || join(process.cwd(), 'models'), 2);

const people = [];
let photos = 0;
let noFace = 0;
let crowded = 0;
let elapsed = 0;
for (const entry of readdirSync(dir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const vectors = [];
  for (const file of readdirSync(join(dir, entry.name))) {
    if (!/\.(jpe?g|png|webp)$/i.test(file)) continue;
    const started = performance.now();
    const frame = await engine.analyse(readFileSync(join(dir, entry.name, file)), photos);
    elapsed += performance.now() - started;
    photos += 1;
    if (!frame.face) noFace += 1;
    else {
      if (frame.faceCount > 1) crowded += 1;
      vectors.push(frame.face.embedding);
    }
  }
  if (vectors.length) people.push(vectors);
}

const same = [];
for (const vectors of people) {
  for (let a = 0; a < vectors.length; a++) {
    for (let b = a + 1; b < vectors.length; b++) same.push(cosine(vectors[a], vectors[b]));
  }
}
// Every cross-person pair is far too many for a large set; walk them with a fixed stride instead.
const different = [];
let total = 0;
for (let a = 0; a < people.length; a++) {
  for (let b = a + 1; b < people.length; b++) total += people[a].length * people[b].length;
}
const stride = Math.max(1, Math.ceil(total / maxDifferent));
let seen = 0;
for (let a = 0; a < people.length; a++) {
  for (let b = a + 1; b < people.length; b++) {
    for (const va of people[a]) {
      for (const vb of people[b]) {
        if (seen++ % stride === 0) different.push(cosine(va, vb));
      }
    }
  }
}
same.sort((x, y) => x - y);
different.sort((x, y) => x - y);

const at = (list, fraction) => list[Math.min(list.length - 1, Math.floor(fraction * list.length))];
const percent = (value) => `${(value * 100).toFixed(2)}%`;
console.log(`${engine.model}`);
console.log(`${people.length} people, ${photos} photographs, ${(elapsed / photos).toFixed(0)} ms each`);
console.log(`no face found: ${noFace}; more than one face: ${crowded}`);
console.log(`${same.length} same-person pairs, ${different.length} different-person pairs\n`);
if (!same.length || !different.length) {
  console.log('Need at least two people, and two photographs of someone, to measure anything.');
  process.exit(0);
}
console.log('threshold   false rejects   false accepts');
for (let threshold = 0.2; threshold <= 0.601; threshold += 0.025) {
  const rejected = same.filter((score) => score < threshold).length / same.length;
  const accepted = different.filter((score) => score >= threshold).length / different.length;
  console.log(`   ${threshold.toFixed(3)}        ${percent(rejected).padStart(7)}         ${percent(accepted).padStart(7)}`);
}
console.log(`\nsame person:  1st percentile ${at(same, 0.01).toFixed(3)}, 5th ${at(same, 0.05).toFixed(3)}, median ${at(same, 0.5).toFixed(3)}`);
console.log(`different:    median ${at(different, 0.5).toFixed(3)}, 99th percentile ${at(different, 0.99).toFixed(3)}, highest ${different[different.length - 1].toFixed(3)}`);
