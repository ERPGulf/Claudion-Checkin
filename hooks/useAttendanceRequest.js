import { useCallback, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { useRoute } from '@react-navigation/native';
import { useSelector } from 'react-redux';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import { resolveWithCorrection } from '../services/offline/AttendanceQueueService';
import {
  createAttendanceRequest,
  getAttendanceRequests,
  uploadAttendanceAttachment,
} from '../services/api/attendance.service';
import { useAttachmentPicker } from './useAttachmentPicker';
import useRequestHistory from './useRequestHistory';

/**
 * Minutes since midnight — used to compare two times that carry their own,
 * irrelevant, date component.
 */
const minutesOfDay = date => date.getHours() * 60 + date.getMinutes();

/** Whether two Dates fall on the same calendar day, locally. */
export function isSameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * The production rule: on a single-day request, To time must be after From time.
 *
 * Deliberately scoped to same-day only. A request spanning two or more days is
 * legitimately "17:00 → 09:00", and rejecting that would break the overnight
 * case the date range already expresses.
 */
export function timeRangeInvalid(fromDate, toDate, fromTime, toTime) {
  if (!isSameCalendarDay(fromDate, toDate)) return false;

  return minutesOfDay(toTime) <= minutesOfDay(fromTime);
}

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

  /**
   * Optional prefill, from the offline sync sheet's "Submit attendance request".
   *
   * The app knows the exact instant of the punch that was refused, so asking the
   * employee to retype it from memory would be both tedious and a source of
   * mismatches between what they punched and what HR receives.
   *
   * `queueRowId` is carried through so a successful submission can mark the
   * rejected record — and its paired punch — resolved, which is what finally
   * clears the banner.
   */
  const route = useRoute();
  const prefill = route?.params?.prefill ?? null;

  const initialDate = prefill?.date instanceof Date ? prefill.date : new Date();
  const initialTime = prefill?.time instanceof Date ? prefill.time : new Date();

  const [fromDate, setFromDate] = useState(initialDate);
  const [toDate, setToDate] = useState(initialDate);

  const [showFromPicker, setShowFromPicker] = useState(false);
  const [showToPicker, setShowToPicker] = useState(false);
  const [fromTime, setFromTime] = useState(initialTime);
  const [toTime, setToTime] = useState(initialTime);

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
   * Date & time pickers.
   *
   * Android presents a modal dialog that dismisses itself once a value is
   * picked, and fires `onChange` with `undefined` when it is cancelled — so
   * there, closing on the first event is correct.
   *
   * iOS presents an inline spinner that stays on screen, and fires `onChange`
   * on *every* tick as the wheel moves. Closing on the first event therefore
   * tore the picker away the instant it was touched, committing whichever value
   * happened to be under the finger — you could not scroll to a date at all.
   * On iOS the picker stays open and the screens render an explicit Done, which
   * calls `closeFromPicker` and friends.
   * ------------------------------------------------------------------- */

  const isIOS = Platform.OS === 'ios';

  const openFromPicker = useCallback(() => setShowFromPicker(true), []);
  const openToPicker = useCallback(() => setShowToPicker(true), []);
  const openFromTimePicker = useCallback(() => setShowFromTimePicker(true), []);
  const openToTimePicker = useCallback(() => setShowToTimePicker(true), []);

  const closeFromPicker = useCallback(() => setShowFromPicker(false), []);
  const closeToPicker = useCallback(() => setShowToPicker(false), []);
  const closeFromTimePicker = useCallback(
    () => setShowFromTimePicker(false),
    [],
  );
  const closeToTimePicker = useCallback(() => setShowToTimePicker(false), []);

  const onFromDateChange = useCallback(
    (event, selected) => {
      if (!isIOS) setShowFromPicker(false);
      if (selected) setFromDate(selected);
    },
    [isIOS],
  );

  const onToDateChange = useCallback(
    (event, selected) => {
      if (!isIOS) setShowToPicker(false);
      if (selected) setToDate(selected);
    },
    [isIOS],
  );

  const onFromTimeChange = useCallback(
    (event, selected) => {
      if (!isIOS) setShowFromTimePicker(false);
      if (selected) setFromTime(selected);
    },
    [isIOS],
  );

  const onToTimeChange = useCallback(
    (event, selected) => {
      if (!isIOS) setShowToTimePicker(false);
      if (selected) setToTime(selected);
    },
    [isIOS],
  );

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
   * Submitted requests — the shared history, newest first.
   * ------------------------------------------------------------------- */

  const history = useRequestHistory({
    queryKey: 'attendanceRequests',
    fetcher: getAttendanceRequests,
    sortBy: 'from_date',
  });

  // Both stable — react-query's refetch and a useCallback([]) — so
  // handleSubmit is not rebuilt on every render the way depending on the
  // wrapper object would force.
  const { refetch: refetchHistory, resetPagination: resetHistoryPage } =
    history;

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

      if (timeRangeInvalid(fromDate, toDate, fromTime, toTime)) {
        Alert.alert('Invalid Time', 'To time must be after From time.');
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

      // The correction now covers the rejected punch, so the queue rows stop
      // counting as unresolved and the banner clears. They are kept, not
      // deleted — they are the evidence of what was originally punched.
      if (prefill?.queueRowId) {
        try {
          await resolveWithCorrection({
            id: prefill.queueRowId,
            resolutionDocname: docname,
          });
        } catch (resolveError) {
          // The request itself succeeded; failing to tidy the local record must
          // not report the submission as failed.
          console.log('Failed to resolve queued attendance:', resolveError?.message);
        }
      }

      // Refresh before the Alert, so the new request is already in the list
      // behind it rather than appearing a beat after "OK".
      await refetchHistory();
      resetHistoryPage();

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
  }, [
    employeeCode,
    toDate,
    fromDate,
    selectedReason,
    fromTime,
    toTime,
    attachment,
    prefill,
    refetchHistory,
    resetHistoryPage,
  ]);

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

    // iOS keeps the spinner open until an explicit Done; Android never shows it.
    needsDoneAffordance: isIOS,
    closeFromPicker,
    closeToPicker,
    closeFromTimePicker,
    closeToTimePicker,

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

    // History
    attendanceRequests: history.items,
    visibleRequests: history.visible,
    hasMoreRequests: history.hasMore,
    showMoreRequests: history.showMore,
    isFetchingHistory: history.isLoading,
    isHistoryError: history.isError,
    historyError: history.error,
    refetchHistory: history.refetch,

    // Display-only mirrors of handleSubmit's checks (modern screen)
    dateRangeInvalid: toDate < fromDate,
    timeRangeInvalid: timeRangeInvalid(fromDate, toDate, fromTime, toTime),
    reasonMissing: !selectedReason,
  };
}
