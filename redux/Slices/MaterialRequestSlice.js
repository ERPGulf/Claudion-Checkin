const { createSlice } = require('@reduxjs/toolkit');

const initialState = {
  materialRequestId: null,
};

export const MaterialRequestSlice = createSlice({
  name: 'materialRequest',
  initialState,
  extraReducers: builder =>
    builder.addCase('REVERT_ALL', () => initialState),
  reducers: {
    setMaterialRequestId: (state, action) => {
      state.materialRequestId = action.payload;
    },

    clearMaterialRequest: (state) => {
      state.materialRequestId = null;
    },
  },
});

export const {
  setMaterialRequestId,
  clearMaterialRequest,
} = MaterialRequestSlice.actions;``

// selector
export const selectMaterialRequestId = state =>
  state.materialRequest.materialRequestId;


export default MaterialRequestSlice.reducer;
