import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import PropTypes from "prop-types";

/**
 * Dropdown built from a Pressable + Modal instead of @react-native-picker/picker.
 * The native picker renders as an inline wheel on iOS and a spinner on Android,
 * so it cannot share the bordered-field look used by the TextInputs on these
 * forms. This renders identically on both platforms and needs no native module.
 *
 * `options` accepts plain strings or { label, value } objects.
 */
export default function SelectField({
  value,
  options = [],
  onChange,
  placeholder = "Select an option",
  title,
  loading = false,
  disabled = false,
  emptyText = "No options available",
}) {
  const [open, setOpen] = useState(false);

  const items = useMemo(
    () =>
      options.map((option) =>
        typeof option === "string"
          ? { label: option, value: option }
          : { label: option.label, value: option.value },
      ),
    [options],
  );

  const selected = items.find((item) => item.value === value);
  const isDisabled = disabled || loading;

  const select = (item) => {
    onChange?.(item.value);
    setOpen(false);
  };

  return (
    <View className="mb-3">
      <Pressable
        onPress={() => setOpen(true)}
        disabled={isDisabled}
        className={`flex-row items-center justify-between border border-gray-300 rounded p-3 ${
          isDisabled ? "bg-gray-100" : "bg-gray-50"
        }`}
      >
        <Text
          className={selected ? "text-gray-900" : "text-gray-500"}
          numberOfLines={1}
          style={{ flex: 1, marginRight: 8 }}
        >
          {loading ? "Loading..." : selected?.label || placeholder}
        </Text>

        {loading ? (
          <ActivityIndicator size="small" color="#6B7280" />
        ) : (
          <Ionicons name="chevron-down" size={18} color="#6B7280" />
        )}
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.5)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          {/* Swallow taps inside the card so they don't close the modal */}
          <Pressable
            onPress={() => {}}
            style={{
              backgroundColor: "#FFFFFF",
              borderRadius: 16,
              paddingVertical: 8,
              maxHeight: 380,
            }}
          >
            <Text className="text-base font-semibold text-gray-800 px-4 py-3">
              {title || placeholder}
            </Text>

            {items.length === 0 ? (
              <Text className="text-gray-500 px-4 py-6 text-center">
                {emptyText}
              </Text>
            ) : (
              <ScrollView>
                {items.map((item) => {
                  const isSelected = item.value === value;

                  return (
                    <TouchableOpacity
                      key={String(item.value)}
                      onPress={() => select(item)}
                      className={`flex-row items-center justify-between mx-2 px-3 py-3 rounded ${
                        isSelected ? "bg-gray-100" : ""
                      }`}
                    >
                      <Text
                        className={
                          isSelected
                            ? "text-gray-900 font-semibold"
                            : "text-gray-700"
                        }
                        style={{ flex: 1, marginRight: 8 }}
                      >
                        {item.label}
                      </Text>

                      {isSelected && (
                        <Ionicons
                          name="checkmark"
                          size={18}
                          color="#16A34A"
                        />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}

            <TouchableOpacity
              onPress={() => setOpen(false)}
              className="mx-2 mt-1 py-3 rounded items-center bg-gray-100"
            >
              <Text className="text-gray-600 font-semibold">Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

SelectField.propTypes = {
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  options: PropTypes.array,
  onChange: PropTypes.func.isRequired,
  placeholder: PropTypes.string,
  title: PropTypes.string,
  loading: PropTypes.bool,
  disabled: PropTypes.bool,
  emptyText: PropTypes.string,
};
