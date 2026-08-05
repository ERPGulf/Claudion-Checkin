import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useSelector } from 'react-redux';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import {
  createAttendanceRequest,
  uploadAttendanceAttachment,
} from '../services/api/attendance.service';
import { useAttachmentPicker } from './useAttachmentPicker';

/** The reasons the backend accepts. Order is the order they render in. */
export const ATTENDANCE_REQUEST_REASONS = ['Work From Home', 'On Duty'];

/** `YYYY-MM-DD` in local time — what `createAttendanceRequest` expects. */
export function formatDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `HH:MM:SS` in local time. */
export function formatTime(date) {
  return date.toTimeString().split(' ')[0];
}

/**
 * Every bit of attendance-request logic, shared by the classic and modern
 * screens so neither can drift from the other.
 *
 * The form state, the date/time picker plumbing, the attachment pickers and
 * `handleSubmit` — validation order, Alert copy, API calls and the post-success
 * reset — are lifted verbatim from the original screen. Nothing here was
 * retuned while moving it.
 *
 * `dateRangeInvalid` / `reasonMissing` are additions used only by the modern
 * screen, to render the same failures inline *before* submit. They are
 * derived from the identical predicates `handleSubmit` already checks, and they
 * gate nothing — submitting still runs the same checks and raises the same
 * Alerts on both screens, so the classic screen's behaviour is unchanged.
 */
export default function useAttendanceRequest() {
  const employeeCode = useSelector(selectEmployeeCode);

  const [fromDate, setFromDate] = useState(new Date());
  const [toDate, setToDate] = useState(new Date());

  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [fromTime, setFromTime] = useState(new Date());
  const [toTime, setToTime] = useState(new Date());

  const [showFromTimePicker, setShowFromTimePicker] = useState(false);
  const [showToTimePicker, setShowToTimePicker] = useState(false);

  const [selectedReason, setSelectedReason] = useState('');

  const [loading, setLoading] = useState(false);
  const [attachment, setAttachment] = useState(null);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  // Recomputed per render, exactly as the original screen did, so a session
  // left open past midnight still caps the pickers at the real "today".
  const today = new Date();

  /* ---------------------------------------------------------------------
   * Date & time pickers. Each `onChange` closes the picker first and only
   * commits a value when one came back — the Android dialog fires with
   * `undefined` on dismiss.
   * ------------------------------------------------------------------- */

  const openFromPicker = useCallback(() => setShowFromPicker(true), []);
  const openToPicker = useCallback(() => setShowToPicker(true), []);
  const openFromTimePicker = useCallback(() => setShowFromTimePicker(true), []);
  const openToTimePicker = useCallback(() => setShowToTimePicker(true), []);

  const onFromDateChange = useCallback((event, selected) => {
    setShowFromPicker(false);
    if (selected) setFromDate(selected);
  }, []);

  const onToDateChange = useCallback((event, selected) => {
    setShowToPicker(false);
    if (selected) setToDate(selected);
  }, []);

  const onFromTimeChange = useCallback((event, selected) => {
    setShowFromTimePicker(false);
    if (selected) setFromTime(selected);
  }, []);

  const onToTimeChange = useCallback((event, selected) => {
    setShowToTimePicker(false);
    if (selected) setToTime(selected);
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

  const handleSubmit = useCallback(async () => {
    try {
      if (!employeeCode) {
        Alert.alert('Error', 'Employee not found');
        return;
      }

      if (toDate < fromDate) {
        Alert.alert('Invalid Date', 'To date cannot be before From date.');
        return;
      }

      if (!selectedReason) {
        Alert.alert('Missing Field', 'Please select a reason.');
        return;
      }

      const payload = {
        employee: employeeCode,
        from_date: formatDate(fromDate),
        to_date: formatDate(toDate),
        reason: selectedReason,
        from_time: formatTime(fromTime),
        to_time: formatTime(toTime),
      };

      setLoading(true);

      const res = await createAttendanceRequest(payload);

      if (!res.success) {
        Alert.alert('Error', res.message);
        return;
      }

      const docname = res.docname;

      // ✅ OPTIONAL FILE
      if (attachment) {
        const uploadRes = await uploadAttendanceAttachment(attachment, docname);

        if (uploadRes?.error) {
          Alert.alert(
            'Warning',
            'Request created, but attachment upload failed.',
          );
        }
      }

      Alert.alert('Success', 'Attendance request submitted!');

      // Reset
      setAttachment(null);
      setSelectedReason('');
      setFromDate(new Date());
      setToDate(new Date());
      setFromTime(new Date());
      setToTime(new Date());
    } catch (error) {
      Alert.alert('Error', 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, [employeeCode, toDate, fromDate, selectedReason, fromTime, toTime, attachment]);

  return {
    employeeCode,

    // Values
    fromDate,
    toDate,
    fromTime,
    toTime,
    selectedReason,
    attachment,
    loading,
    reasons: ATTENDANCE_REQUEST_REASONS,
    today,

    // Formatters, so both screens render a value the same way
    formatDate,
    formatTime,

    // Date & time pickers
    showFromPicker,
    showToPicker,
    showFromTimePicker,
    showToTimePicker,
    openFromPicker,
    openToPicker,
    openFromTimePicker,
    openToTimePicker,
    onFromDateChange,
    onToDateChange,
    onFromTimeChange,
    onToTimeChange,

    // Reason
    setSelectedReason,

    // Attachment
    isBottomSheetVisible,
    pickAttachment,
    closeBottomSheet,
    removeAttachment,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,

    // Submit
    handleSubmit,

    // Display-only mirrors of handleSubmit's checks (modern screen)
    dateRangeInvalid: toDate < fromDate,
    reasonMissing: !selectedReason,
  };
}
