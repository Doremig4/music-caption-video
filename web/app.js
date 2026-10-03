const audio = document.querySelector('#audio');
const captions = document.querySelector('#captions');
const template = document.querySelector('#rowTemplate');
const status = document.querySelector('#status');
const title = document.querySelector('#title');
const artist = document.querySelector('#artist');
const scrubber = document.querySelector('#scrubber');
const timeDisplay = document.querySelector('#timeDisplay');
const play = document.querySelector('#play');
const volume = document.querySelector('#volume');
const volumeDisplay = document.querySelector('#volumeDisplay');
const renderButton = document.querySelector('#render');
const renderMode = document.querySelector('#renderMode');
const renderProgress = document.querySelector('#renderProgress');
const renderLabel = document.querySelector('#renderLabel');
const outputName = document.querySelector('#outputName');
const syncButton = document.querySelector('#generateSrt');
const syncProgress = document.querySelector('#syncProgress');
const syncLabel = document.querySelector('#syncLabel');
let outputHandle = null;
const defaultOutputName = () => renderMode.value === 'proxy' ? 'music-video-proxy.mp4' : 'music-video.mp4';
renderMode.onchange = () => {
  outputHandle = null;
  outputName.textContent = defaultOutputName();
};

const setStatus = (message) => (status.textContent = message);
const refreshNumbers = () => [...captions.children].forEach((row, index) => (row.querySelector('.number').textContent = index + 1));
const time = () => Number(audio.currentTime.toFixed(3));
const updateTimeline = () => {
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
  scrubber.max = duration;
  scrubber.value = audio.currentTime;
  timeDisplay.textContent = `${audio.currentTime.toFixed(2)} / ${duration.toFixed(2)}초`;
  play.textContent = audio.paused ? '재생' : '일시정지';
};
let timelineFrame = 0;
const animateTimeline = () => {
  updateTimeline();
  if (!audio.paused) timelineFrame = requestAnimationFrame(animateTimeline);
};

const addRow = ({start = 0, text = ''} = {}) => {
  const row = template.content.firstElementChild.cloneNode(true);
  row.querySelector('.start').value = start;
  row.querySelector('textarea').value = text;
  row.querySelector('.mark-start').onclick = () => (row.querySelector('.start').value = time());
  row.querySelector('.remove').onclick = () => { row.remove(); refreshNumbers(); };
  captions.append(row);
  refreshNumbers();
};

let draggedRow = null;
captions.addEventListener('dragstart', (event) => {
  if (!event.target.matches('.drag-handle')) return event.preventDefault();
  draggedRow = event.target.closest('.caption-row');
  draggedRow.classList.add('dragging');
  event.dataTransfer.effectAllowed = 'move';
});
captions.addEventListener('dragover', (event) => {
  const target = event.target.closest('.caption-row');
  if (!draggedRow || !target || target === draggedRow) return;
  event.preventDefault();
  const after = event.clientY > target.getBoundingClientRect().top + target.offsetHeight / 2;
  captions.insertBefore(draggedRow, after ? target.nextSibling : target);
});
captions.addEventListener('dragend', () => {
  draggedRow?.classList.remove('dragging');
  draggedRow = null;
  refreshNumbers();
});

const parseSrt = (input) => input.trim().split(/\r?\n\r?\n+/).flatMap((block) => {
  const lines = block.split(/\r?\n/);
  const timingIndex = lines.findIndex((line) => line.includes('-->'));
  if (timingIndex < 0) return [];
  const [start, end] = lines[timingIndex].split('-->').map((value) => value.trim());
  const seconds = (value) => { const [h, m, rest] = value.replace(',', '.').split(':'); return +h * 3600 + +m * 60 + +rest; };
  return [{start: seconds(start), end: seconds(end), text: lines.slice(timingIndex + 1).join('\n')}];
});

