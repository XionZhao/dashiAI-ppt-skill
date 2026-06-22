#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const tests = [
  ['media contracts distinguish writable slots from count-only controls', testMediaContracts],
  ['provided image query requires initial media write support', testProvidedImageQuery],
  ['video query returns only initial video-capable slots', testVideoQuery],
  ['mixed media query requires image and video capable slots', testMixedMediaQuery],
  ['stage-media preserves user media through render and preview', testStageMediaRenderPreview],
];

const failures = [];

for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failures.push([name, error]);
    console.error(`not ok - ${name}`);
    console.error(`  ${error.message}`);
  }
}

if (failures.length) {
  console.error(`\n${failures.length} skill media workflow validation test(s) failed.`);
  process.exit(1);
}

console.log('\nSkill media workflow validation passed.');

function testMediaContracts() {
  const theme03 = runJson('scripts/inspect-layout.mjs', ['theme03_page017']);
  const badWritableFields = new Set(['decorScale', 'layout', 'imageCount']);
  for (const slot of theme03.mediaSlots || []) {
    assert(!badWritableFields.has(slot.field), `theme03_page017 exposes count/control as writable media field: ${slot.field}`);
    if (slot.writeMode !== 'countOnly') {
      assert(slot.fieldPath !== `props.${slot.field}` || slot.initialSrcSupported === true, `theme03_page017 writable media slot missing initial support flag: ${slot.field}`);
    }
  }
  assert((theme03.mediaSlots || []).every(slot => Object.prototype.hasOwnProperty.call(slot, 'initialSrcSupported') && slot.writeMode), 'theme03_page017 media slots should expose initialSrcSupported and writeMode');

  const theme11 = runJson('scripts/inspect-layout.mjs', ['theme11_page063']);
  const imagesSlot = (theme11.mediaSlots || []).find(slot => slot.field === 'images' && slot.countKey === 'imageCount');
  assert(imagesSlot, 'theme11_page063 should expose images slot bound to imageCount');
  assert(imagesSlot.fieldPath === 'props.images', 'theme11_page063 images slot should expose fieldPath=props.images');
  assert(imagesSlot.max >= 4, 'theme11_page063 images slot should expose max capacity');
  assert(imagesSlot.initialSrcSupported === true, 'theme11_page063 images slot should support initial src');
  assert(imagesSlot.runtimeReplaceable === true, 'theme11_page063 images slot should be runtime replaceable');
  assert(imagesSlot.writeMode === 'initialProps', 'theme11_page063 images slot should use initialProps write mode');
  assert(Array.isArray(imagesSlot.acceptedKinds) && imagesSlot.acceptedKinds.includes('image') && imagesSlot.acceptedKinds.includes('video'), 'theme11_page063 images slot should accept image and video');
  assert(typeof imagesSlot.valueShape === 'string' && imagesSlot.valueShape.includes('src'), 'theme11_page063 images slot should describe value shape');
  assert(imagesSlot.emptySlotBehavior, 'theme11_page063 images slot should describe empty slot behavior');
}

function testProvidedImageQuery() {
  const result = runJson('scripts/layout-query.mjs', [
    '--theme', 'theme08',
    '--provided-images', '3',
    '--require-initial-media',
    '--limit', '5',
  ]);
  assert(result.mediaIntent === 'provided-images', 'expected provided-images media intent');
  assert(result.requireInitialMedia === true, 'expected requireInitialMedia=true in query output');
  for (const layout of result.layouts) {
    const slots = layout.mediaSlots || [];
    assert(slots.some(slot => slot.initialSrcSupported === true && mediaSlotCapacity(slot) >= 3), `${layout.layout} lacks initial media slot for 3 images`);
    assert(slots.some(slot => slot.canPresetMedia === true && slot.presetProp), `${layout.layout} lacks canPresetMedia/presetProp hint`);
    for (const slot of slots) {
      assert(slot.field !== 'mediaCount' && slot.field !== 'imageCount', `${layout.layout} exposes count key as media field`);
      assert(slot.fieldPath, `${layout.layout} media slot missing fieldPath`);
      if (slot.canPresetMedia) assert(slot.presetProp === slot.fieldPath, `${layout.layout} presetProp should match fieldPath`);
    }
  }
}

function testVideoQuery() {
  const result = runJson('scripts/layout-query.mjs', [
    '--media-kind', 'video',
    '--require-initial-media',
    '--media-count', '1',
    '--limit', '8',
  ]);
  assert(result.mediaKind === 'video', 'expected mediaKind=video');
  assert(result.requireInitialMedia === true, 'expected requireInitialMedia=true');
  assert(result.layouts.length > 0, 'expected video-capable initial media candidates');
  for (const layout of result.layouts) {
    assert((layout.mediaSlots || []).some(slot => slot.initialSrcSupported === true && slot.canPresetMedia === true && slot.presetProp && (slot.acceptedKinds || []).includes('video')), `${layout.layout} lacks initial video-capable slot`);
  }
}

