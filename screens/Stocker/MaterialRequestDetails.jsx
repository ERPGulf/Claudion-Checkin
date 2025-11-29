// MaterialRequestDetails.jsx
import React, { useEffect, useState, useLayoutEffect } from "react";
import { TouchableOpacity } from "react-native";
import { Entypo } from "@expo/vector-icons";
import { SIZES, COLORS } from "../../constants/theme";
import {
  ActivityIndicator,
  Alert,
  Button,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useNavigation } from "@react-navigation/native";
import { listMaterialRequests } from "../../services/listMaterialRequest";
import { selectMaterialRequestId } from "../../redux/Slices/MaterialRequestSlice";
import { useSelector } from "react-redux";

export default function MaterialRequestDetails() {
  const navigation = useNavigation();
  const id = useSelector(selectMaterialRequestId); 

  const [mr, setMr] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: 'Material Request Details',
      headerTitleAlign: 'center',
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.navigate('Scanning')}>
          <Entypo name="chevron-left" size={SIZES.xxxLarge - 5} color={COLORS.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // 📌 Fetch MR details
  const fetchMR = async (fetchId) => {
    if (!fetchId) {
      setError("No MR id provided");
      setMr(null);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const list = await listMaterialRequests(fetchId);

      if (Array.isArray(list) && list.length > 0) {
        setMr(list[0]);
      } else if (list && list.id) {
        setMr(list);
      } else {
        setMr(null);
        setError("No material request found for id: " + fetchId);
      }
    } catch (e) {
      console.error("fetchMR error", e);
      setMr(null);
      setError("Failed to fetch material request");
    } finally {
      setLoading(false);
    }
  };

  // 📌 Fetch when component mounts or when MR id changes
  useEffect(() => {
    if (id) {
      fetchMR(id);
    } else {
      setMr(null);
      setError("No MR id provided");
    }
  }, [id]);

  // 📌 Manual refresh
  const onRefresh = () => {
    if (!id) {
      Alert.alert("No ID", "Cannot refresh without MR id.");
      return;
    }
    fetchMR(id);
  };

  const renderItem = ({ item, index }) => (
    <View style={styles.itemRow}>
      <Text style={styles.itemIndex}>{index + 1}.</Text>
      <View style={styles.itemBody}>
        <Text style={styles.itemCode}>{item.item_code || item.name || "—"}</Text>
        <Text style={styles.itemMeta}>Qty: {String(item.qty ?? item.quantity ?? "—")}</Text>
        {item.schedule_date ? (
          <Text style={styles.itemMeta}>Schedule: {item.schedule_date}</Text>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {loading && (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <Text style={styles.muted}>Loading...</Text>
        </View>
      )}

      {error && !loading && (
        <View style={styles.center}>
          <Text style={styles.error}>{error}</Text>
        </View>
      )}

      {!loading && mr && (
        <FlatList
          data={[]}
          keyExtractor={(it, idx) => `${it.item_code || it.name || idx}-${idx}`}
          ListHeaderComponent={() => (
            <View>
              <View style={styles.header}>
                <Text style={styles.title}>Material Request</Text>
                <View style={styles.controls}>
                  <Button title="Refresh" onPress={onRefresh} />
                  <View style={{ width: 12 }} />
                </View>
              </View>

              <View style={styles.card}>
                <View style={styles.row}>
                  <Text style={styles.label}>ID</Text>
                  <Text style={styles.value}>{mr.id || mr.name || "—"}</Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Date</Text>
                  <Text style={styles.value}>{mr.date || mr.transaction_date || "—"}</Text>
                </View>

                <View style={styles.row}>
                  <Text style={styles.label}>Warehouse</Text>
                  <Text style={styles.value}>{mr.warehouse || "—"}</Text>
                </View>

                <View style={{ height: 12 }} />

                <Text style={styles.section}>
                  Items ({Array.isArray(mr.items) ? mr.items.length : 0})
                </Text>

                {Array.isArray(mr.items) && mr.items.length > 0 ? (
                  mr.items.map((item, index) => (
                    <View key={`${item.item_code || item.name || index}-${index}`} style={styles.itemRow}>
                      <Text style={styles.itemIndex}>{index + 1}.</Text>
                      <View style={styles.itemBody}>
                        <Text style={styles.itemCode}>{item.item_code || item.name || "—"}</Text>
                        <Text style={styles.itemMeta}>Qty: {String(item.qty ?? item.quantity ?? "—")}</Text>
                        {item.schedule_date ? (
                          <Text style={styles.itemMeta}>Schedule: {item.schedule_date}</Text>
                        ) : null}
                      </View>
                    </View>
                  ))
                ) : (
                  <Text style={styles.muted}>No items available</Text>
                )}
              </View>
            </View>
          )}
          style={{ width: "100%" }}
          contentContainerStyle={{ padding: 16 }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f7fb",
  },
  header: {
    width: "100%",
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
  },
  title: { fontSize: 18, fontWeight: "700" },
  card: {
    width: "100%",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#eee",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  label: { color: "#6b7280" },
  value: { fontWeight: "700" },
  section: { marginTop: 8, marginBottom: 8, fontWeight: "700" },
  itemRow: {
    flexDirection: "row",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "#f1f1f1",
    alignItems: "center",
  },
  itemIndex: { width: 24, color: "#666" },
  itemBody: { flex: 1 },
  itemCode: { fontWeight: "700" },
  itemMeta: { color: "#6b7280", marginTop: 2 },
  center: { width: "100%", alignItems: "center", padding: 12,},
  muted: { color: "#6b7280", marginTop: 8 },
  error: { color: "#b91c1c" },
});
