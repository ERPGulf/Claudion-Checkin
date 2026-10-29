import { t, useTranslation } from "../../localization";
import React from "react";
import { Alert, View } from "react-native";
import Toast from "react-native-toast-message";
import { SPACING } from "../../constants";
import useAppTheme from "../../hooks/useAppTheme";
import {
  canRunCrashTests,
  isCrashCollectionEnabled,
  recordTestNonFatal,
  triggerTestCrash,
} from "../../services/crashlytics.service";
import ActionButton from "../common/ActionButton";
import Card from "../common/Card";
import SectionHeader from "../common/SectionHeader";
import SettingsRow from "../common/SettingsRow";

/**
 * Crashlytics test actions for internal builds: development builds and the
 * `preview` channel (see canRunCrashTests). A production binary renders nothing.
 *
 * Reports reach the Firebase console after the app is next opened. A debug
 * build sends nothing unless firebase.json sets `crashlytics_debug_enabled`,
 * so the buttons are disabled there and the row says why.
 */
export default function CrashlyticsTestSetting() {
  useTranslation();
  const { colors } = useAppTheme();
  if (!canRunCrashTests()) return null;

  const collecting = isCrashCollectionEnabled();

  const handleNonFatal = () => {
    recordTestNonFatal();
    Toast.show({
      type: "info",
      text1: t("Test non-fatal recorded"),
      text2: t("Close and reopen the app to upload it."),
      visibilityTime: 3500,
      autoHide: true,
    });
  };

  const handleCrash = () => {
    Alert.alert(
      t("Crash the app?"),
      t("The app closes immediately. Reopen it afterwards so the crash report uploads."),
      [
        { text: t("Cancel"), style: "cancel" },
        { text: t("Crash"), style: "destructive", onPress: triggerTestCrash },
      ],
    );
  };

  return (
    <>
      <SectionHeader
        title={t("Crash reporting test")}
        subtitle={t("Internal builds only. Not shown in production.")}
        style={{ marginTop: SPACING.xxl }}
      />

      <Card>
        <SettingsRow
          icon="bug-outline"
          iconTint={collecting ? colors.infoSurface : colors.warningSurface}
          iconColor={collecting ? colors.infoText : colors.warningText}
          title={collecting ? t("Crashlytics is collecting") : t("Crashlytics is not collecting")}
          description={
            collecting
              ? t("Reports upload the next time the app starts.")
              : t("Debug builds send nothing unless firebase.json sets crashlytics_debug_enabled.")
          }
        />

        <View style={{ paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg }}>
          <ActionButton
            variant="tinted"
            tone="warning"
            icon="flask-outline"
            label={t("Record test non-fatal")}
            onPress={handleNonFatal}
            disabled={!collecting}
          />
          <ActionButton
            variant="tinted"
            tone="error"
            icon="warning-outline"
            label={t("Force native crash")}
            onPress={handleCrash}
            disabled={!collecting}
            style={{ marginTop: SPACING.md }}
          />
        </View>
      </Card>
    </>
  );
}
