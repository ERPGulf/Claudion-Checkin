// Scanning.jsx - drop-in replacement (fixed: Scan Again stays visible until user taps it)
import { CameraView, useCameraPermissions } from "expo-camera";
import React, { useCallback, useRef, useState } from "react";
import {
  Alert,
  Button,
  Dimensions,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Defs, Mask, Rect } from "react-native-svg";
import ItemCodeButton from "../../components/Stocker/ItemCodeButton";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { AntDesign } from "@expo/vector-icons";
import { getItem } from "../../services/getItems";
import { useSelector } from "react-redux";
import { selectedWarehouse } from "../../redux/Slices/Warehouse";

export default function Scanning() {
  const navigation = useNavigation();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);

  const [items, setItems] = useState([]);
  const warehouse = useSelector(selectedWarehouse);
  const [date] = useState(() => new Date().toISOString().split("T")[0]);

  // synchronous guard to avoid rapid re-entry from camera events
  const processingRef = useRef(false);
  const COOLDOWN_MS = 900; // tune 800-1200ms as needed

  const addOrIncrementItem = (code, uom = "") => {
    setItems((prev) => {
      const exists = prev.find((p) => p.item_code === code);
      if (exists) {
        return prev.map((item) =>
          item.item_code === code
            ? { ...item, qty: item.qty + 1, uom: uom || item.uom || "" }
            : item
        );
      }
      return [...prev, { item_code: code, qty: 1, uom: uom || "" }];
    });
  };

  // ITEM SELECT from ItemCodeButton
  const handleItemSelect = (itemData) => {
    if (itemData && (itemData.item_code || itemData.item_id)) {
      const code = itemData.item_code || itemData.item_id;
      addOrIncrementItem(code, itemData.uom);
    }
  };

  // MANUAL SUBMIT: do NOT auto-reset scanned — let user press Scan Again
  const handleManualSubmit = useCallback(async () => {
    if (!barcode.trim()) return;

    if (!warehouse || !warehouse.warehouse_id) {
      Alert.alert("Error", "No warehouse selected");
      return;
    }

    if (processingRef.current) return;
    processingRef.current = true;
    setScanned(true);
    setIsCameraActive(false);

    try {
      const itemDetails = await getItem(barcode.trim(), warehouse.warehouse_id);
      console.log("getItem result (manual):", itemDetails);
      if (!itemDetails) {
        Alert.alert("Error", "Item not found");
        return;
      }

      const code = itemDetails.item_id || itemDetails.item_code || itemDetails.id;
      const uom = itemDetails.uom || "";

      if (!code) {
        Alert.alert("Error", "Item code missing from API response");
        return;
      }
      if (!uom) {
        Alert.alert("Error", "Item UOM not found");
        return;
      }

      addOrIncrementItem(code, uom);
    } catch (err) {
      console.error("Error processing manual barcode:", err);
      Alert.alert("Error", "Failed to fetch item details");
    } finally {
      // Only clear the processing guard — do NOT change scanned/isCameraActive here.
      processingRef.current = false;

      setBarcode("");
      setShowManualInput(false);
    }
  }, [barcode, warehouse]);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const startCamera = async () => {
        if (!permission?.granted) {
          await requestPermission();
        }

        if (permission?.granted && isMounted) {
          // only start camera when entering the screen; this will reset scanned to false
          // which is desired only on initial focus — but if you open modals inside the same screen
          // this shouldn't re-fire. If you still see unwanted resets, the cause may be navigation.
          setIsCameraActive(true);
          setScanned(false);
        }
      };

      startCamera();

      return () => {
        isMounted = false;
        setIsCameraActive(false);
      };
    }, [permission, requestPermission])
  );

  // SCAN HANDLER: keep scanned true until user taps Scan Again
  const handleBarcodeScanned = useCallback(
    async ({ data }) => {
      if (!data) return;

      if (processingRef.current) {
        console.log("Scan ignored - already processing:", data, new Date().toISOString());
        return;
      }
      processingRef.current = true;

      setScanned(true);
      setIsCameraActive(false);

      console.log("Scanned barcode:", data, "at", new Date().toISOString());

      try {
        if (!warehouse || !warehouse.warehouse_id) {
          Alert.alert("Error", "No warehouse selected");
          return;
        }

        const itemDetails = await getItem(String(data).trim(), warehouse.warehouse_id);

        if (!itemDetails) {
          Alert.alert("Error", "Item not found");
          return;
        }

        const code = itemDetails.item_id || itemDetails.item_code || itemDetails.id;
        const uom = itemDetails.uom || "";

        if (!code) {
          Alert.alert("Error", "Item code missing from API response");
          return;
        }
        if (!uom) {
          Alert.alert("Error", "Item UOM not found");
          return;
        }

        addOrIncrementItem(code, uom);
      } catch (error) {
        console.error("Error processing scanned barcode:", error);
        Alert.alert("Error", "Failed to fetch item details");
      } finally {
        // Clear processing guard only — do not auto-restart camera or flip scanned.
        // If you want a short cooldown to block immediate UI taps, you can set a short timeout
        // that only clears processingRef.current (not scanned).
        setTimeout(() => {
          processingRef.current = false;
        }, 300); // short guard; adjust if needed
      }
    },
    [warehouse]
  );

  const onScanAgain = () => {
    // explicit user-triggered re-enable
    processingRef.current = false;
    setScanned(false);
    setIsCameraActive(true);
  };

  const removeItem = (code) => {
    setItems((prev) => prev.filter((item) => item.item_code !== code));
  };

  const changeQty = (code, delta) => {
    setItems((prev) =>
      prev.map((item) =>
        item.item_code === code ? { ...item, qty: Math.max(1, item.qty + delta) } : item
      )
    );
  };

  const goToItemDetails = () => {
    if (!items.length) {
      Alert.alert("No items", "Add at least one item before proceeding.");
      return;
    }
    navigation.navigate("ItemDetails", { items });
  };

  if (!permission) {
    return (
      <View style={styles.center}>
        <Text>Requesting camera permission…</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Text style={{ textAlign: "center", marginBottom: 20 }}>
          No access to camera. Please enable camera permissions.
        </Text>
        <Button title="Grant Permission" onPress={requestPermission} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 20}
    >
      {!showManualInput ? (
        <>
          <View style={{ flex: 1 }}>
            {/* CameraView only when active */}
            {isCameraActive && (
              <CameraView
                onBarcodeScanned={handleBarcodeScanned}
                barcodeScannerSettings={{
                  barcodeTypes: [
                    "pdf417",
                    "ean13",
                    "ean8",
                    "upc_e",
                    "upc_a",
                    "code39",
                    "code128",
                  ],
                }}
                style={[StyleSheet.absoluteFill, styles.camera]}
              />
            )}

            {/* Overlay: render when camera is active OR when scanned (so Scan Again visible) */}
            {(isCameraActive || scanned) && (
              <View
                pointerEvents={processingRef.current ? "none" : "box-none"}
                style={styles.overlay}
              >
                <Svg height="100%" width="100%">
                  <Defs>
                    <Mask id="mask" x="0" y="0" height="100%" width="100%">
                      <Rect height="100%" width="100%" fill="#fff" />
                      <Rect
                        x={Dimensions.get("window").width * 0.1}
                        y={Dimensions.get("window").height * 0.3}
                        width={Dimensions.get("window").width * 0.8}
                        height={Dimensions.get("window").width * 0.4}
                        fill="black"
                        rx={10}
                        ry={10}
                      />
                    </Mask>
                  </Defs>
                  <Rect
                    height="100%"
                    width="100%"
                    fill={isCameraActive ? "rgba(0,0,0,0.5)" : "rgba(0,0,0,0.35)"}
                    mask="url(#mask)"
                  />
                </Svg>

                {/* Show guidance only when camera is active and not scanned */}
                {isCameraActive && !scanned && (
                  <Text style={styles.scanText}>Scan your barcode</Text>
                )}
                
              </View>
            )}
          </View>

          <View style={styles.ScanAgainContainer}>
            {scanned && (
            <TouchableOpacity
              onPress={onScanAgain}
              activeOpacity={0.7}
       
              
             
            >
              <Text style={styles.scanAgainText}>Tap to Scan Again</Text>
            </TouchableOpacity>
            )}
          </View>

          <View style={styles.buttonsContainer}>
            
            {/* Manual Entry */}
            <View style={styles.buttonWrapper}>
              <TouchableOpacity
                onPress={() => setShowManualInput(true)}
                style={[styles.button, { backgroundColor: "#fff" }]}
                activeOpacity={0.7}
              >
                <Text style={{ color: "black", fontWeight: "600", textAlign: "center" }}>
                  Enter Barcode
                </Text>
              </TouchableOpacity>
            </View>

            {/* Item Code Selector (stops camera when opened/selected). Set navigateOnSelect to false to avoid navigation focus resetting the scanner */}
            <View style={styles.buttonWrapper}>
              <ItemCodeButton
                onSelectItem={handleItemSelect}
                useFlatList={false}
                setScanned={setScanned}
                setIsCameraActive={setIsCameraActive}
                navigateOnSelect={false}
              />
            </View>
          </View>

          {/* ITEMS PANEL */}
          <View style={styles.itemsPanel}>
            <Text style={styles.itemsTitle}>Items ({items.length})</Text>

            <FlatList
              data={items}
              keyExtractor={(item, index) =>
                item?.item_code ? String(item.item_code) : String(index)
              }
              ListEmptyComponent={<Text style={styles.emptyText}>No items added yet</Text>}
              renderItem={({ item }) => (
                <View style={styles.itemRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemCode}>{item.item_code}</Text>
                    <Text style={styles.itemQty}>Qty: {item.qty}</Text>
                  </View>

                  <View style={styles.itemActions}>
                    <TouchableOpacity
                      onPress={() => changeQty(item.item_code, -1)}
                      style={styles.iconBtn}
                    >
                      <AntDesign name="minus" size={18} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => changeQty(item.item_code, 1)}
                      style={styles.iconBtn}
                    >
                      <AntDesign name="plus" size={18} />
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => removeItem(item.item_code)}
                      style={styles.iconBtn}
                    >
                      <AntDesign name="delete" size={18} color="black" />
                    </TouchableOpacity>
                  </View>
                </View>
              )}
              style={{ maxHeight: Dimensions.get("window").height * 0.15 }}
            />

            <View style={styles.submitRow}>
            <TouchableOpacity
              onPress={goToItemDetails}
              disabled={!items.length}
              style={[
                styles.proceedBtn,
                !items.length && styles.ButtonDisabled
              ]}
            >
              <Text style={styles.proceedBtnText}>Proceed to Item Details</Text>
            </TouchableOpacity>
          </View>

          </View>
        </>
      ) : (
        /* MANUAL INPUT */
        <View style={styles.manualInputContainer}>
          <Text style={styles.manualTitle}>Enter Barcode</Text>

          <TextInput style={styles.input} value={barcode} onChangeText={setBarcode} placeholder="Enter barcode" placeholderTextColor="#999" autoFocus />

          <View style={styles.buttonRow}>
            <View style={styles.buttonWrapper}>
             <TouchableOpacity
    onPress={() => setShowManualInput(false)}
    style={[
              styles.cancelBtn,
            ]}
  >
    <Text style={styles.cancelBtnText}>Cancel</Text>
  </TouchableOpacity>
            </View>

            <View style={styles.buttonWrapper}>
             <TouchableOpacity
            onPress={handleManualSubmit}
            disabled={!barcode.trim()}
            style={[
              styles.submitButton,
              !barcode.trim() && styles.ButtonDisabled
            ]}
          >
            <Text style={styles.submitButtonText}>Submit</Text>
          </TouchableOpacity>

            </View>
          </View>
        </View>
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "black" },
  camera: { flex: 1 },
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "black",
  },
  buttonsContainer: {
    position: "absolute",
    bottom: 250,
    left: 20,
    right: 20,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  ScanAgainContainer: {
    position: "absolute",
    bottom: "60%",
    width: "100%",
    alignItems: "center",
  
  },
  buttonWrapper: { flex: 1, marginHorizontal: 5 },
  button: {
    justifyContent: "center",
    height: 48,
    paddingHorizontal: 16,
    backgroundColor: "#007AFF",
    borderRadius: 12,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  scanText: {
    position: "absolute",
    top: Dimensions.get("window").height * 0.25,
    width: "100%",
    textAlign: "center",
    color: "white",
    fontSize: 18,
    fontWeight: "600",
  },

  scanAgainBtn: {
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: "#007AFF",
    minWidth: 140,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  scanAgainText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
  },
  disabledBtn: {
    opacity: 0.6,
  },

  /* Items panel */
  itemsPanel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "#fff",
    padding: 12,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
  },
  itemsTitle: { fontSize: 16, fontWeight: "700", marginBottom: 8 },
  emptyText: { color: "#666", textAlign: "center", padding: 12 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "#eee",
  },
  itemCode: { fontSize: 14, fontWeight: "600" },
  itemQty: { fontSize: 12, color: "#666" },
  itemActions: { flexDirection: "row", alignItems: "center" },
  iconBtn: { marginLeft: 10, padding: 6 },
  submitRow: { marginTop: 12 },

  /* Manual entry */
  manualInputContainer: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 20,
    justifyContent: "center",
  },
  manualTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 20,
    textAlign: "center",
    color: "black",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    padding: 15,
    fontSize: 16,
    marginBottom: 20,
    backgroundColor: "#fff",
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10,
  },
  submitButton: {
  backgroundColor: '#198b43ff',
  paddingVertical: 12,
  borderRadius: 8,
  alignItems: 'center',
},

ButtonDisabled: {
  backgroundColor: '#a9b1aaff', // your custom disabled color
  opacity: 0.6,
},

submitButtonText: {
  color: '#fff',
  fontWeight: '600',
  fontSize: 16,
},
cancelBtn: {
  flex: 1,
  backgroundColor: "black",
  paddingVertical: 12,
  borderRadius: 8,
  alignItems: "center",
},
cancelBtnText: {
  color: "#fff",
  fontWeight: "600",
  fontSize: 16,
},

proceedBtn: {
  backgroundColor: "#198b43ff",     // blue
  paddingVertical: 14,
  borderRadius: 10,
  alignItems: "center",
},


proceedBtnText: {
  color: "#fff",
  fontSize: 16,
  fontWeight: "600",
},


});
