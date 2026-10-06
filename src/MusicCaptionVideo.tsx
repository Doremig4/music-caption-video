import '@fontsource-variable/noto-sans-kr';
import type {Caption} from '@remotion/captions';
import {Audio} from '@remotion/media';
import {
  AbsoluteFill,
  Img,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {getCaptionScroll, getVisibleCaptionRange} from './caption-motion';

export type MusicCaptionProps = {captions: Caption[]; title: string; artist: string; backgroundOpacity?: number; backgroundImage?: string};

export const MusicCaptionVideo = ({captions, title, artist, backgroundOpacity = 0.42, backgroundImage}: MusicCaptionProps) => {
  const frame = useCurrentFrame();
  const {durationInFrames, fps} = useVideoConfig();
  const timeMs = (frame / fps) * 1000;
  const scrollPosition = getCaptionScroll(captions, timeMs);
  const visible = getVisibleCaptionRange(captions.length, scrollPosition);

  return (
    <AbsoluteFill style={{backgroundColor: '#090909', overflow: 'hidden'}}>
      <Img
        src={backgroundImage ?? staticFile('cover.jpg')}
        style={{
          height: '100%',
          objectFit: 'cover',
          filter: backgroundImage ? undefined : 'blur(30px)',
          opacity: backgroundOpacity,
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
        {captions.slice(visible.start, visible.end).map((caption, offset) => {
          const index = visible.start + offset;
          const rowY = (index - scrollPosition) * 108;
          const distance = Math.abs(rowY / 108);
          const focus = Math.max(0, 1 - distance);
          return (
            <div
              key={`${caption.startMs}-${index}`}
              style={{
                alignItems: 'center',
                backgroundColor: 'transparent',
                color: 'white',
                display: 'flex',
                fontFamily: 'Noto Sans KR Variable, sans-serif',
                fontSize: 44,
                filter: `blur(${interpolate(distance, [2, 3, 4, 5], [0, 3, 6, 9], {
                  extrapolateLeft: 'clamp',
                  extrapolateRight: 'clamp',
                })}px)`,
                fontWeight: interpolate(focus, [0, 1], [420, 650]),
                height: 108,
                justifyContent: 'center',
                left: 0,
                letterSpacing: '-0.025em',
                opacity: interpolate(focus, [0, 1], [0.72, 1]),
                padding: '0 52px',
                position: 'absolute',
                right: 0,
                textAlign: 'center',
                top: 540,
                translate: `0 ${rowY}px`,
                whiteSpace: 'pre-line',
              }}
            >
              {caption.text.trim()}
            </div>
          );
        })}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
