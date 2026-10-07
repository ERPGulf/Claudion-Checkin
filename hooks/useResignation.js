import { useCallback, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import { submitResignation as submitResignationRequest } from '../services/api/resignation.service';
import { useAttachmentPicker } from './useAttachmentPicker';
import { formatResignationDate } from '../utils/resignation';
import { formatLogDate } from '../utils/attendanceHistory';
import { hapticsMessage } from '../utils/HapticsMessage';

/**
 * Everything the resignation form does, shared by screens/Resignation.jsx and
 * screens/ResignationLegacy.jsx so both only render.
 *
 * - The reason is validated on press (Alert), not by disabling the button.
 * - A resignation cannot be withdrawn from the app, so submitting asks for
 *   confirmation first; nothing is sent until the employee confirms.
 * - `inFlight` blocks a second request while one is running, since a double
 *   tap on the confirm button would otherwise file two resignations.
 * - Up to two optional attachments travel in the same request as the
 *   resignation (`file1` / `file2`), so there is no half-submitted state where
 *   the record exists but its files don't.
 * - On success the form resets and `submitted` holds the created record for the
 *   confirmation banner. On failure everything the employee entered is kept.
 */
export default function useResignation() {
  const [resignationDate, setResignationDate] = useState(() => new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [reason, setReason] = useState('');
  const [file1, setFile1] = useState(null);
  const [file2, setFile2] = useState(null);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const inFlight = useRef(false);
  // Which slot the open sheet is filling. A ref, so the picker callback that
  // resolves after the sheet closes still writes to the slot that opened it.
  const activeSlot = useRef('file1');

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  /* ---------------------------------------------------------------------
   * Attachments. The sheet is dismissed before the picker opens, then the
   * native picker is launched a beat later — presenting a picker while a
   * modal is still animating out drops it on both platforms.
   * ------------------------------------------------------------------- */

  const openAttachmentPicker = useCallback(slot => {
    activeSlot.current = slot;
    setBottomSheetVisible(true);
  }, []);

  const pickFile1 = useCallback(
    () => openAttachmentPicker('file1'),
    [openAttachmentPicker],
  );
  const pickFile2 = useCallback(
    () => openAttachmentPicker('file2'),
    [openAttachmentPicker],
  );
  const closeBottomSheet = useCallback(() => setBottomSheetVisible(false), []);
  const removeFile1 = useCallback(() => setFile1(null), []);
  const removeFile2 = useCallback(() => setFile2(null), []);

  const pickInto = useCallback(picker => {
    const slot = activeSlot.current;
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await picker();
      if (!pickedFile) return;

      if (slot === 'file1') setFile1(pickedFile);
      else setFile2(pickedFile);
    }, 400);
  }, []);

  const handlePickCamera = useCallback(
    () => pickInto(pickFromCamera),
    [pickInto, pickFromCamera],
  );
  const handlePickGallery = useCallback(
    () => pickInto(pickFromGallery),
    [pickInto, pickFromGallery],
  );
  const handlePickDocument = useCallback(
    () => pickInto(pickDocument),
    [pickInto, pickDocument],
  );

  /* ---------------------------------------------------------------------
   * Date
   *
   * Android's dialog closes itself; iOS's inline spinner fires `onChange` on
   * every tick, so there it stays open until the screen's Done calls
   * `closeDatePicker` — the same arrangement as useAttendanceRequest.
   * ------------------------------------------------------------------- */

  const isIOS = Platform.OS === 'ios';

  const openDatePicker = useCallback(() => setShowDatePicker(true), []);
  const closeDatePicker = useCallback(() => setShowDatePicker(false), []);

  const handleDateChange = useCallback((event, selectedDate) => {
    if (!isIOS) setShowDatePicker(false);

    if (event?.type === 'dismissed') return;
    if (!selectedDate) return;

    const validDate =
      selectedDate instanceof Date ? selectedDate : new Date(selectedDate);

    if (Number.isNaN(validDate.getTime())) return;

    setResignationDate(validDate);
  }, [isIOS]);

  /* ---------------------------------------------------------------------
   * Submit
   * ------------------------------------------------------------------- */

  const send = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setLoading(true);

    try {
      const result = await submitResignationRequest({
        resignationDate: formatResignationDate(resignationDate),
        reason: reason.trim(),
        file1,
        file2,
      });

      if (result?.error) {
        hapticsMessage('error');
        Alert.alert('Error', result.error);
        return;
      }

      setSubmitted(result.message);
      setReason('');
      setFile1(null);
      setFile2(null);
      setResignationDate(new Date());

      hapticsMessage('success');
      Alert.alert('Success', 'Your resignation has been submitted');
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [resignationDate, reason, file1, file2]);

  const submitResignation = useCallback(() => {
    if (!reason.trim()) {
      Alert.alert('Validation', 'Please enter a reason for your resignation');
      return;
    }

    Alert.alert(
      'Submit resignation?',
      `Your resignation dated ${formatLogDate(
        resignationDate,
      )} will be sent for review. You can't withdraw it from the app.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Submit', style: 'destructive', onPress: send },
      ],
    );
  }, [reason, resignationDate, send]);

  return {
    // Values
    resignationDate,
    showDatePicker,
    reason,
    file1,
    file2,
    isBottomSheetVisible,
    loading,
    submitted,

    // Setters
    setReason,
    setFile1,
    setFile2,

    // Attachments
    pickFile1,
    pickFile2,
    removeFile1,
    removeFile2,
    closeBottomSheet,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,

    // Date
    openDatePicker,
    handleDateChange,

    // iOS keeps the spinner open until an explicit Done; Android never shows it.
    needsDoneAffordance: isIOS,
    closeDatePicker,

    // Submit
    submitResignation,
  };
}
