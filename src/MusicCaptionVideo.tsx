import '@fontsource-variable/noto-sans-kr';
import type {Caption} from '@remotion/captions';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill,
  Easing,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

export type MusicCaptionProps = {captions: Caption[]; title: string; artist: string};

export const MusicCaptionVideo = ({captions, title, artist}: MusicCaptionProps) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const timeMs = (frame / fps) * 1000;
  const currentIndex = captions.reduce(
    (found, caption, index) => caption.startMs <= timeMs && caption.startMs > (captions[found]?.startMs ?? -1) ? index : found,
    -1,
  );
  const activeIndex = Math.max(0, currentIndex);
  const active = captions[activeIndex];
  const activeStart = (active?.startMs ?? 0) / 1000 * fps;
  const previousIndex = activeIndex === 0 ? -1 : activeIndex - 1;
  const scrollIndex = interpolate(frame, [activeStart, activeStart + 12], [previousIndex, activeIndex], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });

  return (
    <AbsoluteFill style={{backgroundColor: '#090909', overflow: 'hidden'}}>
      <Img
        src={staticFile('cover.jpg')}
        style={{
          height: '100%',
          objectFit: 'cover',
          filter: 'blur(30px)',
          opacity: 0.42,
          scale: interpolate(frame, [0, durationInFrames], [1.12, 1.18], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          }),
          width: '100%',
        }}
      />
      <AbsoluteFill style={{backgroundColor: 'rgba(20, 20, 22, 0.38)'}} />
      <Audio src={staticFile('music.mp3')} />
      <AbsoluteFill style={{width: '52%', padding: '126px 86px 90px 126px'}}>
        <div style={{fontFamily: 'Noto Sans KR Variable, sans-serif', color: 'white', marginBottom: 30}}>
          <div style={{fontSize: 36, fontWeight: 400, opacity: 0.78}}>{artist}</div>
          <div style={{fontSize: 54, fontWeight: 750, letterSpacing: '-0.035em'}}>{title}</div>
        </div>
        <Img src={staticFile('cover.jpg')} style={{width: 670, height: 670, objectFit: 'cover', borderRadius: 18, boxShadow: '0 18px 55px rgba(0,0,0,.28)'}} />
      </AbsoluteFill>
      <AbsoluteFill style={{left: '52%', width: '43%', backgroundColor: 'rgba(12, 12, 14, 0.55)', overflow: 'hidden'}}>
        <div style={{position: 'absolute', left: 0, right: 0, top: 540, height: 108, backgroundColor: 'rgba(5, 5, 8, 0.68)'}} />
        <div style={{position: 'absolute', left: 0, right: 0, top: 540, translate: `0 ${-scrollIndex * 108}px`}}>
          {captions.map((caption, index) => (
            <div
              key={`${caption.startMs}-${index}`}
              style={{
                alignItems: 'center',
                backgroundColor: 'transparent',
                color: 'white',
                display: 'flex',
                filter: `blur(${Math.min(12, Math.max(0, Math.abs(index - scrollIndex) - 2) * 3)}px)`,
                fontFamily: 'Noto Sans KR Variable, sans-serif',
                fontSize: 44,
                fontWeight: index === currentIndex ? 650 : 420,
                height: 108,
                justifyContent: 'center',
                letterSpacing: '-0.025em',
                opacity: index === currentIndex ? 1 : 0.72,
                padding: '0 52px',
                textAlign: 'center',
                whiteSpace: 'pre-line',
              }}
            >
              {caption.text.trim()}
            </div>
          ))}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
