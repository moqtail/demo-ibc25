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

import type { MoqtObject } from 'moqtail-ts';
import { z } from 'zod';

const CARPZod = z.looseObject({
  version: z.number(),
  tracks: z.array(
    z
      .looseObject({
        name: z.string(),
        packaging: z.enum(['chunk-per-object', 'timeline']),
        codec: z.string().optional(),
        role: z.enum(['video', 'audio', 'timeline']),
        depends: z.array(z.string()).optional(),
        mimeType: z.string().optional(),
        initData: z
          .string()
          .refine(
            val => {
              // Check if it's valid base64
              try {
                return btoa(atob(val)) === val;
              } catch {
                return false;
              }
            },
            { message: 'initData must be a valid base64 string' },
          )
          .optional(),
      })
      .superRefine((track, ctx) => {
        // If packaging is 'chunk-per-object', codec must be present
        if (track.packaging === 'chunk-per-object' && (!track.codec || track.codec.length === 0)) {
          ctx.addIssue({
            code: 'custom',
            message: "codec is required when packaging is 'chunk-per-object'",
            path: ['codec'],
          });
        }

        // If packaging is 'timeline', mimeType must be 'text/csv'
        if (track.packaging === 'timeline' && track.mimeType !== 'text/csv') {
          ctx.addIssue({
            code: 'custom',
            message: "mimeType must be 'text/csv' when packaging is 'timeline'",
            path: ['mimeType'],
          });
        }

        // If packaging is 'timeline', then at least one dependee must be present
        if (track.packaging === 'timeline' && (!track.depends || track.depends.length === 0)) {
          ctx.addIssue({
            code: 'custom',
            message: "At least one dependee must be present when packaging is 'timeline'",
            path: ['depends'],
          });
        }
      }),
  ),
});

export type CARP = z.infer<typeof CARPZod>;

class CARPCatalog {
  #catalog: CARP;

  private constructor(catalog: CARP) {
    this.#catalog = catalog;
  }

  static from(object: MoqtObject) {
    const decoder = new TextDecoder();
    const json = decoder.decode(object.payload?.buffer);
    const catalog = CARPZod.parse(JSON.parse(json));
    return new CARPCatalog(catalog);
  }

  getByTrackName(trackName: string) {
    return this.#catalog.tracks.find(track => track.name === trackName);
  }

  getVideo(index = 0) {
    const videos = this.#catalog.tracks.filter(track => track.role === 'video');
    if (index < 0 || index >= videos.length) return undefined;
    return videos[index];
  }

  getAudio(index = 0) {
    const audios = this.#catalog.tracks.filter(track => track.role === 'audio');
    if (index < 0 || index >= audios.length) return undefined;
    return audios[index];
  }

  getTimeline(index = 0) {
    const timelines = this.#catalog.tracks.filter(track => track.role === 'timeline');
    if (index < 0 || index >= timelines.length) return undefined;
    return timelines[index];
  }

  getCodecString(trackName: string) {
    const track = this.#catalog.tracks.find(track => track.name === trackName);
    if (!track) return undefined;
    if (!track.codec) throw new Error(`Track ${trackName} does not have a codec`);
    return track.codec;
  }

  getRole(trackName: string) {
    const track = this.#catalog.tracks.find(track => track.name === trackName);
    if (!track) return undefined;
    return track.role;
  }

  getPackaging(trackName: string) {
    const track = this.#catalog.tracks.find(track => track.name === trackName);
    if (!track) return undefined;
    return track.packaging;
  }

  getInitData(trackName: string) {
    const track = this.#catalog.tracks.find(track => track.name === trackName);
    if (!track) return undefined;
    if (!track.initData) throw new Error(`Track ${trackName} does not have initData`);
    return new Uint8Array(
      atob(track.initData)
        .split('')
        .map(c => c.charCodeAt(0)),
    );
  }
}

export { CARPCatalog };
