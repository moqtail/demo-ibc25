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

import {
  DEFAULT_BUFFER_CHECK_INTERVAL,
  DEFAULT_CATCHUP_PLAYBACK_RATE,
  DEFAULT_LIVE_EDGE_DELAY,
  DEFAULT_LIVE_EDGE_TOLERANCE,
  DEFAULT_STALL_THRESHOLD,
} from '@/constants';
import store from '@/store';
import { actions, selectors } from '@/store/slices/player';

interface MSEBufferConfig {
  /** Delay from live edge in seconds (default: 2.0) */
  liveEdgeDelay: number;
  /** Tolerance for live edge in seconds (default: 0.2) */
  liveEdgeTolerance: number;
  /** Interval for checking buffered regions in milliseconds (default: 1000) */
  bufferCheckInterval: number;
  /** Threshold for detecting stalls in seconds (default: 0.5) */
  stallThreshold: number;
  /** Playback rate for catching up to live edge (default: 1.15 = 15% faster) */
  catchupPlaybackRate: number;
}

interface Stats {
  /** Total stall time in milliseconds */
  totalStallMs: number;
}

class MSEBuffer {
  static #instance: MSEBuffer | null = null;
  static #storeSubscription: (() => void) | null = null;

  private config: MSEBufferConfig;
  private bufferCheckInterval: number | null = null;
  private lastStallStart: number | null = null;
  private isDisposed: boolean = false;
  private isCatchingUp: boolean = false;
  private isCatchingDown: boolean = false;
  private originalPlaybackRate: number = 1.0;

  private stats: Stats = {
    totalStallMs: 0,
  };

  // PRFT latency tracking
  private prftMap: Map<number, number> = new Map(); // mediaTime -> ntpMs

  constructor(
    public video: HTMLVideoElement,
    config: Partial<MSEBufferConfig> = {},
  ) {
    this.config = {
      liveEdgeDelay: DEFAULT_LIVE_EDGE_DELAY,
      liveEdgeTolerance: DEFAULT_LIVE_EDGE_TOLERANCE,
      bufferCheckInterval: DEFAULT_BUFFER_CHECK_INTERVAL,
      stallThreshold: DEFAULT_STALL_THRESHOLD,
      catchupPlaybackRate: DEFAULT_CATCHUP_PLAYBACK_RATE,
      ...config,
    };

    this.init();
  }

  static getInstance() {
    if (!MSEBuffer.#instance) {
      throw new Error('MSEBuffer instance not initialized. Call attachSingleton first.');
    }
    return MSEBuffer.#instance;
  }

  static attachSingleton(...args: ConstructorParameters<typeof MSEBuffer>) {
    // Dispose existing instance if any
    if (MSEBuffer.#instance) {
      MSEBuffer.#storeSubscription?.();
      MSEBuffer.#instance.dispose();
    }

    // Create a new instance
    MSEBuffer.#instance = new MSEBuffer(...args);

    // Update the store with initial config
    store.dispatch(actions.setMSEBufferConfig(MSEBuffer.#instance.config));

    // Subscribe to config changes
    MSEBuffer.#storeSubscription = store.subscribe(() => {
      const state = selectors.getMSEBufferConfig(store.getState());
      const instance = MSEBuffer.#instance!;
      if (state) {
        instance.config = { ...instance.config, ...state };

        // Restart buffer monitoring with new interval if changed
        if (state.bufferCheckInterval !== instance.config.bufferCheckInterval)
          instance.startBufferMonitoring();
      }
    });

    return MSEBuffer.#instance;
  }

  private init() {
    // Attach event listeners
    this.video.addEventListener('pause', this.handlePause);
    this.video.addEventListener('play', this.handlePlay);
    this.video.addEventListener('waiting', this.handleWaiting);
    this.video.addEventListener('stalled', this.handleStalled);
    this.video.addEventListener('canplay', this.handleCanPlay);

    // Listen tab visibility changes
    document.addEventListener('visibilitychange', this.handleTabChange);

    // Start periodic buffer checking
    this.startBufferMonitoring();
  }

  public getPRFTListener = () => {
    return async (mediaTime: number, ntpMs: number) => {
      this.prftMap.set(mediaTime, ntpMs);

      // Remove old entries to prevent memory leak
      const maxEntries = 1000;
      const currentMediaTime = this.video.currentTime;

      // Remove entries older than 10 seconds behind current playback
      for (const [mediaTime] of this.prftMap) {
        if (mediaTime < currentMediaTime - 10) {
          this.prftMap.delete(mediaTime);
        }
      }

      // Limit map size to avoid unbounded growth
      if (this.prftMap.size > maxEntries) {
        const sortedKeys = Array.from(this.prftMap.keys()).sort((a, b) => a - b);
        for (let i = 0; i < this.prftMap.size - maxEntries; i++) {
          this.prftMap.delete(sortedKeys[i]);
        }
      }
    };
  };

