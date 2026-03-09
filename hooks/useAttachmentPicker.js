import { useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

export const useAttachmentPicker = () => {
  const [isPicking, setIsPicking] = useState(false);

  const requestCameraPermission = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Denied',
        'Camera permission is required to take photos. Please enable it in your device settings.'
      );
      return false;
    }
    return true;
  };

  const requestGalleryPermission = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(
        'Permission Denied',
        'Media library permission is required to choose images. Please enable it in your device settings.'
      );
      return false;
    }
    return true;
  };

  const pickFromCamera = async () => {
    if (isPicking) return null;
    try {
      setIsPicking(true);
      const hasPermission = await requestCameraPermission();
      if (!hasPermission) return null;

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const fileName = asset.fileName || asset.uri.split('/').pop() || 'photo.jpg';
        return {
          uri: asset.uri,
          name: fileName,
          type: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
        };
      }
      return null;
    } catch (error) {
      console.error('Camera picking error:', error);
      Alert.alert('Error', 'Failed to open camera.');
      return null;
    } finally {
      setIsPicking(false);
    }
  };

  const pickFromGallery = async () => {
    if (isPicking) return null;
    try {
      setIsPicking(true);
      const hasPermission = await requestGalleryPermission();
      if (!hasPermission) return null;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const fileName = asset.fileName || asset.uri.split('/').pop() || 'image.jpg';
        return {
          uri: asset.uri,
          name: fileName,
          type: asset.mimeType || 'image/jpeg',
          size: asset.fileSize,
        };
      }
      return null;
    } catch (error) {
      console.error('Gallery picking error:', error);
      Alert.alert('Error', 'Failed to pick image from gallery.');
      return null;
    } finally {
      setIsPicking(false);
    }
  };

  const pickDocument = async () => {
    if (isPicking) return null;
    try {
      setIsPicking(true);
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'image/*',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        ],
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        return null;
      }

      if (result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        return {
          uri: asset.uri,
          name: asset.name,
          type: asset.mimeType || 'application/octet-stream',
          size: asset.size,
        };
      }
      return null;
    } catch (error) {
      console.error('Document picking error:', error);
      Alert.alert('Error', 'Failed to pick document.');
      return null;
    } finally {
      setIsPicking(false);
    }
  };

  return {
    pickFromCamera,
    pickFromGallery,
    pickDocument,
    isPicking,
  };
};
