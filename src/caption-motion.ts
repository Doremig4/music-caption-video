import type {Caption} from '@remotion/captions';

// Sum each cue's movement so closely spaced cues never reset an unfinished scroll.
export const getCaptionScroll = (captions: Caption[], timeMs: number) =>
  captions.slice(1).reduce((position, caption) => {
    const progress = Math.min(1, Math.max(0, (timeMs - caption.startMs) / 500));
    const eased = progress ** 3 * (progress * (progress * 6 - 15) + 10);
    return position + eased;
  }, 0);
