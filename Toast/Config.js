import {
  SuccessToast,
  ErrorToast,
  InfoToast,
} from "react-native-toast-message";

const BASE_TOAST_STYLE = {
  borderRadius: 15,
  width: "94%",
  height: 60,
};

const TITLE_STYLE = {
  fontSize: 20,
  color: "#fff",
  fontWeight: 500,
  textAlign: "center",
};

const BODY_STYLE = {
  fontSize: 12,
  color: "#fff",
  textAlign: "center",
};

export const toastConfig = {
  /*
      Overwrite 'success' type,
      by modifying the existing `BaseToast` component
    */
  success: (props) => (
    <SuccessToast
      {...props}
      style={{
        ...BASE_TOAST_STYLE,
        backgroundColor: "#22c55e",
        borderLeftColor: "#22c55e",
      }}
      text1Style={TITLE_STYLE}
      text2Style={BODY_STYLE}
    />
  ),
  /*
      Overwrite 'error' type,
      by modifying the existing `ErrorToast` component
    */
  error: (props) => (
    <ErrorToast
      {...props}
      style={{
        ...BASE_TOAST_STYLE,
        backgroundColor: "rgb(239 68 68)",
        borderLeftColor: "rgb(239 68 68)",
      }}
      text1Style={TITLE_STYLE}
      text2Style={BODY_STYLE}
    />
  ),
  info: (props) => (
    <InfoToast
      {...props}
      style={{
        ...BASE_TOAST_STYLE,
        backgroundColor: "#0096FF",
        borderLeftColor: "#0096FF",
      }}
      text1Style={TITLE_STYLE}
      text2Style={BODY_STYLE}
    />
  ),
  notificationToast: (props) => (
    <InfoToast
      {...props}
      style={{
        ...BASE_TOAST_STYLE,
        backgroundColor: "#0B6E99",
        borderLeftColor: "#0B6E99",
      }}
      text1Style={TITLE_STYLE}
      text2Style={BODY_STYLE}
    />
  ),
  announcementToast: (props) => (
    <InfoToast
      {...props}
      style={{
        ...BASE_TOAST_STYLE,
        backgroundColor: "#B45309",
        borderLeftColor: "#B45309",
      }}
      text1Style={TITLE_STYLE}
      text2Style={BODY_STYLE}
    />
  ),
  /*
      Or create a completely new type - `tomatoToast`,
      building the layout from scratch.
  
      I can consume any custom `props` I want.
      They will be passed when calling the `show` method (see below)
    */
  tomatoToast: ({ text1, props }) => (
    <View style={{ height: 60, width: "100%", backgroundColor: "tomato" }}>
      <Text>{text1}</Text>
      <Text>{props.uuid}</Text>
    </View>
  ),
};
