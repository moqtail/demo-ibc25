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

import { MAX_FETCH_BATCH_SIZE } from '@/constants';
import {
  FetchError,
  FetchType,
  GroupOrder,
  Location,
  MoqtObject,
  type FullTrackName,
  type MoqtailClient,
} from 'moqtail-ts';

interface FetchSlot {
  trackName: string;
  priority: number;
  start: Location;
  end: Location;
  fullTrackName: FullTrackName;

  batchSize: number;
  lastFetched?: Location;
  internal?: {
    source: ReadableStream<MoqtObject>;
    requestId: bigint;
    state: number;
  };
}

interface AddMediaTrackOptions {
  priority?: number;
  start: Location;
  end: Location;
  fullTrackName: FullTrackName;
  requestFactor?: number;
}

class PacedFetchStream {
  private slots: FetchSlot[] = [];
  private barrier = new AsyncBarrier(2);

  constructor(private readonly client: MoqtailClient) {}

  async addMediaTrack(trackName: string, params: AddMediaTrackOptions) {
    const slot: FetchSlot = {
      trackName,
      priority: params.priority ?? 0,
      start: params.start,
      end: params.end,
      fullTrackName: params.fullTrackName,
      batchSize: params.requestFactor
        ? MAX_FETCH_BATCH_SIZE * params.requestFactor
        : MAX_FETCH_BATCH_SIZE,
    };

    // Get the next request
    const result = await this.getNext(slot);
    if (!result) throw new Error(`No data available for track ${trackName}`);

    // Store the internal state
    slot.lastFetched = result.lastFetched;
    slot.internal = {
      source: result.source,
      requestId: result.requestId,
      state: 0,
    };

    // Add the slot to the list
    this.slots.push(slot);

    // Create a new readable stream for this slot
    const reader = new ReadableStream<MoqtObject>(
      { pull: this.#pull.bind(this, slot) },
      { highWaterMark: 1 },
    );

    return {
      requestId: result.requestId,
      source: reader,
    };
  }

  private async getNext(slot: FetchSlot) {
    // Decide on the next start and end location
    let currentStart = slot.lastFetched;
    if (!currentStart) currentStart = slot.start;
    let currentEnd = new Location(currentStart.group, currentStart.object + BigInt(slot.batchSize));

    // We've reached the end of the slot
    if (currentStart.compare(slot.end) >= 0) {
      console.log(`[pacer] Reached end of slot for track ${slot.trackName}`);
      return null;
    }

    // Clamp the end location to the slot's end
    if (currentEnd.compare(slot.end) > 0) {
      console.warn(
        `[pacer] Clamping end location for track ${slot.trackName} from ${locationAsString(currentEnd)} to ${locationAsString(slot.end)}`,
      );
      currentEnd = slot.end;
    }

    // Add 1 to the object to make the end location inclusive
    currentEnd = new Location(currentEnd.group, currentEnd.object + 1n);

    // Make the request
    console.debug(
      `[pacer] Fetching objects for track ${slot.trackName} from ${locationAsString(currentStart)} to ${locationAsString(currentEnd)}...`,
    );
    const result = await this.client.fetch({
      groupOrder: GroupOrder.Original,
      priority: slot.priority,
      typeAndProps: {
        type: FetchType.StandAlone,
        props: {
          startLocation: currentStart,
          endLocation: currentEnd,
          fullTrackName: slot.fullTrackName,
        },
      },
    });

    // Check if the request was successful
    if (result instanceof FetchError)
      throw new Error(
        `Fetch request for ${slot.trackName} between ${locationAsString(currentStart)} and ${locationAsString(currentEnd)} failed`,
      );

    // Update the slot's last fetched location
    let lastFetched = result.ok.endLocation;
    console.debug(
      `[pacer] Fetched up to ${locationAsString(lastFetched)} for track ${slot.trackName}`,
    );

    // We've reached the end of the group
    if (lastFetched.object !== currentEnd.object)
      lastFetched = new Location(lastFetched.group + 1n, 0n);

    return {
      trackName: slot.trackName,
      requestId: result.requestId,
      source: result.stream,
      lastFetched,
    };
  }

  async #pull(slot: FetchSlot, controller: ReadableStreamDefaultController<MoqtObject>) {
    if (!slot.internal) {
      console.error('Internal state missing for slot:', slot);
      controller.close();
      return;
    }

    // Consume from the internal source
    const reader = slot.internal.source.getReader();
    const { value, done } = await reader.read();

    // If done, try to fetch the next batch
    if (done) {
      console.debug(
        `[pacer] Finished current batch for track ${slot.trackName}, waiting at barrier...`,
      );
      await this.barrier.wait(slot.trackName, slot.internal.state);

      console.debug(`[pacer] Passed barrier for track ${slot.trackName}, fetching next batch...`);
      const next = await this.getNext(slot);
      if (next) {
        // Update the slot's internal state
        slot.lastFetched = next.lastFetched;
        slot.internal = {
          source: next.source,
          requestId: next.requestId,
          state: slot.internal.state + 1,
        };

        // Close the current reader
        reader.releaseLock();

        // Pull again to get the next value
        await this.#pull(slot, controller);
      } else {
        // No more data, close the stream
        controller.close();
        this.barrier.eos();
        console.log(`[pacer] No more data for track ${slot.trackName}, stream closed.`);
      }
      return;
    }

    // Enqueue the fetched value
    controller.enqueue(value);

    // Release the reader
    reader.releaseLock();
  }
}

class AsyncBarrier {
  private currentState: number = 0;
  private arrived: Set<string> = new Set();
  private waiters: (() => void)[] = [];

  constructor(private expectedCount: number) {}

  eos() {
    this.expectedCount--;

    // If all have arrived, release all waiters
    if (this.arrived.size === this.expectedCount) {
      this.advanceState();
    }
  }

  async wait(id: string, state: number): Promise<void> {
    // If first arrival to a NEW state, reset the barrier
    if (state !== this.currentState) {
      throw new Error(`Invalid state transition: expected ${this.currentState}`);
    }

    // Mark arrival
    this.arrived.add(id);

    // If all have arrived, release all waiters
    if (this.arrived.size === this.expectedCount) {
      this.advanceState();
      return;
    }

    // Otherwise, wait
    return new Promise<void>(resolve => {
      this.waiters.push(resolve);
    });
  }

  private advanceState() {
    this.currentState++;
    this.arrived.clear();
    const waiters = this.waiters;
    this.waiters = [];
    waiters.forEach(fn => fn());
  }
}

function locationAsString(loc: Location) {
  return `[${loc.group.toString()}, ${loc.object.toString()}]`;
}

export default PacedFetchStream;