const stamp = (value) => {
  const ms = Math.max(0, Math.round(value * 1000));
  const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${hours}:${minutes}:${seconds},${String(ms % 1000).padStart(3, '0')}`;
};

const serialize = () => {
  const cues = [...captions.children].map((row) => ({start: +row.querySelector('.start').value, text: row.querySelector('textarea').value.trim()}));
  return cues.map((cue, index) => {
    const end = cues[index + 1]?.start ?? (Number.isFinite(audio.duration) ? audio.duration : cue.start + 2);
    if (!cue.text || !Number.isFinite(cue.start) || end <= cue.start) throw new Error(`${index + 1}번 자막의 문구와 시작 시간을 확인하세요.`);
    return `${index + 1}\n${stamp(cue.start)} --> ${stamp(end)}\n${cue.text}`;
  }).join('\n\n') + '\n';
};

const save = async () => {
  const [captionResponse, metaResponse] = await Promise.all([
    fetch('/api/captions', {method: 'PUT', body: serialize()}),
    fetch('/api/meta', {method: 'PUT', headers: {'content-type': 'application/json'}, body: JSON.stringify({title: title.value.trim(), artist: artist.value.trim()})}),
  ]);
  if (!captionResponse.ok) throw new Error(await captionResponse.text());
  if (!metaResponse.ok) throw new Error(await metaResponse.text());
  setStatus('SRT를 저장했습니다.');
};

document.querySelector('#add').onclick = () => addRow({start: time()});
document.querySelectorAll('.offset').forEach((button) => button.onclick = () => {
  const offset = Number(button.dataset.offset);
  const inputs = [...captions.querySelectorAll('.start')];
  if (inputs.some((input) => Number(input.value) + offset < 0)) return setStatus('자막은 0초보다 앞으로 이동할 수 없습니다.');
  inputs.forEach((input) => (input.value = (Number(input.value) + offset).toFixed(3)));
  setStatus(`전체 자막을 ${offset > 0 ? '+' : ''}${offset.toFixed(1)}초 이동했습니다.`);
});
play.onclick = () => audio.paused ? audio.play() : audio.pause();
scrubber.oninput = () => { audio.currentTime = +scrubber.value; updateTimeline(); };
volume.oninput = () => {
  audio.volume = +volume.value;
  volumeDisplay.textContent = `${Math.round(audio.volume * 100)}%`;
};
audio.addEventListener('loadedmetadata', updateTimeline);
audio.addEventListener('timeupdate', updateTimeline);
audio.addEventListener('play', () => { cancelAnimationFrame(timelineFrame); animateTimeline(); });
audio.addEventListener('pause', () => { cancelAnimationFrame(timelineFrame); updateTimeline(); });
document.querySelector('#srtFile').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const imported = parseSrt(await file.text());
  if (!imported.length) return setStatus('유효한 SRT 자막을 찾지 못했습니다.');
  captions.replaceChildren();
  imported.forEach(addRow);
  setStatus(`${file.name}에서 자막 ${imported.length}개를 불러왔습니다.`);
};
document.querySelector('#lyricsFile').onchange = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  setStatus(`${file.name} 업로드 중…`);
  const response = await fetch('/api/lyrics', {method: 'PUT', body: file});
  setStatus(response.ok ? `${file.name}을 저장했습니다.` : await response.text());
};
document.querySelector('#save').onclick = () => save().catch((error) => setStatus(error.message));
document.querySelector('#download').onclick = () => {
  try {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([serialize()], {type: 'text/plain'}));
    link.download = 'lyrics.srt';
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (error) { setStatus(error.message); }
};

for (const kind of ['music', 'cover']) {
  document.querySelector(`#${kind}`).onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    setStatus(`${file.name} 업로드 중…`);
    const response = await fetch(`/api/${kind}`, {method: 'PUT', body: file});
    if (!response.ok) return setStatus(await response.text());
    const url = URL.createObjectURL(file);
    if (kind === 'music') audio.src = url;
    else document.querySelector('#coverPreview').src = url;
    setStatus(`${file.name}을 저장했습니다.`);
  };
}

