import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import {
  createLeaveApplication,
  getLeaveTypes,
  uploadLeaveAttachment,
} from '../services/api';
import { useAttachmentPicker } from './useAttachmentPicker';

/**
 * The sentinel the picker uses for "nothing chosen". Part of the contract with
 * `handleSubmit`, which rejects it — not a value the backend ever sees.
 */
export const NO_LEAVE_TYPE = '__none__';

/** The leave type that requires the remote-work acknowledgement. */
export const REMOTE_LEAVE_TYPE = 'Remote';

export const REMOTE_AGREEMENT_TEXT = `I acknowledge and agree to the proposed remote work arrangement.

I understand and agree to fulfil all my job responsibilities while working remotely, as outlined in my job description or as assigned by the Company.

I will maintain regular communication (30 minutes span) with my team members, supervisors, and other stakeholders through the designated communication channels established by the Company.

I will be available during the Company's regular working hours, making any necessary adjustments to accommodate time zone differences, if applicable. I will promptly notify my supervisor or designated point of contact of any anticipated unavailability or need for schedule adjustments.

I confirm that I possess the necessary equipment and technology required to perform my job remotely, including a reliable internet connection, a suitable computer or device, and any other tools specified by the Company.

I will be responsible for maintaining and securing my equipment and promptly reporting any technical issues or concerns to the designated IT support team.

I agree to maintain the confidentiality of all company information, trade secrets, customer data, and other sensitive information, both during and after the remote work arrangement.

I acknowledge that the remote work arrangement may be subject to reasonable changes and adjustments based on the Company's evolving needs, operational requirements, or changing circumstances.

I acknowledge that, at the Company's discretion, I may be required to return to the office for important meetings, collaborative work, training sessions, or as directed by the Company.

The employer reserves the right to approve or deny the leave request based on business needs and operational requirements.`;

