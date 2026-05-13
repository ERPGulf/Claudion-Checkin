import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  Modal,
  ScrollView,
} from "react-native";
import React, { useState, useLayoutEffect, useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Entypo from "@expo/vector-icons/Entypo";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, SIZES } from "../constants";
import {
  getNotifications,
  markNotificationAsRead,
} from "../services/api/notification.service";
import { useDispatch } from "react-redux";
import { decrementUnreadCount } from "../redux/Slices/notificationSlice";

/* -------------------- HELPERS -------------------- */
const ICON_REGISTRY = {
  // money
  salary: { icon: "card", bg: "#16A34A" },
  expense: { icon: "card", bg: "#16A34A" },
  expenseclaim: { icon: "card", bg: "#16A34A" },

  // meetings & time
  meeting: { icon: "people", bg: "#0EA5E9" },
  attendance: { icon: "time", bg: "#4F46E5" },

  // leave
  leave: { icon: "calendar", bg: "#DC2626" },

  // fallback/system
  system: { icon: "settings", bg: "#6B7280" },
};

// Date grouping label
const formatDateLabel = (dateString) => {
  const date = new Date(dateString);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const isSameDay = (a, b) =>
    a.getDate() === b.getDate() &&
    a.getMonth() === b.getMonth() &&
    a.getFullYear() === b.getFullYear();

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, yesterday)) return "Yesterday";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
};

const normalizeType = (type) => {
  if (!type) return "";

  return type
    .toLowerCase()
    .replace(/\s+/g, "") // remove spaces
    .replace(/[^a-z]/g, ""); // remove non-letters
};

const getIconByType = (type) => {
  const key = normalizeType(type);

  return (
    ICON_REGISTRY[key] || {
      icon: "notifications",
      bg: "#6B7280",
    }
  );
};

/* -------------------- SCREEN -------------------- */

