// src/services/offline/attendancePhotoUpload.js
import { putUserFile, userFileUpload } from "../api";

/**
 * Attaching the photo a check-in was queued with.
 *
 * On tenants where `photo === 1` a check-in is taken through the camera, and the
 * upload needs the docname the server issues when the log is created. Offline
 * there is no docname yet, so the capture's URI rides on the queue row and this
 * runs once the row syncs.
 *
 * Two-step, matching what the camera screen does online: upload the file, then
 * point the checkin's `custom_image` at the returned path.
 *
 * **Best-effort, deliberately.** The camera writes to the app's cache directory,
 * which the OS may reclaim under storage pressure — so a photo can be gone by
 * the time the network returns. When that happens the attendance record still
 * stands; only the attachment is missing. Making it durable means copying the
 * capture into document storage at capture time (`expo-file-system`, whose
 * native side is already in the binary but which is not hoisted as a JS
 * package). Worth doing if photo attachments turn out to matter more than the
 * cache window covers.
 */

const LOG_PREFIX = "[attendancePhotoUpload]";

/**
 * @returns {Promise<{uploaded: boolean, reason?: string}>} never throws — a
 *          failed attachment must not undo a synced attendance record
 */
export const uploadQueuedPhoto = async ({ photoUri, docname }) => {
  if (!photoUri) return { uploaded: false, reason: "no-photo" };
  if (!docname) return { uploaded: false, reason: "no-docname" };

  try {
    const file = {
      uri: photoUri,
      name: `${docname}_${Date.now()}.jpg`,
      type: "image/jpeg",
    };

    const uploadResponse = await userFileUpload(file, docname);
    const uploadedFileUrl = uploadResponse?.message?.[0];

    if (!uploadedFileUrl) {
      return { uploaded: false, reason: "no-file-url" };
    }

    const updateFormData = new FormData();
    updateFormData.append("custom_image", uploadedFileUrl);
    await putUserFile(updateFormData, docname);

    console.log(`${LOG_PREFIX} Attached photo to ${docname}`);
    return { uploaded: true };
  } catch (error) {
    console.log(`${LOG_PREFIX} Failed for ${docname}:`, error?.message);
    return { uploaded: false, reason: error?.message || "upload-failed" };
  }
};

export default { uploadQueuedPhoto };
