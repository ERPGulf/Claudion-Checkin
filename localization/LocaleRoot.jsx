/* eslint-disable react/prop-types */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from './index';

/** Runtime Yoga direction; never remounts attendance bootstraps or navigation. */
export default function LocaleRoot({ children }) {
  const { direction } = useTranslation();
  return <View style={{ flex: 1, direction }}>{children}</View>;
}
