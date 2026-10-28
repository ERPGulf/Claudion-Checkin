import React from "react";
import { FlatList, Text, View } from "react-native";
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
  const { colors } = useAppTheme();
  const result = describeRecoveryRow(row, context);
  const date = parseLogTime(row.timestamp);
  return (
    <View style={{ paddingVertical: SPACING.md, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
      <Text style={{ ...TYPO.headline, color: colors.textPrimary }}>{row.action === "checkout" ? "Check-out" : "Check-in"}</Text>
      <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>{formatLogDate(date)} · {formatLogTime(date)}</Text>
      <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>Worker: {row.employeeId} · Record #{row.id}</Text>
      <Text style={{ ...TYPO.headline, color: colors[`${result.tone}Text`], marginTop: SPACING.sm }}>{result.label}</Text>
      <Text style={{ ...TYPO.body, color: colors.textSecondary }}>{result.explanation}</Text>
      {!!result.photoNote && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{result.photoNote}</Text>}
      <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>
        Saved status: {row.status} · Transient retries: {row.retryCount ?? 0}
      </Text>
      <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>Attempts recorded since update: {row.attemptCount ?? 0}</Text>
      <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>
        Last sync attempt: {row.lastAttemptAt ? `${formatLogDate(new Date(row.lastAttemptAt))} · ${formatLogTime(new Date(row.lastAttemptAt))}` : "Not recorded by this app version"}
      </Text>
      {!!onVerify && canVerifyRecoveryRow(row) && <ActionButton
        label={checking ? "Checking server…" : "Check server record"} variant="outline"
        disabled={disabled} loading={checking} onPress={() => onVerify(row.id)} style={{ marginTop: SPACING.sm }} />}
    </View>
  );
}

export default function AttendanceRecoverySetting() {
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
  const status = loading ? "Reading saved attendance…" : error ||
    (pending ? `Pending attendance: ${pending}` : automaticPending ? `Saved automatic events: ${automaticPending}` : syncing ? `Syncing attendance: ${syncing}` :
      attention ? "Saved attendance needs review" : "No pending attendance");
  return (
    <>
      <SectionHeader title="Sync pending attendance" style={{ marginTop: SPACING.xxl }} />
      <Card padded>
        <Text accessibilityLiveRegion="polite" style={{ ...TYPO.headline, color: error ? colors.errorText : colors.textPrimary }}>{status}</Text>
        {!!counts?.blockedCount && <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>Waiting to retry: {counts.blockedCount}</Text>}
        {!!counts?.rejectedCount && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>Needs attention: {counts.rejectedCount}</Text>}
        {!!counts?.reviewCount && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>Needs review: {counts.reviewCount}</Text>}
        {!!heldByEarlier && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>Blocked by earlier attendance: {heldByEarlier}</Text>}
        {!!heldByEarlier && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>A previous attendance record needs attention before newer records can sync.</Text>}
        {!!counts?.unknownTenantCount && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>Cannot verify company: {counts.unknownTenantCount}</Text>}
        {!!counts?.unknownTenantCount && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>These older records are kept on this device. Ask your administrator to verify their company before recovery.</Text>}
        {!!automaticEvents.length && <Text style={{ ...TYPO.subhead, color: colors.warningText }}>Automatic events: {automaticPending} waiting · {automaticReview} need review</Text>}
        {!!automaticReview && <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>Original transitions remain saved. Ask your administrator to verify the company and server attendance before recovery.</Text>}
        {!!automaticPending && <ActionButton label="Retry automatic events" variant="outline" disabled={busy} onPress={recovery.retryAutomatic} style={{ marginTop: SPACING.sm }} />}
        <ActionButton label={busy ? "Syncing attendance…" : "Sync now"} icon="sync-outline" loading={busy}
          disabled={loading || !!error || recovery.checkingId != null || (!pending && !syncing)} onPress={recovery.sync} style={{ marginTop: SPACING.md }} />
        {!!error && <ActionButton label="Retry reading attendance" variant="outline" onPress={recovery.refresh} style={{ marginTop: SPACING.sm }} />}
        {!error && (pending + syncing + attention + automaticPending > 0 || rows.length > 0) && <ActionButton label="View attendance records" variant="outline" onPress={recovery.open} style={{ marginTop: SPACING.sm }} />}
      </Card>
      <BottomSheet visible={recovery.visible} onClose={recovery.close} title="Attendance recovery"
        subtitle={error ? "Saved attendance could not be read." : summarizeRecoveryRows(rows, context)}>
        <View style={{ paddingHorizontal: SPACING.lg, flexShrink: 1 }}>
          {!!recovery.notice && <Text style={{ ...TYPO.body, color: colors.warningText }}>{recovery.notice}</Text>}
          {automaticEvents.map(event => {
            const description = describeAutomaticRecoveryEvent(event, { events: automaticEvents, deviceOnline: recovery.deviceOnline });
            return <View key={event.eventId} style={{ paddingVertical: SPACING.md }}>
              <Text style={{ ...TYPO.headline, color: colors.textPrimary }}>Automatic {event.transition === "EXIT" ? "exit" : event.transition === "ENTER" ? "entry" : "transition"} · {description.label}</Text>
              <Text style={{ ...TYPO.subhead, color: colors.textSecondary }}>{event.occurredAt ? `${formatLogDate(new Date(event.occurredAt))} · ${formatLogTime(new Date(event.occurredAt))}` : "Original time unavailable"}</Text>
              <Text style={{ ...TYPO.caption, color: colors.textSecondary }}>{description.explanation}</Text>
              {event.status === "needs_review" && !!event.onlineAttemptAt && !!event.tenantKey && !!event.employeeId && <ActionButton
                label="Check automatic server record" variant="outline" disabled={busy || recovery.checkingId != null}
                onPress={() => recovery.verifyAutomatic(event.eventId)} style={{ marginTop: SPACING.sm }} />}
            </View>;
          })}
          {error ? <Text style={{ ...TYPO.body, color: colors.errorText }}>{error}</Text> :
            <FlatList data={rows} keyExtractor={row => String(row.id)} renderItem={({ item }) => <RecoveryRecord row={item}
              onVerify={recovery.verify} disabled={busy || recovery.checkingId != null} checking={recovery.checkingId === item.id} context={context} />}
              ListEmptyComponent={<Text style={{ ...TYPO.body, color: colors.textSecondary }}>{automaticEvents.length ? "Saved automatic transitions appear above." : "No saved attendance records for this account. Missing records may require administrator investigation."}</Text>} />}
        </View>
      </BottomSheet>
    </>
  );
}
