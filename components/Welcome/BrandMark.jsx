/* eslint-disable react/prop-types */
import React, { memo } from 'react';
import { Image } from 'expo-image';
import useAppTheme from '../../hooks/useAppTheme';
import lightWordmark from '../../assets/claudion-wordmark-light.png';
import darkWordmark from '../../assets/claudion-wordmark-dark.png';

/** Upper bound on the mark's width. The screen scales down from here. */
export const BRAND_MARK_MAX_WIDTH = 330;

/**
 * The mark's own light — the colour anything glowing behind the wordmark should
 * be. Sampled from the artwork, not picked: the lockup is deep teal ink (#003030)
 * with a mint swoosh, and this is the brightest saturated pixel of that swoosh.
 *
 * It exists because the glow behind the logo used to be the brand orange, the
 * palette's only brand hue. Orange is the wordmark's near-complement, so at any
 * alpha that made it visible it read as a peach stain sitting behind a teal
 * lockup rather than as light coming off it — nothing in the mark could have cast
 * that colour. The mark's own mint can, which is the whole difference.
 *
 * The deep teal is not the alternative: at glow alphas it desaturates to a cool
 * grey against either page and reads as dirt on the background.
 *
 * Theme-independent on purpose. Both wordmark variants carry the same swoosh —
 * only the ink changes between them — so the glow does not change either.
 */
export const BRAND_MARK_GLOW = '#1DE9B9';

/**
 * Aspect ratio of both wordmark files (3081 × 763). Height is derived from this,
 * so the lockup is never stretched or letterboxed at any width.
 */
export const WORDMARK_ASPECT = 3081 / 763;

/**
 * The Claudion wordmark — the screen's hero.
 *
 * **No card, in either theme.** The brand ships two proper variants, so the mark
 * can sit straight on the page and the white slab is gone for good:
 *
 *   theme | asset                          | ink       | vs its page
 *   light | claudion-wordmark-light.png    | #003030   | 13.14 : 1
 *   dark  | claudion-wordmark-dark.png     | #F0F0F0   | 17.26 : 1
 *
 * That is the whole reason this component no longer needs a plate. The single
 * two-tone asset it used before had one dark wordmark for both themes, which
 * measured 1.43:1 against the dark page — unreadable — so dark mode had to prop
 * it up with a light panel. A variant with white ink removes the problem at the
 * source rather than working around it.
 *
 * Both files are cropped from `LOGOLIGHT.png` / `LOGODARK.png` to the **union** of
 * the two inks, not to each one's own bounds, so they are byte-for-byte the same
 * dimensions with the mark in the same place. Cropped independently, the tiny
 * difference in their ink extents would make the logo jump size or position the
 * moment the theme flipped. Nothing else about either mark is altered — no tint,
 * no recolour, no crop into the artwork.
 */
function BrandMark({ width = BRAND_MARK_MAX_WIDTH }) {
  const { isDark } = useAppTheme();

  return (
    <Image
      cachePolicy="memory-disk"
      source={isDark ? darkWordmark : lightWordmark}
      contentFit="contain"
      style={{ width, height: width / WORDMARK_ASPECT }}
      accessible
      accessibilityRole="image"
      accessibilityLabel="Claudion"
    />
  );
}

export default memo(BrandMark);