function Notifications() {
  const [list, setList] = useState([]);
  const [selected, setSelected] = useState(null);

  const dispatch = useDispatch();
  const navigation = useNavigation();

  /* ---------- Load notifications ---------- */
  useEffect(() => {
    const load = async () => {
      const employeeId = await AsyncStorage.getItem("employee_id");
      if (!employeeId) return;

      const res = await getNotifications(employeeId);
      setList(res);

      // clear bell badge
    };

    load();
  }, [dispatch]);

  /* ---------- Header ---------- */
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: "Notifications",
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

  /* ---------- Empty state ---------- */
  if (list.length === 0) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#FFFFFF",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <Text>No notifications</Text>
      </View>
    );
  }

  /* ---------- Group by date ---------- */
  const grouped = list.reduce((acc, item) => {
    const label = formatDateLabel(item.date);
    if (!acc[label]) acc[label] = [];
    acc[label].push(item);
    return acc;
  }, {});

  const sections = Object.keys(grouped).map((date) => ({
    date,
    data: grouped[date],
  }));

  /* -------------------- UI -------------------- */

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <FlatList
        data={sections}
        keyExtractor={(item) => item.date}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => (
          <View>
            {/* DATE HEADER */}
            <Text
              style={{
                fontSize: 12,
                fontWeight: "700",
                color: "#9CA3AF",
                marginBottom: 12,
                marginTop: 16,
                textTransform: "uppercase",
                letterSpacing: 0.5,
              }}
            >
              {item.date}
            </Text>

            {item.data.map((notification) => {
              const isUnread = notification.read === 0;
              const { icon, bg } = getIconByType(notification.type);

              const handlePress = async () => {
                // ✅ only decrement if it was unread
                if (notification.read === 0) {
                  dispatch(decrementUnreadCount());
                }

                setSelected(notification);

                setList((prev) =>
                  prev.map((n) =>
                    n.name === notification.name ? { ...n, read: 1 } : n,
                  ),
                );

                try {
                  await markNotificationAsRead(notification.name);
                } catch (e) {}
              };

              return (
                <TouchableOpacity
                  key={notification.name}
                  onPress={handlePress}
                  activeOpacity={0.65}
                  style={{
                    marginBottom: 10,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      padding: 16,
                      borderRadius: 12,
                      backgroundColor: isUnread ? "#1F2937" : "#F9FAFB",
                      borderLeftWidth: isUnread ? 4 : 0,
                      borderLeftColor: isUnread ? bg : "transparent",
                      shadowColor: isUnread ? "#000" : "transparent",
                      shadowOffset: { width: 0, height: 1 },
                      shadowOpacity: isUnread ? 0.1 : 0,
                      shadowRadius: 2,
                      elevation: isUnread ? 2 : 0,
                    }}
                  >
                    {/* LOGO ICON */}
                    <View
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        backgroundColor: bg,
                        justifyContent: "center",
                        alignItems: "center",
                        marginRight: 14,
                        flexShrink: 0,
                      }}
                    >
                      <Ionicons name={icon} size={20} color="#fff" />
                    </View>

                    {/* TEXT CONTAINER */}
                    <View style={{ flex: 1, justifyContent: "center" }}>
                      {/* TITLE */}
                      <Text
                        numberOfLines={1}
                        style={{
                          fontWeight: "600",
                          fontSize: 14,
                          color: isUnread ? "#F3F4F6" : "#1F2937",
                          marginBottom: 6,
                        }}
                      >
                        {notification.title}
                      </Text>

                      {/* DESCRIPTION PREVIEW */}
                      <Text
                        numberOfLines={2}
                        ellipsizeMode="tail"
                        style={{
                          fontSize: 13,
                          color: isUnread ? "#D1D5DB" : "#6B7280",
                          lineHeight: 18,
                        }}
                      >
                        {notification.notification}
                      </Text>
                    </View>

                    {/* UNREAD INDICATOR */}
                    {isUnread && (
                      <View
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 5,
                          backgroundColor: bg,
                          marginLeft: 12,
                          marginTop: 2,
                        }}
                      />
                    )}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      />
      {/* ---------- MODAL ---------- */}
      <Modal visible={!!selected} transparent animationType="fade" >
        <TouchableOpacity
          style={{
            height: "100%",
            width: "100%",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            justifyContent: "flex-end",
          }}
          activeOpacity={1}
          onPress={() => setSelected(null)}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => {}}
            style={{
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingHorizontal: 20,
              paddingTop: 16,
              paddingBottom: 32,
              maxHeight: "70%",
              minHeight: 400,
              shadowColor: "#000",
              shadowOffset: { width: 0, height: -2 },
              shadowOpacity: 0.15,
              shadowRadius: 8,
              elevation: 10,
            }}
          >
            {/* Drag indicator */}
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: "#E5E7EB",
                alignSelf: "center",
                marginBottom: 16,
              }}
            />

            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "flex-start",
                marginBottom: 16,
              }}
            >
              <View style={{ flex: 1, marginRight: 12 }}>
                <Text
                  numberOfLines={2}
                  style={{
                    fontSize: 18,
                    fontWeight: "700",
                    color: "#111827",
                    marginBottom: 4,
                  }}
                >
                  {selected?.title || "Notification"}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontSize: 12,
                    color: "#9CA3AF",
                  }}
                >
                  {selected?.date}
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setSelected(null)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: "#F3F4F6",
                  justifyContent: "center",
                  alignItems: "center",
                  flexShrink: 0,
                }}
              >
                <Ionicons name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Divider */}
            <View
              style={{
                height: 1,
                backgroundColor: "#E5E7EB",
                marginBottom: 16,
              }}
            />

            {/* Content */}
            <ScrollView
              showsVerticalScrollIndicator={true}
              nestedScrollEnabled={true}
              scrollEventThrottle={16}
            >
              <Text
                style={{
                  fontSize: 15,
                  lineHeight: 24,
                  color: "#374151",
                  fontWeight: "400",
                  paddingRight: 8,
                }}
              >
                {selected?.notification}
              </Text>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

export default Notifications;
