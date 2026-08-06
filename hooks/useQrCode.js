import { useCallback, useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { getQrCode } from '../services/api/qr.service';

/**
 * The QR fetch, lifted out of the classic screen so the modern UI is
 * presentation only.
 *
 * Unchanged: the same `getQrCode(employeeCode)` call with the employee code read
 * from Redux, fired once per code, behind the same `isMounted` guard, with the
 * error swallowed. Nothing here generates, re-encodes or re-requests a QR — the
 * screen renders whatever `image_url` the server returned, for whatever
 * `employee` string it returned with it.
 *
 * Two presentation-only additions:
 *
 * - `error`, so the screen can show a proper error state. The classic screen
 *   caught the failure into an empty block and rendered red "QR Code not
 *   available" text, with no way to tell a failed request from a missing image.
 * - `loading` now also ends when there is no employee code at all. The classic
 *   effect returned before its `finally`, so a session without a code left the
 *   spinner turning forever — an infinite spinner, not an error.
 *
 * `retry` re-runs the identical call. There was no retry before; the only way
 * out of a failure was to leave the screen and come back.
 */
export default function useQrCode() {
  const employeeCode = useSelector(
    state => state.user?.userDetails?.employeeCode,
  );
  const fullname = useSelector(state => state.user?.fullname);

  const [qrData, setQrData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped by `retry`, which is what re-runs the effect below.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let isMounted = true;

    if (!employeeCode) {
      // The classic screen returned here and left `loading` true forever.
      setLoading(false);
      setError(true);
      return undefined;
    }

    setLoading(true);
    setError(false);

    const fetchQr = async () => {
      try {
        const data = await getQrCode(employeeCode);
        if (isMounted) {
          setQrData(data);
        }
      } catch {
        if (isMounted) {
          setError(true);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchQr();

    return () => {
      isMounted = false;
    };
  }, [employeeCode, attempt]);

  const retry = useCallback(() => setAttempt(n => n + 1), []);

  return {
    // Values — exactly what the service returned
    imageUrl: qrData?.imageUrl || null,
    employee: qrData?.employee || null,
    fullname,
    loading,
    // A request that came back without an image is as unusable as one that
    // threw, and reads the same to the user.
    error: error || (!loading && !qrData?.imageUrl),

    // Actions
    retry,
  };
}
