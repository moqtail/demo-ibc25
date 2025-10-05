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

import { BroadcastStream } from './stream';
import * as Comlink from 'comlink';
import { Mutex } from 'async-mutex';
import {
  DRAFT_11,
  FetchError,
  FetchType,
  FilterType,
  FullTrackName,
  GroupOrder,
  Location,
  MoqtailClient,
  MoqtObject,
  SubscribeError,
  Tuple,
} from 'moqtail-ts';
import { CARPCatalog, type CARP } from './carp';
import { createFile, MP4BoxBuffer, type AllRegisteredBoxes } from 'mp4box';
import { TimelineZod, type MediaLocation, type TimelinePayload } from '@/types';
import { ntptoms } from './utils';
import { MAX_TIMELINE_SECONDS } from '@/constants';

declare const self: DedicatedWorkerGlobalScope;

interface MOQStreamStruct {
  trackName: string;
  requestId: bigint;
  requestMode: 'subscribe' | 'fetch';
  source: ReadableStream<MoqtObject>;
  latestObject?: MoqtObject;
  fanout?: BroadcastStream<MoqtObject>;
  promises?: Promise<void>[];
  buffers?: Partial<{
    [type in CARP['tracks'][number]['role']]: {
      sourceBuffer: SourceBuffer;
      ac: AbortController;
      handleId: ReturnType<typeof crypto.randomUUID>;
    };
  }>;
}

interface BaseOptions {
  trackName: string;
  priority?: number;
}

interface SubscribeOptions extends BaseOptions {
  mode: 'subscribe';
}

interface FetchOptions extends BaseOptions {
  mode: 'fetch';
  location: MediaLocation;
}

type AddTrackMOQParameters = SubscribeOptions | FetchOptions;

type BufferNotificationFn = ((bufferedStart: number, bufferedEnd: number) => Promise<boolean>) &
  Comlink.ProxyMarked;

type PRFTNotificationFn = ((mediaTime: number, ntpMs: number) => Promise<void>) &
  Comlink.ProxyMarked;

type MOQCloseNotificationFn = ((reason?: unknown) => Promise<void>) & Comlink.ProxyMarked;

type TimelineEventFn = ((event: TimelinePayload) => Promise<void>) & Comlink.ProxyMarked;

class MOQProcessor {
  private client: MoqtailClient | null = null;
  private lock = new Mutex();
  private catalog: CARPCatalog | null = null;
  private streams: MOQStreamStruct[] = [];
  private mediaSources: Map<string, MediaSource> = new Map();

  // Private options
  #closeNotification?: MOQCloseNotificationFn;

  constructor(private url: string) {}

