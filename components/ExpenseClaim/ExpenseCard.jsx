import { View, Text } from 'react-native';
import React from 'react';
import { COLORS, SIZES } from '../../constants';

function ExpenseCard({ claim }) {
  return (
    <View className="mb-3 p-4 bg-gray-100 rounded-lg">
      <Text className="text-base font-semibold">{claim.title}</Text>
      <Text className="text-sm text-gray-700">Amount: ${claim.amount}</Text>
      <Text className="text-sm text-gray-500">Date: {claim.date}</Text>
      <Text className="text-sm text-gray-500">Status: {claim.status}</Text>
    </View>
  );
}

export default ExpenseCard;