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

export const MAX_VIDEO_TILES = 12;
export const MAX_TIMELINE_SECONDS = 600; // 10 minutes
export const MAX_FETCH_BATCH_SIZE = 5; // Maximum of 5 objects per fetch request

// MSE Buffer Configuration
export const DEFAULT_LIVE_EDGE_DELAY = 1.5; // seconds
export const DEFAULT_LIVE_EDGE_TOLERANCE = 0.25; // seconds
export const DEFAULT_BUFFER_CHECK_INTERVAL = 250; // milliseconds
export const DEFAULT_STALL_THRESHOLD = 0.5; // seconds
export const DEFAULT_CATCHUP_PLAYBACK_RATE = 1.1; // 10% faster