/** `YYYY-MM-DD`, or "Select date" for anything unparseable. Lifted verbatim. */
export function formatDate(date) {
  if (!date) return 'Select date';

  const d = new Date(date);

  if (Number.isNaN(d.getTime())) return 'Select date';

  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Every bit of leave-application logic, shared by the classic and modern
 * screens so neither can drift from the other.
 *
 * The form state, the leave-type fetch, the date handlers, the attachment
 * pickers and `handleSubmit` — the validation order, the Alert copy, the payload
 * shape, the upload-after-create sequence and the post-success reset — are
 * lifted verbatim from the original screen. Nothing here was retuned while
 * moving it. In particular:
 *
 * - `posting_date` is `formatDate(new Date())`, not the `postingDate` state.
 *   The two are the same day in practice; the payload keeps the original
 *   expression rather than a tidier-looking equivalent.
 * - `acknowledgement_policy` is `1` for Remote and `undefined` otherwise, so the
 *   key is omitted from the JSON exactly as it was.
 * - Choosing From after To pushes To forward to match, which is the classic
 *   screen's behaviour and the reason the range can't be inverted by hand.
 *
 * The only thing dropped in the move is two `console.log` debug lines that
 * printed the created docname and the picked file.
 *
 * `dateRangeInvalid` / `typeMissing` / `agreementMissing` are additions used
 * only by the modern screen, to surface the same failures inline. They are
 * derived from the identical predicates `handleSubmit` already checks and they
 * gate nothing — submitting runs the same checks and raises the same Alerts on
 * both screens.
 */
export default function useLeaveRequest() {
  const [leaveType, setLeaveType] = useState(NO_LEAVE_TYPE);
  const [reason, setReason] = useState('');
  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());
  const [postingDate] = useState(new Date());
  const [agreed, setAgreed] = useState(false);
  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [leaveTypes, setLeaveTypes] = useState([]);
  const [attachment, setAttachment] = useState(null);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);
  const [isTypeSheetVisible, setTypeSheetVisible] = useState(false);

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  useEffect(() => {
    const fetchLeaveTypes = async () => {
      const { message, error } = await getLeaveTypes();

      if (error) {
        Alert.alert('Error', error);
      } else {
        setLeaveTypes(message || []);
      }
    };

    fetchLeaveTypes();
    // Mount only, exactly as the classic screen did.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Switching away from Remote drops the acknowledgement, so it can never be
  // carried into a leave type that didn't ask for it.
  useEffect(() => {
    if (leaveType !== REMOTE_LEAVE_TYPE) {
      setAgreed(false);
    }
  }, [leaveType]);

  /* ---------------------------------------------------------------------
   * Leave type
   * ------------------------------------------------------------------- */

  const openTypeSheet = useCallback(() => setTypeSheetVisible(true), []);
  const closeTypeSheet = useCallback(() => setTypeSheetVisible(false), []);

  const selectLeaveType = useCallback(type => {
    setLeaveType(type);
    setTypeSheetVisible(false);
  }, []);

  /* ---------------------------------------------------------------------
   * Dates
   * ------------------------------------------------------------------- */

  const openFromPicker = useCallback(() => setShowFromPicker(true), []);
  const openToPicker = useCallback(() => setShowToPicker(true), []);

  const handleFromChange = useCallback(
    (event, selectedDate) => {
      setShowFromPicker(false);

      if (event?.type === 'dismissed') return;
      if (!selectedDate) return;

      const validDate =
        selectedDate instanceof Date ? selectedDate : new Date(selectedDate);

      if (Number.isNaN(validDate.getTime())) return;

      setFromDate(validDate);

      if (validDate > toDate) {
        setToDate(validDate);
      }
    },
    [toDate],
  );

  const handleToChange = useCallback((event, selectedDate) => {
    setShowToPicker(false);

    if (event?.type === 'dismissed') return;
    if (!selectedDate) return;

    const validDate =
      selectedDate instanceof Date ? selectedDate : new Date(selectedDate);

    if (Number.isNaN(validDate.getTime())) return;

    setToDate(validDate);
  }, []);

  /* ---------------------------------------------------------------------
   * Attachment. The sheet is dismissed before the picker opens, then the
   * native picker is launched a beat later — presenting a camera or document
   * picker while a modal is still animating out drops it on both platforms.
   * ------------------------------------------------------------------- */

  const pickAttachment = useCallback(() => setBottomSheetVisible(true), []);
  const closeBottomSheet = useCallback(() => setBottomSheetVisible(false), []);
  const removeAttachment = useCallback(() => setAttachment(null), []);

  const handlePickCamera = useCallback(() => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickFromCamera();
      if (file) setAttachment(file);
    }, 400);
  }, [pickFromCamera]);

  const handlePickGallery = useCallback(() => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickFromGallery();
      if (file) setAttachment(file);
    }, 400);
  }, [pickFromGallery]);

  const handlePickDocument = useCallback(() => {
    setBottomSheetVisible(false);
    setTimeout(async () => {
      const file = await pickDocument();
      if (file) setAttachment(file);
    }, 400);
  }, [pickDocument]);

  /* ---------------------------------------------------------------------
   * Submit
   * ------------------------------------------------------------------- */

  const resetForm = useCallback(() => {
    setLeaveType(NO_LEAVE_TYPE);
    setReason('');
    setFromDate(new Date());
    setToDate(new Date());
    setAgreed(false);
    setAttachment(null);
  }, []);

  const handleSubmit = useCallback(async () => {
    const normalizeDate = date => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d;
    };

    const from = normalizeDate(fromDate);
    const to = normalizeDate(toDate);

    if (to < from) {
      Alert.alert('Invalid Date', 'To date cannot be before From date.');
      return;
    }

    if (!leaveType || leaveType === NO_LEAVE_TYPE) {
      Alert.alert('Missing Field', 'Please select a leave type.');
      return;
    }

    if (leaveType === REMOTE_LEAVE_TYPE && !agreed) {
      Alert.alert(
        'Agreement Required',
        'Please agree to the remote work policy.',
      );
      return;
    }

    const leaveData = {
      leave_type: leaveType,
      from_date: formatDate(fromDate),
      to_date: formatDate(toDate),
      posting_date: formatDate(new Date()),
      reason: reason.trim(),
      acknowledgement_policy:
        leaveType === REMOTE_LEAVE_TYPE ? 1 : undefined,
    };

    try {
      setLoading(true);

      const res = await createLeaveApplication(leaveData);

      if (res?.error) {
        Alert.alert('Error', res.error);
        return;
      }

      const docname = res?.message?.id;

      if (!docname) {
        throw new Error('Leave docname missing');
      }

      if (attachment) {
        const uploadRes = await uploadLeaveAttachment(attachment, docname);

        if (uploadRes?.error) {
          Alert.alert('Warning', 'Leave created, but attachment upload failed.');
        }
      }

      Alert.alert('Success', 'Leave request submitted successfully!', [
        {
          text: 'OK',
          onPress: resetForm,
        },
      ]);
    } catch (err) {
      Alert.alert('Error', err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, leaveType, agreed, reason, attachment, resetForm]);

  const isRemote = leaveType === REMOTE_LEAVE_TYPE;

  return {
    // Values
    leaveType,
    reason,
    fromDate,
    toDate,
    postingDate,
    agreed,
    leaveTypes,
    attachment,
    loading,
    isRemote,
    remoteAgreementText: REMOTE_AGREEMENT_TEXT,

    // Formatter, so both screens build a wire date the same way
    formatDate,

    // Setters
    setLeaveType,
    setReason,
    setAgreed,

    // Leave type sheet (modern only; the classic screen keeps its wheel)
    isTypeSheetVisible,
    openTypeSheet,
    closeTypeSheet,
    selectLeaveType,

    // Dates
    showFromPicker,
    showToPicker,
    openFromPicker,
    openToPicker,
    setShowFromPicker,
    setShowToPicker,
    handleFromChange,
    handleToChange,

    // Attachment
    isBottomSheetVisible,
    pickAttachment,
    closeBottomSheet,
    removeAttachment,
    setBottomSheetVisible,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,

    // Submit
    handleSubmit,

    // Display-only mirrors of handleSubmit's checks (modern screen)
    dateRangeInvalid: (() => {
      const from = new Date(fromDate);
      const to = new Date(toDate);
      from.setHours(0, 0, 0, 0);
      to.setHours(0, 0, 0, 0);
      return to < from;
    })(),
    typeMissing: !leaveType || leaveType === NO_LEAVE_TYPE,
    agreementMissing: isRemote && !agreed,
  };
}
