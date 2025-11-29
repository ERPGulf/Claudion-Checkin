// Stocker.jsx
import React, { useLayoutEffect, useEffect, useState } from 'react';
import {
  View,
  Text,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useSelector, useDispatch } from 'react-redux';
import { selectEmployeeCode } from '../../redux/Slices/UserSlice';
import { useNavigation } from '@react-navigation/native';
import { getWarehouses } from '../../services/getWarehouse';
import { selectedWarehouse as selectedWarehouseSelect, setWarehouse } from '../../redux/Slices/Warehouse';
import Entypo from '@expo/vector-icons/Entypo';
import { COLORS, SIZES } from '../../constants';


const Stocker = () => {
  const navigation = useNavigation();
  const dispatch = useDispatch();

  // header like ExpenseClaim
  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      headerShadowVisible: false,
      headerTitle: 'Stocker',
      headerTitleAlign: 'center',
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingLeft: 12 }}>
          <Entypo name="chevron-left" size={SIZES.xxxLarge - 5} color={COLORS.primary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const employeeCode = useSelector(selectEmployeeCode);
  const selectedWarehouseValue = useSelector(selectedWarehouseSelect);

  const [warehouses, setWarehouses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [showWarehousePicker, setShowWarehousePicker] = useState(false);

  const showAlert = (title, msg) => {
    if (Platform.OS === 'web') {
      alert(`${title}\n\n${msg}`);
    } else {
      Alert.alert(title, msg);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const list = await getWarehouses(employeeCode);
        setWarehouses(list || []);
      } catch (e) {
        setError(e?.message ?? 'Failed to load warehouses');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [employeeCode]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Warehouse</Text>

        {loading && (
          <View style={styles.loadingRow}>
            <ActivityIndicator />
            <Text style={{ marginLeft: 8 }}>Loading…</Text>
          </View>
        )}
        {error && <Text style={{ color: 'red', marginBottom: 8 }}>{error}</Text>}

        {/* Dropdown trigger */}
        <TouchableOpacity
          onPress={() => setShowWarehousePicker(true)}
          style={styles.select}
        >
          <Text style={styles.selectText}>
            {selectedWarehouseValue?.warehouse_id ?? 'Select Warehouse'}
          </Text>
          <Text style={styles.chevron}>▾</Text>
        </TouchableOpacity>

        {/* Dropdown modal */}
        <Modal
          visible={showWarehousePicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowWarehousePicker(false)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => setShowWarehousePicker(false)}
          >
            <Pressable style={styles.modalCard}>
              <Text style={styles.modalTitle}>Select Warehouse</Text>
              <FlatList
                data={warehouses}
                keyExtractor={(w) => w.warehouse_id}
                renderItem={({ item }) => {
                  const active =
                    selectedWarehouseValue?.warehouse_id === item.warehouse_id;
                  return (
                    <TouchableOpacity
                      onPress={() => {
                        // dispatch the whole warehouse object
                        dispatch(setWarehouse(item));
                        setShowWarehousePicker(false);
                      }}
                      style={[styles.optionRow, active && { backgroundColor: '#eff6ff' }]}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.optionPrimary}>{item.warehouse_id}</Text>
                        <Text style={styles.optionSecondary}>{item.warehouse_name}</Text>
                      </View>
                      {active && <Text style={{ color: '#2563eb' }}>✓</Text>}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={!loading ? (
                  <Text style={{ color: '#6b7280' }}>No Warehouses.</Text>
                ) : null}
              />
            </Pressable>
          </Pressable>
        </Modal>

        {/* Scan Button (requires selectedWarehouse) */}
        <TouchableOpacity
          style={[styles.button, !selectedWarehouseValue && { opacity: 0.6 }]}
          onPress={() => {
            if (!selectedWarehouseValue) {
              showAlert('Selection required', 'Please select warehouse to continue.');
              return;
            }
            navigation.navigate('Scanning');
          }}
        >
          <Text style={styles.buttonText}>Scan Item</Text>
        </TouchableOpacity>

        <View style={{ height: 16 }} />
      </View>
    </ScrollView>
  );
};

export default Stocker;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    backgroundColor: 'white',
    alignItems: 'center',
  },
  card: {
    width: '90%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 12,
  },
  name: {
    fontSize: 24,
    fontWeight: '800',
    marginBottom: 12,
    paddingBottom: 15,
  },
  select: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    maxHeight: '70%',
    padding: 12,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  optionPrimary: {
    fontWeight: '700',
  },
  optionSecondary: {
    color: '#6b7280',
  },
  selectText: {
    color: '#111827',
  },
  chevron: {
    color: '#6b7280',
  },
    button: {
      backgroundColor: '#198b43ff',
      padding: 12,
      borderRadius: 8,
      alignItems: 'center',
      marginTop: 16,
    },
  scanButton: {
    backgroundColor: '#34C759',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
});
