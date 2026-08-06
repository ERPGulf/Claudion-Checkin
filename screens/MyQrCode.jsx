import React from "react";
import { Linking, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ICON, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useQrCode from "../hooks/useQrCode";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import StatusBanner from "../components/common/StatusBanner";
import PressableScale from "../components/common/PressableScale";
import { QrBadgeCard, QrSkeleton } from "../components/MyQrCode";

/**
 * Modern My QR Code.
 *
 * Presentation only — the fetch lives in hooks/useQrCode.js, a faithful lift of
 * what MyQrCodeLegacy still runs inline. Nothing here generates, encodes or
 * re-requests a QR: the screen renders the exact `image_url` the endpoint
 * returned, at the same 220pt, with the same `resizeMode`, beside the exact
 * `employee` string that came with it.
 *
 * The page is a wallet pass rather than a form: the badge card carries the code
 * and the identity it belongs to, one info card explains what the code is for,
 * and the branding drops to a muted footer link instead of a green heading that
 * outweighed the QR.
 *
 * There are no Share / Download / Copy actions, because the app has none —
 * no clipboard, sharing or file-system module is installed, and the classic
 * screen offers nothing to preserve. Adding any of them would be new
 * functionality rather than a redesign.
 */
function MyQrCode() {
  const { colors } = useAppTheme();
  useModernScreenHeader("My QR Code");

  const { imageUrl, employee, fullname, loading, error, retry } = useQrCode();

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: colors.surfaceSecondary }}
      edges={["bottom", "left", "right"]}
    >
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: SPACING.lg,
          paddingTop: SPACING.md,
          paddingBottom: SPACING.xl,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* ---------- Subtitle ---------- */}
        <Text
          style={{
            ...TYPO.caption,
            color: colors.textMuted,
            marginBottom: SPACING.md,
          }}
          numberOfLines={2}
        >
          Present this QR code when you are asked to identify yourself or to
          record attendance.
        </Text>

        {/* ---------- Badge ---------- */}
        {loading ? (
          <QrSkeleton />
        ) : error ? (
          <Card>
            <EmptyState
              icon="qr-code-outline"
              title="Unable to load QR code"
              description="Please try again later. If it keeps failing, contact your HR administrator."
              actionLabel="Try again"
              onActionPress={retry}
            />
          </Card>
        ) : (
          <QrBadgeCard
            imageUrl={imageUrl}
            employee={employee}
            fullname={fullname}
          />
        )}

        {/* ---------- About ---------- */}
        {/* Deliberately generic: the app knows the code identifies the employee
            profile, not which services a given tenant accepts it for. */}
        <StatusBanner
          tone="info"
          icon="information-circle"
          title="About this QR code"
          message="It uniquely identifies your employee profile and may be used for attendance, identity verification or company services."
          style={{ marginTop: SPACING.md }}
        />

        {/* ---------- Branding ---------- */}
        {/* Same link, same destination — muted, centred and last, so it can't
            compete with the code. Matches the footer on Home's menu. */}
        <PressableScale
          onPress={() => Linking.openURL("https://erpgulf.com")}
          accessibilityRole="link"
          accessibilityLabel="Open ERPGulf.com"
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 44,
            marginTop: SPACING.lg,
          }}
        >
          <Ionicons
            name="globe-outline"
            size={ICON.sm}
            color={colors.textMuted}
          />
          <Text
            style={{
              ...TYPO.subhead,
              color: colors.textMuted,
              marginHorizontal: SPACING.sm,
            }}
          >
            ERPGulf.com
          </Text>
          <Ionicons name="open-outline" size={13} color={colors.textMuted} />
        </PressableScale>
      </ScrollView>
    </SafeAreaView>
  );
}

export default MyQrCode;
