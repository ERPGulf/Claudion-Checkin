/* eslint-disable react/prop-types */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Platform, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import useExpenseClaimForm from '../../hooks/useExpenseClaimForm';
import ActionButton from '../common/ActionButton';
import Card from '../common/Card';
import ModuleCard from '../common/ModuleCard';
import SectionHeader from '../common/SectionHeader';
import StatusBanner from '../common/StatusBanner';
import PickerField from '../common/PickerField';
import UploadField from '../common/UploadField';
import AttachmentSheet from '../common/AttachmentSheet';
import ExpenseTypeSheet from './ExpenseTypeSheet';
import FormField from './FormField';
// "5 Aug 2026" — the same string Attendance History and Attendance Request
// render, so a date reads identically wherever it appears in the app.
import { expenseTypeIcon, formatExpenseDate } from '../../utils/expenseClaims';

/**
 * The picker's starting value. `expense_date` is a bare `YYYY-MM-DD`, which
 * `new Date()` reads as UTC midnight — a day early west of Greenwich — so it is
 * split into local components instead. Falls back to today, so the field can
 * never open on the epoch.
 */
function pickerValue(wireDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(wireDate || '');
  if (!match) return new Date();

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

/**
 * "Add an expense date and a valid amount." — the same three checks
 * `handleSubmit` runs, written as one sentence instead of a stack of red labels.
 */
function describeMissing({ dateMissing, typeMissing, amountInvalid }) {
  const parts = [
    dateMissing ? 'an expense date' : null,
    typeMissing ? 'an expense type' : null,
    amountInvalid ? 'a valid amount' : null,
  ].filter(Boolean);

  if (!parts.length) return null;

  const list =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;

  return `Add ${list}.`;
}

/**
 * Everything above the history list: the introduction, the create-claim form in
 * three grouped cards, and the submit button.
 *
 * This is a component rather than JSX inlined into the screen for one reason:
 * it is the list's `ListHeaderComponent`, and it owns the form state. Typing an
 * amount re-renders *this* subtree only — the screen above it never re-runs, so
 * the claim rows below are untouched between keystrokes. With the state held on
 * the screen instead, every character would re-render the whole list.
 *
 * Presentation only. Every field, the expense-type list, the date handler, the
 * attachment pickers and `handleSubmit` come from useExpenseClaimForm, shared
 * with the classic <ClaimForm>, so validation and the submitted payload are
 * identical on both screens.
 *
 * Inline errors appear only after the first submit attempt (`attempted`). Every
 * field is empty on arrival, so showing "required" straight away would mark a
 * form the user has not touched. The checks themselves are the hook's, unchanged:
 * pressing submit still runs the same three validations in the same order and
 * raises the same toasts as the classic form.
 */
function ClaimFormSection({ addClaim, isCreating, resetFormFlag }) {
  const { colors, isDark } = useAppTheme();

  const {
    expenseDate,
    expenseType,
    description,
    amount,
    fileUrl,
    expenseTypes,
    setDescription,
    setAmount,
    showPicker,
    showDatePicker,
    handleDateChange,
    isTypeSheetVisible,
    openTypeSheet,
    closeTypeSheet,
    selectExpenseType,
    isBottomSheetVisible,
    pickFile,
    closeBottomSheet,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    handleRemoveAttachment,
    handleSubmit,
    dateMissing,
    typeMissing,
    amountInvalid,
  } = useExpenseClaimForm({ onSubmit: addClaim, resetSignal: resetFormFlag });

  const [attempted, setAttempted] = useState(false);

  const onSubmitPress = useCallback(() => {
    setAttempted(true);
    handleSubmit();
  }, [handleSubmit]);

  // The form is blanked by the hook once a claim is acknowledged; clear the
  // error marks with it, so a fresh form isn't pre-marked as invalid.
  useEffect(() => {
    setAttempted(false);
  }, [resetFormFlag]);

  /* ---------------------------------------------------------------------
   * Success affirmation
   *
   * `resetFormFlag` flips only after a claim was created and the user dismissed
   * the Alert, so it is the one reliable "it worked" signal available without
   * touching the mutation. The first render is skipped, since the flag has a
   * value from the start.
   * ------------------------------------------------------------------- */

  const [showSuccess, setShowSuccess] = useState(false);
  const successOpacity = useRef(new Animated.Value(0)).current;
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return undefined;
    }

    setShowSuccess(true);
    Animated.timing(successOpacity, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();

    const timer = setTimeout(() => {
      Animated.timing(successOpacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }).start(({ finished }) => finished && setShowSuccess(false));
    }, 4000);

    return () => clearTimeout(timer);
  }, [resetFormFlag, successOpacity]);

  // iOS-only. Keeps the native wheel on the same palette as the screen; has no
  // bearing on how a date is picked.
  const pickerTheme =
    Platform.OS === 'ios' ? (isDark ? 'dark' : 'light') : undefined;

  /** ModuleCard's body already ends with a 4pt inset; this takes it to 12. */
  const cardBody = { paddingBottom: SPACING.sm };

  const missing = attempted
    ? describeMissing({ dateMissing, typeMissing, amountInvalid })
    : null;

  return (
    <View>
      {/* ---------- Introduction ---------- */}
      {/* Icon centred against the two text lines rather than top-aligned, so
          the block reads as one unit at this height. */}
      <Card style={{ marginBottom: SPACING.md, padding: SPACING.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: RADIUS.sm,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accentSurface,
              borderWidth: 1,
              borderColor: colors.accentBorder,
              marginEnd: SPACING.md,
            }}
          >
            <Ionicons
              name="receipt-outline"
              size={ICON.sm}
              color={colors.accentText}
            />
          </View>

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              accessibilityRole="header"
              style={{ ...TYPO.headline, color: colors.textPrimary }}
            >
              Expense claims
            </Text>
            <Text
              style={{ ...TYPO.caption, color: colors.textMuted }}
              numberOfLines={2}
            >
              Claim what you spent, and follow it through approval.
            </Text>
          </View>
        </View>
      </Card>

      {showSuccess && (
        <Animated.View
          style={{ opacity: successOpacity, marginBottom: SPACING.md }}
        >
          <StatusBanner
            tone="success"
            title="Claim submitted"
            message="It's now with your approver and appears in your history below."
          />
        </Animated.View>
      )}

      {/* ================= CREATE CLAIM ================= */}
      <SectionHeader title="Create claim" subtitle="Required fields are marked" />

      {/* ---------- Expense information ---------- */}
      <ModuleCard
        icon="calendar-outline"
        title="Expense information"
        subtitle="When it happened, and what kind"
        style={{ marginBottom: SPACING.md }}
      >
        <View style={cardBody}>
          <PickerField
            label="Expense date *"
            value={expenseDate ? formatExpenseDate(expenseDate) : ''}
            placeholder="Select a date"
            icon="calendar-outline"
            onPress={showDatePicker}
            active={showPicker}
            invalid={attempted && dateMissing}
          />

          {/* Rendered next to the field it edits: on iOS `display="spinner"`
              lays out inline, so hoisting it would move the wheel away from
              the control it belongs to. */}
          {showPicker && (
            <DateTimePicker
              value={pickerValue(expenseDate)}
              mode="date"
              themeVariant={pickerTheme}
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={handleDateChange}
            />
          )}

          {/* Same field component as the date, so the two read as one pair.
              The chevron opens a sheet rather than a wheel — see
              <ExpenseTypeSheet>. */}
          <PickerField
            label="Expense type *"
            value={expenseType}
            placeholder="Choose a type"
            icon={expenseType ? expenseTypeIcon(expenseType) : 'pricetag-outline'}
            onPress={openTypeSheet}
            active={isTypeSheetVisible}
            invalid={attempted && typeMissing}
            style={{ marginTop: SPACING.md }}
          />
        </View>
      </ModuleCard>

      {/* ---------- Details ---------- */}
      <ModuleCard
        icon="cash-outline"
        title="Details"
        subtitle="How much, and what for"
        style={{ marginBottom: SPACING.md }}
      >
        <View style={cardBody}>
          <FormField
            label="Amount *"
            value={amount}
            onChangeText={setAmount}
            placeholder="0.00"
            icon="cash-outline"
            keyboardType="numeric"
            align="right"
            invalid={attempted && amountInvalid}
            accessibilityLabel="Amount"
          />

          <FormField
            label="Description"
            value={description}
            onChangeText={setDescription}
            placeholder="What was this expense for?"
            multiline
            optional
            style={{ marginTop: SPACING.md }}
          />
        </View>
      </ModuleCard>

      {/* ---------- Receipt ---------- */}
      <ModuleCard
        icon="attach-outline"
        title="Receipt"
        subtitle="Optional supporting document"
        style={{ marginBottom: SPACING.md }}
      >
        <View style={cardBody}>
          <UploadField
            file={fileUrl}
            onPick={pickFile}
            onRemove={handleRemoveAttachment}
          />
        </View>
      </ModuleCard>

      {/* Mirrors the checks handleSubmit already makes, surfaced after the
          first attempt. It gates nothing — pressing submit still runs the same
          validations and raises the same toast as the classic form. */}
      {!!missing && (
        <StatusBanner
          tone="error"
          title="Finish the form first"
          message={missing}
          style={{ marginBottom: SPACING.md }}
        />
      )}

      <ActionButton
        label="Submit claim"
        icon="paper-plane-outline"
        variant="filled"
        size="lg"
        elevated
        loading={isCreating}
        disabled={isCreating}
        onPress={onSubmitPress}
      />

      {/* The "History" heading is not here — it is the list's sticky section
          header, so it can pin to the top with its search bar once the form has
          scrolled away. See <HistorySectionHeader>. */}

      {/* Both sheets are <Modal>s — they render above the app rather than in
          this layout, so living inside the list header costs no height. */}
      <ExpenseTypeSheet
        visible={isTypeSheetVisible}
        types={expenseTypes}
        selected={expenseType}
        onSelect={selectExpenseType}
        onClose={closeTypeSheet}
      />

      {/* The modern picker, not components/attachment/AttachmentBottomSheet —
          that one is hardcoded light and is still what the classic form and the
          four screens that haven't been redesigned render. */}
      <AttachmentSheet
        visible={isBottomSheetVisible}
        onClose={closeBottomSheet}
        onSelectCamera={handlePickCamera}
        onSelectGallery={handlePickGallery}
        onSelectDocument={handlePickDocument}
      />
    </View>
  );
}

export default ClaimFormSection;
