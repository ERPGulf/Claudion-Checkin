import { t, useTranslation } from '../localization';
import { useCallback, useEffect, useState } from "react";
import { getAuthSessionGeneration, isAuthSessionSuspended } from "../utils/authSessionGuard";

const useShortcutData = (employeeCode, fetchFn) => {
  useTranslation();
  const [data, setData] = useState({});
  const [title, setTitle] = useState("Records");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!employeeCode || !fetchFn) {
      setData({});
      setLoading(false);
      setError(true);
      return undefined;
    }

    let isMounted = true;
    const generation = getAuthSessionGeneration();
    const isCurrent = () => isMounted && generation === getAuthSessionGeneration() &&
      !isAuthSessionSuspended();
    setLoading(true);
    setError(false);

    const fetchData = async () => {
      try {
        if (!isCurrent()) return;
        const res = await fetchFn(employeeCode);
        if (isCurrent()) {
          setData(res?.data || {});
          setTitle(res?.shortcut || "Records");
        }
      } catch {
        if (isCurrent()) setError(true);
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [employeeCode, fetchFn, attempt]);

  return { data, title: title === "Records" ? t("Records") : title, loading, error, retry };
};

export default useShortcutData;
