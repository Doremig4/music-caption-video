import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {test} from 'node:test';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const motionSource = ts.transpile(readFileSync(new URL('../src/caption-motion.ts', import.meta.url), 'utf8'), {module: ts.ModuleKind.CommonJS});
const motionExports = {};
runInNewContext(motionSource, {exports: motionExports});
const {getCaptionScroll, getVisibleCaptionRange} = motionExports;

test('visible caption range keeps all rows that can reach the viewport, including blurred edges', () => {
  for (const scroll of [0, 0.1, 10, 10.5, 10.99, 49]) {
    const {start, end} = getVisibleCaptionRange(50, scroll);
    assert.ok(start >= 0 && end <= 50 && end - start <= 15);
    for (let index = 0; index < 50; index++) {
      const top = 540 + (index - scroll) * 108;
      if (top + 108 + 27 >= 0 && top - 27 <= 1080) {
        assert.ok(index >= start && index < end, `missing visible row ${index} at ${scroll}`);
      }
    }
  }
});

test('caption scroll stays still initially and eases to the next row', () => {
  const cues = [{startMs: 1000}, {startMs: 2000}];
  assert.equal(getCaptionScroll([], 0), 0);
  assert.equal(getCaptionScroll(cues, 0), 0);
  assert.equal(getCaptionScroll(cues, 2000), 0);
  assert.equal(getCaptionScroll(cues, 2250), 0.5);
  assert.equal(getCaptionScroll(cues, 2500), 1);
  assert.ok(getCaptionScroll(cues, 2001) < 0.000001);
  assert.ok(1 - getCaptionScroll(cues, 2499) < 0.000001);
});

test('closely spaced cues continue scrolling without resetting or jumping', () => {
  const cues = [{startMs: 0}, {startMs: 1000}, {startMs: 1100}, {startMs: 1200}];
  for (const start of [1100, 1200]) {
    assert.ok(getCaptionScroll(cues, start) > 0);
    assert.ok(getCaptionScroll(cues, start + 0.001) - getCaptionScroll(cues, start - 0.001) < 0.00002);
  }
  let previous = 0;
  for (let ms = 0; ms <= 1800; ms++) {
    const position = getCaptionScroll(cues, ms);
    assert.ok(position >= previous && position <= 3);
    previous = position;
  }
  assert.equal(previous, 3);
});

// Exercise the actual request handler without launching a renderer or opening a port.
const createHarness = () => {
  let handler;
  const calls = [];
  const children = [];
  const source = readFileSync(new URL('../web/server.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace("new URL('..', import.meta.url).pathname", "'/project/'");
  runInNewContext(source, {
    URL, join, console,
    createServer: (callback) => { handler = callback; return {listen: () => {}}; },
    spawn: (command, args) => {
      calls.push({command, args});
      const child = Object.assign(new EventEmitter(), {stdout: new EventEmitter(), stderr: new EventEmitter()});
      children.push(child);
      return child;
    },
    existsSync: () => true,
    statSync: () => ({size: 10}),
    createReadStream: (path) => ({pipe: (response) => { response.path = path; }}),
  });
  const request = async (method, url) => {
    const response = {writeHead(status) { this.status = status; }, end(body) { this.body = body; }};
    await handler({method, url, headers: {}}, response);
    return response;
  };
  return {request, calls, children};
};

test('output mode chooses the renderer and downloads the corresponding file', async () => {
  for (const mode of ['full', 'proxy']) {
    const {request, calls, children} = createHarness();
    assert.equal((await request('POST', `/api/render?mode=${mode}`)).status, 202);
    assert.equal(calls[0].args[1], mode === 'proxy' ? 'render:proxy' : 'render');
    assert.equal((await request('POST', '/api/render')).status, 409);
    children[0].emit('close', 0);
    const state = JSON.parse((await request('GET', '/api/render-status')).body);
    assert.equal(state.status, 'done');
    assert.equal(state.mode, mode);
    const video = await request('GET', `/video?mode=${mode}`);
    assert.equal(video.path, `/project/outputs/music-video${mode === 'proxy' ? '-proxy' : ''}.mp4`);
  }
});

test('default mode preserves full output and invalid modes never spawn a renderer', async () => {
  const {request, calls} = createHarness();
  assert.equal((await request('POST', '/api/render?mode=invalid')).status, 400);
  assert.equal((await request('GET', '/video?mode=__proto__')).status, 400);
  assert.equal((await request('POST', '/api/render?encoding=invalid')).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await request('POST', '/api/render')).status, 202);
  assert.equal(calls[0].args[1], 'render');
});

test('hardware encoding uses the matching full or proxy script and reports the selected encoding', async () => {
  for (const mode of ['full', 'proxy']) {
    const {request, calls, children} = createHarness();
    assert.equal((await request('POST', `/api/render?mode=${mode}&encoding=accelerated`)).status, 202);
    assert.equal(calls[0].args[1], mode === 'proxy' ? 'render:proxy:accelerated' : 'render:accelerated');
    children[0].emit('close', 0);
    assert.equal(JSON.parse((await request('GET', '/api/render-status')).body).encoding, 'accelerated');
  }
});
