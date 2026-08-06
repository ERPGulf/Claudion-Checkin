/* eslint-disable react/prop-types */
import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useModernScreenHeader from '../../hooks/useModernScreenHeader';
import Card from '../common/Card';
import EmptyState from '../common/EmptyState';
import StatusBadge from '../common/StatusBadge';
import PressableScale from '../common/PressableScale';
import ModuleCard from '../common/ModuleCard';
import DetailRow, { DetailDivider } from './DetailRow';
import DetailSkeleton from './DetailSkeleton';
import ValidityBar from './ValidityBar';
import {
  buildDetailModel,
  describeDocumentStatus,
  describeRemaining,
  resolveValidityWindow,
} from '../../utils/shortcutDetails';

/**
 * The Modern UI for every document detail screen.
 *
 * One component, three routes, and as many documents as the tenant configures:
 * Shortcut 1/2/3 each return `{ shortcut, data }` where the title is a
 * server-side name — "Health Card", "Residence Permit", "Passport", "Labour
 * Card" — and `data` is an arbitrary flat object. Redesigning this file
 * redesigns all of them at once, which is why nothing below is written for a
 * particular document.
 *
 * Props are unchanged (`title`, `data`, `loading`) and no API, navigation call
 * or field mapping is touched — the rows are the server's keys, in the server's
 * order, filtered by the same null/undefined rule the classic component uses.
 * All this file does differently is decide how a field *looks*: see
 * utils/shortcutDetails.js, which is where every inference lives and is unit
 * tested on its own.
 *
 * Layout is a wallet-style detail page rather than a table:
 *
 *   ┌ hero ─────────────────────────┐   name, "valid until …", status badge
 *   ┌ countdown ────────────────────┐   the remaining-days figure, if any
 *   ┌ "Document information" card ──┐   every other field, one row each
 *     · footer                          muted ERPGulf link
 */
