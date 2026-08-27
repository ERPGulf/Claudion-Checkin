import { useCallback, useEffect, useState } from 'react';
import { Alert, Platform, ToastAndroid } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import {
  getLoanApplications,
  getLoanProducts,
  LoanApplicationRequest,
} from '../services/api/loanApplication.service';
import { LOAN_REPAYMENT_METHODS } from '../utils/loanApplication';
import { useAttachmentPicker } from './useAttachmentPicker';
import useRequestHistory from './useRequestHistory';

export { PAGE_SIZE } from './useRequestHistory';

/**
 * Everything the loan application does, lifted out of the classic screen and its
 * form so the modern UI is presentation only.
 *
 * The flow is unchanged. The product list still comes from `getLoanProducts()` on
 * mount and still toasts "Unable to load loan products." on failure; the mutation
 * is still `LoanApplicationRequest` with the same success and error Alerts;
 * `handleSubmit` runs the production checks in the production order with the
 * production toast strings, and builds the payload:
 *
 *     { product_name, amount, repayment_amount, repayment_method,
 *       reason, file1, file2 }
 *
 * with `product_name` and `reason` trimmed and both amounts coerced through
 * `Number()`. `repayment_amount` and `repayment_method` are required — the
 * backend's loan approval workflow needs a repayment plan attached to the
 * application, and an application without one cannot be processed. They are
 * checked between the amount and the reason, which is where production puts
 * them. Notably preserved as-is:
 *
 * - Attachment 1 is required and Attachment 2 is not — that asymmetry is the
 *   classic form's, and the modern screen labels the two accordingly rather than
 *   changing the rule.
 * - The 300ms beat before opening a picker (the classic loan form's value; other
 *   screens use 400/500).
 * - A failed submit raises *both* the mutation's "Error" Alert and the form's
 *   "Failed to submit loan application." toast, because `mutateAsync` rejects
 *   into `handleSubmit`'s catch. That double notice is what ships today, so it is
 *   kept rather than quietly tidied.
 *
 * Dropped in the move: three `console.log` debug lines.
 *
 * `components/LoanApplication/LoanApplicationForm.js` deliberately does not use
 * this hook — it keeps its own inline copy, so the classic screen keeps its own
 * layout and toasts. That copy enforces the *same* rules, including the two
 * repayment fields; the duplication is the price of leaving the classic screen
 * visually untouched, and the two must be changed together.
 *
 * The submitted-application history lives here too: one query, sorted newest
 * first, with a client-side "load more" cursor — the same arrangement
 * `useExpenseClaims` uses, because the endpoint likewise returns everything in
 * one response. A successful submission refetches it before the success Alert,
 * so the new application is on screen by the time the Alert is dismissed.
 *
 * The `*Missing` / `*Invalid` flags and `attachmentCount` are additions for the
 * modern screen's inline banner and summary card; they are derived from the same
 * predicates `handleSubmit` checks and gate nothing.
 */
