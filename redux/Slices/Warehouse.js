const { createSlice } = require('@reduxjs/toolkit');

const initialState = {
  selectedWarehouse: null,
};

export const WarehouseSlice = createSlice({
  name: 'warehouse',
  initialState,
  extraReducers: builder =>
    builder.addCase('REVERT_ALL', () => initialState),
  reducers: {
    setWarehouse: (state, action) => {
      state.selectedWarehouse = action.payload;
    },
  },
});

export const { setWarehouse } = WarehouseSlice.actions;

// selectors
export const selectedWarehouse = state =>
  state.warehouse.selectedWarehouse;

export default WarehouseSlice.reducer;
