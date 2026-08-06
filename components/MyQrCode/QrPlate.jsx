/* eslint-disable react/prop-types */
import React, { memo } from 'react';
import { Image, View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';

/**
 * Size of the code itself. Large enough to scan off a phone screen held at
 * arm's length, and it still leaves the quiet zone below inside a 360dp page.
 */
export const QR_SIZE = 220;

/** The white margin a scanner needs around the code. */
const QUIET_ZONE = SPACING.lg;

/**
 * The QR code on its own white plate.
 *
 * The plate is `#FFFFFF` in both palettes and is the one deliberate exception to
 * the theme tokens on this screen. The server returns a black-on-white PNG, and
 * some encoders return it with a transparent background — either way, drawing it
 * straight onto a dark card would put black modules on a near-black surface and
 * make the code unscannable. The quiet zone is padding on this plate rather than
 * anything drawn over the image, so nothing about the code is inverted, tinted
 * or cropped.
 *
 * `resizeMode="contain"` and the fixed 220pt box are the classic screen's, so
 * the rendered pixels are unchanged. Memoised on the uri: the badge card
 * re-renders when the theme or the name changes, and re-decoding the image for
 * that would flash the one thing the user came here to show.
 */
function QrPlate({ uri, employee }) {
  return (
    <View
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: RADIUS.lg,
        padding: QUIET_ZONE,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Image
        source={{ uri }}
        style={{ width: QR_SIZE, height: QR_SIZE }}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel={
          employee
            ? `QR code for employee ${employee}`
            : 'Your employee QR code'
        }
      />
    </View>
  );
}

export default memo(QrPlate);
