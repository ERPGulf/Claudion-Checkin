import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import { getExpenseTypes } from '../services/api/expense.service';
import { useAttachmentPicker } from './useAttachmentPicker';

/**
 * The form half of Expense Claims: field state, the expense-type list, the
 * date picker, the attachment pickers and `handleSubmit`.
 *
 * Shared by the classic <ClaimForm> and the modern screen so neither can drift
 * from the other. The validation order, the toast strings, the payload shape and
 * the reset-on-signal effect are lifted verbatim from the original ClaimForm.
 * Nothing here was retuned while moving it — in particular `handleSubmit` still
 * checks date, then type, then amount, and still toasts rather than blocking the
 * button.
 *
 * `dateMissing` / `typeMissing` / `amountInvalid` are additions used only by the
 * modern screen, to surface the same failures inline *before* submit. They are
 * derived from the identical predicates `handleSubmit` already checks and they
 * gate nothing: submitting runs the same checks and raises the same toasts on
 * both screens, so the classic form's behaviour is unchanged.
 */
export default function useExpenseClaimForm({ onSubmit, resetSignal } = {}) {
  const [expenseDate, setExpenseDate] = useState('');
  const [expenseType, setExpenseType] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [fileUrl, setFileUrl] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);
  const [isTypeSheetVisible, setTypeSheetVisible] = useState(false);
  const [expenseTypes, setExpenseTypes] = useState([]);

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  const showToast = useCallback(msg => {
    if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
    else Alert.alert('Notice', msg);
  }, []);

  useEffect(() => {
    setExpenseDate('');
    setExpenseType('');
    setDescription('');
    setAmount('');
    setFileUrl(null);
  }, [resetSignal]);

  useEffect(() => {
    const loadExpenseTypes = async () => {
      const res = await getExpenseTypes();

      if (res?.error) {
        showToast(res.error);
        return;
      }

      setExpenseTypes(res.message || []);
    };

    loadExpenseTypes();
    // Mount only, exactly as the classic form did — the list is per-tenant
    // configuration, not per-render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------------------------------------------
   * Date
   * ------------------------------------------------------------------- */

  const showDatePicker = useCallback(() => setShowPicker(true), []);

  const handleDateChange = useCallback((event, selectedDate) => {
    setShowPicker(false);
    if (selectedDate) {
      const formatted = selectedDate.toISOString().split('T')[0];
      setExpenseDate(formatted);
    }
  }, []);

  /* ---------------------------------------------------------------------
   * Expense type
   * ------------------------------------------------------------------- */

  const openTypeSheet = useCallback(() => setTypeSheetVisible(true), []);
  const closeTypeSheet = useCallback(() => setTypeSheetVisible(false), []);

  const selectExpenseType = useCallback(type => {
    setExpenseType(type);
    setTypeSheetVisible(false);
  }, []);

  /* ---------------------------------------------------------------------
   * Attachment. The sheet is dismissed before the picker opens, then the
   * native picker is launched a beat later — presenting a camera or document
   * picker while a modal is still animating out drops it on both platforms.
   * ------------------------------------------------------------------- */

  const pickFile = useCallback(() => setBottomSheetVisible(true), []);
  const closeBottomSheet = useCallback(() => setBottomSheetVisible(false), []);
  const handleRemoveAttachment = useCallback(() => setFileUrl(null), []);

  const handlePickCamera = useCallback(() => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickFromCamera();
      if (file) {
        setFileUrl(file);
        showToast(`✅ Photo attached: ${file.name}`);
      }
    }, 500);
  }, [pickFromCamera, showToast]);

  const handlePickGallery = useCallback(() => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickFromGallery();
      if (file) {
        setFileUrl(file);
        showToast(`✅ Image attached: ${file.name}`);
      }
    }, 500);
  }, [pickFromGallery, showToast]);

  const handlePickDocument = useCallback(() => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickDocument();
      if (file) {
        setFileUrl(file);
        showToast(`✅ File attached: ${file.name}`);
      }
    }, 500);
  }, [pickDocument, showToast]);

  /* ---------------------------------------------------------------------
   * Submit
   * ------------------------------------------------------------------- */

  const handleSubmit = useCallback(async () => {
    if (!expenseDate.trim()) return showToast('Please select an expense date.');
    if (!expenseType) return showToast('Please select an expense type.');
    if (!amount.trim() || Number.isNaN(Number(amount))) {
      return showToast('Please enter a valid amount.');
    }

    const payload = {
      expense_date: expenseDate.trim(),
      expense_type: expenseType,
      description: description.trim(),
      amount: Number.parseFloat(amount),
      file_url: fileUrl,
    };

    try {
      await onSubmit?.(payload);
    } catch {
      showToast('Failed to submit claim. Please try again.');
    }
  }, [
    expenseDate,
    expenseType,
    amount,
    description,
    fileUrl,
    onSubmit,
    showToast,
  ]);

  return {
    // Values
    expenseDate,
    expenseType,
    description,
    amount,
    fileUrl,
    expenseTypes,

    // Setters
    setExpenseType,
    setDescription,
    setAmount,

    // Date
    showPicker,
    showDatePicker,
    handleDateChange,

    // Expense type
    isTypeSheetVisible,
    openTypeSheet,
    closeTypeSheet,
    selectExpenseType,

    // Attachment
    isBottomSheetVisible,
    pickFile,
    closeBottomSheet,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,
    handleRemoveAttachment,

    // Submit
    handleSubmit,
    showToast,

    // Display-only mirrors of handleSubmit's checks (modern screen)
    dateMissing: !expenseDate.trim(),
    typeMissing: !expenseType,
    amountInvalid: !amount.trim() || Number.isNaN(Number(amount)),
  };
}