  private lookupLatency(mediaTime: number) {
    // Find the closest mediaTime entry in the map
    let closestTime: number | null = null;
    let closestNtpMs: number | null = null;
    for (const time of this.prftMap.keys()) {
      if (closestTime === null || Math.abs(time - mediaTime) < Math.abs(closestTime - mediaTime)) {
        closestTime = time;
        closestNtpMs = this.prftMap.get(time)!;
      }
    }

    // Calculate distance to buffer end
    const buffered = this.video.buffered;
    if (buffered.length === 0) return 0;
    const bufferEnd = buffered.end(buffered.length - 1);
    const distanceToEnd = bufferEnd - mediaTime;

    // Fallback: estimate latency based on distance to buffer end
    if (closestTime === null) {
      console.warn('[mseBuffer] Could not find PRFT entry, estimating latency based on buffer end');
      return distanceToEnd * 1000; // Convert to ms
    }

    // Calculate the actual latency
    const mediaTimeDiff = (mediaTime - closestTime) * 1000;
    const now = performance.now() + performance.timeOrigin;
    return Math.max(0, now - closestNtpMs! - mediaTimeDiff);
  }

  private handleTabChange = () => {
    if (document.hidden) {
      // Tab is hidden, pause monitoring
      if (this.bufferCheckInterval) {
        clearInterval(this.bufferCheckInterval);
        this.bufferCheckInterval = null;
      }
    } else {
      // Calculate the live edge
      const buffered = this.video.buffered;
      if (buffered.length > 0) {
        console.log('[mseBuffer] Tab became visible, seeking to live edge');
        const liveEdge = buffered.end(buffered.length - 1);
        this.video.currentTime = Math.max(
          liveEdge - this.config.liveEdgeDelay,
          buffered.start(buffered.length - 1),
        );
        this.video.playbackRate = this.originalPlaybackRate;
        this.isCatchingUp = false;
        this.video.play();
      }

      // Tab is visible, resume monitoring
      this.startBufferMonitoring();
    }
  };

  private handlePause = () => {
    console.log('[mseBuffer] Video is paused');
    this.resetPlaybackRate();
  };

  private handlePlay = () => {
    console.log('[mseBuffer] Video is playing');
    this.originalPlaybackRate = this.video.playbackRate;
  };

  private handleWaiting = () => {
    console.log('[mseBuffer] Video is waiting for data');
    this.lastStallStart = performance.now();
    this.checkBufferedRegions();
  };

  private handleStalled = () => {
    console.log('[mseBuffer] Video stalled event fired');
    this.checkBufferedRegions();
  };

  private handleCanPlay = () => {
    if (this.lastStallStart) {
      const stallDuration = performance.now() - this.lastStallStart;
      this.stats.totalStallMs += stallDuration;
      // Reset stall counter when video can play
      this.lastStallStart = null;
    }
  };

  private startBufferMonitoring() {
    if (this.bufferCheckInterval) {
      clearInterval(this.bufferCheckInterval);
    }

    this.bufferCheckInterval = window.setInterval(() => {
      if (this.isDisposed) return;
      this.periodicBufferCheck();
    }, this.config.bufferCheckInterval);
  }

  private periodicBufferCheck() {
    // Only check for live streams
    if (!this.video.duration || isFinite(this.video.duration)) {
      return; // Not a live stream
    }

    this.checkBufferedRegions(false);
  }

  private checkBufferedRegions(logDetails: boolean = true) {
    const buffered = this.video.buffered;
    const currentTime = this.video.currentTime;

    if (buffered.length === 0) {
      console.log('[mseBuffer] No buffered data available');
      return;
    }

    if (logDetails) {
      console.log('[mseBuffer] Checking buffered regions:');
      for (let i = 0; i < buffered.length; i++) {
        const start = buffered.start(i);
        const end = buffered.end(i);
        console.log(`[mseBuffer]   Range ${i}: ${start.toFixed(2)}s - ${end.toFixed(2)}s`);
      }
    }

    // Check if we're at the end of a buffer range and need to jump to the next one
    const shouldSeek = this.shouldSeekToNextRange(currentTime, buffered);

    if (shouldSeek.seek) {
      console.log(
        `[mseBuffer] At end of range, seeking to next buffered range: ${shouldSeek.targetTime!.toFixed(2)}s`,
      );

      // Perform the seek, only if targetTime is ahead of currentTime
      if (shouldSeek.targetTime <= currentTime) {
        console.warn(
          `[mseBuffer] Not seeking because target time ${shouldSeek.targetTime!.toFixed(
            2,
          )}s is not ahead of current time ${currentTime.toFixed(2)}s`,
        );
        return;
      }
      this.video.currentTime = shouldSeek.targetTime;

      // Resume the video if it was paused
      if (this.video.paused) {
        this.video
          .play()
          .then(() => {
            console.log('[mseBuffer] Video was paused and now playing...');
          })
          .catch(e => {
            console.warn('[mseBuffer] Video was paused and could not play it...', e);
          });
      }
    } else {
      // For live streams, check if we need to catch up to live edge
      if (!isFinite(this.video.duration)) this.maintainLiveEdgeDelay();
    }
  }