function ShortcutDetailsModern({ title, data, loading }) {
  const { colors } = useAppTheme();
  useModernScreenHeader(title || 'Details');

  const { status, remaining, rows, subtitle, expiryValue } = useMemo(
    () => buildDetailModel(data, title),
    [data, title],
  );

  // Only a real span produces a fraction; without an issue date this stays null
  // and <ValidityBar> draws its neutral rule instead of a made-up percentage.
  const validity = useMemo(
    () => (remaining ? resolveValidityWindow(data, remaining.value) : null),
    [data, remaining],
  );

  // One fade as the content arrives, so the swap from skeleton to card doesn't
  // pop. Declared before the early returns to keep hook order stable.
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (loading) return;
    Animated.timing(enter, {
      toValue: 1,
      duration: 240,
      useNativeDriver: true,
    }).start();
  }, [loading, enter]);

  const page = { flex: 1, backgroundColor: colors.surfaceSecondary };

  /* ---------- Loading ---------- */
  if (loading) {
    return (
      <SafeAreaView style={page} edges={['bottom', 'left', 'right']}>
        <View style={{ padding: SPACING.lg }}>
          <DetailSkeleton />
        </View>
      </SafeAreaView>
    );
  }

  /* ---------- Empty ---------- */
  // The same test the classic component makes: a payload of nothing but nulls
  // and blanks is "no records", not a document with empty fields.
  const hasValidData =
    data &&
    Object.values(data).some(v => v !== null && v !== undefined && v !== '');

  if (!hasValidData) {
    return (
      <SafeAreaView style={page} edges={['bottom', 'left', 'right']}>
        <View style={{ padding: SPACING.lg }}>
          <Card>
            <EmptyState
              icon="document-text-outline"
              title="No records available"
              description={`There's nothing on file for ${
                title || 'this document'
              } yet. It will appear here once your administrator adds it.`}
            />
          </Card>
        </View>
      </SafeAreaView>
    );
  }

  const statusTone = status ? describeDocumentStatus(status.value) : null;
  const countdown = remaining ? describeRemaining(remaining.value) : null;

  return (
    <SafeAreaView style={page} edges={['bottom', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={{
          padding: SPACING.lg,
          paddingBottom: SPACING.xxxl,
        }}
      >
        <Animated.View
          style={{
            opacity: enter,
            transform: [
              {
                translateY: enter.interpolate({
                  inputRange: [0, 1],
                  outputRange: [8, 0],
                }),
              },
            ],
          }}
        >
          {/* ---------- Hero ---------- */}
          {/* The document says what it is once, prominently, instead of the
              screen opening straight into a table whose title is only in the
              navigation bar. */}
          <Card style={{ padding: SPACING.lg, marginBottom: SPACING.md }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: RADIUS.md,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.accentSurface,
                  borderWidth: 1,
                  borderColor: colors.accentBorder,
                }}
              >
                <Ionicons
                  name="id-card-outline"
                  size={ICON.lg}
                  color={colors.accentText}
                />
              </View>

              <View
                style={{ flex: 1, minWidth: 0, marginStart: SPACING.md }}
              >
                <Text
                  accessibilityRole="header"
                  style={{ ...TYPO.title3, color: colors.textPrimary }}
                >
                  {title || 'Document'}
                </Text>
                {!!subtitle && (
                  <Text
                    style={{
                      ...TYPO.subhead,
                      fontWeight: '400',
                      color: colors.textSecondary,
                      marginTop: 2,
                    }}
                  >
                    {subtitle}
                  </Text>
                )}
              </View>
            </View>

            {/* The status field, promoted out of the table and rendered as a
                tone-driven badge — the same pill Automatic Attendance and
                Expense Claims use, so "Approved" is one green everywhere. */}
            {!!statusTone && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  marginTop: SPACING.md,
                  paddingTop: SPACING.md,
                  borderTopWidth: 1,
                  borderTopColor: colors.dividerSubtle,
                }}
              >
                <Text
                  style={{
                    ...TYPO.subhead,
                    fontWeight: '400',
                    color: colors.textSecondary,
                    flex: 1,
                  }}
                >
                  {status.label}
                </Text>

                <StatusBadge
                  tone={statusTone.tone}
                  icon={statusTone.icon}
                  label={statusTone.label}
                />
              </View>
            )}
          </Card>

          {/* ---------- Countdown ---------- */}
          {/* Only when the server sent a countdown field, and only tinted when
              its number could actually be read. The figure is always the
              server's own — the tone is the only thing decided here. */}
          {!!countdown && countdown.days !== null && (
            <Card
              accessible
              accessibilityLabel={`${remaining.label}, ${countdown.days} days, ${countdown.caption}`}
              style={{
                padding: SPACING.lg,
                marginBottom: SPACING.md,
                backgroundColor: colors[`${countdown.tone}Surface`],
                borderColor: colors[`${countdown.tone}Border`],
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text
                    style={{
                      ...TYPO.caption,
                      color: colors.textSecondary,
                      textTransform: 'uppercase',
                      letterSpacing: 0.4,
                    }}
                  >
                    {remaining.label}
                  </Text>

                  {/* The one number worth reading from across the room. */}
                  <Text
                    style={{
                      ...TYPO.title1,
                      color: colors[`${countdown.tone}Text`],
                      fontVariant: ['tabular-nums'],
                      marginTop: 2,
                    }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {countdown.days} {Math.abs(countdown.days) === 1 ? 'day' : 'days'}
                  </Text>
                </View>

                <StatusBadge
                  tone={countdown.tone}
                  label={countdown.caption}
                  icon={
                    countdown.tone === 'success'
                      ? 'checkmark-circle'
                      : countdown.tone === 'warning'
                        ? 'alert-circle'
                        : 'close-circle'
                  }
                />
              </View>

              {/* Proportional when the payload had both an issue and an expiry
                  date to measure between; a flat neutral rule otherwise. */}
              <ValidityBar
                tone={countdown.tone}
                fraction={validity ? validity.fraction : null}
              />

              {/* The date the countdown is counting to. Only rendered when the
                  server sent one — never back-calculated from the day count. */}
              {!!expiryValue && (
                <View style={{ marginTop: SPACING.md }}>
                  <Text
                    style={{
                      ...TYPO.caption,
                      color: colors.textSecondary,
                    }}
                  >
                    Valid until
                  </Text>
                  <Text
                    style={{
                      ...TYPO.headline,
                      color: colors.textPrimary,
                      marginTop: 1,
                    }}
                  >
                    {expiryValue}
                  </Text>
                </View>
              )}
            </Card>
          )}

          {/* ---------- Everything else ---------- */}
          {rows.length > 0 && (
            <ModuleCard
              icon="document-text-outline"
              title="Document information"
              subtitle={`${rows.length} ${rows.length === 1 ? 'field' : 'fields'}`}
            >
              {/* Negative inset so the rows reach the card's own edges and
                  their dividers can run the full width, while ModuleCard keeps
                  its 12pt body padding for every other screen. */}
              <View
                style={{
                  marginHorizontal: -SPACING.md,
                  marginTop: -SPACING.xs,
                  marginBottom: SPACING.xs,
                }}
              >
                {rows.map((row, index) => (
                  <View key={row.key}>
                    {index > 0 && <DetailDivider />}
                    <DetailRow
                      icon={row.icon}
                      label={row.label}
                      value={row.value}
                    />
                  </View>
                ))}
              </View>
            </ModuleCard>
          )}

          {/* ---------- Footer ---------- */}
          {/* Muted and centred under the content rather than a bright green
              link floating off the right edge behind its own rule. */}
          <PressableScale
            onPress={() => Linking.openURL('https://erpgulf.com')}
            accessibilityRole="link"
            accessibilityLabel="Open erpgulf.com"
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              alignSelf: 'center',
              minHeight: 44,
              paddingHorizontal: SPACING.md,
              marginTop: SPACING.lg,
            }}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={ICON.sm}
              color={colors.textMuted}
            />
            <Text
              style={{
                ...TYPO.caption,
                color: colors.textMuted,
                marginStart: SPACING.xs + 2,
              }}
            >
              Powered by ERPGulf.com
            </Text>
          </PressableScale>
        </Animated.View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default ShortcutDetailsModern;
