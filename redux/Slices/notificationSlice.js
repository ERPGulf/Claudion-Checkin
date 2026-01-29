import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  unreadCount: 0,
};

const notificationSlice = createSlice({
  name: "notification",
  initialState,
  reducers: {
    setUnreadCount(state, action) {
      state.unreadCount = action.payload;
    },

    decrementUnreadCount(state) {
      if (state.unreadCount > 0) {
        state.unreadCount -= 1;
      }
    },

    clearUnreadCount(state) {
      state.unreadCount = 0;
    },
  },
});

export const { setUnreadCount, decrementUnreadCount, clearUnreadCount } =
  notificationSlice.actions;

export default notificationSlice.reducer;
