/* eslint-disable react/prop-types */
import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { SPACING } from '../constants';
import useAppTheme from '../hooks/useAppTheme';
import { useRouteEnabled } from '../hooks/useFeatureSettings';
import Card from '../components/common/Card';
import EmptyState from '../components/common/EmptyState';

/**
 * The screen a disabled feature shows instead of itself.
 *
 * A fallback rather than an automatic `goBack()`: bouncing the user out during
 * the first render races the navigator's own transition and, on a deep link or a
 * notification tap that lands here directly, would drop them somewhere with no
 * explanation. A page that says what happened and offers the way back is both
 * safer and more honest.
 *
 * Worded as availability, not as a permission failure — the employee has not
 * done anything wrong, an administrator has turned the feature off.
 */
function FeatureUnavailable({ onGoBack, canGoBack }) {
  const { colors } = useAppTheme();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={['bottom', 'left', 'right']}
    >
      <View style={{ flex: 1, justifyContent: 'center', padding: SPACING.lg }}>
        <Card>
          <EmptyState
            icon="lock-closed-outline"
            title="Not available"
            description="Your administrator has turned this feature off for your account. Contact your HR administrator if you think this is a mistake."
            actionLabel={canGoBack ? 'Go back' : undefined}
            onActionPress={canGoBack ? onGoBack : undefined}
          />
        </Card>
      </View>
    </SafeAreaView>
  );
}

/**
 * Wraps a screen so it can only render while its feature is enabled.
 *
 * Hiding the entry points is what an employee normally experiences; this is what
 * makes it real. A route can still be reached by a pinned shortcut stored before
 * the flag changed, a notification tap, a deep link, or a `navigate()` from code
 * that has not been updated — so the check lives on the screen itself, which is
 * the one place every one of those paths must pass through.
 *
 * The route stays registered in the navigator either way. Unregistering it would
 * make `navigate('Loan application')` a no-op that fails silently and would
 * break the pinned-shortcut and deep-link paths in a way nobody could diagnose;
 * far better that the route exists and answers for itself.
 *
 * The wrapped screen is not mounted at all while disabled, so its focus effects
 * and network calls never run.
 *
 * Usage in navigation/app-navigator.jsx:
 *
 *     component={withFeatureGate('Loan application', LoanApplication)}
 *
 * The feature that governs a route comes from `ROUTE_FEATURES` in
 * utils/featureSettings.js, so route → flag is declared once.
 */
export default function withFeatureGate(routeName, ScreenComponent) {
  function FeatureGatedScreen(props) {
    const navigation = useNavigation();
    const enabled = useRouteEnabled(routeName);

    if (!enabled) {
      return (
        <FeatureUnavailable
          canGoBack={navigation.canGoBack()}
          onGoBack={() => navigation.goBack()}
        />
      );
    }

    return <ScreenComponent {...props} />;
  }

  FeatureGatedScreen.displayName = `FeatureGated(${
    ScreenComponent?.displayName || ScreenComponent?.name || routeName
  })`;

  return FeatureGatedScreen;
}

export { FeatureUnavailable };
