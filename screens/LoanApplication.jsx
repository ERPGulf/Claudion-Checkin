import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { ICON, RADIUS, SPACING, TYPO } from "../constants";
import useAppTheme from "../hooks/useAppTheme";
import useModernScreenHeader from "../hooks/useModernScreenHeader";
import useLoanApplication from "../hooks/useLoanApplication";
import ActionButton from "../components/common/ActionButton";
import Card from "../components/common/Card";
import EmptyState from "../components/common/EmptyState";
import ModuleCard from "../components/common/ModuleCard";
import SectionHeader from "../components/common/SectionHeader";
import StatusBanner from "../components/common/StatusBanner";
import PickerField from "../components/common/PickerField";
import FormField from "../components/common/FormField";
import UploadField from "../components/common/UploadField";
import OptionSheet from "../components/common/OptionSheet";
import AttachmentSheet from "../components/common/AttachmentSheet";
import LoanHistoryCard from "../components/LoanApplication/LoanHistoryCard";
import ExpenseSkeleton from "../components/ExpenseClaim/ExpenseSkeleton";
// The app's one amount formatter — "10,000.00", grouped and pinned to two
// decimals, and deliberately without a currency symbol: the backend is
// provisioned per device by QR scan and no endpoint reports a currency code, so a
// guessed "QAR" could be wrong. Shared with Expense Claims so a figure reads the
// same in both places.
import { formatExpenseAmount } from "../utils/expenseClaims";
import {
  describeMissingLoanFields,
  loanProductIcon,
} from "../utils/loanApplication";

/**
 * Modern Loan Application.
 *
 * Presentation only — the product fetch, the form state, the two attachment
 * slots, the validation and the submit mutation all live in
 * hooks/useLoanApplication.js, a faithful lift of what LoanApplicationLegacy and
 * its untouched <LoanApplicationForm> still run. Nothing here validates, builds a
 * payload or calls an API.
 *
 * Every control is a shared component already used by Expense Claims, Leave
 * Application, Attendance Request and Complaints: <Card> for the intro and the
 * summary, <ModuleCard> for the groups, <PickerField> + <OptionSheet> in place of
 * the @react-native-picker/picker wheel, <FormField> for the amount and the
 * reason, <UploadField> for both attachments, <AttachmentSheet> for picking,
 * <ActionButton> for submit, <StatusBanner> for the errors and the footnote.
 * There is no Loan-only layout on this screen.
 *
 * Two cards on the dense rhythm rather than four roomy ones: the classic form ran
 * to two screenfuls of stacked labels, and grouping "what and how much" against
 * "supporting documents" is the whole hierarchy this form needs.
 *
 * Inline errors appear only after the first submit attempt — every field starts
 * empty, so marking them on arrival would flag a form nobody has touched. The
 * checks are the hook's, unchanged: pressing submit runs the same five in the same
 * order and raises the same toasts as the classic form.
 */
