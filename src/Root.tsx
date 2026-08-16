import type {CalculateMetadataFunction} from 'remotion';
import {Composition, staticFile} from 'remotion';
import {parseSrt} from '@remotion/captions';
import {ALL_FORMATS, Input, UrlSource} from 'mediabunny';
import {MusicCaptionVideo, type MusicCaptionProps} from './MusicCaptionVideo';

const FPS = 60;

const loadInput = async (path: string, label: string) => {
  const response = await fetch(staticFile(path));
  if (!response.ok) {
    throw new Error(`${label} 파일이 없습니다: public/${path}`);
  }
  return response;
};

const calculateMetadata: CalculateMetadataFunction<MusicCaptionProps> = async () => {
  const [srtResponse, metaResponse] = await Promise.all([
    loadInput('lyrics.srt', '자막'),
    loadInput('meta.json', '곡 정보'),
    loadInput('cover.jpg', '배경 이미지'),
    loadInput('music.mp3', '음악'),
  ]);

  const {captions} = parseSrt({input: await srtResponse.text()});
  if (captions.length === 0) {
    throw new Error('lyrics.srt에 유효한 자막이 없습니다.');
  }

  const input = new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(staticFile('music.mp3'), {getRetryDelay: () => null}),
  });
  const durationInSeconds = await input.computeDuration();
  if (!Number.isFinite(durationInSeconds) || durationInSeconds <= 0) {
    throw new Error('music.mp3의 재생 시간을 읽을 수 없습니다.');
  }

  const lastCaptionEnd = Math.max(...captions.map((caption) => caption.endMs));
  if (lastCaptionEnd > durationInSeconds * 1000 + 100) {
    throw new Error(
      `마지막 자막(${(lastCaptionEnd / 1000).toFixed(2)}초)이 음악(${durationInSeconds.toFixed(2)}초)보다 늦게 끝납니다.`,
    );
  }

  return {
    durationInFrames: Math.ceil(durationInSeconds * FPS),
    props: {captions, ...(await metaResponse.json())},
    defaultOutName: 'music-video.mp4',
    defaultCodec: 'h264',
  };
};

export const Root = () => (
  <Composition
    id="MusicCaption"
    component={MusicCaptionVideo}
    width={1920}
    height={1080}
    fps={FPS}
    durationInFrames={FPS}
    defaultProps={{captions: [], title: '곡 제목', artist: '아티스트'}}
    calculateMetadata={calculateMetadata}
  />
);
