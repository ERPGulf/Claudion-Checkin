import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
// Frappe caps File.file_name at 140 characters and measures the percent-encoded
// form, so names are sanitized at the point they are picked — every feature that
// uploads an attachment goes through this hook.
import { sanitizeFileName } from '../utils/fileName';
import { assertCapability } from '../services/capabilityPolicy';
import { getAuthSessionGeneration, isAuthSessionSuspended } from '../utils/authSessionGuard';
import { store } from '../redux/Store';
import { selectScopedFeatureSettings } from '../redux/Slices/FeatureSettingsSlice';
import { isFeatureEnabled } from '../utils/featureSettings';

export const useAttachmentPicker = (capability) => {
  const [isPicking, setIsPicking] = useState(false);
  const mounted = useRef(true);
  const picking = useRef(false);
  const generation = useRef(getAuthSessionGeneration()).current;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const isCurrent = () => mounted.current &&
    generation === getAuthSessionGeneration() && !isAuthSessionSuspended();

  // A screen's delayed sheet callback or an OS permission prompt can outlive
  // its feature/account. Recheck before every native launch and return no file
  // when a picker already on screen completes after revocation.
  const runPicker = async (pick, errorMessage) => {
    if (picking.current || !isCurrent()) return null;
    picking.current = true;
    setIsPicking(true);
    try {
      const owner = capability
        ? await assertCapability(capability, { generation })
        : null;
      const current = () => isCurrent() && (!capability || isFeatureEnabled(
        selectScopedFeatureSettings(store.getState(), owner.scope), capability,
      ));
      const available = async () => {
        if (!isCurrent()) return false;
        if (capability) await assertCapability(capability, owner);
        return current();
      };
      if (!await available() || !current()) return null;
      const file = await pick(available, current);
      return await available() && current() ? file : null;
    } catch (error) {
      if (isCurrent() && error?.code !== 'FEATURE_DISABLED' && error?.code !== 'CAPABILITY_SCOPE_CHANGED') {
        Alert.alert('Error', errorMessage);
      }
      return null;
    } finally {
      picking.current = false;
      if (isCurrent()) setIsPicking(false);
    }
  };

  const requestCameraPermission = async (available, current) => {
    if (!current()) return false;
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (!await available() || !current()) return false;
    if (status !== 'granted') {
      Alert.alert(
        'Permission Denied',
        'Camera permission is required to take photos. Please enable it in your device settings.'
      );
      return false;
    }
    return true;
  };

  const requestGalleryPermission = async (available, current) => {
    if (!current()) return false;
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!await available() || !current()) return false;
    if (status !== 'granted') {
      Alert.alert(
        'Permission Denied',
        'Media library permission is required to choose images. Please enable it in your device settings.'
      );
      return false;
    }
    return true;
  };

  const pickFromCamera = () => runPicker(async (available, current) => {
    const hasPermission = await requestCameraPermission(available, current);
    if (!hasPermission) return null;
    if (!await available() || !current()) return null;

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
        name: sanitizeFileName(fileName, 'photo.jpg'),
        type: asset.mimeType || 'image/jpeg',
        size: asset.fileSize,
      };
    }
    return null;
  }, 'Failed to open camera.');

  const pickFromGallery = () => runPicker(async (available, current) => {
    const hasPermission = await requestGalleryPermission(available, current);
    if (!hasPermission) return null;
    if (!await available() || !current()) return null;

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
        name: sanitizeFileName(fileName, 'image.jpg'),
        type: asset.mimeType || 'image/jpeg',
        size: asset.fileSize,
      };
    }
    return null;
  }, 'Failed to pick image from gallery.');

  const pickDocument = () => runPicker(async (_, current) => {
    if (!current()) return null;
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/*", "*/*"],
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (result.canceled) {
      return null;
    }

    if (result?.assets && result.assets.length > 0) {
      const file = result.assets[0];
      return {
        uri: file.uri,
        name: sanitizeFileName(file.name, "receipt"),
        type: file.mimeType || "application/octet-stream"
      };
    } else if (result?.uri) {
      return {
        uri: result.uri,
        name: sanitizeFileName(result.name, "receipt"),
        type: result.mimeType || "application/octet-stream"
      };
    }
    return null;
  }, 'Failed to pick document.');

  return {
    pickFromCamera,
    pickFromGallery,
    pickDocument,
    isPicking,
  };
};