function LoanApplication() {
  const { colors } = useAppTheme();
  useModernScreenHeader("Loan Application");

  const {
    productName,
    amount,
    setAmount,
    repaymentAmount,
    setRepaymentAmount,
    repaymentMethod,
    repaymentMethods,
    isRepaymentSheetVisible,
    openRepaymentSheet,
    closeRepaymentSheet,
    selectRepaymentMethod,
    reason,
    setReason,
    file1,
    file2,
    loanProducts,
    loadingProducts,
    isPending,
    isProductSheetVisible,
    openProductSheet,
    closeProductSheet,
    selectProduct,
    isBottomSheetVisible,
    pickFile1,
    pickFile2,
    removeFile1,
    removeFile2,
    closeBottomSheet,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    handleSubmit,
    productMissing,
    amountMissing,
    amountInvalid,
    repaymentAmountMissing,
    repaymentAmountInvalid,
    repaymentMethodMissing,
    reasonMissing,
    file1Missing,
    attachmentCount,
    visibleLoans,
    hasMoreLoans,
    showMoreLoans,
    isFetchingHistory,
    isHistoryError,
    historyError,
    refetchHistory,
    loanApplications,
  } = useLoanApplication();

  const [attempted, setAttempted] = useState(false);

  const onSubmitPress = useCallback(() => {
    setAttempted(true);
    handleSubmit();
  }, [handleSubmit]);

  // The hook blanks the form once a submission is acknowledged; clear the error
  // marks with it, so a fresh form isn't pre-marked as invalid.
  useEffect(() => {
    if (
      productMissing &&
      amountMissing &&
      repaymentAmountMissing &&
      repaymentMethodMissing &&
      reasonMissing &&
      file1Missing
    ) {
      setAttempted(false);
    }
  }, [
    productMissing,
    amountMissing,
    repaymentAmountMissing,
    repaymentMethodMissing,
    reasonMissing,
    file1Missing,
  ]);

  /** ModuleCard's body already ends with a 4pt inset; this takes it to 12. */
  const cardBody = { paddingBottom: SPACING.sm };

  const missing = attempted
    ? describeMissingLoanFields({
        productMissing,
        amountMissing,
        amountInvalid,
        repaymentAmountMissing,
        repaymentAmountInvalid,
        repaymentMethodMissing,
        reasonMissing,
        file1Missing,
      })
    : null;

  // The summary is worth its height once there is something in it to read.
  const hasSummary = !productMissing || !amountMissing;

  /** Products arrive as `[{ product_name }]`; the sheet lists plain strings. */
  const productOptions = loanProducts
    .map(item => item?.product_name)
    .filter(Boolean);

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
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
      >
        {/* ---------- Introduction ---------- */}
        {/* Icon centred against the two text lines rather than top-aligned, so
            the block reads as one unit at this height. */}
        <Card style={{ marginBottom: SPACING.md, padding: SPACING.md }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View
              style={{
                width: 32,
                height: 32,
                borderRadius: RADIUS.sm,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.accentSurface,
                borderWidth: 1,
                borderColor: colors.accentBorder,
                marginEnd: SPACING.md,
              }}
            >
              <Ionicons
                name="wallet-outline"
                size={ICON.sm}
                color={colors.accentText}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0 }}>
              <Text
                accessibilityRole="header"
                style={{ ...TYPO.headline, color: colors.textPrimary }}
              >
                Loan request
              </Text>
              <Text
                style={{ ...TYPO.caption, color: colors.textMuted }}
                numberOfLines={2}
              >
                Pick a product, enter the amount you need and say what it's for.
              </Text>
            </View>
          </View>
        </Card>

        {/* ---------- Loan details ---------- */}
        <ModuleCard
          dense
          icon="card-outline"
          title="Loan details"
          subtitle="Select the product and enter your request"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            {/* The same compact field the other forms use for a choice. Opens a
                sheet instead of the inline wheel — the value it hands back is
                the identical raw `product_name` string. */}
            <PickerField
              label="Loan product *"
              value={productName}
              placeholder={
                loadingProducts ? "Loading products…" : "Select loan product"
              }
              icon={productName ? loanProductIcon(productName) : "list-outline"}
              onPress={openProductSheet}
              active={isProductSheetVisible}
              invalid={attempted && productMissing}
            />

            {/* Right-aligned and tabular, so the figure lines up digit for digit
                with the one echoed in the summary below. */}
            <FormField
              label="Loan amount *"
              value={amount}
              onChangeText={setAmount}
              placeholder="0.00"
              icon="cash-outline"
              keyboardType="numeric"
              align="right"
              invalid={attempted && (amountMissing || amountInvalid)}
              accessibilityLabel="Loan amount"
              style={{ marginTop: SPACING.md }}
            />

            {/* The instalment, not the total — labelled "per month" because
                the backend reads it as the fixed per-period deduction, and an
                employee typing the full loan amount here again would produce an
                application that repays in one month. */}
            <FormField
              label="Repayment amount (per month) *"
              value={repaymentAmount}
              onChangeText={setRepaymentAmount}
              placeholder="0.00"
              icon="repeat-outline"
              keyboardType="numeric"
              align="right"
              invalid={
                attempted && (repaymentAmountMissing || repaymentAmountInvalid)
              }
              accessibilityLabel="Repayment amount"
              style={{ marginTop: SPACING.md }}
            />

            {/* One option today, but still a picker rather than a fixed label:
                the field has to appear in the payload, and a sheet is how every
                other choice on this screen is made. */}
            <PickerField
              label="Repayment method *"
              value={repaymentMethod}
              placeholder="Select repayment method"
              icon={repaymentMethod ? "calendar-outline" : "list-outline"}
              onPress={openRepaymentSheet}
              active={isRepaymentSheetVisible}
              invalid={attempted && repaymentMethodMissing}
              style={{ marginTop: SPACING.md }}
            />

            <FormField
              label="Reason *"
              value={reason}
              onChangeText={setReason}
              placeholder="What is this loan for?"
              multiline
              minLines={4}
              align="auto"
              invalid={attempted && reasonMissing}
              accessibilityLabel="Reason"
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </ModuleCard>

        {/* ---------- Attachments ---------- */}
        {/* Two independent slots, presented as a pair but still posted as the
            separate `file1` / `file 2` form fields the backend expects. The
            first is labelled Required because the classic form refuses to submit
            without it — that rule is unchanged, only stated. */}
        <ModuleCard
          dense
          icon="attach-outline"
          title="Attachments"
          subtitle="Attachment 1 is required"
          style={{ marginBottom: SPACING.md }}
        >
          <View style={cardBody}>
            <UploadField
              compact
              label="Attachment 1"
              optional={false}
              file={file1}
              onPick={pickFile1}
              onRemove={removeFile1}
            />

            <UploadField
              compact
              label="Attachment 2"
              file={file2}
              onPick={pickFile2}
              onRemove={removeFile2}
              style={{ marginTop: SPACING.md }}
            />
          </View>
        </ModuleCard>

        {/* ---------- Application summary ---------- */}
        {/* Only what is already on this screen: the product picked and the amount
            typed, plus how many of the two slots are filled. No instalment plan,
            no eligibility, no reference number — those are the approver's and the
            backend's to decide. */}
        {hasSummary && (
          <Card
            style={{ padding: SPACING.md, marginBottom: SPACING.md }}
            accessible
            accessibilityLabel={`Summary. ${
              productMissing ? "No product selected" : productName
            }, ${
              amountMissing ? "no amount entered" : formatExpenseAmount(amount)
            }, ${
              repaymentAmountMissing
                ? "no repayment entered"
                : `${formatExpenseAmount(repaymentAmount)} per month`
            }, ${attachmentCount} of 2 attachments.`}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <View style={{ flex: 1.2, minWidth: 0 }}>
                <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
                  Loan product
                </Text>
                <Text
                  numberOfLines={1}
                  style={{ ...TYPO.title3, color: colors.textPrimary }}
                >
                  {productMissing ? "—" : productName}
                </Text>
              </View>

              <View
                style={{
                  width: 1,
                  alignSelf: "stretch",
                  backgroundColor: colors.dividerSubtle,
                  marginHorizontal: SPACING.md,
                }}
              />

              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ ...TYPO.caption, color: colors.textMuted }}>
                  Requested
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    ...TYPO.title3,
                    color: colors.textPrimary,
                    fontVariant: ["tabular-nums"],
                  }}
                >
                  {amountMissing ? "—" : formatExpenseAmount(amount)}
                </Text>
              </View>
            </View>

            <View
              style={{
                height: 1,
                backgroundColor: colors.dividerSubtle,
                marginVertical: SPACING.md,
              }}
            />

            {/* The repayment line only once there is a figure to show, so an
                untouched form isn't padded with a dash. */}
            {!repaymentAmountMissing && (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: SPACING.md,
                }}
              >
                <Ionicons
                  name="repeat-outline"
                  size={ICON.sm}
                  color={colors.textMuted}
                  style={{ marginEnd: SPACING.sm }}
                />
                <Text
                  style={{
                    ...TYPO.subhead,
                    fontWeight: "400",
                    flex: 1,
                    minWidth: 0,
                    color: colors.textSecondary,
                  }}
                  numberOfLines={1}
                >
                  {`${formatExpenseAmount(repaymentAmount)} per month`}
                </Text>
              </View>
            )}

            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Ionicons
                name="attach-outline"
                size={ICON.sm}
                color={colors.textMuted}
                style={{ marginEnd: SPACING.sm }}
              />
              <Text
                style={{
                  ...TYPO.subhead,
                  fontWeight: "400",
                  flex: 1,
                  minWidth: 0,
                  color: colors.textSecondary,
                }}
              >
                {attachmentCount === 0
                  ? "No documents attached"
                  : `${attachmentCount} of 2 documents attached`}
              </Text>
            </View>
          </Card>
        )}

        {/* Mirrors the checks handleSubmit already makes, surfaced after the
            first attempt. It gates nothing — pressing submit runs the same
            validations and raises the same toast as the classic form. */}
        {!!missing && (
          <StatusBanner
            tone="error"
            title="Finish the form first"
            message={missing}
            style={{ marginBottom: SPACING.md }}
          />
        )}

        {/* ---------- Submit ---------- */}
        {/* Inline rather than pinned: the "what happens next" card sits below it,
            and a sticky button would either cover that or push it off the screen.
            The bottom safe-area inset comes from <SafeAreaView>. */}
        <ActionButton
          label="Submit loan application"
          icon="paper-plane-outline"
          variant="filled"
          size="lg"
          elevated
          loading={isPending}
          disabled={isPending}
          onPress={onSubmitPress}
        />

        {/* ---------- What happens next ---------- */}
        <StatusBanner
          tone="info"
          icon="information-circle"
          title="What happens next"
          message="Your request goes through your company's loan approval workflow. You'll be notified once it has been approved or rejected."
          style={{ marginTop: SPACING.md }}
        />

        {/* ---------- History ---------- */}
        {/* Below the form rather than above it: this screen exists to make an
            application, and the record of past ones is what you check after.
            A plain section on the same ScrollView, not a FlatList — the list is
            paged client-side at five and the whole response is already in
            memory, so there is nothing to virtualise. */}
        <SectionHeader
          title="Your applications"
          subtitle={
            loanApplications.length > 0
              ? `${loanApplications.length} submitted`
              : undefined
          }
          style={{ marginTop: SPACING.xxl }}
        />

        {isFetchingHistory ? (
          // Only the history waits — the form above does not depend on this
          // query, so it stays usable while the list loads.
          <ExpenseSkeleton count={2} label="Loading loan applications" />
        ) : isHistoryError ? (
          <Card>
            <EmptyState
              compact
              icon="cloud-offline-outline"
              title="Couldn't load your applications"
              description={
                historyError?.message || "Unable to load loan applications."
              }
              actionLabel="Retry"
              onActionPress={refetchHistory}
            />
          </Card>
        ) : visibleLoans.length === 0 ? (
          <Card>
            <EmptyState
              compact
              icon="wallet-outline"
              title="No loan applications yet"
              description="Once you submit an application it will appear here with its approval status."
            />
          </Card>
        ) : (
          <>
            {visibleLoans.map((item, index) => (
              <LoanHistoryCard
                key={item?.name || index}
                loan={item}
                style={{ marginBottom: SPACING.md }}
              />
            ))}

            {hasMoreLoans && (
              <ActionButton
                variant="outline"
                icon="chevron-down"
                label="Load more"
                onPress={showMoreLoans}
              />
            )}
          </>
        )}
      </ScrollView>

      <OptionSheet
        visible={isProductSheetVisible}
        onClose={closeProductSheet}
        title="Loan product"
        subtitle="Which loan are you applying for?"
        options={productOptions}
        selected={productName}
        onSelect={selectProduct}
        iconForOption={loanProductIcon}
        emptyIcon="wallet-outline"
        emptyTitle="No loan products"
        emptyDescription="Your administrator hasn't configured any loan products yet."
      />

      <OptionSheet
        visible={isRepaymentSheetVisible}
        onClose={closeRepaymentSheet}
        title="Repayment method"
        subtitle="How should this loan be repaid?"
        options={repaymentMethods}
        selected={repaymentMethod}
        onSelect={selectRepaymentMethod}
        emptyIcon="calendar-outline"
        emptyTitle="No repayment methods"
      />

      <AttachmentSheet
        visible={isBottomSheetVisible}
        onClose={closeBottomSheet}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </SafeAreaView>
  );
}

export default LoanApplication;
