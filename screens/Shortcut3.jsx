import React from "react";
import { useRoute } from "@react-navigation/native";
import ShortcutDetails from "../components/ShortcutDetails";

const Shortcut3 = () => {
  const route = useRoute();
  const { shortcutData = {}, title = "Records" } = route.params || {};

  return (
    <ShortcutDetails
      title={title}
      data={shortcutData}
      loading={false}
    />
  );
};

export default Shortcut3;
