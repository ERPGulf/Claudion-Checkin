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
                fontSize: 14,
                fontWeight: "600",
                color: "#6B7280",
                marginBottom: 8,
                marginTop: 12,
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
                } catch (e) {
                  console.log("mark read failed", e);
                }
              };

              return (
                <TouchableOpacity
                  key={notification.name}
                  onPress={handlePress}
                  activeOpacity={0.7}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      padding: 14,
                      marginBottom: 10,
                      borderRadius: 10,
                      backgroundColor: isUnread ? "#2E2E2E" : "#F2F2F2",
                    }}
                  >
                    {/* LOGO ICON */}
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: 19,
                        backgroundColor: bg,
                        justifyContent: "center",
                        alignItems: "center",
                        marginRight: 12,
                      }}
                    >
                      <Ionicons name={icon} size={18} color="#fff" />
                    </View>

                    {/* TITLE */}
                    {/* TEXT CONTAINER */}
                    <View style={{ flex: 1 }}>
                      {/* TITLE */}
                      <Text
                        numberOfLines={1}
                        style={{
                          fontWeight: "600",
                          fontSize: 15,
                          color: isUnread ? "#fff" : "#111",
                        }}
                      >
                        {notification.title}
                      </Text>

                      {/* DESCRIPTION PREVIEW */}
                      <Text
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        style={{
                          fontSize: 13,
                          marginTop: 4,
                          color: isUnread ? "#D1D5DB" : "#555",
                        }}
                      >
                        {notification.notification}
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      />

      {/* ---------- MODAL ---------- */}
      <Modal visible={!!selected} transparent animationType="slide">
        <View
          style={{
            height: "100%",
            width: "100%",
            backgroundColor: "rgba(0, 0, 0, 0.35)", // full-screen dim
            justifyContent: "flex-end",
          }}
        >
          <View
            style={{
              backgroundColor: "#FFFFFF",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingHorizontal: 16,
              paddingTop: 12,
              paddingBottom: 20,
              maxHeight: "45%",
            }}
          >
            {/* Drag indicator */}
            <View
              style={{
                width: 36,
                height: 4,
                borderRadius: 2,
                backgroundColor: "#D1D5DB",
                alignSelf: "center",
                marginBottom: 12,
              }}
            />

            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <Text
                numberOfLines={1}
                style={{ fontSize: 16, fontWeight: "600" }}
              >
                {selected?.title || "Notification"}
              </Text>

              <TouchableOpacity onPress={() => setSelected(null)}>
                <Ionicons name="close" size={20} color="#6B7280" />
              </TouchableOpacity>
            </View>

            {/* Content */}
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={{ fontSize: 15, lineHeight: 22, color: "#111827" }}>
                {selected?.notification}
              </Text>

              <Text
                style={{
                  fontSize: 12,
                  color: "#6B7280",
                  marginTop: 12,
                }}
              >
                {selected?.date}
              </Text>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

export default Notifications;
