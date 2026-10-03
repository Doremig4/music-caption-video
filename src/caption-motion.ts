import type {Caption} from '@remotion/captions';

// Keep extra rows beyond both edges so blurred text never pops into view.
export const getVisibleCaptionRange = (count: number, scrollPosition: number) => ({
  start: Math.max(0, Math.floor(scrollPosition) - 7),
  end: Math.min(count, Math.ceil(scrollPosition) + 7),
});

// Sum each cue's movement so closely spaced cues never reset an unfinished scroll.
export const getCaptionScroll = (captions: Caption[], timeMs: number) =>
  captions.slice(1).reduce((position, caption) => {
    const progress = Math.min(1, Math.max(0, (timeMs - caption.startMs) / 500));
    const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
    return position + eased;
  }, 0);
