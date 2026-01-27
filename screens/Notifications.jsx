import { View, Text, FlatList, TouchableOpacity } from "react-native";
import React, { useState, useLayoutEffect, useEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Entypo from "@expo/vector-icons/Entypo";
import { COLORS, SIZES } from "../constants";
import { getNotifications } from "../services/api/notification.service";
import { useDispatch } from "react-redux";
import { clearUnreadCount } from "../redux/Slices/notificationSlice";
import { markNotificationAsRead } from "../services/api/notification.service";

function Notifications() {
  const [list, setList] = useState([]);
  const dispatch = useDispatch();
  const navigation = useNavigation();

  useEffect(() => {
    const load = async () => {
      const employeeId = await AsyncStorage.getItem("employee_id");
      if (!employeeId) return;

      const res = await getNotifications(employeeId);
      setList(res);

      // 🔔 clear bell badge after loading notifications
      dispatch(clearUnreadCount());
    };

    load();
  }, [dispatch]);

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

  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <FlatList
        data={list}
        keyExtractor={(item) => item.name}
        contentContainerStyle={{ padding: 16 }}
        renderItem={({ item }) => {
          const isUnread = Number(item.read) === 0;

          const handlePress = async () => {
            // 1️⃣ Update UI immediately (fast UX)
            setList((prevList) =>
              prevList.map((n) =>
                n.name === item.name ? { ...n, read: 1 } : n,
              ),
            );

            // 2️⃣ Update backend (PERMANENT)
            try {
              await markNotificationAsRead(item.name); // 👈 send ID
            } catch (error) {
              console.log("Failed to mark notification as read", error);
            }
          };

          return (
            <TouchableOpacity onPress={handlePress} activeOpacity={0.7}>
              <View
                style={{
                  padding: 14,
                  marginBottom: 10,
                  borderRadius: 10,
                  backgroundColor: isUnread ? "#2E2E2E" : "#F2F2F2",
                  borderWidth: isUnread ? 0 : 1,
                  borderColor: "#E0E0E0",
                }}
              >
                <Text
                  style={{
                    fontWeight: isUnread ? "bold" : "normal",
                    color: isUnread ? "white" : "#333",
                    fontSize: 15,
                  }}
                >
                  {item.notification}
                </Text>

                <Text
                  style={{
                    fontSize: 12,
                    marginTop: 4,
                    color: isUnread ? "#CCCCCC" : "gray",
                  }}
                >
                  {item.date}
                </Text>
              </View>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

export default Notifications;
