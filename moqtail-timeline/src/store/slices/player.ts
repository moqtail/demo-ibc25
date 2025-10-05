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

import type { MSEBufferConfig } from '@/components/VideoPlayer/mseBuffer';
import { MAX_VIDEO_TILES } from '@/constants';
import type { Video, VideoLive, VideoVod } from '@/types';
import type { PayloadAction } from '@reduxjs/toolkit';
import { createSlice } from '@reduxjs/toolkit';

interface PlayerState {
  ready: boolean;
  connection: {
    url: string;
  };
  mseBufferConfig: Partial<MSEBufferConfig>;
  hoveredId: string | null;
  videos: Video[];
  promoted?: {
    index: number;
    id: string;
  };
}

const LIVE_VIDEO_ID = crypto.randomUUID();

const initialState: PlayerState = {
  ready: false,
  connection: {
    url: '',
  },
  mseBufferConfig: {},
  hoveredId: null,
  videos: [],
};

export const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    addVideo: (state, action: PayloadAction<Omit<Video, 'id'>>) => {
      if (state.videos.length == MAX_VIDEO_TILES) return;
      const id = crypto.randomUUID();
      if (action.payload.type === 'live') {
        state.videos.push({
          ...(action.payload as Omit<VideoLive, 'id'>),
          id,
          type: 'live',
        });
      } else if (action.payload.type === 'vod') {
        state.videos.push({
          ...(action.payload as Omit<VideoVod, 'id'>),
          id,
          type: 'vod',
        });
      }
      state.promoted = { index: state.videos.length - 1, id };
    },
    setMSEBufferConfig: (state, action: PayloadAction<Partial<MSEBufferConfig>>) => {
      state.mseBufferConfig = { ...state.mseBufferConfig, ...action.payload };
    },
    removeVideo: (state, action: PayloadAction<string>) => {
      state.videos = state.videos.filter(video => video.id !== action.payload);
      state.promoted = { index: 0, id: LIVE_VIDEO_ID };
    },
    setPromoted: (state, action: PayloadAction<{ index: number; id: string }>) => {
      state.promoted = action.payload;
    },
    setHoveredId: (state, action: PayloadAction<string | null>) => {
      state.hoveredId = action.payload;
    },
    clearVideos: state => {
      state.videos = [];
      state.promoted = undefined;
    },
    setConnectionOptions: (state, action: PayloadAction<{ url: string } | null>) => {
      if (action.payload) state.connection = action.payload;
      state.videos = [{ type: 'live', id: LIVE_VIDEO_ID }];
      state.promoted = { index: 0, id: LIVE_VIDEO_ID };
      state.ready = state.connection.url !== '';
    },
  },
  selectors: {
    getVideos: state => state.videos,
    getMSEBufferConfig: state => state.mseBufferConfig,
    getHoveredId: state => state.hoveredId,
    getRelayUrl: state => state.connection.url,
    getPromoted: state => state.promoted,
    hasLiveVideo: state => state.videos.some(v => v.type === 'live'),
    isReady: state => state.ready,
    isMSEBufferConfigSet: state => Object.keys(state.mseBufferConfig).length > 0,
  },
});

export const { actions, selectors } = playerSlice;
export default playerSlice.reducer;
