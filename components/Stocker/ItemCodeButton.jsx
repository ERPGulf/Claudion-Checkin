import debounce from "lodash.debounce";
import React, { useState, useCallback } from "react";
import {
    Button,
    FlatList,
    Modal,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
    ActivityIndicator
} from "react-native";
import { searchItems } from "../../services/searchItems";
import { getItem } from "../../services/getItems";
import { getItemUom } from "../../services/getItemUom";
import { useSelector } from "react-redux";
import { selectedWarehouse } from "../../redux/Slices/Warehouse";

/**
 * Props:
 *  - onSelectItem(item)            // required
 *  - navigateOnSelect = true       // optional
 *  - setScanned                    // optional: function from Scanning to set scanned state
 *  - setIsCameraActive             // optional: function from Scanning to enable/disable camera
 */
const ItemCodeButton = ({
  onSelectItem,
  navigateOnSelect = true,
  setScanned,
  setIsCameraActive
}) => {
  const [modalVisible, setModalVisible] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [uoms, setUoms] = useState([]);
  const [selectedUom, setSelectedUom] = useState('');
  const [selectedItem, setSelectedItem] = useState(null);
  const [loadingUoms, setLoadingUoms] = useState(false);
  const [currentSearchTerm, setCurrentSearchTerm] = useState('');
  const warehouse = useSelector(selectedWarehouse);

  const fetchItems = useCallback(
    debounce(async (text, pageNum = 1) => {
      if (!text) {
        setItems([]);
        setHasMore(true);
        setPage(1);
        return;
      }

      const isNewSearch = currentSearchTerm !== text || pageNum === 1;
      const offset = (pageNum - 1) * 3;

      if (isNewSearch) {
        setItems([]);
        setPage(1);
        setCurrentSearchTerm(text);
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const data = await searchItems(text, 3, offset);
        console.log("data", data);
        if (data) {
          setItems(prev =>
            isNewSearch ? data : [...prev, ...data]
          );
          setHasMore(data.length === 3);
        } else {
          if (isNewSearch) setItems([]);
          setHasMore(false);
        }
      } catch (err) {
        console.error("Error fetching items:", err);
        if (isNewSearch) setItems([]);
        setHasMore(false);
      } finally {
        isNewSearch ? setLoading(false) : setLoadingMore(false);
      }
    }, 250),
    [currentSearchTerm]
  );

  const loadMoreItems = useCallback(() => {
    if (!loading && !loadingMore && hasMore && currentSearchTerm) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchItems(currentSearchTerm, nextPage);
    }
  }, [page, loading, loadingMore, hasMore, currentSearchTerm, fetchItems]);

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.loadingMore}>
        <ActivityIndicator size="small" color="#0000ff" />
      </View>
    );
  };

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      key={item.item_code}
      style={styles.suggestionItem}
      onPress={() => handleItemSelect(item)}
    >
      <Text style={styles.itemText}>{item.item_code}</Text>
      <Text style={styles.itemText2}>{item.item_name}</Text>
    </TouchableOpacity>
  ), []);

  const handleItemSelect = async (item) => {
    setSelectedItem(item);
    setLoadingUoms(true);
    try {
      const uomsRes = await getItemUom(item.item_code || '');
      console.log("uomsRes", uomsRes);

      setUoms(uomsRes || []);
      if (uomsRes && uomsRes.length > 0) {
        setSelectedUom(uomsRes[0]);
      } else {
        setSelectedUom('');
      }
    } catch (err) {
      console.error('Error fetching UOMs:', err);
      setUoms([]);
      setSelectedUom('');
    } finally {
      setLoadingUoms(false);
    }
  };

  const handleUomSelect = (uom) => {
    setSelectedUom(uom);
  };

  const handleSelectUom = () => {
    if (!selectedItem || !selectedUom) return;

    // notify parent
    onSelectItem({
      item_code: selectedItem.item_code,
      uom: selectedUom
    });

    // stop scanner in parent (if provided)
    try {
      if (typeof setScanned === "function") setScanned(true);
      if (typeof setIsCameraActive === "function") setIsCameraActive(false);
    } catch (e) {
      // swallow any errors from parent callbacks
      console.warn("Error calling scanner setters:", e);
    }

    // close & reset local state
    setModalVisible(false);
    setSearchTerm('');
    setItems([]);
    setSelectedItem(null);
    setUoms([]);
    setSelectedUom('');
    setPage(1);
    setHasMore(true);
    setCurrentSearchTerm('');
  };

  // When opening modal, also stop camera to avoid accidental scanning while user interacts
  const openModal = () => {
    // stop scanner in parent (if provided)
    try {
      if (typeof setScanned === "function") setScanned(true);
      if (typeof setIsCameraActive === "function") setIsCameraActive(false);
    } catch (e) {
      console.warn("Error calling scanner setters:", e);
    }

    setModalVisible(true);
  };

  const closeModalAndReset = () => {
    setModalVisible(false);
    setTimeout(() => {
      setSelectedItem(null);
      setUoms([]);
      setSearchTerm('');
      setItems([]);
      setSelectedUom('');
      setPage(1);
      setHasMore(true);
      setCurrentSearchTerm('');
    }, 300);
  };

  return (
    <>
      <View >
        <TouchableOpacity
          onPress={openModal}
          style={[styles.button, { backgroundColor: "#fff" }]}
          accessibilityRole="button"
          accessibilityLabel="Enter Item Code"
        >
          <Text style={{ color: "black", fontWeight: "600", textAlign: "center" }}>
            Enter Item Code
          </Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={modalVisible}
        transparent
        animationType="slide"
        onRequestClose={closeModalAndReset}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>

            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {selectedItem ? "Select UOM" : "Search Items"}
              </Text>
              <TouchableOpacity
                onPress={closeModalAndReset}
                style={styles.closeButton}
              >
                <Text style={styles.closeButtonText}>✕</Text>
              </TouchableOpacity>
            </View>

            {!selectedItem ? (
              <>
                <View style={styles.inputContainer}>
                  <TextInput
                    value={searchTerm}
                    onChangeText={setSearchTerm}
                    placeholder="Type item code..."
                    autoFocus
                    style={[styles.input, { flex: 1 }]}
                    placeholderTextColor="#999"
                    underlineColorAndroid="transparent"
                    selectionColor="#007AFF"
                    onSubmitEditing={() => searchTerm && fetchItems(searchTerm, 1)}
                    returnKeyType="search"
                  />
                  <TouchableOpacity
                    style={styles.search}
                    onPress={() => searchTerm && fetchItems(searchTerm, 1)}
                    disabled={!searchTerm}
                  >
                    <Text style={styles.searchButtonText}>Search</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.suggestionsContainer}>
                  {loading && items.length === 0 ? (
                    <Text style={styles.searchingText}>Searching...</Text>
                  ) : (
                    <FlatList
                      data={items}
                      renderItem={renderItem}
                      keyExtractor={item => item.item_code || ''}
                      onEndReached={loadMoreItems}
                      onEndReachedThreshold={0.1}
                      ListFooterComponent={renderFooter}
                    />
                  )}
                </View>
              </>
            ) : (
              <View style={styles.uomContainer}>
                <Text style={styles.selectedItem}>
                  {selectedItem.item_code} ({selectedItem.item_name})
                </Text>

                {loadingUoms ? (
                  <ActivityIndicator size="small" color="#007AFF" style={styles.loader} />
                ) : uoms.length > 0 ? (
                  <>
                    <Text style={styles.uomLabel}>Select Unit of Measure:</Text>
                    <View style={styles.uomList}>
                      {uoms.map((uom) => (
                        <TouchableOpacity
                          key={uom}
                          style={[
                            styles.uomItem,
                            selectedUom === uom && styles.uomItemSelected
                          ]}
                          onPress={() => handleUomSelect(uom)}
                        >
                          <Text style={styles.uomText}>{uom}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </>
                ) : (
                  <Text style={styles.noUomText}>No UOMs available</Text>
                )}

                <View style={styles.uomButtons}>
                  <Button
                    title="Back"
                    onPress={() => {
                      setSelectedItem(null);
                      setUoms([]);
                      setSelectedUom('');
                    }}
                    color="#999"
                  />
                  {uoms.length > 0 && (
                    <Button
                      title="Select"
                      onPress={handleSelectUom}
                      color="green"
                    />
                  )}
                </View>
              </View>
            )}

          </View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  inputWrapper: { flex: 1 },
  input: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 6,
    borderColor: "#ddd",
    backgroundColor: "#fff",
    fontSize: 16
  },
  searchButton: {
    backgroundColor: "#007AFF",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center"
  },
  searchButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600"
  },
  uomContainer: { padding: 16 },
  selectedItem: {
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 20,
    textAlign: "center",
    color: "#1f2937"
  },
  uomLabel: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 12
  },
  uomList: { maxHeight: 200, marginBottom: 20 },
  uomItem: {
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
    backgroundColor: "#fff"
  },
  uomItemSelected: {
    backgroundColor: "#bbe1d0ff",
    borderLeftWidth: 3,
    borderLeftColor: "green"
  },
  uomText: { fontSize: 16, color: "#1f2937" },
  uomButtons: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 10
  },
  noUomText: {
    textAlign: "center",
    color: "#6b7280",
    marginVertical: 20
  },
  loader: { marginVertical: 20 },
  button: {
    justifyContent: "center",
    height: 48,
    paddingHorizontal: 16,
    backgroundColor: "#007AFF",
    borderRadius: 12
  },
  suggestionItem: {
    padding: 12,
    marginVertical: 4,
    backgroundColor: "#f3f4f6",
    borderRadius: 8
  },
  search: {
    backgroundColor: "green",
    paddingVertical: 8,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginRight: 8
  },
  modalContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center"
  },
  modalContent: {
    backgroundColor: "#fff",
    width: "90%",
    borderRadius: 16,
    padding: 16
  },
  inputContainer: {
    flexDirection: "row",
    marginBottom: 16,
    alignItems: "center",
    gap: 8
  },
  suggestionsContainer: { marginTop: 12, maxHeight: 224 },
  modalTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 12,
    color: "#1f2937"
  },
  searchingText: {
    color: "#6b7280",
    textAlign: "center",
    padding: 12
  },
  itemText: {
    fontSize: 16,
    color: "#1f2937",
    fontWeight: "600"
  },
  itemText2: {
    fontSize: 12,
    fontWeight: "400",
    color: "#1f2937"
  },
  loadingMore: {
    padding: 10,
    justifyContent: "center",
    alignItems: "center"
  },
  closeButton: { padding: 8, marginRight: -8 },
  closeButtonText: { fontSize: 20, color: "#666" },
  modalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 16
  }
});

export default ItemCodeButton;