export default function useLoanApplication() {
  const [productName, setProductName] = useState('');
  const [amount, setAmount] = useState('');
  const [repaymentAmount, setRepaymentAmount] = useState('');
  const [repaymentMethod, setRepaymentMethod] = useState('');
  const [reason, setReason] = useState('');
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [activeAttachment, setActiveAttachment] = useState(null);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);
  const [isProductSheetVisible, setProductSheetVisible] = useState(false);
  const [isRepaymentSheetVisible, setRepaymentSheetVisible] = useState(false);
  const [loanProducts, setLoanProducts] = useState([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  const showToast = useCallback(msg => {
    if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT);
    else Alert.alert('Notice', msg);
  }, []);

  const resetForm = useCallback(() => {
    setProductName('');
    setAmount('');
    setRepaymentAmount('');
    setRepaymentMethod('');
    setReason('');
    setFile1(null);
    setFile2(null);
  }, []);

  /* ---------------------------------------------------------------------
   * Loan products
   * ------------------------------------------------------------------- */

  useEffect(() => {
    const fetchLoanProducts = async () => {
      try {
        setLoadingProducts(true);

        const response = await getLoanProducts();

        // The service already unwraps `{ message }` / `{ data }`; this is the
        // last guard, so a tenant returning something else entirely leaves the
        // picker empty rather than crashing the screen on `.map()`.
        setLoanProducts(Array.isArray(response) ? response : []);
      } catch {
        showToast('Unable to load loan products.');
      } finally {
        setLoadingProducts(false);
      }
    };

    fetchLoanProducts();
    // Mount only, exactly as the classic form did — the list is per-tenant
    // configuration, not per-render state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openProductSheet = useCallback(() => setProductSheetVisible(true), []);
  const closeProductSheet = useCallback(() => setProductSheetVisible(false), []);

  const selectProduct = useCallback(product => {
    // The raw `product_name` string the wheel would have handed back.
    setProductName(product);
    setProductSheetVisible(false);
  }, []);

  /* ---------------------------------------------------------------------
   * Repayment method. A fixed list rather than a fetch — see
   * LOAN_REPAYMENT_METHODS — but presented through the same sheet as the
   * products so the two fields behave identically.
   * ------------------------------------------------------------------- */

  const repaymentMethods = LOAN_REPAYMENT_METHODS;

  const openRepaymentSheet = useCallback(
    () => setRepaymentSheetVisible(true),
    [],
  );
  const closeRepaymentSheet = useCallback(
    () => setRepaymentSheetVisible(false),
    [],
  );

  const selectRepaymentMethod = useCallback(method => {
    setRepaymentMethod(method);
    setRepaymentSheetVisible(false);
  }, []);

  /* ---------------------------------------------------------------------
   * Attachments. Two independent slots — `activeAttachment` records which one
   * the sheet was opened for, exactly as the classic form does, so the picked
   * file lands in the right one. The sheet is dismissed before the picker
   * opens, then the native picker is launched a beat later: presenting a camera
   * or document picker while a modal is still animating out drops it.
   * ------------------------------------------------------------------- */

  const openAttachmentPicker = useCallback(type => {
    setActiveAttachment(type);
    setBottomSheetVisible(true);
  }, []);

  const closeBottomSheet = useCallback(() => setBottomSheetVisible(false), []);

  const pickFile1 = useCallback(
    () => openAttachmentPicker('file1'),
    [openAttachmentPicker],
  );
  const pickFile2 = useCallback(
    () => openAttachmentPicker('file2'),
    [openAttachmentPicker],
  );

  const removeFile1 = useCallback(() => setFile1(null), []);
  const removeFile2 = useCallback(() => setFile2(null), []);

  const storePickedFile = useCallback(
    pickedFile => {
      if (!pickedFile) return;

      if (activeAttachment === 'file1') setFile1(pickedFile);
      else setFile2(pickedFile);
    },
    [activeAttachment],
  );

  const handlePickCamera = useCallback(() => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      storePickedFile(await pickFromCamera());
    }, 300);
  }, [pickFromCamera, storePickedFile]);

  const handlePickGallery = useCallback(() => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      storePickedFile(await pickFromGallery());
    }, 300);
  }, [pickFromGallery, storePickedFile]);

  const handlePickDocument = useCallback(() => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      storePickedFile(await pickDocument());
    }, 300);
  }, [pickDocument, storePickedFile]);

  /* ---------------------------------------------------------------------
   * Submitted applications — the shared history, sorted on posting_date.
   * ------------------------------------------------------------------- */

  const {
    items: loanApplications,
    visible: visibleLoans,
    hasMore: hasMoreLoans,
    showMore: showMoreLoans,
    resetPagination,
    isLoading: isFetchingHistory,
    isError: isHistoryError,
    error: historyError,
    isRefetching: isRefetchingHistory,
    refetch: refetchHistory,
  } = useRequestHistory({
    queryKey: 'loanApplications',
    fetcher: getLoanApplications,
    sortBy: 'posting_date',
  });

  /* ---------------------------------------------------------------------
   * Submit
   * ------------------------------------------------------------------- */

  const { mutateAsync: submitRequest, isPending } = useMutation({
    mutationFn: LoanApplicationRequest,

    onSuccess: async () => {
      // Refresh before the Alert, so the new application is already in the list
      // behind it rather than appearing a beat after "OK".
      await refetchHistory();
      resetPagination();

      Alert.alert('Success', 'Loan application submitted successfully.', [
        {
          text: 'OK',
          onPress: resetForm,
        },
      ]);
    },

    onError: err => {
      Alert.alert('Error', err.message || 'Failed to submit loan application.');
    },
  });

  const handleSubmit = useCallback(async () => {
    const amountValue = Number(amount);
    const repaymentAmountValue = Number(repaymentAmount);

    if (!productName.trim()) {
      return showToast('Please select loan product.');
    }

    if (!amount.trim()) {
      return showToast('Please enter amount.');
    }

    if (Number.isNaN(amountValue) || amountValue <= 0) {
      return showToast('Please enter a valid amount.');
    }

    if (!repaymentAmount.trim()) {
      return showToast('Please enter repayment amount.');
    }

    if (Number.isNaN(repaymentAmountValue) || repaymentAmountValue <= 0) {
      return showToast('Please enter a valid repayment amount.');
    }

    if (!repaymentMethod) {
      return showToast('Please select repayment method.');
    }

    if (!reason.trim()) {
      return showToast('Please enter the reason.');
    }

    if (!file1) {
      return showToast('Please upload File 1.');
    }

    const payload = {
      product_name: productName.trim(),
      amount: amountValue,
      repayment_amount: repaymentAmountValue,
      repayment_method: repaymentMethod,
      reason: reason.trim(),
      file1,
      file2,
    };

    try {
      return await submitRequest(payload);
    } catch {
      // The mutation's onError has already raised the "Error" Alert; this is the
      // classic form's own catch, kept so the notice pair is unchanged.
      return showToast('Failed to submit loan application.');
    }
  }, [
    productName,
    amount,
    repaymentAmount,
    repaymentMethod,
    reason,
    file1,
    file2,
    submitRequest,
    showToast,
  ]);

  const amountValue = Number(amount);
  const repaymentAmountValue = Number(repaymentAmount);

  return {
    // Values
    productName,
    amount,
    repaymentAmount,
    repaymentMethod,
    reason,
    file1,
    file2,
    loanProducts,
    loadingProducts,
    isPending,
    isBottomSheetVisible,
    isProductSheetVisible,
    isRepaymentSheetVisible,

    // Setters
    setProductName,
    setAmount,
    setRepaymentAmount,
    setReason,

    // Loan product
    openProductSheet,
    closeProductSheet,
    selectProduct,

    // Repayment method
    repaymentMethods,
    openRepaymentSheet,
    closeRepaymentSheet,
    selectRepaymentMethod,

    // Attachments
    pickFile1,
    pickFile2,
    removeFile1,
    removeFile2,
    closeBottomSheet,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,

    // Submit
    handleSubmit,
    showToast,

    // History
    loanApplications,
    visibleLoans,
    hasMoreLoans,
    showMoreLoans,
    isFetchingHistory,
    isRefetchingHistory,
    isHistoryError,
    historyError,
    refetchHistory,

    // Display-only mirrors of handleSubmit's checks (modern screen)
    productMissing: !productName.trim(),
    amountMissing: !amount.trim(),
    amountInvalid:
      !!amount.trim() && (Number.isNaN(amountValue) || amountValue <= 0),
    repaymentAmountMissing: !repaymentAmount.trim(),
    repaymentAmountInvalid:
      !!repaymentAmount.trim() &&
      (Number.isNaN(repaymentAmountValue) || repaymentAmountValue <= 0),
    repaymentMethodMissing: !repaymentMethod,
    reasonMissing: !reason.trim(),
    file1Missing: !file1,
    attachmentCount: (file1 ? 1 : 0) + (file2 ? 1 : 0),
  };
}
