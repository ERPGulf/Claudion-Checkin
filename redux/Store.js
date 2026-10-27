import { configureStore } from '@reduxjs/toolkit';

import {
  persistStore,
  persistReducer,
  FLUSH,
  REHYDRATE,
  PAUSE,
  PERSIST,
  PURGE,
  REGISTER,
} from 'redux-persist';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import rootReducer from './RootReducer';

/**
 * A rehydrate that fails restores the initial state — signed out — and
 * redux-persist then writes that over the stored session.
 *
 * iOS starts this app in the background for a geofence crossing or a push,
 * including before the phone's first unlock, when AsyncStorage's files are
 * still encrypted and every read fails. In the background, wait for them to
 * open (the user unlocking) instead; in the foreground, fail as before.
 */
const persistStorage = {
  getItem: async key => {
    for (;;) {
      try {
        return await AsyncStorage.getItem(key);
      } catch (error) {
        if (AppState.currentState === 'active') throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  },
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: key => AsyncStorage.removeItem(key),
};

const persistConfig = {
  key: 'root',
  storage: persistStorage,
  // The default 5 s timeout rehydrates as signed out too: a slow cold start or
  // a launch suspended mid-read must wait, never reset the session.
  timeout: 0,
};

const persistedReducer = persistReducer(persistConfig, rootReducer);

export const store = configureStore({
  reducer: persistedReducer,
  middleware: getDefaultMiddleware =>
    getDefaultMiddleware({
      serializableCheck: {
        ignoredActions: [FLUSH, REHYDRATE, PAUSE, PERSIST, PURGE, REGISTER],
      },
    }),
});
// clear all state
export const clearPersistedState = async () => {
  await persistor.purge(); // Clear all persisted state
};
export const persistor = persistStore(store);
