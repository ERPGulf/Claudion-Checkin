/* eslint-disable react/prop-types */
import React, { useEffect, useRef } from 'react';
import { Animated, Image, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ICON, RADIUS, SPACING, TYPO } from '../../constants';
import useAppTheme from '../../hooks/useAppTheme';
import PressableScale from './PressableScale';
import { resolveTextAlign } from '../../utils/textDirection';

/**
 * The attachment area, as a dedicated upload target rather than something
 * shaped like a text input.
 *
 * Empty, it is a single compact row — glyph, prompt, accepted formats, an
 * "Optional" chip — not a tall drop zone. The area only grows once there is a
 * file to show, so the common case (no attachment) costs almost no height. The
 * dashed outline stays, because it is the one cue that reads as "put something
 * here", and it is the only dashed border in the app.
 *
 * Attached, it becomes a solid card with a thumbnail or a document row and a
 * remove button. The whole thing stays tappable so a wrong file can be replaced
 * without removing it first.
 *
 * Picking is unchanged: the press is forwarded straight to the same bottom
 * sheet and the same `useAttachmentPicker` handlers the classic screen uses.
 */
function UploadField({ file, onPick, onRemove }) {
  const { colors } = useAppTheme();

  const isImage = !!file?.type?.startsWith('image');

  // A short fade+rise once a file lands, so the state change registers without
  // anything bouncing. Keyed on the uri, so replacing a file replays it.
  const enter = useRef(new Animated.Value(file ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: file ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [file?.uri, file, enter]);

  if (!file) {
    return (
      <PressableScale
        onPress={onPick}
        scaleTo={0.99}
        hitSlop={0}
        accessibilityRole="button"
        accessibilityLabel="Upload supporting document. Optional."
        accessibilityHint="Opens options to take a photo, choose an image or browse files"
        style={{
          minHeight: 54,
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: SPACING.md,
          paddingVertical: SPACING.sm,
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderStyle: 'dashed',
          borderColor: colors.cardBorder,
          backgroundColor: colors.surfaceSecondary,
        }}
      >
        <Ionicons
          name="cloud-upload-outline"
          size={ICON.md}
          color={colors.textSecondary}
          style={{ marginEnd: SPACING.md }}
        />

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ ...TYPO.headline, color: colors.textPrimary }}
            numberOfLines={1}
          >
            Upload supporting document
          </Text>
          <Text style={{ ...TYPO.caption2, color: colors.textMuted }}>
            PDF • JPG • PNG
          </Text>
        </View>

        <View
          style={{
            paddingHorizontal: SPACING.sm,
            paddingVertical: 2,
            borderRadius: RADIUS.pill,
            backgroundColor: colors.neutralSurface,
            borderWidth: 1,
            borderColor: colors.neutralBorder,
            marginStart: SPACING.sm,
          }}
        >
          <Text style={{ ...TYPO.caption2, color: colors.textMuted }}>
            Optional
          </Text>
        </View>
      </PressableScale>
    );
  }

  return (
    <Animated.View
      style={{
        opacity: enter,
        transform: [
          {
            translateY: enter.interpolate({
              inputRange: [0, 1],
              outputRange: [6, 0],
            }),
          },
        ],
      }}
    >
      <PressableScale
        onPress={onPick}
        scaleTo={0.99}
        hitSlop={0}
        accessibilityRole="button"
        accessibilityLabel={`Attached: ${file.name}. Tap to replace.`}
        style={{
          borderRadius: RADIUS.lg,
          borderWidth: 1,
          borderColor: colors.successBorder,
          backgroundColor: colors.successSurface,
          padding: SPACING.sm,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Ionicons
            name={isImage ? 'image-outline' : 'document-text-outline'}
            size={ICON.md}
            color={colors.successText}
            style={{ marginEnd: SPACING.md, marginStart: SPACING.xs }}
          />

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                ...TYPO.caption,
                fontWeight: '600',
                color: colors.successText,
              }}
            >
              Attached
            </Text>
            <Text
              numberOfLines={1}
              // Frappe filenames are regularly Arabic; align to the script the
              // name actually contains rather than assuming Latin.
              style={{
                ...TYPO.caption2,
                color: colors.textSecondary,
                textAlign: resolveTextAlign(file.name),
              }}
            >
              {file.name}
            </Text>
          </View>

          <PressableScale
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel="Remove attachment"
            style={{
              width: 30,
              height: 30,
              borderRadius: RADIUS.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.cardBackground,
              marginStart: SPACING.sm,
            }}
          >
            <Ionicons name="close" size={ICON.sm} color={colors.textSecondary} />
          </PressableScale>
        </View>

        {isImage && (
          <Image
            source={{ uri: file.uri }}
            style={{
              width: '100%',
              height: 120,
              borderRadius: RADIUS.md,
              marginTop: SPACING.sm,
            }}
            resizeMode="cover"
          />
        )}
      </PressableScale>
    </Animated.View>
  );
}

export default UploadField;
