/* eslint-disable react/prop-types */
import React from "react";
import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { ICON, RADIUS, SPACING, TYPO } from "../../constants";
import { navigateSafely } from "../../navigation/rootNavigation";
import useAppTheme from "../../hooks/useAppTheme";
import BottomSheet from "./BottomSheet";
import ActionButton from "./ActionButton";
import {
  describeLogType,
  formatLogDate,
  formatLogTime,
  parseLogTime,
} from "../../utils/attendanceHistory";
import { describeQueueRow } from "../../utils/offlineStatus";

/**
 * What happened to an attendance record that hasn't reached the server, and
 * whether anyone needs to do anything about it.
 *
 * The whole sheet is built around one distinction the employee cannot make on
 * their own: *is this being handled?* A blocked record is already being retried
 * and needs nothing from them, so it gets a reassurance and no button. A
 * rejected one will never resolve itself, so it gets the one action that works —
 * an attendance request, prefilled from the punch.
 *
 * There is deliberately no "Retry" button anywhere. For blocked rows retry is
 * already automatic and a button would imply the employee had been holding
 * things up; for rejected rows it would fail every time and teach them the app
 * is broken.
 */

const ROW_ICON = {
  error: "alert-circle",
  warning: "shield-outline",
  info: "sync-outline",
  neutral: "document-text-outline",
};

/** One line of "will this sort itself out?", the question the sheet exists for. */
function Fact({ icon, text, tone }) {
  const { colors } = useAppTheme();

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        marginTop: SPACING.sm,
      }}
    >
      <Ionicons
        name={icon}
        size={ICON.sm}
        color={colors[`${tone}Text`]}
        style={{ marginTop: 2 }}
      />
      <Text
        style={{
          ...TYPO.subhead,
          color: colors.textSecondary,
          marginStart: SPACING.sm,
          flex: 1,
        }}
      >
        {text}
      </Text>
    </View>
  );
}

function QueueRowCard({ row, onCorrect }) {
  const { colors } = useAppTheme();

  const detail = describeQueueRow(row);
  const date = parseLogTime(row.timestamp);
  const { label: typeLabel } = describeLogType(
    row.action === "checkout" ? "OUT" : "IN",
  );

  return (
    <View
      style={{
        borderRadius: RADIUS.lg,
        borderWidth: 1,
        borderColor: colors[`${detail.tone}Border`] ?? colors.cardBorder,
        backgroundColor: colors[`${detail.tone}Surface`] ?? colors.cardBackground,
        padding: SPACING.md,
        marginBottom: SPACING.md,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Ionicons
          name={ROW_ICON[detail.tone] ?? ROW_ICON.warning}
          size={ICON.md}
          color={colors[`${detail.tone}Text`]}
        />
        <Text
          style={{
            ...TYPO.headline,
            color: colors[`${detail.tone}Text`],
            marginStart: SPACING.sm,
            flex: 1,
          }}
        >
          {detail.label}
        </Text>
      </View>

      <Text
        style={{
          ...TYPO.title3,
          color: colors.textPrimary,
          marginTop: SPACING.sm,
        }}
      >
        {typeLabel} · {formatLogTime(date)}
      </Text>
      <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
        {formatLogDate(date)}
      </Text>

      <Text
        style={{
          ...TYPO.body,
          color: colors.textSecondary,
          marginTop: SPACING.sm,
        }}
      >
        {detail.reason}
      </Text>

      {detail.willRetry && (
        <Fact
          icon="refresh-outline"
          tone={detail.tone}
          text="We'll keep trying automatically. You don't need to do anything."
        />
      )}

      {detail.needsAdmin && (
        <Fact
          icon="person-circle-outline"
          tone={detail.tone}
          text="Your administrator needs to enable offline attendance on the server."
        />
      )}

      {detail.needsEmployee && (
        <Fact
          icon="hand-right-outline"
          tone={detail.tone}
          text="This one won't resolve on its own — submit an attendance request so HR can record it."
        />
      )}

      {detail.canCorrect && !!onCorrect && (
        <ActionButton
          label="Submit attendance request"
          icon="create-outline"
          onPress={() => onCorrect(row)}
          style={{ marginTop: SPACING.md }}
        />
      )}
    </View>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.visible
 * @param {() => void} props.onClose
 * @param {Array<object>} props.rows unresolved queue rows, newest first
 */
function AttendanceSyncSheet({ visible, onClose, rows = [] }) {
  const { colors } = useAppTheme();

  const handleCorrect = (row) => {
    const date = parseLogTime(row.timestamp);
    onClose?.();

    // `navigateSafely`, not `useNavigation`. The banner that owns this sheet is
    // mounted in App.js as a *sibling* of <Navigator>, so it sits outside the
    // NavigationContainer entirely and the hook would throw. This is the
    // project's existing route for navigating from outside the tree — the same
    // one the FCM handlers use — and it queues the navigation if the tree is not
    // ready yet.
    //
    // Prefilled so the employee is not asked to remember a time the app already
    // knows precisely — and so the request HR receives matches the punch that
    // was refused, rather than an approximation typed from memory.
    navigateSafely("Attendance request", {
      prefill: {
        date,
        time: date,
        logType: row.action === "checkout" ? "OUT" : "IN",
        reason: `Offline attendance could not be recorded automatically (${
          row.action === "checkout" ? "check-out" : "check-in"
        } at ${formatLogTime(date)} on ${formatLogDate(date)}).`,
        queueRowId: row.id,
      },
    });
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Attendance sync"
      subtitle={
        rows.length === 1
          ? "1 record hasn't reached the server yet."
          : `${rows.length} records haven't reached the server yet.`
      }
    >
      {rows.length === 0 ? (
        <Text style={{ ...TYPO.body, color: colors.textSecondary }}>
          Everything has synced.
        </Text>
      ) : (
        rows.map((row) => (
          <QueueRowCard key={row.id} row={row} onCorrect={handleCorrect} />
        ))
      )}

      <Text
        style={{
          ...TYPO.caption,
          color: colors.textMuted,
          marginTop: SPACING.xs,
        }}
      >
        Your attendance is stored on this device and is never discarded, even if
        it takes days to reach the server.
      </Text>
    </BottomSheet>
  );
}

export default AttendanceSyncSheet;