  async init(closeNotification?: MOQCloseNotificationFn) {
    return this.lock.runExclusive(async () => {
      // If we already have a catalog, return it
      if (this.catalog) {
        const struct = this.streams.find(s => s.trackName === 'catalog');
        if (!struct) throw new Error('Catalog stream not found');
        if (!struct.latestObject) throw new Error('Failed to retrieve latest catalog object');
        return { requestId: struct.requestId, object: struct.latestObject };
      }

      // Initialize the MOQtail client
      try {
        this.#closeNotification = closeNotification;
        this.client = await MoqtailClient.new({
          url: this.url,
          supportedVersions: [DRAFT_11],
          callbacks: {
            onSessionTerminated: reason => this.#closeNotification?.(reason),
          },
        });

        // Handle connection close
        this.client.webTransport.closed.then(this.#closeNotification);
      } catch (error) {
        if (closeNotification) closeNotification();
        throw error;
      }

      // Subscribe to the catalog
      let struct: MOQStreamStruct;
      try {
        struct = await this.addTrackRaw({ mode: 'subscribe', trackName: 'catalog' }, false);
      } catch (error) {
        this.#closeNotification?.();
        throw error;
      }

      // Pull the latest catalog object
      const reader = struct.source.getReader();
      const result = await reader.read();
      reader.releaseLock();
      if (result.done) throw new Error('Catalog stream closed unexpectedly');
      struct.latestObject = result.value;
      if (!struct.latestObject) throw new Error('Failed to retrieve latest catalog object');

      // Parse and store the catalog
      this.catalog = CARPCatalog.from(struct.latestObject);

      // Return the latest catalog
      return { requestId: struct.requestId, object: struct.latestObject };
    });
  }

  async close() {
    // Encapsulate cleanup
    const cleanup = async () => {
      // Close all streams
      await Promise.all(this.streams.map(({ requestId }) => this.removeTrack(requestId)));

      // Close the client
      await this.client?.disconnect();
    };

    // Ensure cleanup doesn't take longer than 5 seconds
    const timeout = new Promise<void>(resolve => setTimeout(resolve, 5000));

    // Start the race
    await Promise.race([cleanup(), timeout]).finally(() => {
      console.warn('MOQProcessor cleanup finished');
      self.close();
    });
  }

  async createMediaSource() {
    const mediaSource = new MediaSource();
    if (!('handle' in mediaSource)) {
      throw new Error(
        'MediaSource cannot be transferred, please request a ReadableStream via `addTrackRaw` instead.',
      );
    }

    // Get the handle and store the MediaSource
    const handle = mediaSource.handle as MediaSourceHandle;
    const id = crypto.randomUUID();
    this.mediaSources.set(id, mediaSource);

    // Transfer the handle
    return Comlink.transfer({ id, handle }, [handle]);
  }

  async addTrackRaw(params: AddTrackMOQParameters, transfer = true): Promise<MOQStreamStruct> {
    if (!this.client) throw new Error('MOQProcessor not initialized');

    // Send the appropriate control message
    let struct: MOQStreamStruct;
    if (params.mode === 'subscribe') {
      const result = await this.client.subscribe({
        fullTrackName: this.#getFullTrackName(params.trackName),
        groupOrder: GroupOrder.Original,
        filterType: FilterType.LatestObject,
        forward: true,
        priority: params.priority ?? 0,
        trackAlias: this.#fnv1aHashU32(params.trackName),
      });
      if (result instanceof SubscribeError)
        throw new Error(`Error occured during subscription: ${result.errorReason.phrase}`);
      struct = {
        trackName: params.trackName,
        requestId: result.requestId,
        requestMode: params.mode,
        source: result.stream,
      };
    } else {
      const { start, end } = params.location;
      const result = await this.client.fetch({
        groupOrder: GroupOrder.Original,
        priority: params.priority ?? 0,
        typeAndProps: {
          type: FetchType.StandAlone,
          props: {
            startLocation: new Location(start.group, start.object),
            endLocation: new Location(end.group, end.object),
            fullTrackName: this.#getFullTrackName((params as FetchOptions).trackName),
          },
        },
      });
      if (result instanceof FetchError)
        throw new Error(`Error occured during fetch: ${result.reasonPhrase}`);
      struct = {
        trackName: params.trackName,
        requestId: result.requestId,
        requestMode: params.mode,
        source: result.stream,
      };
    }

    // Add the stream to the pool
    this.streams.push(struct);

    // Transfer the stream if needed
    if (transfer) return Comlink.transfer(struct, [struct.source]);
    else return struct;
  }

  async addMediaTrack(
    params: AddTrackMOQParameters,
    handleId: ReturnType<typeof crypto.randomUUID>,
  ) {
    // We require a catalog entry to be present
    if (!this.catalog?.getByTrackName(params.trackName))
      throw new Error(`Track not found in catalog: ${params.trackName}`);

    // Verify packaging is 'chunk-per-object'
    if (this.catalog.getPackaging(params.trackName) !== 'chunk-per-object')
      throw new Error(
        `Unsupported packaging type for track ${params.trackName}, only 'chunk-per-object' is supported`,
      );

    // Get the stream struct
    const struct = await this.addTrackRaw(params, false);

    // Create new Source Buffer
    await this.#newSourceBufferMSE(struct, params.trackName, handleId);

    // Return the request ID
    return struct.requestId;
  }

  async startMedia(
    requestId: bigint,
    bufferNotification?: BufferNotificationFn,
    prftNotification?: PRFTNotificationFn,
  ) {
    // Find the stream
    const struct = this.streams.find(s => s.requestId === requestId);
    if (!struct) throw new Error('Stream not found');

    // Check if buffers exist
    if (!struct.buffers) throw new Error('No buffers found');

    // Convenience function to wait for buffer updates
    const waitForBufferUpdate = (sourceBuffer: SourceBuffer) =>
      new Promise<void>(resolve =>
        sourceBuffer.addEventListener('updateend', () => resolve(), { once: true }),
      );

    // Iterate over all added roles
    for (const [role, { ac, sourceBuffer, handleId }] of Object.entries(struct.buffers)) {
      // Get the related MediaSource
      const mediaSource = this.mediaSources.get(handleId);
      if (!mediaSource) throw new Error('MediaSource not found');

      // Get the init segment
      const initSegment = this.catalog?.getInitData(struct.trackName);
      if (!initSegment) throw new Error('Init segment not found');

      // Modify the init segment so that only this role is present
      const modifiedInitSegment = this.#modifyInitSegment(
        initSegment,
        role as CARP['tracks'][number]['role'],
      );

      // Append the init segment to the source buffer
      sourceBuffer.appendBuffer(modifiedInitSegment);

      // MSE State
      let bufferedRegionSent = false;
      let lastPRFTNotification = performance.now();
      let stats = {
        firstGroup: -1n,
        lastGroup: -1n,
        totalObjects: 0,
        totalBytes: 0,
      };
      let lastObjectId = -1n;
      let lastGroupId = -1n;
      let objectsInGroup = 0;

      // Create the WritableStream to handle incoming objects
      const writable = new WritableStream<MoqtObject>({
        write: async (object, controller) => {
          // Make TypeScript happy
          if (!(object.payload?.buffer instanceof ArrayBuffer)) {
            console.warn('Received non-ArrayBuffer payload, ignoring', object);
            return;
          }

          // Cancel if aborted
          if (ac.signal.aborted) {
            controller.error(new DOMException('Stream aborted', 'InternalError'));
            return;
          }

          // Update stats
          if (stats.firstGroup === -1n) stats.firstGroup = object.groupId;
          stats.lastGroup = object.groupId;
          stats.totalObjects++;
          stats.totalBytes += object.payload.byteLength;

          // Display debug information on non-live streams
          if (struct.requestMode === 'fetch') {
            if (lastGroupId !== -1n && object.objectId === 1n) {
              console.assert(
                lastGroupId + 1n === object.groupId,
                `Expected group ID ${lastGroupId + 1n}, got ${object.groupId}`,
              );
            }
            if (lastObjectId !== -1n && object.objectId !== 1n) {
              console.assert(
                lastObjectId + 1n === object.objectId,
                `Expected object ID ${lastObjectId + 1n}, got ${object.objectId}`,
              );
            }
            if (lastGroupId !== object.groupId) objectsInGroup = 1;
            else objectsInGroup++;

            lastObjectId = object.objectId;
            lastGroupId = object.groupId;

            const trackAlias = this.#fnv1aHashU32(struct.trackName);
            console.debug(
              `[${trackAlias}][${role}] Appending object ${object.objectId}/${objectsInGroup} from group ${object.groupId} (${object.payload.byteLength} bytes)`,
            );
          }

          // Parse the MP4 data
          const mp4 = createFile();
          mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(object.payload.buffer, 0));

          // Check if we have a complete moof and mdat box
          const moof = mp4.getBox('moof');
          const mdat = mp4.getBox('mdat');
          if (!moof || !mdat || mp4.hasIncompleteMdat()) {
            console.warn('Received incomplete MP4 segment, ignoring', object);
            return;
          }

          // Append the data
          let maxRetries = 5;
          while (maxRetries--) {
            try {
              // Append the data
              sourceBuffer.appendBuffer(object.payload.buffer);

              // Wait for the source buffer to be consumed
              await waitForBufferUpdate(sourceBuffer);
              break;
            } catch (error) {
              // Wait for the source buffer to be ready
              if (sourceBuffer.updating) await waitForBufferUpdate(sourceBuffer);
              else
                console.warn(
                  `Error appending to SourceBuffer, retrying... (${maxRetries} attempts left)`,
                  error,
                );
            }
          }

          // Check the buffered amount
          if (sourceBuffer.buffered.length > 0) {
            // Only keep the timeline window of buffer
            if (struct.requestMode === 'subscribe') {
              const maxBuffer = MAX_TIMELINE_SECONDS + MAX_TIMELINE_SECONDS / 5; // To account for long events
              const bufferedEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
              const bufferedStart = sourceBuffer.buffered.start(0);
              const removeEnd = bufferedEnd - maxBuffer;
              const bufferDurationToRemove = removeEnd - bufferedStart;
              if (
                bufferedEnd - bufferedStart > maxBuffer &&
                bufferDurationToRemove > maxBuffer / 5
              ) {
                // Remove old buffer
                maxRetries = 5;
                while (maxRetries--) {
                  try {
                    console.log(
                      `[${role}] Removing buffer from ${bufferedStart.toFixed(
                        2,
                      )} to ${removeEnd.toFixed(2)} (buffered: ${bufferedStart.toFixed(
                        2,
                      )} - ${bufferedEnd.toFixed(2)})`,
                    );
                    sourceBuffer.remove(bufferedStart, removeEnd);
                    await waitForBufferUpdate(sourceBuffer);
                    break;
                  } catch (error) {
                    // Wait for the source buffer to be ready
                    if (sourceBuffer.updating) await waitForBufferUpdate(sourceBuffer);
                    else
                      console.warn(
                        `Error removing from SourceBuffer, retrying... (${maxRetries} attempts left)`,
                        error,
                      );
                  }
                }
              }
            }

            if (!bufferedRegionSent && bufferNotification) {
              const minStart = sourceBuffer.buffered.start(0);
              const maxEnd = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
              const bufferDuration = maxEnd - minStart;
              if (bufferDuration > 1.0)
                bufferedRegionSent = await bufferNotification(minStart, maxEnd);
            }
          }

          // Parse 'prft' box to get the NTP timestamp
          if (prftNotification && lastPRFTNotification + 500 < performance.now()) {
            const prft = mp4.getBox('prft');
            const mediaTime = prft.media_time / 90000; // FIXME: Hardcoded timescale
            const time = ntptoms(prft.ntp_timestamp);

            // Send PRFT notification (don't await)
            prftNotification(mediaTime, time);
            lastPRFTNotification = performance.now();
          }
        },
      });

      // Create a fanout in case of multiple consumers
      struct.fanout = new BroadcastStream();

      // Pipe through fanout in case of multiple consumers
      const promise = struct.source.pipeThrough(struct.fanout).pipeTo(writable);
      struct.promises = struct.promises ? struct.promises.concat(promise) : [promise];

      // Cleanup stream, re
      promise
        .then(() => {
          if (struct.requestMode === 'fetch') {
            console.log(`[${role}] Stream fetched successfully`);
            console.table(stats);
          }
        })
        .catch(error => {
          if (!(error instanceof DOMException && error.name === 'InternalError')) throw error;
        })
        .finally(async () => {
          if (mediaSource.readyState === 'open') {
            let maxRetries = 5;
            while (maxRetries--) {
              try {
                // TODO: This might be problematic when we switch tracks, but right now it's acceptable that EOS on single track ends the entire stream
                mediaSource.endOfStream();
              } catch (error) {
                if (error instanceof DOMException && error.name === 'InvalidStateError') {
                  // Wait for the source buffers to be ready
                  await Promise.all(
                    Object.values(struct.buffers ?? {}).map(async ({ sourceBuffer }) => {
                      await waitForBufferUpdate(sourceBuffer);
                    }),
                  );
                }
              }
            }
            if (maxRetries <= 0)
              console.warn("Couldn't end MediaSource stream after multiple attempts");
          }
        });
    }
  }

  async addTimelineTrack(params: AddTrackMOQParameters, cb: TimelineEventFn) {
    // We require a catalog entry to be present
    if (!this.catalog?.getByTrackName(params.trackName))
      throw new Error(`Track not found in catalog: ${params.trackName}`);

    // Verify packaging is 'timeline'
    if (this.catalog.getPackaging(params.trackName) !== 'timeline')
      throw new Error(
        `Unsupported packaging type for track ${params.trackName}, only 'timeline' is supported`,
      );

    // Get the stream struct
    const struct = await this.addTrackRaw(params, false);

    // Handle with a callback
    return this.#handleTimeline(struct, cb);
  }

  async removeTrack(requestId: bigint) {
    // Find the stream
    const index = this.streams.findIndex(s => s.requestId === requestId);
    if (index === -1) throw new Error('Request ID not found');

    // Get the stream struct
    const { requestMode, buffers, source, promises } = this.streams[index];

    // Remove the source buffers
    for (const [type, { ac, sourceBuffer, handleId }] of Object.entries(buffers ?? {})) {
      if (sourceBuffer.updating) {
        await new Promise<void>(resolve =>
          sourceBuffer.addEventListener('updateend', () => resolve(), { once: true }),
        );
      }
      const mediaSource = this.mediaSources.get(handleId);
      if (mediaSource && mediaSource.readyState !== 'closed') {
        try {
          ac.abort();
          mediaSource.removeSourceBuffer(sourceBuffer);
          delete buffers?.[type as CARP['tracks'][number]['role']];
        } catch (error) {
          console.error('Error removing SourceBuffer:', error);
        }

        // If this was the last source buffer, end the stream
        if (mediaSource?.activeSourceBuffers.length === 0 && mediaSource.readyState === 'open') {
          mediaSource.endOfStream();
          this.mediaSources.delete(handleId);
        }
      }
    }

    // If there are no more buffers, cancel the source
    if (Object.keys(buffers ?? {}).length === 0) {
      try {
        if (requestMode === 'subscribe') await this.client?.unsubscribe(requestId);
        await Promise.allSettled(promises ?? []);
        await source.cancel();
      } catch (error) {
        console.error('Error cancelling stream:', error);
      } finally {
        console.log('Stream cancelled successfully');
      }
    }

    // Remove from the pool
    this.streams.splice(index, 1);
  }

  //
  // Private methods
  //

  async #newSourceBufferMSE(
    struct: MOQStreamStruct,
    trackName: string,
    handleId: ReturnType<typeof crypto.randomUUID>,
  ) {
    // Get the MediaSource
    const mediaSource = this.mediaSources.get(handleId);
    if (!mediaSource) throw new Error('MediaSourceHandle not recognized');

    // Wait for media source to be open
    if (mediaSource.readyState === 'closed') {
      await new Promise(resolve => {
        const onSourceOpen = () => {
          mediaSource.removeEventListener('sourceopen', onSourceOpen);
          resolve(true);
        };
        mediaSource.addEventListener('sourceopen', onSourceOpen);
      });
    }

    // Get the MIME type
    const codecString = this.catalog?.getCodecString(trackName);
    const role = this.catalog?.getRole(trackName);
    if (!codecString || !role) {
      await this.removeTrack(struct.requestId);
      throw new Error(`Failed to get codec or role for track: ${trackName}`);
    }

    // Check if the MIME type is supported
    const mimeType = `${role}/mp4; codecs="${codecString}"`;
    if (!MediaSource.isTypeSupported(mimeType)) {
      await this.removeTrack(struct.requestId);
      throw new Error(`MIME type not supported: ${mimeType}`);
    }

    // Create a new SourceBuffer
    const sourceBuffer = mediaSource.addSourceBuffer(mimeType);

    // Register the SourceBuffer
    if (!struct.buffers) struct.buffers = {};
    struct.buffers[role] = {
      ac: new AbortController(),
      sourceBuffer,
      handleId,
    };
  }

  async #handleTimeline(struct: MOQStreamStruct, cb: TimelineEventFn) {
    // Keep track of the latest version
    let version = -1;

    // Create a timeline payload transformer
    const decoder = new TextDecoder();
    const timelineTransformer = new TransformStream<MoqtObject, TimelinePayload>({
      transform: async (object, controller) => {
        const decoded = decoder.decode(object.payload?.buffer);
        const json = JSON.parse(decoded);
        const parsed = TimelineZod.parse(json);

        // Get the new records
        const records = parsed.records.filter(record => version === -1 || record.version > version);
        if (records.length > 0) version = Math.max(version, ...records.map(r => r.version));
        parsed.records = records;

        // Send to the controller
        controller.enqueue(parsed);
      },
    });

    // Create the WritableStream to direct parsed objects to the callback
    const writable = new WritableStream<TimelinePayload>({
      // We don't need to worry about cancellation here
      write: async object => await cb(object),
    });

    // Create a fanout in case of multiple consumers
    struct.fanout = new BroadcastStream();

    // Pipe through fanout in case of multiple consumers
    struct.source
      .pipeThrough(struct.fanout) // Fanout for multiple consumers
      .pipeThrough(timelineTransformer) // Transform MoQ objects to TimelinePayload
      .pipeTo(writable); // Send to callback

    // Return the request ID
    return struct.requestId;
  }

  #getFullTrackName(name: string) {
    return FullTrackName.tryNew(Tuple.fromUtf8Path('/moqtail'), new TextEncoder().encode(name));
  }

  #modifyInitSegment(initSegment: Uint8Array, role: CARP['tracks'][number]['role']): ArrayBuffer {
    const mp4 = createFile();
    mp4.appendBuffer(MP4BoxBuffer.fromArrayBuffer(initSegment.buffer, 0));
    mp4.flush();

    // Decide on the handler type
    const wantHandler = role == 'audio' ? 'soun' : 'vide';

    // Filter 'moov' box
    const moov = mp4.getBox('moov');
    if (!moov.boxes) throw new Error('Invalid init segment, no boxes found under moov');
    moov.boxes = moov.boxes.filter(box => {
      if (box.type === 'trak') {
        const trak = box as AllRegisteredBoxes['trak'];
        return trak.mdia.hdlr.handler === wantHandler;
      }
      return true;
    });

    // Write the modified boxes
    const { buffer } = mp4.getBuffer();
    return buffer;
  }

  #fnv1aHashU32(str: string): number {
    let hash = 2166136261;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
      hash >>>= 0; // Ensure unsigned 32-bit
    }
    return hash;
  }

  // @ts-ignore Hide Comlink.finalizer
  private async [Comlink.finalizer]() {
    await this.close();
  }
}

export type MOQProcessorClass = typeof MOQProcessor;
Comlink.expose(MOQProcessor);
