import React from "react";
import { Text } from "react-native";
import { SPACING, TYPO } from "../../constants";
import useAppTheme from "../../hooks/useAppTheme";
import useAttendanceSyncTest from "../../hooks/useAttendanceSyncTest";
import ActionButton from "../common/ActionButton";
import Card from "../common/Card";
import SectionHeader from "../common/SectionHeader";

export default function AttendanceSyncTestSetting() {
  const { colors } = useAppTheme();
  const test = useAttendanceSyncTest();
  if (!test.visible) return null;
  return (
    <>
      <SectionHeader title="Offline attendance API test" subtitle="Development and preview builds" style={{ marginTop: SPACING.xxl }} />
      <Card padded>
        <Text style={{ ...TYPO.body, color: colors.textSecondary }}>
          Each tap adds a random IN/OUT pair for the signed-in employee. These are real queued records and can sync automatically. Use a test account.
        </Text>
        <Text style={{ ...TYPO.caption, color: colors.textSecondary, marginTop: SPACING.sm }}>{test.employeeId} · {test.tenantKey}</Text>
        {!test.enabled && <Text style={{ ...TYPO.subhead, color: colors.warningText, marginTop: SPACING.sm }}>Automatic and offline attendance must be enabled for this employee.</Text>}
        <ActionButton label="Add chronological pair" icon="time-outline" disabled={!test.enabled || !!test.busy}
          loading={test.busy === "chronological"} onPress={() => test.add("chronological")} style={{ marginTop: SPACING.lg }} />
        <ActionButton label="Add non-chronological pair" icon="shuffle-outline" variant="outline" disabled={!test.enabled || !!test.busy}
          loading={test.busy === "non-chronological"} onPress={() => test.add("non-chronological")} style={{ marginTop: SPACING.md }} />
        <Text style={{ ...TYPO.caption, color: colors.textSecondary, marginTop: SPACING.md }}>
          Chronological appends a newer pair, IN first. Non-chronological prepends an older pair, OUT first. Normal sync ordering and existing blockers still apply. Your live check-in session is unchanged.
        </Text>
        {!!test.result && <Text accessibilityLiveRegion="polite" style={{ ...TYPO.subhead, color: colors.successText, marginTop: SPACING.md }}>
          {`Added 2 records: IN ${test.result.checkinTime} · OUT ${test.result.checkoutTime}. Check Attendance recovery for sync status.`}
        </Text>}
        {!!test.error && <Text accessibilityLiveRegion="polite" style={{ ...TYPO.subhead, color: colors.errorText, marginTop: SPACING.md }}>{test.error}</Text>}
      </Card>
    </>
  );
}
