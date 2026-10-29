import { t, useTranslation } from "../localization";
import React from "react";
import { useRoute } from "@react-navigation/native";
import ShortcutDetails from "../components/ShortcutDetails";

const Shortcut3 = () => {
  useTranslation();
  const route = useRoute();
  const { shortcutData = {}, title = t("Records") } = route.params || {};

  return (
    <ShortcutDetails
      title={title}
      data={shortcutData}
      loading={false}
    />
  );
};

export default Shortcut3;
