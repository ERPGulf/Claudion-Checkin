import { useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useDispatch, useSelector } from 'react-redux';
import { Toast } from 'react-native-toast-message/lib/src/Toast';
import * as Yup from 'yup';
import { setSignIn } from '../redux/Slices/AuthSlice';
import { selectEmployeeCode } from '../redux/Slices/UserSlice';
import { setUnreadCount } from '../redux/Slices/notificationSlice';
import { getNotifications } from '../services/api/notification.service';
import { generateToken } from '../services/api';
import { getLoginErrorMessage } from '../utils/loginError';
import { readProvisioning } from '../utils/provisioning';

/**
 * The login flow, lifted out of the classic screen so the modern UI is
 * presentation only. Same relationship hooks/useQrScanner.js already has with
 * QrScanLegacy, and for the same reason: the redesign is a layout change, and
 * authentication is not something a layout change should be able to touch.
 *
 * Everything here is a faithful lift of screens/LoginLegacy.jsx — the same code,
 * moved, not rewritten:
 *
 * - the same Yup schema, character for character: min 5 "Too short!", max 24
 *   "Too long!", required "Please enter your password.",
 * - the same three AsyncStorage reads (`api_key`, `app_key`, `baseUrl`) and the
 *   same "QR code not scanned" guard, with the same toast text and the same
 *   early `setIsLoading(false)` return,
 * - the same `generateToken({ api_key, app_key, api_secret })` call, the same
 *   "Token not returned from server" throw, the same `employee_id` write gated on
 *   `employeeCode`, the same `setSignIn({ isLoggedIn: true, token })`,
 * - the same post-login notification fetch, including its silent `catch` — a
 *   failed unread count must never fail a successful login,
 * - the same success toast, the same `console.log("Login failed", …)` diagnostic
 *   shape, the same `getLoginErrorMessage()` mapping and the same 4s error toast,
 * - the same `finally { setIsLoading(false) }`.
 *
 * Navigation on success is still nothing: `selectIsLoggedIn` swaps the navigator
 * (see redux/Slices/AuthSlice.js), which is why the classic screen's
 * `navigation.navigate("homeTab")` is commented out rather than called. Left that
 * way deliberately — routing off Redux is the app's rule, and "fixing" it here
 * would double-navigate.
 *
 * @returns {{
 *   loginSchema: object,
 *   initialValues: { password: string },
 *   isLoading: boolean,
 *   handleLogin: (password: string) => Promise<void>,
 *   fullname: string,
 *   employeeCode: string,
 * }}
 */
export default function useLogin() {
  const dispatch = useDispatch();
  const [isLoading, setIsLoading] = useState(false);
  const employeeCode = useSelector(selectEmployeeCode);
  const fullname = useSelector(state => state.user.fullname);

  // Form validation schema
  const loginSchema = Yup.object().shape({
    password: Yup.string()
      .min(5, 'Too short!')
      .max(24, 'Too long!')
      .required('Please enter your password.'),
  });

  // Handle login
  const handleLogin = async password => {
    setIsLoading(true);
    try {
      // Same three keys and the same guard as before, read through the shared
      // helper so this and the auth navigator's "which screen do we open on"
      // decision can never disagree about what "provisioned" means.
      const { api_key, app_key, provisioned } = await readProvisioning();

      if (!provisioned) {
        Toast.show({
          type: 'error',
          text1: 'QR code not scanned',
          text2: 'Please scan QR code first',
          autoHide: true,
          visibilityTime: 3000,
        });
        setIsLoading(false);
        return;
      }

      const { access_token } = await generateToken({
        api_key,
        app_key,
        api_secret: password,
      });

      if (!access_token) throw new Error('Token not returned from server');

      if (employeeCode) {
        await AsyncStorage.setItem('employee_id', employeeCode);
      }

      dispatch(setSignIn({ isLoggedIn: true, token: access_token }));

      // 🔔 fetch notifications at login
      try {
        const employeeId = await AsyncStorage.getItem('employee_id');

        if (employeeId) {
          const notifications = await getNotifications(employeeId);

          const unreadCount = notifications.filter(
            item => Number(item.read) === 0,
          ).length;

          dispatch(setUnreadCount(unreadCount));
        }
      } catch (err) {}

      Toast.show({
        type: 'success',
        text1: 'Login successful',
        autoHide: true,
        visibilityTime: 3000,
      });
    } catch (error) {
      // Log the real cause for engineers (adb logcat / Metro). The user used to
      // see only a generic "Something went wrong", which hid SSL/clock/network
      // failures behind the same text as a wrong password.
      console.log('Login failed', {
        message: error?.message ?? null,
        code: error?.code ?? null,
        status: error?.response?.status ?? null,
        data: error?.response?.data ?? null,
      });

      const { text1, text2 } = getLoginErrorMessage(error);
      Toast.show({
        type: 'error',
        text1,
        text2,
        autoHide: true,
        visibilityTime: 4000,
      });
    } finally {
      setIsLoading(false);
    }
  };

  return {
    // Form — the schema and the starting value the classic <Formik> was given.
    loginSchema,
    initialValues: { password: '' },

    // Submission
    isLoading,
    handleLogin,

    // Who is signing in. Read here rather than in the screen so the card and the
    // `employee_id` write agree on one source.
    fullname,
    employeeCode,
  };
}
