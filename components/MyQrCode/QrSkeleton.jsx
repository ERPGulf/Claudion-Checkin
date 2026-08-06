/* eslint-disable react/prop-types */
import React from 'react';
import { View } from 'react-native';
import { RADIUS, SPACING } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import Card from '../common/Card';
import { SkeletonBlock, useSkeletonPulse } from '../common/Skeleton';
import { QR_SIZE } from './QrPlate';

/**
 * Loading placeholder shaped like the badge — the same plate footprint, the same
 * divider, the same identity row — so the card doesn't resize when the code
 * arrives.
 *
 * Replaces the classic screen's bare <ActivityIndicator> at the top of an
 * otherwise empty page. The pulse comes from the shared `useSkeletonPulse`, so
 * it breathes at the same rate as every other skeleton in the app.
 */
function QrSkeleton() {
  const { colors } = useAppTheme();
  const opacity = useSkeletonPulse();

  return (
    <Card style={{ padding: SPACING.lg, alignItems: 'center' }}>
      <View accessible accessibilityLabel="Loading your QR code">
        <SkeletonBlock
          width={QR_SIZE + SPACING.lg * 2}
          height={QR_SIZE + SPACING.lg * 2}
          radius={RADIUS.lg}
          opacity={opacity}
        />
      </View>

      <View
        style={{
          height: 1,
          alignSelf: 'stretch',
          backgroundColor: colors.dividerSubtle,
          marginVertical: SPACING.lg,
        }}
      />

      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <SkeletonBlock width={44} height={44} circle opacity={opacity} />
        <View style={{ marginStart: SPACING.md }}>
          <SkeletonBlock width={120} height={13} opacity={opacity} />
          <View style={{ height: SPACING.xs }} />
          <SkeletonBlock width={92} height={11} opacity={opacity} />
        </View>
      </View>
    </Card>
  );
}

export default QrSkeleton;
