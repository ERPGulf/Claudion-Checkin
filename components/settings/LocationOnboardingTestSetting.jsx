import React from "react";
import { Text } from "react-native";
import { SPACING, TYPO } from "../../constants";
import useAppTheme from "../../hooks/useAppTheme";
import { GEOTAGGING } from "../../redux/Slices/AutoAttendanceSlice";
import { previewLocationAccessExplanation } from "../../utils/autoAttendance";
import ActionButton from "../common/ActionButton";
import Card from "../common/Card";
import SectionHeader from "../common/SectionHeader";

// Development builds and the preview channel, like the other Profile test panels.
const internalBuild = () => {
  if (__DEV__) return true;
  try { return require("expo-updates").channel === "preview"; } catch { return false; }
};

/** Opens the location explanation for either geotagging mode, whatever this account's configuration. */
export default function LocationOnboardingTestSetting() {
  const { colors } = useAppTheme();
  if (!internalBuild()) return null;
  return (
    <>
      <SectionHeader title="Location explanation test" subtitle="Development and preview builds" style={{ marginTop: SPACING.xxl }} />
      <Card padded>
        <Text style={{ ...TYPO.body, color: colors.textSecondary }}>
          Shows what employees see before the system location prompts. Nothing is requested or recorded.
        </Text>
        <ActionButton label="Automatic attendance (mode 2)" icon="location-outline"
          onPress={() => previewLocationAccessExplanation(GEOTAGGING.ALL_ACTIONS)} style={{ marginTop: SPACING.lg }} />
        <ActionButton label="Warnings only (mode 1)" icon="alert-circle-outline" variant="outline"
          onPress={() => previewLocationAccessExplanation(GEOTAGGING.WARNINGS_ONLY)} style={{ marginTop: SPACING.md }} />
        <Text style={{ ...TYPO.caption, color: colors.textSecondary, marginTop: SPACING.md }}>
          Employees never see mode 1 yet: the backend defines no warning behaviour for it.
        </Text>
      </Card>
    </>
  );
}
