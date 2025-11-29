// ItemDetails.jsx
import React, { useEffect, useState, useLayoutEffect } from "react";
import { Entypo } from "@expo/vector-icons";
import { SIZES, COLORS } from "../../constants/theme";
import {
  Alert,
  Button,
  FlatList,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useNavigation, useRoute } from "@react-navigation/native";

import { createMaterialRequest } from "../../services/createMaterialRequest";
import { selectedWarehouse } from "../../redux/Slices/Warehouse";
import { useDispatch, useSelector } from "react-redux";
import { setMaterialRequestId } from "../../redux/Slices/MaterialRequestSlice";

export default function ItemDetails() {
  const navigation = useNavigation();
  const route = useRoute();
  const params = route.params || {};
  const initialItems = Array.isArray(params.items) ? params.items : [];
  const Selectedwarehouse = useSelector(selectedWarehouse);
  const warehouse = Selectedwarehouse.warehouse_id;
  const dispatch = useDispatch();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: 'Item Details',
      headerTitleAlign: 'center',
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} >
          <Entypo name="chevron-left" size={SIZES.xxxLarge - 5} color={COLORS.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);



  // Local state for editable items with qty
  const [items, setItems] = useState(
    initialItems.map((it) => ({ ...it, qty: Number(it.qty) || 1 }))
  );

  // date state
  const [date, setDate] = useState(() => new Date());
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tempDate, setTempDate] = useState(new Date()); 

  const confirmDate = () => {
    setDate(tempDate);
    setShowPicker(false);
  };

  const cancelPicker = () => {
    setTempDate(date);
    setShowPicker(false);
  };

  useEffect(() => {
    // if no items passed, go back
    if (!initialItems.length) {
      Alert.alert("No items", "No scanned items were passed.", [
        { text: "OK", onPress: () => navigation.goBack() },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChangeQty = (item_code, value) => {
    setItems((prev) =>
      prev.map((p) =>
        p.item_code === item_code ? { ...p, qty: value === "" ? "" : Math.max(1, Number(value)) } : p
      )
    );
  };

  const increaseQty = (item_code) =>
    setItems((prev) => prev.map((p) => (p.item_code === item_code ? { ...p, qty: (Number(p.qty) || 0) + 1 } : p)));

  const decreaseQty = (item_code) =>
    setItems((prev) =>
      prev.map((p) =>
        p.item_code === item_code ? { ...p, qty: Math.max(1, (Number(p.qty) || 1) - 1) } : p
      )
    );

  const formatDateOnly = (d) => {
    const pad = (n) => n.toString().padStart(2, "0");
    const yyyy = d.getFullYear();
    const MM = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    return `${yyyy}-${MM}-${dd}`;
  };
  const onSubmit = async () => {
    // validate
    if (!items.length) {
      Alert.alert("No items", "Add at least one item.");
      return;
    }
  
    const invalid = items.find((it) => !it.qty || Number(it.qty) <= 0);
    if (invalid) {
      Alert.alert("Invalid quantity", `Enter a valid quantity for ${invalid.item_code}`);
      return;
    }
  
    const payloadDate = formatDateOnly(date);
  
    // build payload - match the shape your API expects
    const payloadItems = items.map((it) => ({
      item_code: String(it.item_code),
      qty: Number(it.qty),
      schedule_date: payloadDate,
      uom: it.uom,
    }));
  

    try {
      setLoading(true);
      const res = await createMaterialRequest(payloadDate,warehouse,payloadItems); // your service should handle auth/storage
  
      // Expecting response shape: { data: { data: { id, date, warehouse, items: [...] } } }
      const created = res.data;
      console.log("created",created);
  
      if (created) {
        const mrId = created.id   || "—";
        const mrDate = created.date || payloadDate;
        const mrWarehouse = created.warehouse || selectedWarehouse  || '';
        const itemsCount = Array.isArray(created.items) ? created.items.length : payloadItems.length;
  
        // clear local state
        setItems([]);
        dispatch(setMaterialRequestId(mrId));
        Alert.alert(
          "Material Request Created",
          `ID: ${mrId}\nDate: ${mrDate}\nWarehouse: ${mrWarehouse}\nItems: ${itemsCount}`,
          [
            {
              text: "View",
              onPress: () => {
                // navigate to details screen and pass created MR object
                navigation.navigate("MaterialRequestDetails", { mr: created });
              },
            },
            {
              text: "OK",
              onPress: () => {
                navigation.navigate("Scanning");
              },
              style: "cancel",
            },
          ],
          { cancelable: false }
        );
      } else {
        // handle error shape
        const msg = (res && (res.message || res.data?.message)) || "Failed to create material request";
        Alert.alert("Failed", msg);
      }
    } catch (e) {
      console.error("createMaterialRequest error", e);
      let msg = "Error creating material request";
      // try to extract friendly message
      if (e && e.response && e.response.data && e.response.data.message) {
        msg = e.response.data.message;
      } else if (e && e.message) {
        msg = e.message;
      }
      Alert.alert("Error", msg);
    } finally {
      setLoading(false);
    }
  };
  
  const showDatePicker = () => setShowPicker(true);
  const onDateChange = (event, selectedDate) => {
  const currentDate = selectedDate || date;

  if (Platform.OS === "android") {
    // On Android, close the picker after selecting
    setShowPicker(false);
  }

  setDate(currentDate); // <-- this actually updates the date
};


  return (
    <View style={styles.container}>
      <FlatList
        style={{ width: "100%", flex: 1 }}           // <-- add flex: 1
        contentContainerStyle={{ padding: 16, flexGrow: 1 }} 
        data={items}
        keyExtractor={(it) => it.item_code}
        ListHeaderComponent={() => (
          <View>
            <View style={styles.row}>
              <Text style={styles.label}>Warehouse</Text>
              <Text style={styles.value}>
                {(warehouse) || "—"}
              </Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Date</Text>
              <TouchableOpacity
              onPress={() => setShowPicker(true)}
              style={styles.datePickerButton}
              activeOpacity={0.7}
            >
              <Text style={styles.datePickerText}>
                {formatDateOnly(date)}
              </Text>
            </TouchableOpacity>

            </View>

            {showPicker && (
              <View style={styles.pickerContainer}>
                <DateTimePicker
                  value={tempDate}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={onDateChange}
                />

                <View style={styles.actions}>
                  <Button title="Cancel" onPress={cancelPicker} />
                  <Button title="OK" onPress={confirmDate} />
                </View>
              </View>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Items</Text>
          </View>
        )}
        renderItem={({ item }) => (
          <View style={styles.itemCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.itemCode}>{item.item_code}</Text>
            </View>

            <View style={styles.qtyControls}>
              <TouchableOpacity style={styles.qtyBtn} onPress={() => decreaseQty(item.item_code)}>
                <Text style={styles.qtyBtnText}>−</Text>
              </TouchableOpacity>

              <TextInput
                style={styles.qtyInput}
                value={String(item.qty)}
                keyboardType="numeric"
                onChangeText={(t) => onChangeQty(item.item_code, t.replace(/[^0-9]/g, ""))}
              />

              <TouchableOpacity style={styles.qtyBtn} onPress={() => increaseQty(item.item_code)}>
                <Text style={styles.qtyBtnText}>+</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.muted}>No items</Text>}
        ListFooterComponent={() => (
        <View style={{ justifyContent: "flex-end", }}>
          <View style={{ flex: 1 }} />

          <TouchableOpacity
          onPress={onSubmit}
          disabled={loading}
          style={{
            backgroundColor: loading ? "#9ca3af" : '#198b43ff',
            paddingVertical: 14,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 16, fontWeight: "600" }}>
            {loading ? "Submitting…" : "Submit Material Request"}
          </Text>
        </TouchableOpacity>

        </View>
      )}


      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f7fb",
  },
  datePickerButton: {
  borderWidth: 1,
  borderColor: COLORS.primary,
  borderRadius: 10,
  paddingVertical: 5,
  backgroundColor: "white",
  justifyContent: "center",
  alignItems: "center",
  minWidth: 125,
  alignSelf: "flex-end", 
},

datePickerText: {
  fontSize: 16,
  fontWeight: "600",
  color: COLORS.primary,
},

  title: { fontSize: 18, fontWeight: "700", marginBottom: 12 },
  row: { width: "100%", marginBottom: 8, flexDirection: "row", justifyContent: "space-between" },
  label: { color: "#6b7280" },
  value: { fontWeight: "700" },
  sectionTitle: { width: "100%", fontSize: 16, fontWeight: "700", marginBottom: 8 },
  itemCard: {
    width: "100%",
    padding: 12,
    backgroundColor: "#fff",
    borderRadius: 8,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#eee",
  },
  itemCode: { fontWeight: "700" },
  qtyControls: { flexDirection: "row", alignItems: "center" },
  qtyBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, backgroundColor: "#eee", marginHorizontal: 6 },
  qtyBtnText: { fontSize: 18, fontWeight: "700" },
  qtyInput: {
    width: 64,
    textAlign: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: "#fff",
  },
  muted: { color: "#6b7280" },
});