  private shouldSeekToNextRange(
    currentTime: number,
    buffered: TimeRanges,
  ): { seek: true; targetTime: number } | { seek: false } {
    // Find which buffered range we're currently in (if any)
    let currentRangeIndex = -1;

    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);

      if (currentTime >= start && currentTime <= end) {
        currentRangeIndex = i;
        break;
      }
    }

    // If we're not in any buffered range, find the nearest one to seek to
    if (currentRangeIndex === -1) {
      return this.findNearestBufferedRange(currentTime, buffered);
    }

    // Check if we're close to the end of the current range
    const currentRangeEnd = buffered.end(currentRangeIndex);
    const distanceToEnd = currentRangeEnd - currentTime;

    // Only consider seeking if we're very close to the end (within threshold)
    if (distanceToEnd > this.config.stallThreshold) return { seek: false };

    // Check if there's a next buffered range
    if (currentRangeIndex + 1 < buffered.length) {
      for (let nextRange = currentRangeIndex + 1; nextRange < buffered.length; nextRange++) {
        const nextRangeStart = buffered.start(currentRangeIndex + 1);
        const gap = nextRangeStart - currentRangeEnd;

        // Next range must have enough buffer to jump to
        const nextRangeEnd = buffered.end(currentRangeIndex + 1);
        const nextRangeDuration = nextRangeEnd - nextRangeStart;

        if (nextRangeDuration < this.config.stallThreshold) {
          console.warn(
            `[mseBuffer] Next range too short (${nextRangeDuration.toFixed(3)}s), not seeking`,
          );
          continue;
        }

        if (nextRangeDuration < this.config.liveEdgeDelay) {
          console.warn(
            `[mseBuffer] Next range shorter than live edge delay (${nextRangeDuration.toFixed(
              3,
            )}s < ${this.config.liveEdgeDelay}s), not seeking`,
          );
          continue;
        }

        if (gap > 0) {
          console.warn(
            `[mseBuffer] At buffer end with gap of ${gap.toFixed(3)}s, must jump to next range`,
          );
          return { seek: true, targetTime: nextRangeStart };
        }
      }
    }

    return { seek: false };
  }

  private findNearestBufferedRange(
    currentTime: number,
    buffered: TimeRanges,
  ): { seek: true; targetTime: number } | { seek: false } {
    if (buffered.length === 0) {
      return { seek: false };
    }

    // For live streams, prefer the most recent buffered range
    if (!isFinite(this.video.duration)) {
      const lastRangeIndex = buffered.length - 1;
      const targetTime = Math.max(
        buffered.start(lastRangeIndex),
        buffered.end(lastRangeIndex) - this.config.liveEdgeDelay,
      );
      return { seek: true, targetTime };
    }

    // For VOD, find the closest buffered range
    let bestTarget = buffered.start(0);
    let minDistance = Math.abs(currentTime - bestTarget);

    for (let i = 0; i < buffered.length; i++) {
      const start = buffered.start(i);
      const end = buffered.end(i);

      // Check distance to start of range
      const distanceToStart = Math.abs(currentTime - start);
      if (distanceToStart < minDistance) {
        minDistance = distanceToStart;
        bestTarget = start;
      }

      // Check distance to end of range
      const distanceToEnd = Math.abs(currentTime - end);
      if (distanceToEnd < minDistance) {
        minDistance = distanceToEnd;
        bestTarget = end;
      }
    }

    return { seek: true, targetTime: bestTarget };
  }

  private maintainLiveEdgeDelay() {
    const buffered = this.video.buffered;
    if (buffered.length === 0) return;

    // Get the end of the last buffered range (live edge)
    const bufferEdge = buffered.end(buffered.length - 1);
    const currentLatency = this.lookupLatency(this.video.currentTime) / 1000;
    const timeToStall = bufferEdge - this.video.currentTime;
    const targetDistance = this.config.liveEdgeDelay;

    // Use playback rate adjustment to catch up instead of seeking
    if (currentLatency > targetDistance + this.config.liveEdgeTolerance) {
      // We're too far behind, jump ahead
      const jumpableTime = bufferEdge - targetDistance * 1.5;
      const jumpCheckTime = bufferEdge - targetDistance * 2;
      if (this.video.currentTime < jumpCheckTime && timeToStall > this.config.stallThreshold) {
        console.warn(
          `[mseBuffer] Too far from live edge (${currentLatency.toFixed(
            2,
          )}s) and enough buffer (${timeToStall.toFixed(2)}s), jumping to ${jumpableTime.toFixed(2)}s`,
        );
        this.video.currentTime = jumpableTime;
      }

      // We're behind but close, use catchup speed
      if (!this.isCatchingUp) {
        console.log(
          `[mseBuffer] Too far from live edge (${currentLatency.toFixed(2)}s), catching up at ${this.config.catchupPlaybackRate}x speed`,
        );
        this.isCatchingUp = true;
        this.isCatchingDown = false;
        this.video.playbackRate = this.config.catchupPlaybackRate;
      }
    } else if (currentLatency < targetDistance - this.config.liveEdgeTolerance) {
      // We're too close to the live edge, slow down slightly
      if (!this.isCatchingDown) {
        const slowdownRate = 1 - (this.config.catchupPlaybackRate - 1);
        console.log(
          `[mseBuffer] Close to live edge (${currentLatency.toFixed(2)}s), slowing down to ${slowdownRate.toFixed(2)}x speed`,
        );
        this.isCatchingUp = false;
        this.isCatchingDown = true;
        this.video.playbackRate = slowdownRate;
      } else if (timeToStall < this.config.stallThreshold) {
        const newRate = Math.max(
          0.6,
          (1 - (this.config.catchupPlaybackRate - 1)) * (timeToStall / this.config.stallThreshold),
        );
        console.warn(
          `[mseBuffer] Approaching live edge too quickly, time to stall ${timeToStall.toFixed(
            2,
          )}s is below threshold, slowing down further to ${newRate.toFixed(2)}x speed`,
        );
        this.video.playbackRate = newRate;
      }
    } else if (
      (this.isCatchingUp || this.isCatchingDown) &&
      Math.abs(currentLatency - targetDistance) < this.config.liveEdgeTolerance
    ) {
      // We've reached the target distance, return to normal speed
      console.log(
        `[mseBuffer] Reached target distance from live edge (${currentLatency.toFixed(2)}s), returning to normal speed`,
      );
      this.resetPlaybackRate();
    }
  }

  private resetPlaybackRate() {
    if (
      this.isCatchingUp ||
      this.isCatchingDown ||
      this.video.playbackRate !== this.originalPlaybackRate
    ) {
      this.video.playbackRate = this.originalPlaybackRate;
      this.isCatchingUp = false;
      this.isCatchingDown = false;
      console.log(`[mseBuffer] Playback rate reset to ${this.originalPlaybackRate}x`);
    }
  }

  /**
   * Manually trigger buffer check
   */
  public checkBuffers() {
    this.checkBufferedRegions();
  }

  /** Get current configuration */
  public getCurrentLatency(asString: false): number;
  public getCurrentLatency(asString: true): string;
  public getCurrentLatency(asString: boolean): number | string {
    if (asString) {
      const latencyMs = this.lookupLatency(this.video.currentTime);
      if (latencyMs === 0) return 'N/A';
      const totalSeconds = Math.floor(latencyMs / 1000);
      const totalMilliseconds = Math.floor(latencyMs % 1000);
      const milliseconds = totalMilliseconds.toString().padStart(3, '0');
      const seconds = totalSeconds.toString().padStart(1, '0');
      return `${seconds}.${milliseconds}`;
    }
    return this.lookupLatency(this.video.currentTime);
  }

  /**
   * Force catchup mode for testing
   */
  public forceCatchup(enabled: boolean = true) {
    if (enabled) {
      console.log(`[mseBuffer] Forcing catchup mode at ${this.config.catchupPlaybackRate}x speed`);
      this.isCatchingUp = true;
      this.video.playbackRate = this.config.catchupPlaybackRate;
    } else {
      console.log('[mseBuffer] Disabling forced catchup mode');
      this.resetPlaybackRate();
    }
  }

  public getConfig() {
    return this.config;
  }

  public getStats() {
    return this.stats;
  }

  dispose() {
    if (this.isDisposed) return;
    this.isDisposed = true;

    // Reset playback rate before disposing
    this.resetPlaybackRate();

    // Remove event listeners
    this.video.removeEventListener('pause', this.handlePause);
    this.video.removeEventListener('play', this.handlePlay);
    this.video.removeEventListener('waiting', this.handleWaiting);
    this.video.removeEventListener('stalled', this.handleStalled);
    this.video.removeEventListener('canplay', this.handleCanPlay);

    // Remove tab visibility listener
    document.removeEventListener('visibilitychange', this.handleTabChange);

    // Clear interval
    if (this.bufferCheckInterval) {
      clearInterval(this.bufferCheckInterval);
      this.bufferCheckInterval = null;
    }
  }
}

export default MSEBuffer;
export type { MSEBufferConfig };
