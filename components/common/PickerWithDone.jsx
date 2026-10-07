/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';

/**
 * A native picker and, on iOS only, the Done that dismisses it.
 *
 * Android's picker is a modal dialog that closes itself, so it needs nothing
 * here. iOS renders an inline spinner that stays put and reports every tick of
 * the wheel — the screen used to close on the first of those, which snatched the
 * picker away the instant it was touched and committed whichever value was under
 * the finger. The spinner now stays open and this is how it is closed.
 */
function PickerWithDone({ needsDone, onDone, children }) {
  const { colors } = useAppTheme();

  if (!needsDone) return children;

  return (
    <View>
      {children}

      <PressableScale
        onPress={onDone}
        accessibilityRole="button"
        accessibilityLabel="Done"
        hitSlop={8}
        style={{
          alignSelf: 'flex-end',
          paddingHorizontal: SPACING.md,
          paddingVertical: SPACING.xs + 2,
          minHeight: 44,
          justifyContent: 'center',
        }}
      >
        <Text
          style={{ ...TYPO.body, fontWeight: '600', color: colors.primary2 }}
        >
          Done
        </Text>
      </PressableScale>
    </View>
  );
}

export default PickerWithDone;
