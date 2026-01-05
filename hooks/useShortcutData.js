import { useEffect, useState } from "react";

const useShortcutData = (employeeCode, fetchFn) => {
  const [data, setData] = useState({});
  const [title, setTitle] = useState("Records");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeCode || !fetchFn) return;

    let isMounted = true;

    const fetchData = async () => {
      try {
        const res = await fetchFn(employeeCode);
        if (isMounted) {
          setData(res?.data || {});
          setTitle(res?.shortcut || "Records");
        }
      } catch (error) {
        console.error("❌ Shortcut fetch failed:", error.message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchData();

    return () => {
      isMounted = false;
    };
  }, [employeeCode, fetchFn]);

  return { data, title, loading };
};

export default useShortcutData;