function testMixedMediaQuery() {
  const result = runJson('scripts/layout-query.mjs', [
    '--provided-media', '2',
    '--require-initial-media',
    '--limit', '8',
  ]);
  assert(result.mediaKind === 'mixed', 'expected mediaKind=mixed');
  assert(result.requireInitialMedia === true, 'expected requireInitialMedia=true');
  assert(result.layouts.length > 0, 'expected mixed media candidates');
  for (const layout of result.layouts) {
    assert((layout.mediaSlots || []).some(slot => {
      const kinds = slot.acceptedKinds || [];
      return slot.initialSrcSupported === true && kinds.includes('image') && kinds.includes('video') && mediaSlotCapacity(slot) >= 2;
    }), `${layout.layout} lacks mixed image/video initial slot`);
  }
}

function testStageMediaRenderPreview() {
  assert(existsSync(path.join(ROOT, 'scripts/stage-media.mjs')), 'scripts/stage-media.mjs is missing');
  const tmp = mkdtempSync(path.join(tmpdir(), 'dashi-stage-media-'));
  let previewState = null;
  try {
    const sourceDir = path.join(tmp, 'source');
    const outDir = path.join(tmp, 'ppt');
    mkdirSync(sourceDir, { recursive: true });
    mkdirSync(outDir, { recursive: true });
    const png = path.join(sourceDir, 'Key Visual 01.png');
    const mp4 = path.join(sourceDir, 'Recap Clip 01.mp4');
    writeFileSync(png, Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'));
    writeFileSync(mp4, Buffer.from('00000018667479706d70343200000000', 'hex'));

    const staged = runJson('scripts/stage-media.mjs', [outDir, png, mp4]);
    assert(staged.items?.length === 2, 'stage-media should return two items');
    assert(staged.items[0].relative === 'assets/user-media/key-visual-01.png', 'stage-media should slugify image name');
    assert(staged.items[1].relative === 'assets/user-media/recap-clip-01.mp4', 'stage-media should slugify video name');
    assert(staged.items[0].kind === 'image' && staged.items[1].kind === 'video', 'stage-media should identify media kind');

    const goalPath = path.join(tmp, 'goal.json');
    writeFileSync(goalPath, JSON.stringify({
      title: 'Media Stage Smoke',
      goal: 'verify staged media survives render',
      themePack: 'theme11',
      slides: [{
        layout: 'theme11_page063',
        props: {
          headingHtml: 'Media Stage Smoke',
          lede: 'Staged image and video should remain available after render.',
          imageCount: 2,
          images: [
            { src: staged.items[0].relative, kind: 'image', type: staged.items[0].mime },
            { src: staged.items[1].relative, kind: 'video', type: staged.items[1].mime },
          ],
        },
      }],
    }, null, 2));

    execFileSync('npm', ['run', 'render:goal', '--', goalPath, path.join(outDir, 'index.html')], { cwd: ROOT, stdio: 'pipe' });
    assert(existsSync(path.join(outDir, staged.items[0].relative)), 'staged image should survive render');
    assert(existsSync(path.join(outDir, staged.items[1].relative)), 'staged video should survive render');

    const port = 49200 + (process.pid % 500);
    const output = execFileSync('npm', ['run', 'preview:start', '--', outDir, String(port)], {
      cwd: ROOT,
      env: { ...process.env, DASHI_PPT_PREVIEW_HOST: '127.0.0.1', DASHI_PPT_PREVIEW_NAME: 'jadon' },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert(output.includes(`https://jadon.local:${port}/`), 'preview:start should print jadon.local URL');
    previewState = JSON.parse(readFileSync(path.join(outDir, '.preview-server.json'), 'utf8'));
    fetchHttpsWithRetry(`https://localhost:${port}/${staged.items[0].relative}`);
    fetchHttpsWithRetry(`https://localhost:${port}/${staged.items[1].relative}`);
  } finally {
    if (previewState?.pid) cleanupPreviewProcess(previewState.pid);
    rmSync(tmp, { recursive: true, force: true });
  }
}

function runJson(script, args) {
  const stdout = execFileSync('node', [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

function mediaSlotCapacity(slot) {
  const max = Number(slot?.max);
  if (Number.isFinite(max) && max > 0) return max;
  const defaultCount = Number(slot?.defaultCount);
  if (Number.isFinite(defaultCount) && defaultCount > 0) return defaultCount;
  return 1;
}

function fetchHttpsWithRetry(url) {
  let lastError = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return fetchHttps(url);
    } catch (error) {
      lastError = error;
      sleep(150);
    }
  }
  throw new Error(`Failed to fetch ${url}: ${lastError?.message || 'unknown error'}`);
}

function fetchHttps(url) {
  let result = null;
  let error = null;
  const marker = path.join(tmpdir(), `dashi-fetch-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    const code = `
      const https = require('https');
      https.get(${JSON.stringify(url)}, { rejectUnauthorized: false }, response => {
        response.resume();
        response.on('end', () => process.exit(response.statusCode === 200 ? 0 : 2));
      }).on('error', () => process.exit(1));
    `;
    execFileSync(process.execPath, ['-e', code], { stdio: 'pipe' });
    result = true;
  } catch (caught) {
    error = caught;
  } finally {
    rmSync(marker, { force: true });
  }
  if (result) return true;
  throw error || new Error('request failed');
}

function cleanupPreviewProcess(pid) {
  const value = Number(pid);
  if (!Number.isFinite(value) || value <= 0) return;
  try {
    process.kill(value, 'SIGTERM');
  } catch {}
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
