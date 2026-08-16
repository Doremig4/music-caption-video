import {createReadStream, createWriteStream, existsSync, statSync} from 'node:fs';
import {mkdir, rename} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {parseSrt} from '@remotion/captions';

const root = new URL('..', import.meta.url).pathname;
const publicDir = join(root, 'public');
const outputsDir = join(root, 'outputs');
const webDir = join(root, 'web');
const files = {music: 'music.mp3', cover: 'cover.jpg', captions: 'lyrics.srt'};
const limits = {music: 500 * 1024 * 1024, cover: 25 * 1024 * 1024, captions: 2 * 1024 * 1024};
let renderState = {status: 'idle', phase: '', percent: 0, error: ''};

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

const startRender = () => {
  renderState = {status: 'running', phase: '렌더링 준비 중', percent: 0, error: ''};
  const child = spawn('npm', ['run', 'render'], {cwd: root});
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
    renderState = {status: 'done', phase: '완료', percent: 100, error: ''};
    spawn('osascript', ['-e', 'display notification "영상 렌더링이 완료됐습니다." with title "음악 자막 영상"']);
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
    if (request.method === 'GET' && url.pathname === '/video') return stream(request, response, join(outputsDir, 'music-video.mp4'), 'video/mp4');

    const upload = url.pathname.match(/^\/api\/(music|cover)$/)?.[1];
    if (request.method === 'PUT' && upload) {
      await saveBody(request, join(publicDir, files[upload]), limits[upload]);
      return send(response, 200, '저장했습니다.');
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
      const target = join(publicDir, 'meta.json');
      const temp = `${target}.upload`;
      await import('node:fs/promises').then(({writeFile}) => writeFile(temp, JSON.stringify({title: meta.title.trim(), artist: meta.artist.trim()}, null, 2)));
      await rename(temp, target);
      return send(response, 200, '곡 정보를 저장했습니다.');
    }

    if (request.method === 'POST' && url.pathname === '/api/render') {
      if (renderState.status === 'running') return send(response, 409, '이미 렌더링 중입니다.');
      startRender();
      return send(response, 202, '렌더링을 시작했습니다.');
    }

    return send(response, 404, '찾을 수 없습니다.');
  } catch (error) {
    return send(response, 400, error instanceof Error ? error.message : String(error));
  }
});

server.listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173'));
