import Text from '../../localization/LocalizedText';
import { t, useTranslation } from "../../localization";
import React from "react";
import { FlatList, View } from "react-native";
import { SPACING, TYPO } from "../../constants";
import useAppTheme from "../../hooks/useAppTheme";
import useAttendanceRecovery from "../../hooks/useAttendanceRecovery";
import { blockedByEarlierAttendance, canVerifyRecoveryRow, describeAutomaticRecoveryEvent, describeRecoveryRow, summarizeRecoveryRows } from "../../utils/attendanceRecovery";
import { formatLogDate, formatLogTime, parseLogTime } from "../../utils/attendanceHistory";
import ActionButton from "../common/ActionButton";
import BottomSheet from "../common/BottomSheet";
import Card from "../common/Card";
import SectionHeader from "../common/SectionHeader";

export function RecoveryRecord({ row, onVerify, disabled, checking, context }) {
  useTranslation();
  const { colors } = useAppTheme();
  const result = describeRecoveryRow(row, context);
  const date = parseLogTime(row.timestamp);
  return (
    <View style={{ paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
      <Text style={{ ...TYPO.headline, color: colors.textPrimary }}>{row.action === "checkout" ? t("Check-out") : t("Check-in")}</Text>
      <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>{formatLogDate(date)} · {formatLogTime(date)}</Text>
      <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>{t('Worker: {{employee}} · Record #{{record}}', { employee: row.employeeId, record: row.id })}</Text>
      <Text style={{ ...TYPO.headline, color: colors[`${result.tone}Text`], marginTop: SPACING.sm }}>{result.label}</Text>
      <Text style={{ ...TYPO.body, color: colors.textSecondary }}>{result.explanation}</Text>
      {!!result.photoNote && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{result.photoNote}</Text>}
      <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{t('Saved status: {{status}} · Transient retries: {{count}}', { status: row.status, count: row.retryCount ?? 0 })}
      </Text>
      <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{t('Attempts recorded since update: {{count}}', { count: row.attemptCount ?? 0 })}</Text>
      <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{t('Last sync attempt: {{time}}', { time: row.lastAttemptAt ? `${formatLogDate(new Date(row.lastAttemptAt))} · ${formatLogTime(new Date(row.lastAttemptAt))}` : t('Not recorded by this app version') })}
      </Text>
      {!!onVerify && canVerifyRecoveryRow(row) && <ActionButton
        label={checking ? t("Checking server…") : t("Check server record")} variant="outline"
        disabled={disabled} loading={checking} onPress={() => onVerify(row.id)} style={{ marginTop: SPACING.sm }} />}
    </View>
  );
}

export default function AttendanceRecoverySetting() {
  useTranslation();
  const { colors } = useAppTheme();
  const recovery = useAttendanceRecovery();
  if (!recovery.isLoggedIn) return null;
  const { counts, loading, error, busy, rows, automaticEvents = [] } = recovery;
  const context = { rows, deviceOnline: recovery.deviceOnline };
  const heldByEarlier = rows.filter(row => blockedByEarlierAttendance(row, rows)).length;
  const automaticReview = automaticEvents.filter(event => event.status === "needs_review").length;
  const automaticPending = automaticEvents.length - automaticReview;
  const pending = counts?.recoverableCount ?? 0;
  const syncing = counts?.syncingCount ?? 0;
  const attention = (counts?.rejectedCount ?? 0) + (counts?.unknownTenantCount ?? 0) + (counts?.reviewCount ?? 0) + automaticReview;
  const status = loading ? t('Reading saved attendance…') : error ||
    (pending ? t('Pending attendance: {{count}}', { count: pending }) : automaticPending ? t('Saved automatic events: {{count}}', { count: automaticPending }) : syncing ? t('Syncing attendance: {{count}}', { count: syncing }) :
      attention ? t('Saved attendance needs review') : t('No pending attendance'));
  return (
    <>
      <SectionHeader title={t("Sync pending attendance")} style={{ marginTop: SPACING.xxl }} />
      <Card padded>
        <Text accessibilityLiveRegion="polite" style={{ ...TYPO.headline, color: error ? colors.errorText : colors.textPrimary }}>{status}</Text>
        {!!counts?.blockedCount && <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>{t('Waiting to retry: {{count}}', { count: counts.blockedCount })}</Text>}
        {!!counts?.rejectedCount && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>{t('Needs attention: {{count}}', { count: counts.rejectedCount })}</Text>}
        {!!counts?.reviewCount && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>{t('Needs review: {{count}}', { count: counts.reviewCount })}</Text>}
        {!!heldByEarlier && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>{t('Blocked by earlier attendance: {{count}}', { count: heldByEarlier })}</Text>}
        {!!heldByEarlier && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{t("A previous attendance record needs attention before newer records can sync.")}</Text>}
        {!!counts?.unknownTenantCount && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>{t('Cannot verify company: {{count}}', { count: counts.unknownTenantCount })}</Text>}
        {!!counts?.unknownTenantCount && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{t("These older records are kept on this device. Ask your administrator to verify their company before recovery.")}</Text>}
        {!!automaticEvents.length && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>{t('Automatic events: {{pending}} waiting · {{review}} need review', { pending: automaticPending, review: automaticReview })}</Text>}
        {!!automaticReview && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{t("Original transitions remain saved. Ask your administrator to verify the company and server attendance before recovery.")}</Text>}
        {!!automaticPending && <ActionButton label={t("Retry automatic events")} variant="outline" disabled={busy} onPress={recovery.retryAutomatic} style={{ marginTop: SPACING.sm }} />}
        <ActionButton label={busy ? t("Syncing attendance…") : t("Sync now")} icon="sync-outline" loading={busy}
          disabled={loading || !!error || recovery.checkingId != null || (!pending && !syncing)} onPress={recovery.sync} style={{ marginTop: SPACING.md }} />
        {!!error && <ActionButton label={t("Retry reading attendance")} variant="outline" onPress={recovery.refresh} style={{ marginTop: SPACING.sm }} />}
        {!error && (pending + syncing + attention + automaticPending > 0 || rows.length > 0) && <ActionButton label={t("View attendance records")} variant="outline" onPress={recovery.open} style={{ marginTop: SPACING.sm }} />}
      </Card>
      <BottomSheet visible={recovery.visible} onClose={recovery.close} title={t("Attendance recovery")}
        subtitle={error ? t("Saved attendance could not be read.") : summarizeRecoveryRows(rows, context)}>
        <View style={{ paddingHorizontal: SPACING.lg, flexShrink: 1 }}>
          {!!recovery.notice && <Text style={{ ...TYPO.body, color: colors.warningText }}>{recovery.notice}</Text>}
          {automaticEvents.map(event => {
            const description = describeAutomaticRecoveryEvent(event, { events: automaticEvents, deviceOnline: recovery.deviceOnline });
            return <View key={event.eventId} style={{ paddingVertical: SPACING.md }}>
              <Text style={{ ...TYPO.headline, color: colors.textPrimary }}>{t('Automatic {{transition}} · {{status}}', { transition: t(event.transition === 'EXIT' ? 'exit' : event.transition === 'ENTER' ? 'entry' : 'transition'), status: description.label })}</Text>
              <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>{event.occurredAt ? `${formatLogDate(new Date(event.occurredAt))} · ${formatLogTime(new Date(event.occurredAt))}` : t("Original time unavailable")}</Text>
              <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{description.explanation}</Text>
              {event.status === "needs_review" && !!event.onlineAttemptAt && !!event.tenantKey && !!event.employeeId && <ActionButton
                label={t("Check automatic server record")} variant="outline" disabled={busy || recovery.checkingId != null}
                onPress={() => recovery.verifyAutomatic(event.eventId)} style={{ marginTop: SPACING.sm }} />}
            </View>;
          })}
          {error ? <Text style={{ ...TYPO.body, color: colors.errorText }}>{error}</Text> :
            <FlatList data={rows} keyExtractor={row => String(row.id)} renderItem={({ item }) => <RecoveryRecord row={item}
              onVerify={recovery.verify} disabled={busy || recovery.checkingId != null} checking={recovery.checkingId === item.id} context={context} />}
              ListEmptyComponent={<Text style={{ ...TYPO.body, color: colors.textSecondary }}>{automaticEvents.length ? t("Saved automatic transitions appear above.") : t("No saved attendance records for this account. Missing records may require administrator investigation.")}</Text>} />}
        </View>
      </BottomSheet>
    </>
  );
}
