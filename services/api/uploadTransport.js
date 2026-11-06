// A timeout ends local waiting; it does not establish whether the server saved
// the file. Multipart writes get one attempt and are never retried here.
export const UPLOAD_TIMEOUT_MS = 120000;
export const UPLOAD_UNCONFIRMED_MESSAGE =
  "We couldn't confirm the upload. Check the saved request before uploading the file again.";

export const fetchUploadJson = (url, options, { invalidJsonMessage, timeoutMs = UPLOAD_TIMEOUT_MS } = {}) => {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(Object.assign(new Error(UPLOAD_UNCONFIRMED_MESSAGE), {
        code: "UPLOAD_CONFIRMATION_TIMEOUT", outcomeUnconfirmed: true,
      }));
      controller.abort();
    }, timeoutMs);
  });
  const request = (async () => {
    const response = await fetch(url, { ...options, signal: controller.signal });
    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (invalidJsonMessage) throw new Error(invalidJsonMessage);
      throw error;
    }
    return { response, result };
  })();
  // The deadline covers headers AND response-body parsing, including fetch
  // implementations that ignore AbortSignal. Late completion stays detached.
  return Promise.race([request, deadline]).finally(() => clearTimeout(timer));
};
