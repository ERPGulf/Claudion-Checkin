import React from "react";
import { useSelector } from "react-redux";
import { getShortcut1 } from "../services/api/records.service";
import ShortcutDetails from "../components/ShortcutDetails";
import useShortcutData from "../hooks/useShortcutData";

const Shortcut1 = () => {
  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode
  );

  const { data, title, loading, error, retry } = useShortcutData(
    employeeCode,
    getShortcut1
  );

  return <ShortcutDetails title={title} data={data} loading={loading} error={error} onRetry={retry} />;
};

export default Shortcut1;
