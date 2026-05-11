import React, { useState, useCallback, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StatusBar,
  StyleSheet,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Entypo, Ionicons, MaterialIcons } from "@expo/vector-icons";
import { getExpenseClaims } from "../services/api/expense.service";

export default function ExpenseCard() {
  const [claims, setClaims] = useState([]);
  const [selectedFilter, setSelectedFilter] = useState("All");
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    const fetchBaseUrl = async () => {
      const storedBaseUrl = await AsyncStorage.getItem("baseUrl");
      setBaseUrl(storedBaseUrl || "");
    };

    fetchBaseUrl();
  }, []);
  useFocusEffect(
    useCallback(() => {
      fetchExpenses();
    }, []),
  );

  const fetchExpenses = async () => {
    const res = await getExpenseClaims();

    if (res?.error) {
      console.log(res.error);
      return;
    }

    setClaims(res.message || []);
  };

  const filteredClaims = claims.filter((item) => {
    if (selectedFilter === "All") return true;
    return item?.status?.toLowerCase() === selectedFilter.toLowerCase();
  });

  const getStatusConfig = (status) => {
    switch (status?.toLowerCase()) {
      case "approved":
        return {
          bg: "#E7F8EE",
          color: "#22C55E",
          icon: "checkmark-circle",
        };

      case "rejected":
        return {
          bg: "#FDECEC",
          color: "#EF4444",
          icon: "close-circle",
        };

      case "draft":
        return {
          bg: "#EEF2FF",
          color: "#6366F1",
          icon: "document-text",
        };

      default:
        return {
          bg: "#FFF7D6",
          color: "#F59E0B",
          icon: "time",
        };
    }
  };
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {/* Safe Area */}
      <View style={{ height: insets.top, backgroundColor: "#8B1E3F" }} />

      {/* Header */}
      <LinearGradient
        colors={["#7B1E4F", "#A12652"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
        >
          <Entypo name="chevron-left" size={24} color="#fff" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>My Expense Claims</Text>
      </LinearGradient>

      {/* Content */}
      <View style={styles.body}>
        {/* Filters */}
        <View style={styles.filterRow}>
          {["All", "Draft", "Approved", "Rejected"].map((item) => {
            const active = selectedFilter === item;

            return (
              <TouchableOpacity
                key={item}
                onPress={() => setSelectedFilter(item)}
                style={[styles.filterBtn, active && styles.activeFilterBtn]}
              >
                <Text
                  style={[styles.filterText, active && styles.activeFilterText]}
                >
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Expense List */}
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 120 }}
        >
          <View style={styles.cardContainer}>
            {filteredClaims.map((item, index) => {
              const statusConfig = getStatusConfig(item?.status);

              return (
                <View
                  key={item.name || index}
                  style={[
                    styles.card,
                    index !== filteredClaims.length - 1 && styles.cardBorder,
                  ]}
                >
                  {/* Top Row */}
                  <View style={styles.rowBetween}>
                    <View
                      style={[
                        styles.statusBadge,
                        { backgroundColor: statusConfig.bg },
                      ]}
                    >
                      <Ionicons
                        name={statusConfig.icon}
                        size={14}
                        color={statusConfig.color}
                      />

                      <Text
                        style={[
                          styles.statusText,
                          { color: statusConfig.color },
                        ]}
                      >
                        {item?.status}
                      </Text>
                    </View>

                    <Text style={styles.dateText}>
                      {item?.expense_date || "-"}
                    </Text>
                  </View>

                  {/* Name */}
                  <View style={{ marginTop: 14 }}>
                    <Text style={styles.label}>Name</Text>

                    <Text style={styles.value}>
                      {item?.employee_name || "-"}
                    </Text>
                  </View>

                  {/* Bottom */}
                  <View style={[styles.rowBetween, { marginTop: 14 }]}>
                    <View>
                      <Text style={styles.label}>Type</Text>

                      <Text style={styles.value}>
                        {item?.expense_type || "-"}
                      </Text>
                    </View>

                    <View style={styles.amountBox}>
                      <MaterialIcons
                        name="payments"
                        size={16}
                        color="#8B1E3F"
                      />

                      <Text style={styles.amountText}>
                        {Number(item?.amount || 0).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}

            {filteredClaims.length === 0 && (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyText}>No expense claims found</Text>
              </View>
            )}
          </View>
        </ScrollView>

        {/* Bottom Button */}
        <View style={styles.bottomContainer}>
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={() => navigation.navigate("Claim form")}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={["#7B1E4F", "#A12652"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.gradientBtn}
            >
              <Text style={styles.submitText}>Claim a new expense</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F7F8FA",
  },

  header: {
    height: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    elevation: 3,
  },

  backBtn: {
    position: "absolute",
    left: 18,
  },

  headerTitle: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },

  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
  },

  /* FILTERS */

  filterRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 18,
  },

  filterBtn: {
    minWidth: 72,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#C48AA0",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },

  activeFilterBtn: {
    backgroundColor: "#8B1E3F",
    borderColor: "#8B1E3F",
  },

  filterText: {
    color: "#8B1E3F",
    fontSize: 13,
    fontWeight: "500",
  },

  activeFilterText: {
    color: "#fff",
    fontWeight: "600",
  },

  /* CARD CONTAINER */

  cardContainer: {
    backgroundColor: "#fff",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    overflow: "hidden",
  },

  card: {
    padding: 16,
    backgroundColor: "#fff",
  },

  cardBorder: {
    borderBottomWidth: 1,
    borderBottomColor: "#ECECEC",
  },

  rowBetween: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  /* STATUS */

  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 30,
  },

  statusText: {
    marginLeft: 4,
    fontSize: 12,
    fontWeight: "600",
  },

  /* TEXT */

  label: {
    fontSize: 12,
    color: "#9CA3AF",
    marginBottom: 4,
  },

  value: {
    fontSize: 15,
    color: "#111827",
    fontWeight: "600",
  },

  dateText: {
    fontSize: 12,
    color: "#6B7280",
    fontWeight: "500",
  },

  /* AMOUNT */

  amountBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8F1F4",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
  },

  amountText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#8B1E3F",
    marginLeft: 6,
  },

  /* EMPTY */

  emptyBox: {
    paddingVertical: 40,
    alignItems: "center",
  },

  emptyText: {
    color: "#9CA3AF",
    fontSize: 14,
  },

  /* BUTTON */

  bottomContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: "#ECECEC",
  },

  submitBtn: {
    borderRadius: 14,
    overflow: "hidden",
  },

  gradientBtn: {
    height: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },

  submitText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
  },
});
