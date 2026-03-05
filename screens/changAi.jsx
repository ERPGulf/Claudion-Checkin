import { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  ScrollView,
} from "react-native";
import { generateChangAiToken } from "../services/api/changai/changAiAuth.service";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { sendChangAiMessage } from "../services/api/changai/changAi.service";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import { StatusBar, Platform } from "react-native";

const PRIMARY = "#6d4fc2";
const PRIMARY_LIGHT = "#f6f2ff";

export default function ChangAi() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("chat");
  const scrollViewRef = useRef(null);
  const shouldScrollToBottom = useRef(false);
  const navigation = useNavigation();
  useEffect(() => {
    if (activeTab === "chat") {
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: false });
      }, 100);
    }
  }, [activeTab, messages]);

  /* LOAD SAVED MESSAGES */
  useEffect(() => {
    const loadMessages = async () => {
      const saved = await AsyncStorage.getItem("changai_messages");

      if (saved) {
        setMessages(JSON.parse(saved));
      } else {
        setMessages([
          {
            id: "1",
            text: "Hello 👋 I'm your AI assistant. How can I help today?",
            sender: "ai",
          },
        ]);
      }
    };

    loadMessages();
  }, []);
  useEffect(() => {
    generateChangAiToken();
  }, []);
  useEffect(() => {
    const saveMessages = async () => {
      try {
        await AsyncStorage.setItem(
          "changai_messages",
          JSON.stringify(messages),
        );
      } catch (error) {
        console.log("Error saving messages:", error);
      }
    };

    if (messages.length > 0) {
      saveMessages();
    }
  }, [messages]);
  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userText = input;

    const userMessage = {
      id: Date.now().toString(),
      text: userText,
      sender: "user",
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setLoading(true);

    // ✅ ADD TYPING MESSAGE HERE
    const typingId = Date.now().toString() + "_typing";

    setMessages((prev) => [
      ...prev,
      {
        id: typingId,
        text: "Typing...",
        sender: "ai",
      },
    ]);

    try {
      const response = await sendChangAiMessage(userText, "mobile_user");

      const apiData = response?.message;
      console.log("FULL API DATA:", JSON.stringify(apiData, null, 2));
      const botText =
        typeof apiData?.Bot === "string" ? apiData?.Bot : apiData?.Bot?.answer;

      // ✅ REPLACE TYPING MESSAGE WITH REAL RESPONSE
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === typingId
            ? {
                ...msg,
                text: botText ?? "No response received.",
                fullResponse: apiData,
              }
            : msg,
        ),
      );
    } catch (error) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === typingId
            ? {
                ...msg,
                text: "Something went wrong. Please try again.",
              }
            : msg,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }) => (
    <View
      style={[
        styles.messageRow,
        item.sender === "user" ? styles.userRow : styles.botRow,
      ]}
    >
      {item.sender === "ai" && (
        <View style={styles.botIcon}>
          <MaterialCommunityIcons
            name="robot-happy-outline"
            size={16}
            color="#fff"
          />
        </View>
      )}

      <View
        style={[
          styles.messageBubble,
          item.sender === "user" ? styles.userBubble : styles.botBubble,
        ]}
      >
        <Text style={item.sender === "user" ? styles.userText : styles.botText}>
          {item.text}
        </Text>
      </View>
    </View>
  );

  const latestAIMessage = [...messages]
    .reverse()
    .find((msg) => msg.sender === "ai" && msg.fullResponse);

  return (
    // <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
    <SafeAreaView style={styles.container} edges={["top"]}>
      <StatusBar
        backgroundColor={PRIMARY}
        barStyle="light-content"
        translucent={false}
      />
      {/* HEADER */}
      <View style={styles.chatHeader}>
        <View style={styles.headerInfo}>
          <View style={styles.headerIcon}>
            <MaterialCommunityIcons
              name="robot-happy-outline"
              size={18}
              color={PRIMARY}
            />
          </View>
          <Text style={styles.logoText}>ChangAI</Text>
        </View>

        <TouchableOpacity onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="chevron-down" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* TABS */}
      <View style={styles.tabBox}>
        <TouchableOpacity onPress={() => setActiveTab("chat")}>
          <Text
            style={[styles.tabBtn, activeTab === "chat" && styles.activeTab]}
          >
            Chat
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setActiveTab("debug")}>
          <Text
            style={[styles.tabBtn, activeTab === "debug" && styles.activeTab]}
          >
            Debug
          </Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => setActiveTab("support")}>
          <Text
            style={[styles.tabBtn, activeTab === "support" && styles.activeTab]}
          >
            Support
          </Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "undefined"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 10 : 6}
      >
        {/* CHAT / DEBUG / SUPPORT AREA */}
        <View style={{ flex: 1 }}>
          {activeTab === "chat" && (
            <ScrollView
              ref={scrollViewRef}
              contentContainerStyle={{
                flexGrow: 1,
                paddingVertical: 10,
              }}
              keyboardShouldPersistTaps="handled"
            >
              {messages.map((item) => (
                <View
                  key={item.id}
                  style={[
                    styles.messageRow,
                    item.sender === "user" ? styles.userRow : styles.botRow,
                  ]}
                >
                  {item.sender === "ai" && (
                    <View style={styles.botIcon}>
                      <MaterialCommunityIcons
                        name="robot-happy-outline"
                        size={16}
                        color="#fff"
                      />
                    </View>
                  )}

                  <View
                    style={[
                      styles.messageBubble,
                      item.sender === "user"
                        ? styles.userBubble
                        : styles.botBubble,
                    ]}
                  >
                    <Text
                      style={
                        item.sender === "user"
                          ? styles.userText
                          : styles.botText
                      }
                    >
                      {item.text}
                    </Text>
                  </View>
                </View>
              ))}
            </ScrollView>
          )}

          {/* DEBUG TAB */}
          {activeTab === "debug" && latestAIMessage?.fullResponse && (
            <ScrollView contentContainerStyle={styles.debugContainer}>
              <View style={styles.debugBox}>
                <Text style={styles.debugText}>
                  {JSON.stringify(latestAIMessage.fullResponse, null, 2)}
                </Text>
              </View>
            </ScrollView>
          )}

          {/* SUPPORT TAB */}
          {activeTab === "support" && latestAIMessage && (
            <ScrollView contentContainerStyle={styles.supportContainer}>
              {/* USER QUESTION */}
              <View style={styles.supportUserRow}>
                <View style={styles.supportUserBubble}>
                  <Text style={styles.supportUserText}>
                    {latestAIMessage?.fullResponse?.Question}
                  </Text>
                </View>
              </View>

              {/* RESPONSE CARD */}
              <View style={styles.ticketCard}>
                <Text style={styles.ticketTitle}>📊 Response</Text>

                <Text style={styles.ticketValue}>{latestAIMessage.text}</Text>
              </View>
            </ScrollView>
          )}
        </View>

        {/* FOOTER */}
        <View style={styles.chatFooter}>
          <View style={styles.chatForm}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Message..."
              placeholderTextColor="#999"
              style={styles.input}
            />

            {input.trim() !== "" && (
              <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
                <MaterialCommunityIcons
                  name="arrow-up"
                  size={14}
                  color="#fff"
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
  },

  /* HEADER */
  chatHeader: {
    height: 50,
    backgroundColor: PRIMARY,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 20,
  },
  headerInfo: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  logoText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },

  /* TABS */
  tabBox: {
    flexDirection: "row",
    justifyContent: "space-around",
    borderBottomWidth: 2,
    borderBottomColor: "#e5e5e5",
  },
  tabBtn: {
    fontSize: 12,
    fontWeight: "600",
    color: "#919191",
    paddingVertical: 14,
  },
  activeTab: {
    color: "#3f51b5",
  },

  /* CHAT BODY */
  chatBody: {
    paddingHorizontal: 14,
    paddingVertical: 16,
    paddingBottom: 20,
  },
  messageRow: {
    flexDirection: "row",
    marginBottom: 12,
    paddingHorizontal: 14,
  },

  botRow: {
    justifyContent: "flex-start",
    alignItems: "flex-end",
  },

  userRow: {
    justifyContent: "flex-end",
    alignItems: "flex-end",
  },
  botIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },

  messageBubble: {
    maxWidth: "72%",
    padding: 14,
  },
  botBubble: {
    backgroundColor: PRIMARY_LIGHT,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
  },

  userBubble: {
    backgroundColor: PRIMARY,
    borderRadius: 16,
    borderBottomRightRadius: 4,
  },

  botText: {
    fontSize: 15,
    color: "#000",
    lineHeight: 20,
  },

  userText: {
    fontSize: 15,
    color: "#fff",
    lineHeight: 20,
  },

  /* FOOTER */
  // chatFooter: {
  //   padding: 15,
  //   paddingVertical: 8,
  //   backgroundColor: "#fff",
  // },
  chatFooter: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: Platform.OS === "ios" ? 10 : 6,
    backgroundColor: "#fff",
  },

  chatForm: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 28,
    borderWidth: 3,
    borderColor: PRIMARY,
    paddingHorizontal: 16,
    height: 44,
    backgroundColor: "#fff",
  },

  input: {
    flex: 1,
    fontSize: 14,
    color: "#333",
    paddingVertical: Platform.OS === "ios" ? 10 : 6,
    textAlignVertical: "center",
  },

  sendButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: PRIMARY,
    alignItems: "center",
    justifyContent: "center",
  },
  popup: {
    position: "absolute",
    top: 50,
    right: 20,
    backgroundColor: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: 10,
    elevation: 5,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    zIndex: 10,
  },

  popupText: {
    fontSize: 12,
    paddingVertical: 6,
    color: "#333",
  },
  debugContainer: {
    flexGrow: 1,
    padding: 16,
  },

  debugBox: {
    backgroundColor: "#e9e9ec",
    borderRadius: 12,
    padding: 16,
  },

  debugText: {
    fontSize: 13,
    color: "#333",
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
    lineHeight: 18,
  },
  supportContainer: {
    padding: 16,
    paddingBottom: 30,
  },

  /* USER QUESTION */
  supportUserRow: {
    alignItems: "flex-end",
    marginBottom: 16,
  },

  supportUserBubble: {
    backgroundColor: PRIMARY,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    borderTopRightRadius: 6,
    maxWidth: "75%",
  },

  supportUserText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "500",
  },

  supportResponseBox: {
    backgroundColor: "#e9e9ec",
    padding: 16,
    borderRadius: 14,
  },

  supportResponseText: {
    fontSize: 13,
    color: "#333",
    lineHeight: 18,
    fontFamily: Platform.OS === "ios" ? "Courier" : "monospace",
  },
  ticketCard: {
    backgroundColor: "#eceaf4",
    padding: 18,
    borderRadius: 16,
    width: "85%",
  },

  ticketTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 10,
    color: "#333",
  },

  ticketValue: {
    color: "#333",
    fontSize: 14,
    lineHeight: 20,
  },
});
