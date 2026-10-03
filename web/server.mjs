import {createReadStream, createWriteStream, existsSync, readFileSync, renameSync, statSync} from 'node:fs';
import {mkdir, rename} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {parseSrt} from '@remotion/captions';

const root = new URL('..', import.meta.url).pathname;
const publicDir = join(root, 'public');
const outputsDir = join(root, 'outputs');
const webDir = join(root, 'web');
const files = {music: 'music.mp3', cover: 'cover.jpg', captions: 'lyrics.srt', lyrics: 'lyrics.txt'};
const limits = {music: 500 * 1024 * 1024, cover: 25 * 1024 * 1024, captions: 2 * 1024 * 1024, lyrics: 2 * 1024 * 1024};
const renderModes = {
  full: {script: 'render', acceleratedScript: 'render:accelerated', filename: 'music-video.mp4'},
  proxy: {script: 'render:proxy', acceleratedScript: 'render:proxy:accelerated', filename: 'music-video-proxy.mp4'},
};
const getRenderMode = (url) => {
  const mode = url.searchParams.get('mode') ?? 'full';
  if (!Object.hasOwn(renderModes, mode)) throw new Error('지원하지 않는 출력 모드입니다.');
  return mode;
};
const getEncoding = (url) => {
  const encoding = url.searchParams.get('encoding') ?? 'standard';
  if (!['standard', 'accelerated'].includes(encoding)) throw new Error('지원하지 않는 인코딩 방식입니다.');
  return encoding;
};
let renderState = {status: 'idle', phase: '', percent: 0, error: ''};
// ponytail: local single-user UI; use per-job state if concurrent users are added.
let syncState = {status: 'idle', phase: '', percent: 0, error: ''};

const send = (response, status, body, type = 'text/plain; charset=utf-8') => {
  response.writeHead(status, {'content-type': type, 'cache-control': 'no-store'});
  response.end(body);
};

const stream = (request, response, path, type) => {
  if (!existsSync(path)) return send(response, 404, '파일이 없습니다.');
  const size = statSync(path).size;
  const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
  response.writeHead(range ? 206 : 200, {
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    'content-length': end - start + 1,
    ...(range ? {'content-range': `bytes ${start}-${end}/${size}`} : {}),
    'content-type': type,
  });
  createReadStream(path, {start, end}).pipe(response);
};

const saveBody = async (request, target, limit) => {
  const temp = `${target}.upload`;
  let size = 0;
  await new Promise((resolve, reject) => {
    const output = createWriteStream(temp);
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) request.destroy(new Error('파일이 너무 큽니다.'));
    });
    request.on('error', reject);
    output.on('error', reject);
    output.on('finish', resolve);
    request.pipe(output);
  });
  await rename(temp, target);
};

const startRender = (mode, encoding) => {
  renderState = {status: 'running', phase: '렌더링 준비 중', percent: 0, error: '', mode, encoding};
  const script = encoding === 'accelerated' ? renderModes[mode].acceleratedScript : renderModes[mode].script;
  const child = spawn('npm', ['run', script], {cwd: root});
  let log = '';
  const readProgress = (chunk) => {
    log = (log + chunk).slice(-4000);
    for (const match of chunk.toString().matchAll(/Rendered (\d+)\/(\d+)/g)) {
      renderState.phase = '프레임 렌더링 중';
      renderState.percent = Math.round(Number(match[1]) / Number(match[2]) * 85);
    }
    for (const match of chunk.toString().matchAll(/Encoded (\d+)\/(\d+)/g)) {
      renderState.phase = '영상 인코딩 중';
      renderState.percent = 85 + Math.round(Number(match[1]) / Number(match[2]) * 15);
    }
  };
  child.stdout.on('data', readProgress);
  child.stderr.on('data', readProgress);
  child.on('error', (error) => {
    renderState = {status: 'error', phase: '', percent: 0, error: error.message};
  });
  child.on('close', (code) => {
    if (code !== 0) {
      renderState = {status: 'error', phase: '', percent: renderState.percent, error: log || `렌더러가 ${code} 코드로 종료됐습니다.`};
      return;
    }
    renderState = {status: 'done', phase: '완료', percent: 100, error: '', mode, encoding};
    spawn('osascript', ['-e', 'display notification "영상 렌더링이 완료됐습니다." with title "음악 자막 영상"']);
  });
};

