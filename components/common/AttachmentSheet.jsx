/* eslint-disable react/prop-types */
import React from 'react';
import { View } from 'react-native';
import { SPACING } from '../../constants';
import BottomSheet from './BottomSheet';
import SettingsRow, { RowDivider } from './SettingsRow';

/**
 * How a receipt gets attached. Order is the order they render in — camera first,
 * because photographing a paper receipt is what most of these are.
 */
const OPTIONS = [
  {
    key: 'camera',
    icon: 'camera-outline',
    title: 'Take Photo',
    description: 'Capture a new receipt',
  },
  {
    key: 'gallery',
    icon: 'image-outline',
    title: 'Choose Image',
    description: 'Select from your gallery',
  },
  {
    key: 'document',
    icon: 'document-text-outline',
    title: 'Browse Files',
    description: 'PDF, JPG, PNG',
  },
];

/**
 * The Modern UI's attachment picker.
 *
 * A separate component from components/attachment/AttachmentBottomSheet, which
 * stays exactly as it is: the classic Expense Claim form, classic Attendance
 * Request, Leave Request, Complaints and Loan Application all still render it,
 * and none of those screens have been redesigned. This one is wired into the
 * modern screens only.
 *
 * What changed is presentation. The old sheet hardcodes its palette — a white
 * panel with `#E0F2FE` / `#DCFCE7` / `#FEF3C7` circles behind the icons — which
 * is a bright white card floating over a near-black page in dark mode. Here the
 * chrome comes from <BottomSheet> and each option is a <SettingsRow>, the same
 * row Profile and Automatic Attendance use: one neutral `iconBackground` chip,
 * a monochrome glyph, a title, a description and a chevron, at the 44pt
 * `comfortable` rhythm. Nothing about *how* a file is picked changed — the three
 * callbacks are handed straight through.
 */
function AttachmentSheet({
  visible,
  onClose,
  onSelectCamera,
  onSelectGallery,
  onSelectDocument,
}) {
  const handlers = {
    camera: onSelectCamera,
    gallery: onSelectGallery,
    document: onSelectDocument,
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Add Attachment"
      subtitle="Choose how you want to attach a receipt."
      closeLabel="Close"
    >
      <View style={{ paddingVertical: SPACING.xs }}>
        {OPTIONS.map((option, index) => (
          <View key={option.key}>
            {index > 0 && <RowDivider size="comfortable" />}

            <SettingsRow
              size="comfortable"
              icon={option.icon}
              title={option.title}
              description={option.description}
              accessibilityLabel={`${option.title}. ${option.description}`}
              onPress={handlers[option.key]}
            />
          </View>
        ))}
      </View>
    </BottomSheet>
  );
}

export default AttachmentSheet;
