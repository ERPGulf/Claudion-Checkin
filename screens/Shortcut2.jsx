import React from "react";
import { useSelector } from "react-redux";
import { getShortcut2 } from "../services/api/records.service";
import ShortcutDetails from "../components/ShortcutDetails";
import useShortcutData from "../hooks/useShortcutData";

const Shortcut2 = () => {
  const employeeCode = useSelector(
    (state) => state.user?.userDetails?.employeeCode
  );

  const { data, title, loading } = useShortcutData(employeeCode, getShortcut2);

  return <ShortcutDetails title={title} data={data} loading={loading} />;
};

export default Shortcut2;