const startSync = () => {
  syncState = {status: 'running', phase: 'Whisper 시작 중', percent: 1, error: ''};
  const python = join(root, '.whisper-env', 'bin', 'python');
  const generated = join(publicDir, 'lyrics.generated.srt');
  const child = spawn(python, [join(root, 'scripts', 'generate_srt.py'), join(publicDir, files.music), join(publicDir, files.lyrics), generated], {cwd: root});
  let log = '';
  let buffer = '';
  const readOutput = (chunk) => {
    log = (log + chunk).slice(-4000);
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (line.startsWith('STATUS ')) syncState.phase = line.slice(7);
      if (line.startsWith('PROGRESS ')) syncState.percent = Number(line.slice(9));
    }
  };
  child.stdout.on('data', readOutput);
  child.stderr.on('data', readOutput);
  child.on('error', (error) => {
    syncState = {status: 'error', phase: '', percent: syncState.percent, error: error.message};
  });
  child.on('close', (code) => {
    if (code !== 0) {
      syncState = {status: 'error', phase: '', percent: syncState.percent, error: log.trim() || 'SRT 생성에 실패했습니다.'};
      return;
    }
    try {
      const {captions} = parseSrt({input: readFileSync(generated, 'utf8')});
      if (!captions.length) throw new Error('생성된 자막이 비어 있습니다.');
      renameSync(generated, join(publicDir, files.captions));
      syncState = {status: 'done', phase: `자막 ${captions.length}개 생성 완료`, percent: 100, error: ''};
    } catch (error) {
      syncState = {status: 'error', phase: '', percent: 100, error: error instanceof Error ? error.message : String(error)};
    }
  });
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/') return stream(request, response, join(webDir, 'index.html'), 'text/html; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/app.js') return stream(request, response, join(webDir, 'app.js'), 'text/javascript; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/styles.css') return stream(request, response, join(webDir, 'styles.css'), 'text/css; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/media/music') return stream(request, response, join(publicDir, files.music), 'audio/mpeg');
    if (request.method === 'GET' && url.pathname === '/media/cover') return stream(request, response, join(publicDir, files.cover), 'image/jpeg');
    if (request.method === 'GET' && url.pathname === '/api/captions') return stream(request, response, join(publicDir, files.captions), 'text/plain; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/api/meta') return stream(request, response, join(publicDir, 'meta.json'), 'application/json; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/api/render-status') return send(response, 200, JSON.stringify(renderState), 'application/json; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/api/sync-status') return send(response, 200, JSON.stringify(syncState), 'application/json; charset=utf-8');
    if (request.method === 'GET' && url.pathname === '/video') return stream(request, response, join(outputsDir, renderModes[getRenderMode(url)].filename), 'video/mp4');

    const upload = url.pathname.match(/^\/api\/(music|cover)$/)?.[1];
    if (request.method === 'PUT' && upload) {
      await saveBody(request, join(publicDir, files[upload]), limits[upload]);
      return send(response, 200, '저장했습니다.');
    }

    if (request.method === 'PUT' && url.pathname === '/api/lyrics') {
      await saveBody(request, join(publicDir, files.lyrics), limits.lyrics);
      return send(response, 200, 'TXT를 저장했습니다.');
    }

    if (request.method === 'PUT' && url.pathname === '/api/captions') {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > limits.captions) throw new Error('SRT 파일이 너무 큽니다.');
        chunks.push(chunk);
      }
      const input = Buffer.concat(chunks).toString('utf8');
      const {captions} = parseSrt({input});
      if (!captions.length || captions.some((caption) => caption.endMs <= caption.startMs)) {
        throw new Error('유효한 자막 구간이 필요합니다.');
      }
      await mkdir(publicDir, {recursive: true});
      const target = join(publicDir, files.captions);
      const temp = `${target}.upload`;
      await import('node:fs/promises').then(({writeFile}) => writeFile(temp, input));
      await rename(temp, target);
      return send(response, 200, 'SRT를 저장했습니다.');
    }

    if (request.method === 'PUT' && url.pathname === '/api/meta') {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const meta = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!meta.title?.trim() || !meta.artist?.trim()) throw new Error('곡 제목과 아티스트를 입력하세요.');
      const backgroundOpacity = meta.backgroundOpacity ?? 0.42;
      if (!Number.isFinite(backgroundOpacity) || backgroundOpacity < 0 || backgroundOpacity > 1) {
        throw new Error('배경 불투명도는 0부터 1 사이의 값이어야 합니다.');
      }
      const target = join(publicDir, 'meta.json');
      const temp = `${target}.upload`;
      await import('node:fs/promises').then(({writeFile}) => writeFile(temp, JSON.stringify({title: meta.title.trim(), artist: meta.artist.trim(), backgroundOpacity}, null, 2)));
      await rename(temp, target);
      return send(response, 200, '곡 정보를 저장했습니다.');
    }

    if (request.method === 'POST' && url.pathname === '/api/render') {
      if (renderState.status === 'running') return send(response, 409, '이미 렌더링 중입니다.');
      startRender(getRenderMode(url), getEncoding(url));
      return send(response, 202, '렌더링을 시작했습니다.');
    }

    if (request.method === 'POST' && url.pathname === '/api/generate-srt') {
      if (syncState.status === 'running') return send(response, 409, '이미 자막 싱크를 분석 중입니다.');
      if (!existsSync(join(publicDir, files.music))) throw new Error('먼저 음악 파일을 업로드하세요.');
      if (!existsSync(join(publicDir, files.lyrics))) throw new Error('먼저 가사 TXT 파일을 업로드하세요.');
      if (!existsSync(join(root, '.whisper-env', 'bin', 'python'))) throw new Error('터미널에서 npm run setup-whisper를 먼저 실행하세요.');
      startSync();
      return send(response, 202, '자막 싱크 분석을 시작했습니다.');
    }

    return send(response, 404, '찾을 수 없습니다.');
  } catch (error) {
    return send(response, 400, error instanceof Error ? error.message : String(error));
  }
});

server.listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
