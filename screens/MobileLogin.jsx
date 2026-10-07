import React, { useCallback, useEffect, useRef } from 'react';
import { BackHandler } from 'react-native';
import { useStore } from 'react-redux';
import { useFocusEffect, useNavigation, usePreventRemove } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SPACING } from '../constants';
import useAppTheme from '../hooks/useAppTheme';
import useMobileLogin from '../hooks/useMobileLogin';
import ActionButton from '../components/common/ActionButton';
import StatusBanner from '../components/common/StatusBanner';
import AccountStep from '../components/MobileLogin/AccountStep';
import OtpStep from '../components/MobileLogin/OtpStep';
import PasswordSignInStep from '../components/MobileLogin/PasswordSignInStep';
import PasswordCreateStep from '../components/MobileLogin/PasswordCreateStep';
import { CompleteStep } from '../components/MobileLogin/AuthStepLayout';
import { MobileLoginContext } from '../components/MobileLogin/MobileLoginContext';
import { mobileLoginCopy } from '../components/MobileLogin/mobileLoginCopy';
import { isMobileAuthAvailable } from '../utils/mobileAuthCrypto';
import { selectIsLoggedIn } from '../redux/Slices/AuthSlice';

const Stack = createNativeStackNavigator();
const STEP_SCREENS = {
  MOBILE: AccountStep,
  OTP: OtpStep,
  PASSWORD_SIGN_IN: PasswordSignInStep,
  PASSWORD_CREATE: PasswordCreateStep,
  PASSWORD_OPTION: PasswordCreateStep,
  COMPLETE: CompleteStep,
};

function MobileLoginForm() {
  const navigation = useNavigation();
  // One hook owns the whole flow. Native screens receive it through context;
  // credentials never become route params or navigator state.
  const login = useMobileLogin();
  const store = useStore();
  const cancelFlowRef = useRef(login.cancelFlow);
  cancelFlowRef.current = login.cancelFlow;
  const { colors } = useAppTheme();
  const step = login.step || 'MOBILE';
  const busy = login.isLoading || login.isHydrating || step === 'COMPLETE';
  const canLeave = navigation.canGoBack?.() || false;
  const onBack = useCallback(() => {
    if (busy) return;
    if (step !== 'MOBILE') {
      login.goBack();
    } else if (canLeave) {
      login.cancelFlow();
      navigation.goBack();
    }
  }, [busy, canLeave, login, navigation, step]);

  // Protect the outer mobile-login route as well as the visible step. A native
  // back action returns through the flow without regenerating an OTP.
  usePreventRemove(busy || step !== 'MOBILE', () => {
    if (!busy) login.goBack();
  });
  useEffect(() => navigation.addListener('blur', () => {
    // A sibling push can leave this route mounted. Clear its transient flow,
    // but never invalidate the new session during the authenticated navigator
    // swap: setSignIn happens before the completion's notification fetch ends.
    if (!selectIsLoggedIn(store.getState())) cancelFlowRef.current();
  }), [navigation, store]);
  useFocusEffect(useCallback(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (busy) return true;
      if (step !== 'MOBILE') {
        login.goBack();
        return true;
      }
      login.cancelFlow();
      return false;
    });
    return () => subscription.remove();
  }, [busy, login, step]));

  const value = { login, onBack, showBack: step !== 'COMPLETE' && (step !== 'MOBILE' || canLeave), navigation };
  const Screen = STEP_SCREENS[step] || AccountStep;
  return (
    <MobileLoginContext.Provider value={value}>
      <Stack.Navigator screenOptions={{
        headerShown: false,
        gestureEnabled: false,
        animation: 'fade',
        contentStyle: { backgroundColor: colors.surfaceSecondary },
      }}>
        <Stack.Screen key={step} name={step} component={Screen} />
      </Stack.Navigator>
    </MobileLoginContext.Provider>
  );
}

export default function MobileLogin() {
  const navigation = useNavigation();
  const { colors } = useAppTheme();
  if (isMobileAuthAvailable()) return <MobileLoginForm />;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surfaceSecondary, padding: SPACING.lg }}>
      <StatusBanner tone="info" title={mobileLoginCopy('useQr')} message={mobileLoginCopy('latestBuild')} />
      <ActionButton
        label={mobileLoginCopy('scanQr')}
        icon="qr-code-outline"
        style={{ marginTop: SPACING.lg }}
        onPress={() => navigation.navigate('Qrscan')}
      />
    </SafeAreaView>
  );
}