const waitForSync = async () => {
  while (true) {
    const response = await fetch('/api/sync-status');
    const state = await response.json();
    syncProgress.value = state.percent;
    syncLabel.textContent = `${state.phase || '분석 중'} · ${state.percent}%`;
    if (state.status === 'done') return;
    if (state.status === 'error') throw new Error(state.error || '자동 싱크에 실패했습니다.');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
};

syncButton.onclick = async () => {
  try {
    syncButton.disabled = true;
    setStatus('음성과 TXT 가사를 분석 중입니다…');
    const response = await fetch('/api/generate-srt', {method: 'POST'});
    if (!response.ok) throw new Error(await response.text());
    await waitForSync();
    const srtResponse = await fetch(`/api/captions?t=${Date.now()}`);
    if (!srtResponse.ok) throw new Error(await srtResponse.text());
    const generated = parseSrt(await srtResponse.text());
    captions.replaceChildren();
    generated.forEach(addRow);
    setStatus(`자동 생성한 자막 ${generated.length}개를 편집기에 불러왔습니다.`);
  } catch (error) {
    setStatus(error.message);
  } finally {
    syncButton.disabled = false;
  }
};

const chooseOutput = async () => {
  if (!window.showSaveFilePicker) {
    setStatus('이 브라우저에서는 위치 선택을 지원하지 않아 완성 영상 링크를 사용합니다.');
    return true;
  }
  try {
    outputHandle = await window.showSaveFilePicker({
      suggestedName: defaultOutputName(),
      types: [{description: 'MP4 영상', accept: {'video/mp4': ['.mp4']}}],
    });
    outputName.textContent = outputHandle.name;
    return true;
  } catch (error) {
    if (error.name !== 'AbortError') setStatus(error.message);
    return false;
  }
};

document.querySelector('#chooseOutput').onclick = chooseOutput;

const waitForRender = async () => {
  while (true) {
    const response = await fetch('/api/render-status');
    const state = await response.json();
    renderProgress.value = state.percent;
    renderLabel.textContent = `${state.phase || '렌더링 중'} · ${state.percent}%`;
    if (state.status === 'done') return;
    if (state.status === 'error') throw new Error(state.error || '렌더링에 실패했습니다.');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
};

renderButton.onclick = async () => {
  try {
    renderButton.disabled = true;
    renderMode.disabled = true;
    document.querySelector('#chooseOutput').disabled = true;
    const mode = renderMode.value;
    if (!outputHandle && !(await chooseOutput())) return;
    await save();
    setStatus('렌더링 중입니다. 창을 닫지 마세요…');
    const response = await fetch(`/api/render?mode=${mode}`, {method: 'POST'});
    if (!response.ok) throw new Error(await response.text());
    await waitForRender();
    if (outputHandle) {
      const videoResponse = await fetch(`/video?mode=${mode}&t=${Date.now()}`);
      if (!videoResponse.ok) throw new Error(await videoResponse.text());
      const writable = await outputHandle.createWritable();
      await writable.write(await videoResponse.blob());
      await writable.close();
    }
    setStatus(outputHandle ? `${outputHandle.name} 저장 완료.` : '렌더링 완료. 완성 영상을 열 수 있습니다.');
    document.querySelector('#video').href = `/video?mode=${mode}&t=${Date.now()}`;
  } catch (error) {
    setStatus(error.message);
  } finally {
    renderButton.disabled = false;
    renderMode.disabled = false;
    document.querySelector('#chooseOutput').disabled = false;
  }
};

fetch('/api/captions').then((response) => response.text()).then((text) => parseSrt(text).forEach(addRow)).catch(() => addRow());
fetch('/api/meta').then((response) => response.json()).then((meta) => { title.value = meta.title; artist.value = meta.artist; });
