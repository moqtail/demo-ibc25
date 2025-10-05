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

import { z } from 'zod';

const TimelineMetadataZod = z
  .looseObject({
    id: z.number(),
    type: z.string(),
    thumbnail: z.string(),
    offset: z.number(),
    duration: z.number(),
    start_pts: z.number(),
  })
  .optional();

export const TimelineZod = z.looseObject({
  version: z.number(),
  records: z.array(
    z.object({
      media_pts: z.number(),
      start: z.object({ group: z.number(), object: z.number() }).optional(),
      end: z.object({ group: z.number(), object: z.number() }).optional(),
      wallclock: z.number(),
      metadata: z
        .string()
        .optional()
        .transform(val => {
          if (!val) return undefined;
          try {
            const parsed = JSON.parse(val);
            return TimelineMetadataZod.parse(parsed);
          } catch {
            return undefined;
          }
        }),
      version: z.number(),
    }),
  ),
});

export type TimelinePayload = z.infer<typeof TimelineZod>;

export interface MediaLocation {
  start: { group: number; object: number };
  end: { group: number; object: number };
}

export interface Category {
  name: string;
  enabled: boolean;
  type: 'marker' | 'event';
  color: `#${string}`;
  icon?: string;
}

export interface TimelineEvent {
  id: string;
  category: string;
  display: {
    start: number;
    end: number;
  };
  trackNames: string[];
  media: MediaLocation;
}

export interface VideoLive {
  type: 'live';
  id: string;
  trackNames?: string[];
  location?: never;
}

export interface VideoVod {
  type: 'vod';
  id: string;
  trackNames: string[];
  location: MediaLocation;
}

export type Video = VideoLive | VideoVod;
