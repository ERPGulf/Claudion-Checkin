/* eslint-disable react/prop-types */
import React from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { RADIUS, SPACING, TYPO } from '../../constants';
import { useSkeletonPulse } from '../common/Skeleton';

/** Frame edge as a share of the viewport, and the cap on a tablet. */
const FRAME_RATIO = 0.72;
const FRAME_MAX = 300;

/** Corner bracket: arm length and stroke. */
const ARM = 34;
const STROKE = 4;

/**
 * How the mask splits above and below the frame. Only slightly bottom-heavy: the
 * window lands a touch above the centre of the preview, which is where a phone
 * held at scanning angle points, and leaves room for the hint underneath. The
 * action sheet already occupies the bottom of the screen, so weighting this any
 * harder just opens a band of dead mask between the hint and the sheet.
 */
const ABOVE = 1;
const BELOW = 1.1;

const MASK = 'rgba(0,0,0,0.55)';
const FRAME_HAIRLINE = 'rgba(255,255,255,0.32)';

/**
 * The scanner overlay: a dark mask with a clear rounded window, four breathing
 * corner brackets, and the alignment hint.
 *
 * The mask is four panels laid out around the window rather than one sheet with a
 * hole punched in it — React Native cannot subtract a shape from a view without a
 * masking library, and this is how every scanner in the wild does it. The window
 * is simply the gap the panels leave, so the live preview inside it is completely
 * untouched: nothing is drawn over the area the decoder reads.
 *
 * `pointerEvents="none"` throughout. The overlay sits on top of <CameraView>, and
 * anything that swallowed touches here would break the sheet below it.
 *
 * Deliberately theme-independent. The backdrop is a live camera feed — unknown,
 * usually dark, and identical in light and dark mode — so the chrome over it is
 * fixed light-on-dark in both palettes, the same exception <QrPlate> makes for the
 * white QR plate. Themed tokens would make the mask lighter than the picture
 * behind it in one mode and the frame invisible in the other. The screen's real
 * surfaces — the action sheet, the permission and loading states — are fully
 * themed.
 */
function ScanOverlay({ hint = 'Align the QR code inside the frame.' }) {
  const { width } = useWindowDimensions();
  const size = Math.min(Math.round(width * FRAME_RATIO), FRAME_MAX);

  // The app's one pulse primitive, shared with every skeleton, so the corners
  // breathe on the same curve as the rest of the app instead of a private timing.
  const pulse = useSkeletonPulse();

  /** One L-bracket. `corner` picks which two edges get the stroke. */
  const bracket = corner => {
    const top = corner.startsWith('top');
    const left = corner.endsWith('left');

    return (
      <Animated.View
        key={corner}
        style={{
          position: 'absolute',
          width: ARM,
          height: ARM,
          top: top ? 0 : undefined,
          bottom: top ? undefined : 0,
          // Physical left/right, not start/end: a symmetric decoration must not
          // mirror itself under RTL.
          left: left ? 0 : undefined,
          right: left ? undefined : 0,
          borderColor: '#FFFFFF',
          opacity: pulse,
          ...(top
            ? { borderTopWidth: STROKE }
            : { borderBottomWidth: STROKE }),
          ...(left
            ? { borderLeftWidth: STROKE }
            : { borderRightWidth: STROKE }),
          // Only the outer corner is rounded, so the bracket follows the frame.
          [`border${top ? 'Top' : 'Bottom'}${left ? 'Left' : 'Right'}Radius`]:
            RADIUS.xl,
        }}
      />
    );
  };

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* ---------- Above ---------- */}
      <View style={{ flex: ABOVE, backgroundColor: MASK }} />

      {/* ---------- Window row ---------- */}
      <View style={{ flexDirection: 'row', height: size }}>
        <View style={{ flex: 1, backgroundColor: MASK }} />

        <View
          style={{ width: size, height: size }}
          accessible
          accessibilityRole="image"
          accessibilityLabel={hint}
        >
          {/* A hairline so the window still reads as a frame where the picture
              behind it happens to be dark. */}
          <View
            style={{
              ...StyleSheet.absoluteFillObject,
              borderWidth: 1,
              borderColor: FRAME_HAIRLINE,
              borderRadius: RADIUS.xl,
            }}
          />

          {['top-left', 'top-right', 'bottom-left', 'bottom-right'].map(
            bracket,
          )}
        </View>

        <View style={{ flex: 1, backgroundColor: MASK }} />
      </View>

      {/* ---------- Below + hint ---------- */}
      <View
        style={{
          flex: BELOW,
          backgroundColor: MASK,
          alignItems: 'center',
          paddingTop: SPACING.xl,
          paddingHorizontal: SPACING.xxl,
        }}
      >
        <Text
          style={{
            ...TYPO.body,
            color: '#FFFFFF',
            textAlign: 'center',
          }}
        >
          {hint}
        </Text>
      </View>
    </View>
  );
}

export default ScanOverlay;
