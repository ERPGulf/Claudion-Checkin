import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { getShortcut1 } from "../services/api/records.service";
import ShortcutDetails from "../components/ShortcutDetails";

const Shortcut1 = () => {
  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode
  );

  const [data, setData] = useState({});
  const [title, setTitle] = useState("Records");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!employeeCode) return;

    let isMounted = true;

    const fetchData = async () => {
      try {
        const res = await getShortcut1(employeeCode);
        if (isMounted) {
          setData(res?.data || {});
          setTitle(res?.shortcut || "Records");
        }
      } catch (error) {
        console.error("❌ Shortcut1 fetch failed:", error.message);
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
  }, [employeeCode]);

  return <ShortcutDetails title={title} data={data} loading={loading} />;
};

export default Shortcut1;
