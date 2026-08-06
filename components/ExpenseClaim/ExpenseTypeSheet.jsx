/* eslint-disable react/prop-types */
import React from 'react';
import OptionSheet from '../common/OptionSheet';
import { expenseTypeIcon } from '../../utils/expenseClaims';

/**
 * The expense-type chooser.
 *
 * All of the sheet's behaviour now lives in <OptionSheet>, which Leave
 * Application uses for its leave types too — this file is what makes that
 * generic list *this* screen's: the heading, the empty-state wording, and the
 * glyph rule for an expense type.
 *
 * The props are unchanged from when this component owned the whole
 * implementation, so the modern Expense Claims form still calls it exactly as
 * before, and the value handed back is still the raw server string.
 */
function ExpenseTypeSheet({ visible, types = [], selected, onSelect, onClose }) {
  return (
    <OptionSheet
      visible={visible}
      onClose={onClose}
      title="Expense type"
      subtitle="What kind of expense was this?"
      options={types}
      selected={selected}
      onSelect={onSelect}
      iconForOption={expenseTypeIcon}
      emptyIcon="pricetags-outline"
      emptyTitle="No expense types"
      emptyDescription="Your administrator hasn't configured any expense claim types yet."
    />
  );
}

export default ExpenseTypeSheet;
