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
import Timericon from "../assets/images/timer-clock.svg";
import Leaveicon from "../assets/images/user-leave.svg";

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
      const monthKey = `${d.getFullYear()}-${d.getMonth()}`;

      const displayMonth = d.toLocaleString("default", {
        month: "long",
        year: "numeric",
      });

      const week = Math.ceil(d.getDate() / 7);

      if (!months[monthKey]) {
        months[monthKey] = {
          label: displayMonth,
          weeks: {},
          totalMinutes: 0, // 🔥 ADD
          totalLeaves: 0, // 🔥 ADD
        };
      }

      if (!months[monthKey].weeks[week]) {
        months[monthKey].weeks[week] = {};
      }

      if (!months[monthKey].weeks[week][date]) {
        months[monthKey].weeks[week][date] = {
          date,
          checkIn: null,
          checkOut: null,
          isLeave: false,
        };
      }

      if (log.log_type === "IN") {
        months[monthKey].weeks[week][date].checkIn = log.time;
      } else {
        months[monthKey].weeks[week][date].checkOut = log.time;
      }
    });

    // 🔥 CALCULATE TOTALS
    Object.values(months).forEach((month) => {
      Object.values(month.weeks).forEach((week) => {
        Object.values(week).forEach((day) => {
          if (day.checkIn && day.checkOut) {
            const diff =
              (new Date(day.checkOut) - new Date(day.checkIn)) / (1000 * 60);

            if (diff > 0) month.totalMinutes += diff;
          } else {
            month.totalLeaves += 1;
          }
        });
      });

      const h = Math.floor(month.totalMinutes / 60);
      const m = Math.floor(month.totalMinutes % 60);

      month.totalHours = `${h}h ${m}m`;
    });

    return months;
  };

  const groupedData = useMemo(() => {
    return groupByMonthWeek(data || []);
  }, [data]);
  const getDayTotalTime = (checkIn, checkOut) => {
    if (!checkIn || !checkOut) return "-";

    const diff = (new Date(checkOut) - new Date(checkIn)) / (1000 * 60);

    if (diff <= 0) return "-";

    const hours = Math.floor(diff / 60);
    const minutes = Math.floor(diff % 60);

    return `${hours}h ${minutes}m`;
  };
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
          Object.entries(groupedData)
            .sort((a, b) => b[0].localeCompare(a[0])) // newest month first
            .map(([monthKey, monthData]) => {
              const { label, weeks } = monthData;

              return (
                <View key={monthKey} style={{ marginBottom: 15 }}>
                  {/* MONTH */}
                  <TouchableOpacity
                    onPress={() =>
                      setOpenMonth(openMonth === monthKey ? null : monthKey)
                    }
                    style={styles.monthBox}
                  >
                    <View style={styles.row}>
                      <Entypo name="calendar" size={33} color="#77224C" />
                      <Text style={styles.monthText}>{label}</Text>
                    </View>

                    <Entypo
                      name={
                        openMonth === monthKey ? "chevron-up" : "chevron-down"
                      }
                      size={20}
                      color="#77224C"
                    />
                  </TouchableOpacity>

                  {/* WEEKS */}
                  {/* SUMMARY CARD */}
                  {openMonth === monthKey && (
                    <View
                      style={{
                        flexDirection: "row",
                        marginTop: 10,
                        borderWidth: 1,
                        borderColor: "#ddd",
                        borderRadius: 10,
                        overflow: "hidden",
                        backgroundColor: "#fff",
                      }}
                    >
                      {/* TOTAL HOURS */}
                      <View
                        style={{
                          flex: 1,
                          flexDirection: "row",
                          alignItems: "center",
                          padding: 12,
                          borderRightWidth: 1,
                          borderColor: "#B3B3B3",
                        }}
                      >
                        <Timericon width={40} height={40} />
                        <View style={{ marginLeft: 10 }}>
                          <Text style={{ fontWeight: "600" }}>
                            {monthData.totalHours}
                          </Text>
                          <Text style={{ fontSize: 12, color: "#777" }}>
                            Total Hours
                          </Text>
                        </View>
                      </View>

                      {/* TOTAL LEAVES */}
                      <View
                        style={{
                          flex: 1,
                          flexDirection: "row",
                          alignItems: "center",
                          padding: 12,
                          borderColor: "#B3B3B3",
                        }}
                      >
                        <Leaveicon width={40} height={40} />
                        <View style={{ marginLeft: 10 }}>
                          <Text style={{ fontWeight: "600" }}>
                            {monthData.totalLeaves}
                          </Text>
                          <Text style={{ fontSize: 12, color: "#777" }}>
                            Total Leaves
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}

                  {/* WEEKS */}
                  {openMonth === monthKey &&
                    Object.entries(weeks)
                      .sort((a, b) => Number(a[0]) - Number(b[0]))
                      .map(([week, days]) => {
                        const weekKey = `${monthKey}-${week}`;

                        return (
                          <View key={weekKey} style={{ marginTop: 10 }}>
                            {/* WEEK HEADER */}
                            <TouchableOpacity
                              onPress={() =>
                                setOpenWeek(
                                  openWeek === weekKey ? null : weekKey,
                                )
                              }
                              style={styles.weekBox}
                            >
                              <View>
                                <Text style={styles.weekTitle}>
                                  Week {week}
                                </Text>
                                <Text style={styles.weekDate}>01–07 Jan</Text>
                                {/* optional */}
                              </View>

                              <View style={{ alignItems: "flex-end" }}>
                                <Text style={styles.weekHours}>
                                  {monthData.totalHours}
                                </Text>
                                <Text style={styles.label}>Total Hours</Text>
                              </View>

                              <Entypo
                                name={
                                  openWeek === weekKey
                                    ? "chevron-up"
                                    : "chevron-down"
                                }
                                size={20}
                                color="#77224C"
                              />
                            </TouchableOpacity>

                            {/* DAYS */}
                            {openWeek === weekKey &&
                              Object.values(days)
                                .sort(
                                  (a, b) => new Date(a.date) - new Date(b.date),
                                )
                                .map((day) => {
                                  const isLeave = !day.checkIn && !day.checkOut;

                                  return (
                                    <View key={day.date} style={styles.dayCard}>
                                      {/* DATE BOX */}
                                      <View style={styles.dateBox}>
                                        <Text style={styles.dateNum}>
                                          {new Date(day.date).getDate()}
                                        </Text>
                                        <Text style={styles.dateDay}>
                                          {new Date(
                                            day.date,
                                          ).toLocaleDateString("en-US", {
                                            weekday: "short",
                                          })}
                                        </Text>
                                      </View>

                                      {/* CONTENT */}
                                      {isLeave ? (
                                        <>
                                          <View style={styles.leaveBox}>
                                            <Text style={{ color: "#777" }}>
                                              ----Leave----
                                            </Text>
                                          </View>

                                          <View style={styles.timeBox}>
                                            <Text>0h 00m</Text>
                                            <Text style={styles.label}>
                                              Total Hours
                                            </Text>
                                          </View>
                                        </>
                                      ) : (
                                        <>
                                          {/* CHECK IN */}
                                          <View style={styles.timeBox}>
                                            <Text>
                                              {formatTime(day.checkIn)}
                                            </Text>
                                            <Text style={styles.label}>
                                              Check in
                                            </Text>
                                          </View>

                                          {/* CHECK OUT */}
                                          <View style={styles.timeBox}>
                                            <Text>
                                              {formatTime(day.checkOut)}
                                            </Text>
                                            <Text style={styles.label}>
                                              Check out
                                            </Text>
                                          </View>

                                          {/* TOTAL */}
                                          <View style={styles.timeBox}>
                                            <Text>
                                              {getDayTotalTime(
                                                day.checkIn,
                                                day.checkOut,
                                              )}
                                            </Text>
                                            <Text style={styles.label}>
                                              Total Hours
                                            </Text>
                                          </View>
                                        </>
                                      )}
                                    </View>
                                  );
                                })}
                          </View>
                        );
                      })}
                </View>
              );
            })
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
    width: "100%",
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
  weekBox: {
    height: 60,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    backgroundColor: "#fff",
  },

  weekTitle: {
    fontWeight: "600",
    fontSize: 16,
  },

  weekDate: {
    fontSize: 12,
    color: "#777",
  },

  weekHours: {
    fontWeight: "600",
  },
  dayCard: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: "#8E273B",
    borderRadius: 10,
    marginTop: 8,
    overflow: "hidden",
  },

  dateBox: {
    width: 60,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f5f5f5",
    borderRightWidth: 1,
    borderColor: "#8E273B",
  },

  dateNum: {
    fontSize: 18,
    fontWeight: "600",
  },

  dateDay: {
    fontSize: 12,
  },

  timeBox: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 8,
  },

  leaveBox: {
    flex: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  label: {
    fontSize: 11,
    color: "#777",
  },
});
