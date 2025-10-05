/**
 * Copyright 2025 The MOQtail Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

interface GeneralState {
  closeFetchOnEnd: boolean;
  connectionError: boolean;
}

const initialState: GeneralState = {
  closeFetchOnEnd: false,
  connectionError: false,
};

export const generalSlice = createSlice({
  name: 'general',
  initialState,
  reducers: {
    setFetchClose: (state, action: PayloadAction<boolean>) => {
      state.closeFetchOnEnd = action.payload;
    },
    setConnectionError(state, action: PayloadAction<boolean>) {
      state.connectionError = action.payload;
    },
  },
  selectors: {
    getCloseFetchOnEnd: state => state.closeFetchOnEnd,
    hasConnectionError: state => !!state.connectionError,
  },
});

export const { actions, selectors } = generalSlice;
export default generalSlice.reducer;
