import React, { useLayoutEffect, useState, useMemo } from "react";
import { Image } from "react-native";
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
import CheckInIcon from "../assets/images/check_in.svg";
import CheckOutIcon from "../assets/images/check_out.svg";
import TotalHoursIcon from "../assets/images/total_hours.svg";

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
          totalMinutes: 0,
          totalLeaves: 0,
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

    //CALCULATE TOTALS
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
  useLayoutEffect(() => {
    navigation.setOptions({
      headerTitle: "My Attendance",
      headerTitleAlign: "center",
    });
  }, []);
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
            .sort((a, b) => b[0].localeCompare(a[0]))
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
                      <View style={styles.iconBox}>
                        <Entypo name="calendar" size={22} color="#77224C" />
                      </View>

                      <Text style={styles.monthText}>{label}</Text>
                    </View>

                    <View style={styles.iconBox}>
                      <Entypo
                        name={
                          openMonth === monthKey ? "chevron-up" : "chevron-down"
                        }
                        size={20}
                        color="#77224C"
                      />
                    </View>
                  </TouchableOpacity>

                  {/* SUMMARY */}
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
                      <View
                        style={{
                          width: 180,
                          height: 56,
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 12,
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

                      <View
                        style={{
                          width: 170,
                          height: 56,
                          flexDirection: "row",
                          alignItems: "center",
                          paddingHorizontal: 12,
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

                        // ✅ FULL WEEK LOGIC (Mon–Sun)
                        const weekDays = [
                          "Mon",
                          "Tue",
                          "Wed",
                          "Thu",
                          "Fri",
                          "Sat",
                          "Sun",
                        ];

                        const sortedDays = Object.values(days).sort(
                          (a, b) => new Date(a.date) - new Date(b.date),
                        );

                        // get first and last date of this week
                        const startDate = new Date(sortedDays[0]?.date);
                        const endDate = new Date(
                          sortedDays[sortedDays.length - 1]?.date,
                        );

                        // generate all dates between start → end
                        const fullWeek = [];
                        let current = new Date(startDate);

                        while (current <= endDate) {
                          const dateStr = current.toISOString().split("T")[0];

                          const found = sortedDays.find(
                            (d) => d.date === dateStr,
                          );

                          fullWeek.push(
                            found || {
                              date: dateStr,
                              checkIn: null,
                              checkOut: null,
                            },
                          );

                          current.setDate(current.getDate() + 1);
                        }

                        return (
                          <View key={weekKey} style={styles.weekContainer}>
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
                                size={25}
                                color="#77224C"
                              />
                            </TouchableOpacity>

                            {/* DAYS */}
                            {openWeek === weekKey &&
                              fullWeek.map((day, index) => (
                                <View key={index} style={styles.dayCard}>
                                  {/* DATE */}
                                  <View style={styles.dateBox}>
                                    <Text style={styles.dateNum}>
                                      {day.date
                                        ? new Date(day.date).getDate()
                                        : "--"}
                                    </Text>

                                    <Text style={styles.dateDay}>
                                      {day.date
                                        ? new Date(day.date).toLocaleDateString(
                                            "en-US",
                                            {
                                              weekday: "short",
                                            },
                                          )
                                        : day.weekday}
                                    </Text>
                                  </View>

                                  {/* TIMES */}
                                  <View style={styles.timeSection}>
                                    <View
                                      style={[
                                        styles.timeItem,
                                        styles.timeDivider,
                                      ]}
                                    >
                                      <CheckInIcon width={18} height={18} />
                                      <Text>
                                        {day.checkIn
                                          ? formatTime(day.checkIn)
                                          : "-/-"}
                                      </Text>
                                      <Text style={styles.label}>Check in</Text>
                                    </View>

                                    <View
                                      style={[
                                        styles.timeItem,
                                        styles.timeDivider,
                                      ]}
                                    >
                                      <CheckOutIcon width={18} height={18} />
                                      <Text>
                                        {day.checkOut
                                          ? formatTime(day.checkOut)
                                          : "--:--"}
                                      </Text>
                                      <Text style={styles.label}>
                                        Check out
                                      </Text>
                                    </View>

                                    <View style={styles.timeItem}>
                                      <TotalHoursIcon width={18} height={18} />
                                      <Text>
                                        {day.checkIn && day.checkOut
                                          ? getDayTotalTime(
                                              day.checkIn,
                                              day.checkOut,
                                            )
                                          : "-/-"}
                                      </Text>
                                      <Text style={styles.label}>
                                        Total Hours
                                      </Text>
                                    </View>
                                  </View>
                                </View>
                              ))}
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
    width: "100%",
    justifyContent: "center",
    flexDirection: "row",
    alignItems: "center",
    position: "relative", // important
  },
  backBtn: {
    position: "absolute",
    left: 10,
    top: "50%",
    marginLeft: 16,
    transform: [{ translateY: -14 }],
  },
  headerTitle: {
    color: "#FFF",
    fontSize: 24,
    fontWeight: "500",
    fontFamily: "Inter-Regular",
    lineHeight: 29, // 120% of 24 ≈ 28.8 → round to 29
    textAlign: "center",
  },
  iconBox: {
    width: 40,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
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
    color: "#000",
    fontWeight: "500",
    fontFamily: "Inter-Medium",
  },
  weekContainer: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#D9D9D9",
    borderRadius: 12,
    backgroundColor: "#fff",
    padding: 8,
  },
  weekBox: {
    width: 318,
    height: 57,

    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",

    paddingHorizontal: 12,

    borderWidth: 1,
    borderColor: "#B3B3B3",
    borderRadius: 7,

    backgroundColor: "#FFF",

    alignSelf: "center",
  },

  weekTitle: {
    fontWeight: "500",
    fontSize: 18,
  },

  weekDate: {
    fontSize: 14,
    color: "#777",
    fontWeight: "400",
  },

  weekHours: {
    fontWeight: "500",
    fontSize: 18,
  },
  weekHoursLabel: {
    fontSize: 12,
    color: "#777",
    fontWeight: "400",
    fontSize: 14,
  },

  dayCard: {
    width: 310,
    height: 68,
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    marginTop: 6,

    borderWidth: 1,
    borderColor: "#fff",
    borderRadius: 8,
    backgroundColor: "#fff",
  },

  dateBox: {
    width: 51,
    height: 59,

    justifyContent: "center",
    alignItems: "center",

    paddingTop: 8,
    paddingRight: 9,
    paddingBottom: 9,
    paddingLeft: 10,

    gap: 2,

    borderRadius: 3.5,
    borderWidth: 1,
    borderColor: "#63205F",
    borderRightWidth: 0.5,

    backgroundColor: "rgba(255, 238, 254, 0.5)",
  },

  dateNum: {
    fontSize: 14,
    fontWeight: "600",
    color: "#000",
  },

  dateDay: {
    fontSize: 12,
    color: "#555",
  },

  timeItem: {
    flex: 1,
    height: "100%",

    justifyContent: "center",
    alignItems: "center",

    paddingVertical: 2,
    paddingHorizontal: 4,
  },

  timeSection: {
    width: 246,
    height: 59,

    flexDirection: "row",
    alignItems: "center",

    borderWidth: 1,
    borderColor: "#63205F",
    borderRadius: 3.5,
    borderLeftWidth: 0.5,

    backgroundColor: "#FFF",

    overflow: "hidden", // important for clean borders
    marginLeft: 0,
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
