/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import Card from '../common/Card';
import StatusBadge from '../common/StatusBadge';
import { resolveTextAlign } from '../../utils/textDirection';
import { formatExpenseAmount, formatExpenseDate } from '../../utils/expenseClaims';
import {
  describeLoanForA11y,
  describeLoanStatus,
  loanProductIcon,
} from '../../utils/loanApplication';

/**
 * One submitted loan application.
 *
 * Deliberately the same three bands as <ExpenseHistoryCard> — header, headline
 * figure, then the supporting detail behind a hairline — so the two histories
 * read as one product rather than two screens that both happen to list records.
 * Every colour comes off the palette, which is what makes this card work in dark
 * mode where the classic <LoanApplicationCard> (hardcoded #E5E7EB / #F3F0FF)
 * cannot.
 *
 * The loan amount is the anchor at title1 and tabular. The repayment figure sits
 * below it as a secondary row rather than a second headline: it is the *plan*,
 * not the request, and giving both the same weight left neither reading as the
 * number the card is about.
 *
 * The repayment method is a full-width row rather than a right-aligned value —
 * "Repay Fixed Amount per Period" is far too long to sit opposite a label on a
 * phone, which is exactly where the classic card wrapped it to two cramped lines.
 */
function LoanHistoryCard({ loan, style }) {
  const { colors } = useAppTheme();

  const {
    tone,
    label: statusLabel,
    icon: statusIcon,
  } = describeLoanStatus(loan?.status);

  const hasRepayment =
    loan?.repayment_amount !== null && loan?.repayment_amount !== undefined;

  return (
    <Card
      style={[{ padding: SPACING.md }, style]}
      accessible
      accessibilityLabel={describeLoanForA11y(loan)}
    >
      {/* ---------- Header: which product, and where it stands ---------- */}
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: RADIUS.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.iconBackground,
          }}
        >
          <Ionicons
            name={loanProductIcon(loan?.loan_product)}
            size={ICON.md}
            color={colors.textPrimary}
          />
        </View>

        <View style={{ flex: 1, minWidth: 0, marginStart: SPACING.md }}>
          <Text
            numberOfLines={1}
            style={{ ...TYPO.headline, color: colors.textPrimary }}
          >
            {loan?.loan_product || 'Loan application'}
          </Text>
          <Text
            numberOfLines={1}
            style={{ ...TYPO.caption, color: colors.textMuted }}
          >
            {formatExpenseDate(loan?.posting_date)}
          </Text>
        </View>

        {!!loan?.status && (
          <StatusBadge
            tone={tone}
            icon={statusIcon}
            label={statusLabel}
            style={{ marginStart: SPACING.sm }}
          />
        )}
      </View>

      {/* ---------- Amount ---------- */}
      <Text
        style={{
          ...TYPO.title1,
          color: colors.textPrimary,
          fontVariant: ['tabular-nums'],
          marginTop: SPACING.sm,
        }}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {formatExpenseAmount(loan?.loan_amount)}
      </Text>

      {/* ---------- Repayment plan ---------- */}
      {(hasRepayment || !!loan?.repayment_method) && (
        <>
          <View
            style={{
              height: 1,
              backgroundColor: colors.dividerSubtle,
              marginTop: SPACING.md,
              marginBottom: SPACING.sm,
            }}
          />

          {hasRepayment && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: loan?.repayment_method ? SPACING.xs : 0,
              }}
            >
              <Text
                style={{ ...TYPO.caption, color: colors.textMuted, flex: 1 }}
              >
                Repayment
              </Text>
              <Text
                style={{
                  ...TYPO.subhead,
                  fontWeight: '600',
                  color: colors.textSecondary,
                  fontVariant: ['tabular-nums'],
                }}
                numberOfLines={1}
              >
                {`${formatExpenseAmount(loan.repayment_amount)} / month`}
              </Text>
            </View>
          )}

          {!!loan?.repayment_method && (
            <Text
              numberOfLines={2}
              style={{ ...TYPO.caption, color: colors.textMuted }}
            >
              {loan.repayment_method}
            </Text>
          )}
        </>
      )}

      {/* ---------- Reason ---------- */}
      {!!loan?.reason && (
        <Text
          numberOfLines={2}
          style={{
            ...TYPO.subhead,
            fontWeight: '400',
            color: colors.textSecondary,
            marginTop: SPACING.sm,
            // Frappe reasons are regularly Arabic; align to the script the text
            // actually contains rather than assuming Latin.
            textAlign: resolveTextAlign(loan.reason),
          }}
        >
          {loan.reason}
        </Text>
      )}
    </Card>
  );
}

/**
 * Memoised for the same reason <ExpenseHistoryCard> is: the screen re-renders on
 * every keystroke in the form above the list, and without this every card
 * already on screen would re-render with it.
 */
export default React.memo(LoanHistoryCard);
