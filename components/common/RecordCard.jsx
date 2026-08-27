/* eslint-disable react/prop-types */
import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import Card from './Card';
import StatusBadge from './StatusBadge';
import { resolveTextAlign } from '../../utils/textDirection';

/**
 * One submitted record, for the histories whose subject is a *span* rather than
 * a figure: Attendance Request and Leave Request.
 *
 * <ExpenseHistoryCard> and <LoanHistoryCard> both give an amount the headline
 * slot, because a claim and a loan are fundamentally about a number. A leave or
 * an attendance request is about a date range, so the headline here is the
 * range, and everything else is label/value rows underneath.
 *
 * Shared rather than written twice: the two differ only in which rows they pass,
 * and duplicating the header, the badge and the divider rhythm is exactly how
 * two lists start looking like two different apps.
 *
 * `rows` is `[{ label, value }]`, already formatted by the caller — this
 * component does no date or number formatting of its own. Rows with an empty
 * value are dropped rather than rendered as a dash, so a record that carries
 * half the optional fields doesn't get a column of blanks.
 */
function RecordCard({
  icon,
  title,
  subtitle,
  status,
  headline,
  rows = [],
  note,
  accessibilityLabel,
  style,
}) {
  const { colors } = useAppTheme();

  const shownRows = rows.filter(
    row => row?.value !== null && row?.value !== undefined && row?.value !== '',
  );

  return (
    <Card
      style={[{ padding: SPACING.md }, style]}
      accessible
      accessibilityLabel={accessibilityLabel}
    >
      {/* ---------- Header ---------- */}
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
          <Ionicons name={icon} size={ICON.md} color={colors.textPrimary} />
        </View>

        <View style={{ flex: 1, minWidth: 0, marginStart: SPACING.md }}>
          <Text
            numberOfLines={1}
            style={{ ...TYPO.headline, color: colors.textPrimary }}
          >
            {title}
          </Text>
          {!!subtitle && (
            <Text
              numberOfLines={1}
              style={{ ...TYPO.caption, color: colors.textMuted }}
            >
              {subtitle}
            </Text>
          )}
        </View>

        {!!status?.label && (
          <StatusBadge
            tone={status.tone}
            icon={status.icon}
            label={status.label}
            style={{ marginStart: SPACING.sm }}
          />
        )}
      </View>

      {/* ---------- The span ---------- */}
      {!!headline && (
        <Text
          numberOfLines={2}
          style={{
            ...TYPO.title3,
            color: colors.textPrimary,
            marginTop: SPACING.sm,
          }}
        >
          {headline}
        </Text>
      )}

      {/* ---------- Detail rows ---------- */}
      {shownRows.length > 0 && (
        <>
          <View
            style={{
              height: 1,
              backgroundColor: colors.dividerSubtle,
              marginTop: SPACING.md,
              marginBottom: SPACING.sm,
            }}
          />

          {shownRows.map((row, index) => (
            <View
              key={row.label}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginTop: index > 0 ? SPACING.xs : 0,
              }}
            >
              <Text
                style={{ ...TYPO.caption, color: colors.textMuted, flex: 1 }}
                numberOfLines={1}
              >
                {row.label}
              </Text>
              <Text
                style={{
                  ...TYPO.subhead,
                  fontWeight: '600',
                  color: colors.textSecondary,
                }}
                numberOfLines={1}
              >
                {row.value}
              </Text>
            </View>
          ))}
        </>
      )}

      {/* ---------- Free text ---------- */}
      {!!note && (
        <Text
          numberOfLines={2}
          style={{
            ...TYPO.subhead,
            fontWeight: '400',
            color: colors.textSecondary,
            marginTop: SPACING.sm,
            // Frappe free text is regularly Arabic; align to the script the
            // text actually contains rather than assuming Latin.
            textAlign: resolveTextAlign(note),
          }}
        >
          {note}
        </Text>
      )}
    </Card>
  );
}

export default React.memo(RecordCard);
