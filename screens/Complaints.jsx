import React, { useState, useLayoutEffect } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import AttachmentPicker from "../components/AttachmentPicker";
import SubmitButton from "../components/common/SubmitButton";
import * as DocumentPicker from "expo-document-picker";
import Entypo from "@expo/vector-icons/Entypo";
import { COLORS, SIZES } from "../constants";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  createComplaint,
  uploadComplaintAttachment,
} from "../services/api/complaint.service";

const Complaints = () => {
  const [message, setMessage] = useState("");
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigation = useNavigation();
  // ✅ Header setup
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Complaints",
      headerTitleAlign: "center",
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Entypo
            name="chevron-left"
            size={SIZES.xxxLarge - 5}
            color={COLORS.primary}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const pickFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        console.log("User cancelled picker");
        return;
      }

      const doc = result.assets?.[0];
      if (!doc) {
        return;
      }

      const pickedFile = {
        uri: doc.uri,
        name: doc.name,
        type: doc.mimeType || "application/octet-stream",
      };
      setFile(pickedFile);
    } catch (err) {
      console.log("File pick error:", err);
      Alert.alert("Error", "Failed to pick file");
    }
  };

  const submitComplaint = async () => {
    if (!message.trim()) {
      Alert.alert("Validation", "Please enter complaint message");
      return;
    }

    if (!file) {
      Alert.alert("Validation", "Please attach a file before submitting");
      return;
    }

    setLoading(true);

    try {
      const date = new Date().toISOString().replace("T", " ").slice(0, 19);

      const result = await createComplaint({ date, message });

      if (result.error) {
        throw new Error(result.error);
      }

      const docname = result?.message?.message?.name;

      if (!docname) {
        throw new Error("Complaint created but docname missing");
      }

      await uploadComplaintAttachment(file, docname);

      Alert.alert("Success", "Complaint submitted successfully");

      setMessage("");
      setFile(null);
    } catch (error) {
      console.log("Complaint submit error:", error);
      Alert.alert("Error", error?.message || "Failed to submit complaint");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#fff" }}>
      <View style={{ flex: 1 }}>
        {/* MAIN CONTENT */}
        <View style={{ flex: 1, padding: 16 }}>
          {/* MESSAGE BOX */}
          <TextInput
            style={{
              minHeight: 160,
              maxHeight: 240,
              backgroundColor: "#fff",
              borderRadius: 10,
              padding: 16,
              marginBottom: 14,

              shadowColor: "#000",
              shadowOffset: { width: 0, height: 2 },
              shadowOpacity: 0.12,
              shadowRadius: 6,
              elevation: 3,
            }}
            placeholder="Enter your message here..."
            multiline
            value={message}
            onChangeText={setMessage}
            textAlignVertical="top"
          />

          {/* ATTACH FILE */}
          <AttachmentPicker
            file={file}
            onPick={pickFile}
            onRemove={() => setFile(null)}
            label="Attach file (optional) "
          />
        </View>

        {/* FOOTER */}
        <View
          style={{
            padding: 16,
            paddingBottom: 24,
            borderTopWidth: 1,
            borderTopColor: "#f1f5f9",
            backgroundColor: "#fff",
          }}
        >
          <SubmitButton
            title="Submit Complaint"
            loading={loading}
            onPress={submitComplaint}
          />
        </View>
      </View>
    </SafeAreaView>
  );
};

export default Complaints;
