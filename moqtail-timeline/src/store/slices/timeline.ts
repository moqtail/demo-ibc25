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

import type { Category, TimelineEvent } from '@/types';
import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

interface TimelineState {
  position: number;
  events: TimelineEvent[];
  categories: Category[];
}

const initialState: TimelineState = {
  position: 0,
  events: [],
  categories: [
    { name: 'GAME_START', enabled: true, type: 'marker', color: '#FF3B30' },
    { name: 'PLAY', enabled: true, type: 'event', color: '#4F8EF7' },
    { name: '1_POINT', enabled: true, type: 'event', color: '#228B22' },
    { name: '2_POINT', enabled: true, type: 'event', color: '#FF9500' },
    { name: '3_POINT', enabled: true, type: 'event', color: '#FF3B30' },
    { name: '1_QUARTER_END', enabled: true, type: 'marker', color: '#FF3B30' },
    { name: '2_QUARTER_START', enabled: true, type: 'marker', color: '#FF3B30' },
    { name: '2_QUARTER_END', enabled: true, type: 'marker', color: '#FF3B30' },
    { name: '3_QUARTER_START', enabled: true, type: 'marker', color: '#FF3B30' },
    { name: '3_QUARTER_END', enabled: true, type: 'marker', color: '#FF3B30' },
    { name: '4_QUARTER_START', enabled: true, type: 'marker', color: '#FF3B30' },
    { name: '4_QUARTER_END', enabled: true, type: 'marker', color: '#FF3B30' },
  ],
};

export const timelineSlice = createSlice({
  name: 'timeline',
  initialState,
  reducers: {
    updatePosition: (state, action: PayloadAction<number>) => {
      state.position = action.payload;
    },
    addEvent: (state, action: PayloadAction<Omit<TimelineEvent, 'id'>>) => {
      state.events.push({ ...action.payload, id: crypto.randomUUID() });
    },
    removeEvent: (state, action: PayloadAction<string>) => {
      state.events = state.events.filter(event => event.id !== action.payload);
    },
    clearEvents: state => {
      state.events = [];
    },
    toggleCategory: (state, action: PayloadAction<string>) => {
      const category = state.categories.find(cat => cat.name === action.payload);
      if (category) category.enabled = !category.enabled;
    },
    toggleAllCategories: (state, action: PayloadAction<boolean>) => {
      state.categories.forEach(cat => {
        cat.enabled = action.payload;
      });
    },
  },
  selectors: {
    getEvents: state =>
      state.events.filter(event => {
        const category = state.categories.find(({ name }) => name === event.category);
        if (category?.type === 'marker') return false;
        return category ? category.enabled : true;
      }),
    getMarkers: state =>
      state.events.filter(event => {
        const category = state.categories.find(({ name }) => name === event.category);
        if (category?.type !== 'marker') return false;
        return category ? category.enabled : true;
      }),
    getCategories: state => state.categories,
    getPosition: state => state.position,
    hasStarted: state => state.position > 0,
  },
});

export const { actions, selectors } = timelineSlice;
export default timelineSlice.reducer;
