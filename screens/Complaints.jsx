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
import * as DocumentPicker from "expo-document-picker";
import Entypo from "@expo/vector-icons/Entypo";
import { COLORS, SIZES } from "../constants";
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

      const response = await createComplaint({ date, message });
      const docname = response?.message?.name;

      if (docname === undefined || docname === null) {
        throw new Error("Complaint created but docname missing");
      }

      await uploadComplaintAttachment(file, docname);

      Alert.alert("Success", "Complaint submitted successfully");
      setMessage("");
      setFile(null);
    } catch (error) {
      Alert.alert("Error", "Failed to submit complaint");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#f5f5f5", padding: 16 }}>
      

      <TextInput
        style={{
          backgroundColor: "#fff",
          borderRadius: 8,
          padding: 14,
          minHeight: 120,
          marginBottom: 16,
        }}
        placeholder="Enter your message here..."
        multiline
        value={message}
        onChangeText={setMessage}
        textAlignVertical="top"
      />

      <TouchableOpacity
        onPress={pickFile}
        style={{
          backgroundColor: "#fff",
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: "#aaa",
          borderRadius: 8,
          padding: 14,
          marginBottom: 16,
        }}
      >
        <Text style={{ textAlign: "center", color: "#555" }}>
          {file ? file.name : "Attach file (optional)"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={submitComplaint}
        disabled={loading}
        style={{
          backgroundColor: "#2563eb",
          padding: 14,
          borderRadius: 8,
          alignItems: "center",
          opacity: loading ? 0.7 : 1,
        }}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={{ color: "#fff", fontWeight: "600" }}>
            Submit Complaint
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
};

export default Complaints;
