import { TouchableOpacity, Text, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useDispatch } from "react-redux";
import { revertAll } from "../../redux/CommonActions";
import { saveTokens } from "../../services/api";
// your reset slice

export default function ResetTokenButton() {
  const dispatch = useDispatch();

  const handleResetToken = async () => {
    try {
      const refreshToken = await AsyncStorage.getItem("refresh_token");
      saveTokens("aadasdsadsas", refreshToken);
      //   dispatch(revertAll());
      console.log("Access token reset");
    } catch (err) {
      console.log(err);
    }
  };

  return (
    <TouchableOpacity style={styles.button} onPress={handleResetToken}>
      <Text style={styles.text}>Reset Token</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    bottom: 40,
    right: 20,
    backgroundColor: "#FF4C4C",
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 50,
    elevation: 5,
    zIndex: 9999,
  },
  text: {
    color: "white",
    fontWeight: "600",
  },
});
