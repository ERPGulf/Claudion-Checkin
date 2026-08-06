import { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import {
  createComplaint,
  uploadComplaintAttachment,
} from '../services/api/complaint.service';
import { useAttachmentPicker } from './useAttachmentPicker';

/**
 * Everything the complaint form does, lifted out of the screen so the modern UI
 * is presentation only.
 *
 * The flow is the classic screen's, unchanged: the same empty-message guard with
 * the same Alert copy, the same `date` string, the same `{ date, message }`
 * payload to `createComplaint`, the same docname read out of
 * `result.message.message.name`, the same upload-after-create sequence, the same
 * success Alert and the same post-success reset. Nothing here was retuned while
 * moving it. In particular:
 *
 * - The empty-message check runs on press, not as a disabled button, so an empty
 *   submit still raises the "Please enter complaint message" Alert.
 * - `date` is still computed and still passed, even though complaint.service.js
 *   overwrites it with `getServerTime()` — the call keeps its original shape
 *   rather than a tidier-looking one.
 * - A failed attachment upload still fails the whole submit (it is not caught
 *   separately), so the error Alert is the same one the classic screen shows.
 *
 * `screens/ComplaintsLegacy.jsx` deliberately does not use this hook: it keeps
 * its own inline copy so the classic screen is byte-identical to what shipped.
 * `hasMessage` / `attachmentCount` are additions for the modern summary card;
 * they are derived from state that already exists and gate nothing.
 */
export default function useComplaint() {
  const [message, setMessage] = useState('');
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isBottomSheetVisible, setBottomSheetVisible] = useState(false);

  const { pickFromCamera, pickFromGallery, pickDocument } =
    useAttachmentPicker();

  /* ---------------------------------------------------------------------
   * Attachment. The sheet is dismissed before the picker opens, then the
   * native picker is launched a beat later — presenting a camera or document
   * picker while a modal is still animating out drops it on both platforms.
   * ------------------------------------------------------------------- */

  const pickFile = useCallback(() => setBottomSheetVisible(true), []);
  const closeBottomSheet = useCallback(() => setBottomSheetVisible(false), []);
  const removeFile = useCallback(() => setFile(null), []);

  const handlePickCamera = useCallback(() => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickFromCamera();
      if (pickedFile) setFile(pickedFile);
    }, 400);
  }, [pickFromCamera]);

  const handlePickGallery = useCallback(() => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickFromGallery();
      if (pickedFile) setFile(pickedFile);
    }, 400);
  }, [pickFromGallery]);

  const handlePickDocument = useCallback(() => {
    setBottomSheetVisible(false);

    setTimeout(async () => {
      const pickedFile = await pickDocument();
      if (pickedFile) setFile(pickedFile);
    }, 400);
  }, [pickDocument]);

  /* ---------------------------------------------------------------------
   * Submit
   * ------------------------------------------------------------------- */

  const submitComplaint = useCallback(async () => {
    if (!message.trim()) {
      Alert.alert('Validation', 'Please enter complaint message');
      return;
    }

    setLoading(true);

    try {
      const date = new Date().toISOString().replace('T', ' ').slice(0, 19);

      const result = await createComplaint({ date, message });

      if (result.error) {
        throw new Error(result.error);
      }

      const docname = result?.message?.message?.name;

      if (!docname) {
        throw new Error('Complaint created but docname missing');
      }

      if (file) {
        await uploadComplaintAttachment(file, docname);
      }

      Alert.alert('Success', 'Complaint submitted successfully');

      setMessage('');
      setFile(null);
    } catch (error) {
      Alert.alert('Error', error?.message || 'Failed to submit complaint');
    } finally {
      setLoading(false);
    }
  }, [message, file]);

  return {
    // Values
    message,
    file,
    loading,
    isBottomSheetVisible,

    // Setters
    setMessage,
    setFile,

    // Attachment
    pickFile,
    closeBottomSheet,
    removeFile,
    handlePickCamera,
    handlePickGallery,
    handlePickDocument,

    // Submit
    submitComplaint,

    // Display-only, for the modern summary card
    hasMessage: !!message.trim(),
    attachmentCount: file ? 1 : 0,
  };
}
