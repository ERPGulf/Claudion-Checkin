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
          <TouchableOpacity
            onPress={pickFile}
            style={{
              backgroundColor: "#fff",
              borderWidth: 1,
              borderStyle: "dashed",
              borderColor: "#d1d5db",
              borderRadius: 10,
              paddingVertical: 14,
              paddingHorizontal: 12,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: "#6b7280",
                fontSize: 14,
              }}
              numberOfLines={1}
            >
              {file ? file.name : "Attach file (optional)"}
            </Text>
          </TouchableOpacity>
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
          <TouchableOpacity
            onPress={submitComplaint}
            disabled={loading}
            className="bg-green-600 p-4 rounded-xl items-center"
            style={{ opacity: loading ? 0.7 : 1 }}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text
                style={{
                  color: "#fff",
                  fontWeight: "600",
                  fontSize: 16,
                }}
              >
                Submit Complaint
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

export default Complaints;
