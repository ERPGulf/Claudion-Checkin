import React, { useRef } from 'react';
import { I18nManager, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import ActionButton from '../common/ActionButton';
import Card from '../common/Card';
import FormField from '../common/FormField';
import OrDivider from '../common/OrDivider';
import PressableScale from '../common/PressableScale';
import AuthStepLayout from './AuthStepLayout';
import { useMobileLoginFlow } from './MobileLoginContext';
import { mobileLoginCopy } from './mobileLoginCopy';

function CompanySelection({ onNext }) {
  const { login } = useMobileLoginFlow();
  const { colors } = useAppTheme();
  const busy = login.isLoading || login.isHydrating;
  const discovery = login.discovery === 'server' ? 'server' : 'company';
  const align = I18nManager.isRTL ? 'right' : 'left';
  if (login.backendUrl) {
    return (
      <Card padded>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons name="business-outline" size={ICON.md} color={colors.primary2} style={{ marginEnd: SPACING.md }} />
          <View style={{ flex: 1 }}>
            <Text style={{ ...TYPO.headline, color: colors.textPrimary, textAlign: align }}>{mobileLoginCopy('selectedCompany')}</Text>
            <Text numberOfLines={1} style={{ ...TYPO.caption, color: colors.textMuted, marginTop: SPACING.xs, textAlign: align }}>{login.backendUrl}</Text>
          </View>
          <PressableScale
            accessibilityLabel={mobileLoginCopy('changeCompany')}
            disabled={busy}
            accessibilityState={{ disabled: busy }}
            onPress={login.changeCompany}
            style={{ minHeight: 44, justifyContent: 'center', paddingStart: SPACING.md }}
          >
            <Text style={{ ...TYPO.headline, color: busy ? colors.textMuted : colors.accentText }}>{mobileLoginCopy('change')}</Text>
          </PressableScale>
        </View>
      </Card>
    );
  }

  return (
    <View style={{ gap: SPACING.md }}>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', padding: SPACING.xs, borderRadius: RADIUS.md, backgroundColor: colors.iconBackground }}>
        {['company', 'server'].map(mode => {
          const selected = discovery === mode;
          return (
            <PressableScale
              key={mode}
              accessibilityRole="tab"
              accessibilityLabel={mobileLoginCopy(mode === 'company' ? 'useCompanyCode' : 'useServerAddress')}
              accessibilityState={{ selected, disabled: busy }}
              disabled={busy}
              hitSlop={0}
              onPress={() => login.setDiscovery(mode)}
              style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS.sm, backgroundColor: selected ? colors.cardBackground : colors.iconBackground }}
            >
              <Text style={{ ...TYPO.subhead, color: selected ? colors.textPrimary : colors.textSecondary }}>{mobileLoginCopy(mode === 'company' ? 'companyCode' : 'serverAddress')}</Text>
            </PressableScale>
          );
        })}
      </View>
      <FormField
        accessibilityLabel={mobileLoginCopy(discovery === 'server' ? 'serverAddress' : 'companyCode')}
        icon={discovery === 'server' ? 'globe-outline' : 'business-outline'}
        placeholder={discovery === 'server' ? 'erp.yourcompany.com' : mobileLoginCopy('companyPlaceholder')}
        value={discovery === 'server' ? login.serverAddress : login.companyCode}
        onChangeText={discovery === 'server' ? login.setServerAddress : login.setCompanyCode}
        errorText={discovery === 'server' ? login.serverAddressError : login.companyCodeError}
        disabled={busy}
        keyboardType={discovery === 'server' ? 'url' : 'default'}
        textContentType={discovery === 'server' ? 'URL' : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        returnKeyType="next"
        submitBehavior="submit"
        onSubmitEditing={onNext}
        align={align}
      />
    </View>
  );
}

export default function AccountStep() {
  const { login, navigation } = useMobileLoginFlow();
  const busy = login.isLoading || login.isHydrating;
  const mobileRef = useRef(null);
  const submit = () => { if (!busy) login.begin(); };
  const subtitle = login.backendUrl ? 'mobileSubtitle' : login.discovery === 'server' ? 'serverSubtitle' : 'companySubtitle';
  return (
    <AuthStepLayout title={mobileLoginCopy('mobileTitle')} subtitle={mobileLoginCopy(subtitle)}>
      <CompanySelection onNext={() => mobileRef.current?.focus()} />
      <FormField
        ref={mobileRef}
        label={mobileLoginCopy('mobileNumber')}
        icon="call-outline"
        placeholder={mobileLoginCopy('mobilePlaceholder')}
        value={login.mobileNumber}
        onChangeText={login.setMobileNumber}
        errorText={login.mobileNumberError}
        keyboardType="phone-pad"
        textContentType="telephoneNumber"
        autoComplete="tel"
        autoCapitalize="none"
        disabled={busy}
        returnKeyType="go"
        onSubmitEditing={submit}
        align={I18nManager.isRTL ? 'right' : 'left'}
      />
      <ActionButton label={mobileLoginCopy('continue')} icon={I18nManager.isRTL ? 'arrow-back' : 'arrow-forward'} variant="accent" size="lg" loading={login.isLoading} disabled={busy} onPress={login.begin} />
      <OrDivider label={mobileLoginCopy('or')} />
      <ActionButton
        label={mobileLoginCopy('scanQr')}
        icon="qr-code-outline"
        variant="outline"
        size="lg"
        disabled={busy}
        onPress={() => {
          login.cancelFlow();
          navigation.navigate('Qrscan');
        }}
      />
    </AuthStepLayout>
  );
}
