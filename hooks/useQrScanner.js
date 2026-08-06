import { useCallback, useEffect, useRef, useState } from 'react';
import base64 from 'base-64';
import utf8 from 'utf8';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch } from 'react-redux';
import { Camera, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import {
  setBaseUrl,
  setUsername,
  setFullname,
  setEmployeeCode,
} from '../redux/Slices/UserSlice';

/**
 * The QR provisioning flow, lifted out of the classic scanner so the modern UI is
 * presentation only. Same relationship MyQrCodeLegacy and hooks/useQrCode.js
 * already have.
 *
 * Everything here is a faithful lift of screens/QrScanLegacy.jsx — the same code,
 * moved, not rewritten:
 *
 * - the same `useCameraPermissions()` hook, and the same "request it if it is not
 *   granted" mount effect — with the classic screen's `[permission]` dep replaced
 *   by a one-shot guard, which is the one deliberate behaviour fix in here and is
 *   explained at the effect,
 * - `handleQRCodeData` character for character: the same KEY list, the same
 *   base64 → utf8 decode, the same three cleanup regexes, the same dynamic
 *   pair extraction, the same `App_key` `=` padding fix, the same `Photo`
 *   default, the same `sanitizeString`/`sanitizeNumber` coercions, the same
 *   company/employee_code/baseUrl validity gate, the same nine-entry
 *   `AsyncStorage.multiSet`, the same four dispatches, the same
 *   `navigate("login")`, and the same two `alert()` failure paths,
 * - the same `pickImage`: identical `launchImageLibraryAsync` options, the same
 *   `Camera.scanFromURLAsync` decode of the first result, the same
 *   "No QR-CODE Found" alert,
 * - the same `scanned` flag, set by `handleBarCodeScanned` and cleared by the
 *   scan-again action.
 *
 * Deliberately *not* changed, even though it looks like a bug: the camera's
 * `onBarcodeScanned` is never gated on `scanned`, so frames keep being decoded
 * after the first hit. Gating it would change scanner behaviour, which is out of
 * scope for a redesign — `scanned` drives the UI and nothing else, exactly as
 * before.
 *
 * @returns {{
 *   permission: object|null,
 *   requestPermission: () => Promise<object>,
 *   initializing: boolean,
 *   denied: boolean,
 *   scanned: boolean,
 *   handleBarCodeScanned: (event: { type: string, data: string }) => Promise<void>,
 *   scanAgain: () => void,
 *   pickImage: () => Promise<void>,
 * }}
 */
export default function useQrScanner() {
  const navigation = useNavigation();
  const dispatch = useDispatch();
  const [permission, requestPermission] = useCameraPermissions();
  const [scanned, setScanned] = useState(false);

  /**
   * Ask once, on mount, when the permission is not already granted.
   *
   * The classic screen depends on `[permission]` — the whole object — and calls
   * `requestPermission()` whenever it is not granted. That is a loop on the
   * refusal path: `useCameraPermissions` stores a *fresh* response object on every
   * request, so the identity changes, the effect re-runs, and it asks again, for
   * as long as the screen is open. On a hard denial the OS answers instantly
   * without a dialog, so the loop runs at render speed and is a real source of
   * jank rather than a theoretical one.
   *
   * A ref rather than a `[permission?.granted]` dep, because the flag stays false
   * across a denial too — the ref is what makes "once" mean once. The `Try again`
   * button calls `requestPermission` directly and is unaffected.
   */
  const askedRef = useRef(false);
  useEffect(() => {
    if (permission?.granted || askedRef.current) return;
    askedRef.current = true;
    requestPermission();
  }, [permission?.granted, requestPermission]);

  const sanitizeString = (value, defaultValue = '') => {
    if (value === null || value === undefined) {
      return defaultValue;
    }

    return String(value).trim();
  };

  const sanitizeNumber = (value, defaultValue = 0) => {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : defaultValue;
  };

  const handleQRCodeData = async data => {
    try {
      const KEYS = [
        'Company',
        'Employee_Code',
        'Full_Name',
        'User_id',
        'API',
        'App_key',

        // Optional old fields (backward compatibility)
        'Photo',
        'Restrict Location',
        'Unrestricted Checkout Location',
      ];
      // :one: Decode Base64
      let value = utf8.decode(base64.decode(data));
      // :two: Clean up weird characters
      value = value
        .replace(/[\u0000-\u001F\u00A0]+/g, ' ')
        .replace(
          /[%#;]+(?:\s+)?(Company|Employee_Code|Full_Name|Photo|Restrict Location|Unrestricted Checkout Location|User_id|API|App_key)(?:\s*[:=])/g,
          (_, key) => `${key}:`,
        )
        .replace(/[^\S\r\n]+/g, ' ')
        .trim();
      // :three: Dynamic extraction
      const qrData = {};
      const keyAlt = KEYS.join('|');
      const pairRE = new RegExp(
        `\\b(${keyAlt})\\s*[:=]\\s*([\\s\\S]*?)(?=\\s*(?:${keyAlt})\\s*[:=]|$)`,
        'gi',
      );
      let m;
      while ((m = pairRE.exec(value))) {
        const k = m[1].trim();
        const v = m[2].trim();
        qrData[k] = v;
      }
      // :four: Trailing cleanup
      Object.keys(qrData).forEach(k => {
        qrData[k] = qrData[k].replace(/[%#;]+$/, '').trim();
      });
      // :five: App_key fix
      let appKey = qrData['App_key']?.trim() || '';
      const missingPadding = appKey.length % 4;
      if (missingPadding) {
        appKey = appKey.padEnd(appKey.length + (4 - missingPadding), '=');
      }
      if (!appKey.endsWith('==')) {
        if (appKey.endsWith('=')) appKey = appKey.slice(0, -1) + '==';
        else appKey += '==';
      }
      // :six: Photo default=1
      const photoFlag = qrData['Photo']
        ? Number.parseInt(qrData['Photo'], 10)
        : 1;
      // :seven: Build final object
      const cleanedData = {
        company: sanitizeString(qrData['Company']),

        employee_code: sanitizeString(qrData['Employee_Code']),

        full_name: sanitizeString(qrData['Full_Name']),

        api_key: sanitizeString(qrData['User_id']),

        baseUrl: sanitizeString(qrData['API']),

        app_key: sanitizeString(appKey),

        // Optional old QR fallback values
        photo: sanitizeNumber(qrData['Photo'], 0),

        restrict_location: sanitizeNumber(qrData['Restrict Location'], 0),

        unrestricted_checkout_location: sanitizeNumber(
          qrData['Unrestricted Checkout Location'],
          0,
        ),
      };
      console.log(
        'QR UNRESTRICTED VALUE:',
        cleanedData.unrestricted_checkout_location,
      );
      // :eight: Validate required fields
      if (
        cleanedData.company &&
        cleanedData.employee_code &&
        cleanedData.baseUrl
      ) {
        await AsyncStorage.multiSet([
          ['company', cleanedData.company],
          ['employee_code', cleanedData.employee_code],
          ['full_name', cleanedData.full_name],
          ['api_key', cleanedData.api_key],
          ['app_key', cleanedData.app_key],
          ['baseUrl', cleanedData.baseUrl],
          ['photo', String(cleanedData.photo)],
          ['restrict_location', String(cleanedData.restrict_location)], // :point_left: NEW
          [
            'unrestricted_checkout_location',
            String(cleanedData.unrestricted_checkout_location),
          ],
        ]);
        // Redux dispatch (NO restrict_location)
        dispatch(setUsername(cleanedData.api_key));
        dispatch(setFullname(cleanedData.full_name));
        dispatch(setBaseUrl(cleanedData.baseUrl));
        dispatch(setEmployeeCode(cleanedData.employee_code));
        navigation.navigate('login');
      } else {
        alert('Invalid QR code. Please try again.');
      }
    } catch (err) {
      alert('Invalid QR code');
    }
  };

  const handleBarCodeScanned = async ({ type, data }) => {
    setScanned(true);
    await handleQRCodeData(data);
  };

  const pickImage = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (result?.canceled) return;
      if (result.assets[0]?.uri) {
        const scannedResults = await Camera.scanFromURLAsync(
          result.assets[0].uri,
        );
        const { data } = scannedResults[0];
        await handleQRCodeData(data);
      }
    } catch {
      alert('No QR-CODE Found');
    }
  };

  const scanAgain = useCallback(() => setScanned(false), []);

  return {
    // Permission — the same object the classic screen branched on, with its two
    // branches named rather than re-derived at the call site.
    permission,
    requestPermission,
    initializing: !permission || permission.status === 'undetermined',
    denied: !!permission && permission.status !== 'undetermined' && !permission.granted,

    // Scanning
    scanned,
    handleBarCodeScanned,

    // Actions
    scanAgain,
    pickImage,
  };
}
