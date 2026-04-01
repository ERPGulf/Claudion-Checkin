import React, { useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  ScrollView,
} from "react-native";
import Entypo from "@expo/vector-icons/Entypo";
import { useNavigation } from "@react-navigation/native";
import { useSelector } from "react-redux";
import { useQuery } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native";

import { selectEmployeeCode } from "../redux/Slices/UserSlice";
import { COLORS } from "../constants";
import { getUserAttendance } from "../services/api";

function AttendanceHistory() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const employeeCode = useSelector(selectEmployeeCode);

  const [openMonth, setOpenMonth] = useState(null);
  const [openWeek, setOpenWeek] = useState(null);

  /* ================= API ================= */
  const { isLoading, isError, data } = useQuery({
    queryKey: ["attendanceHistory", employeeCode],
    queryFn: () => getUserAttendance(employeeCode, 0, 200),
    staleTime: 1000 * 60 * 5,
  });

  /* ================= DATA ================= */
  const groupByMonthWeek = (logs) => {
    const months = {};

    logs.forEach((log) => {
      const d = new Date(log.time);
      const date = d.toISOString().split("T")[0];

      const monthKey = d.toLocaleString("default", {
        month: "long",
        year: "numeric",
      });

      const week = Math.ceil(d.getDate() / 7);

      if (!months[monthKey]) months[monthKey] = {};
      if (!months[monthKey][week]) months[monthKey][week] = {};
      if (!months[monthKey][week][date]) {
        months[monthKey][week][date] = {
          date,
          checkIn: null,
          checkOut: null,
        };
      }

      if (log.log_type === "IN") {
        months[monthKey][week][date].checkIn = log.time;
      } else {
        months[monthKey][week][date].checkOut = log.time;
      }
    });

    return months;
  };

  const groupedData = useMemo(() => {
    return groupByMonthWeek(data || []);
  }, [data]);

  /* ================= UI ================= */
  return (
    <View style={{ flex: 1, backgroundColor: "#fff" }}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />
      <View style={{ height: insets.top, backgroundColor: "#fff" }} />

      {/* HEADER */}
      <LinearGradient colors={["#77224C", "#8E273B"]} style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Entypo name="chevron-left" size={28} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>My Attendance</Text>
      </LinearGradient>

      {/* CONTENT */}
      <ScrollView contentContainerStyle={{ padding: 15 }}>
        {isLoading ? (
          <ActivityIndicator size="large" color={COLORS.primary} />
        ) : isError || !data?.length ? (
          <Text style={{ textAlign: "center" }}>
            No attendance records found
          </Text>
        ) : (
          Object.entries(groupedData).map(([month, weeks]) => (
            <View key={month} style={{ marginBottom: 15 }}>
              {/* MONTH */}
              <TouchableOpacity
                onPress={() => setOpenMonth(openMonth === month ? null : month)}
                style={styles.monthBox}
              >
                <View style={styles.row}>
                  <Entypo name="calendar" size={20} color="#8E273B" />
                  <Text style={styles.monthText}>{month}</Text>
                </View>

                <Entypo
                  name={openMonth === month ? "chevron-up" : "chevron-down"}
                  size={20}
                  color="#77224C"
                />
              </TouchableOpacity>

              {/* WEEKS */}
              {openMonth === month &&
                Object.entries(weeks).map(([week, days]) => {
                  const weekKey = `${month}-${week}`;

                  return (
                    <View key={weekKey} style={{ marginTop: 10 }}>
                      {/* WEEK */}
                      <TouchableOpacity
                        onPress={() =>
                          setOpenWeek(openWeek === weekKey ? null : weekKey)
                        }
                        style={styles.weekHeader}
                      >
                        <Text style={styles.weekTitle}>Week {week}</Text>

                        <Entypo
                          name={
                            openWeek === weekKey ? "chevron-up" : "chevron-down"
                          }
                          size={18}
                        />
                      </TouchableOpacity>

                      {/* DAYS */}
                      {openWeek === weekKey &&
                        Object.values(days).map((day) => (
                          <View key={day.date} style={styles.dayRow}>
                            <View style={styles.dateBox}>
                              <Text>{new Date(day.date).getDate()}</Text>
                              <Text>
                                {new Date(day.date).toLocaleDateString(
                                  "en-US",
                                  { weekday: "short" },
                                )}
                              </Text>
                            </View>

                            <View style={styles.timeBox}>
                              <Text>{formatTime(day.checkIn)}</Text>
                              <Text style={styles.label}>Check in</Text>
                            </View>

                            <View style={styles.timeBox}>
                              <Text>{formatTime(day.checkOut)}</Text>
                              <Text style={styles.label}>Check out</Text>
                            </View>

                            <View style={styles.timeBox}>
                              <Text>7h 59m</Text>
                              <Text style={styles.label}>Total</Text>
                            </View>
                          </View>
                        ))}
                    </View>
                  );
                })}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

export default AttendanceHistory;

/* ================= HELPERS ================= */
const formatTime = (time) => {
  if (!time) return "--";
  return new Date(time).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

/* ================= STYLES ================= */
const styles = StyleSheet.create({
  header: {
    height: 56,
    justifyContent: "center",
    alignItems: "center",
  },
  backBtn: {
    position: "absolute",
    left: 10,
    top: 10,
  },
  headerTitle: {
    color: "#FFF",
    fontSize: 24, // 🔥 fixed
    fontFamily: "Inter-Medium",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  monthBox: {
    height: 48,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: "#B3B3B3",
    backgroundColor: "#FFF",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  monthText: {
    marginLeft: 10,
    fontSize: 20,
    fontFamily: "Inter-Medium",
  },
  weekHeader: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  weekTitle: {
    fontFamily: "Inter-Medium",
  },
  dayRow: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#8E273B",
    borderRadius: 10,
    marginTop: 6,
  },
  dateBox: {
    width: 60,
    alignItems: "center",
    justifyContent: "center",
    borderRightWidth: 1,
    borderColor: "#8E273B",
  },
  timeBox: {
    flex: 1,
    alignItems: "center",
    padding: 8,
  },
  label: {
    fontSize: 10,
    color: "#777",
  },
});
