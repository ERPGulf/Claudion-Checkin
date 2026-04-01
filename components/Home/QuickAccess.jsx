import { View, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useNavigation } from "@react-navigation/native";
import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import Usericon from "../../assets/images/user.svg";

function QuickAccess() {
  const navigation = useNavigation();
  const [dateTime, setDateTime] = useState("");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();

      const formatted = now.toLocaleString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
      setDateTime(formatted);
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const checkin = useSelector((state) => state.attendance.checkin);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={() => navigation.navigate("Attendance action")}
    >
      <LinearGradient
        colors={["#77224C", "#8E273B"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{
          width: "100%",
          height: 112,
          borderRadius: 7,
          borderWidth: 1,
          borderColor: "#63205F",
          paddingHorizontal: 12,

          shadowColor: "#000",
          shadowOffset: { width: 0, height: 6 },
          shadowOpacity: 0.08,
          shadowRadius: 18,
          elevation: 6,

          position: "relative", // ✅ IMPORTANT
        }}
      >
        {/* ICON (TOP RIGHT - FIXED) */}
        <View
          style={{
            position: "absolute",
            right: 28, 
            top: 26, 
          }}
        >
          <Usericon width={60} height={60} />
        </View>

        <View style={{ flex: 1 }}>
          {/* TODAY */}
          <Text
            style={{
              color: "#FFF",
              fontSize: 12,
              fontWeight: "500",
              marginTop: 11,
            }}
          >
            TODAY
          </Text>

        
          <View
            style={{
              marginTop: 4,
            }}
          >
            <Text
              numberOfLines={1}
              style={{
                color: "#FFF",
                fontSize: 24,
                fontWeight: "600",
                lineHeight: 28,
              }}
            >
              {checkin ? "Check out" : "Check in"}
            </Text>
          </View>

          {/* STATUS */}
          <Text style={{ color: "#FFF",fontSize: 12, marginTop: 4 }}>
            Status: {checkin ? "Checked in" : "Not checked in"}
          </Text>

          {/* DATE */}
          <Text style={{ color: "#FFF", fontSize: 11, marginTop: 4 }}>{dateTime}</Text>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}
export default QuickAccess;
