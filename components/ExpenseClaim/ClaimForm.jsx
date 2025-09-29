// /components/ExpenseClaim/ClaimForm.jsx
import { View, Text, TextInput, Button } from "react-native";
import { useState } from "react";

function ClaimForm({ onSubmit }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");

  const handleSubmit = () => {
    if (onSubmit) {
      onSubmit({ title, amount });
    }
    setTitle("");
    setAmount("");
  };

  return (
    <View className="p-4 bg-gray-100 rounded-lg">
      <TextInput
        placeholder="Claim title"
        value={title}
        onChangeText={setTitle}
        className="border border-gray-300 p-2 mb-2 rounded"
      />
      <TextInput
        placeholder="Amount"
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        className="border border-gray-300 p-2 mb-2 rounded"
      />
      <Button title="Submit Claim" onPress={handleSubmit} />
    </View>
  );
}

export default ClaimForm;