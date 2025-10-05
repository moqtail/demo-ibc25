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

import { useEffect, useRef } from 'react';
import MSEBuffer from './mseBuffer';
import { useAppSelector } from '@/store/hooks';
import { selectors } from '@/store/slices/player';

/**
 * Modified from https://github.com/mrdoob/stats.js/blob/master/src/Stats.js
 */
function createPanel(name: string, fg: string, bg: string, unit = 's') {
  const round = (val: number) => Number(val.toFixed(2));
  const PR = round(window.devicePixelRatio || 1);

  const WIDTH = 80 * PR,
    HEIGHT = 48 * PR,
    TEXT_X = 3 * PR,
    TEXT_Y = 2 * PR,
    GRAPH_X = 3 * PR,
    GRAPH_Y = 15 * PR,
    GRAPH_WIDTH = 74 * PR,
    GRAPH_HEIGHT = 30 * PR;

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  canvas.style.cssText = 'width:80px;height:48px';

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Failed to get canvas context');
  context.font = 'bold ' + 9 * PR + 'px Helvetica,Arial,sans-serif';
  context.textBaseline = 'top';

  context.fillStyle = bg;
  context.fillRect(0, 0, WIDTH, HEIGHT);

  context.fillStyle = fg;
  context.fillText(name, TEXT_X, TEXT_Y);
  context.fillRect(GRAPH_X, GRAPH_Y, GRAPH_WIDTH, GRAPH_HEIGHT);

  context.fillStyle = bg;
  context.globalAlpha = 0.9;
  context.fillRect(GRAPH_X, GRAPH_Y, GRAPH_WIDTH, GRAPH_HEIGHT);

  const mark = () => {
    context.fillStyle = 'white';
    context.globalAlpha = 1;
    context.fillRect(GRAPH_X + GRAPH_WIDTH - PR, GRAPH_Y, PR, GRAPH_HEIGHT);
  };

  let counter = 0;
  let range: [number, number] = [0, 1];
  return {
    dom: canvas,
    mark,
    updateRange: function (newRange: [number, number]) {
      range = newRange;
    },
    update: function (value: number) {
      if (!context) return;
      counter++;

      context.fillStyle = bg;
      context.globalAlpha = 1;
      context.fillRect(0, 0, WIDTH, GRAPH_Y);
      context.fillStyle = fg;
      context.fillText(name + ': ' + round(value) + unit, TEXT_X, TEXT_Y);

      if (counter % 20 === 0) {
        context.drawImage(
          canvas,
          GRAPH_X + PR,
          GRAPH_Y,
          GRAPH_WIDTH - PR,
          GRAPH_HEIGHT,
          GRAPH_X,
          GRAPH_Y,
          GRAPH_WIDTH - PR,
          GRAPH_HEIGHT,
        );

        context.fillRect(GRAPH_X + GRAPH_WIDTH - PR, GRAPH_Y, PR, GRAPH_HEIGHT);

        context.fillStyle = bg;
        context.globalAlpha = 0.9;
        context.fillRect(
          GRAPH_X + GRAPH_WIDTH - PR,
          GRAPH_Y,
          PR,
          round((1 - value / range[1]) * GRAPH_HEIGHT),
        );
      }
    },
  };
}

function mapValue(x: number) {
  const inMin = 0.1,
    inMax = 5;
  const outMin = 1.8,
    outMax = 1.2;

  // normalize to 0..1
  let t = (x - inMin) / (inMax - inMin);

  // ease-out (smooth)
  t = 1 - (1 - t) * (1 - t);

  // map to output
  return outMin + (outMax - outMin) * t;
}

interface StatsProps extends React.HTMLAttributes<HTMLDivElement> {}

function Stats({ ...props }: StatsProps) {
  const ref = useRef<HTMLDivElement>(null);
  const isMSEReady = useAppSelector(selectors.isMSEBufferConfigSet);

  useEffect(() => {
    if (!isMSEReady) return;
    if (!ref.current) return;
    const container = ref.current;

    // Get the mseBuffer instance
    const mseBuffer = MSEBuffer.getInstance();
    if (!mseBuffer) return;

    // Create stats
    const buffer = createPanel('Buffer', '#ff8', '#221');
    container.appendChild(buffer.dom);
    const latency = createPanel('Latency', '#8f8', '#212');
    container.appendChild(latency.dom);
    const playbackRate = createPanel('Playback', '#88f', '#122', 'x');
    container.appendChild(playbackRate.dom);
    const stall = createPanel('Stall', '#f88', '#211');
    container.appendChild(stall.dom);

    // Register timeupdate event to update stats
    const ac = new AbortController();
    const video = mseBuffer.video;
    let prevTargetLatency = 0;
    const update = () => {
      const buffered = video.buffered;
      if (buffered.length === 0) {
        if (!ac.signal.aborted) requestAnimationFrame(update);
        return;
      }

      // Calculate stats
      const stalled = mseBuffer.getStats().totalStallMs / 1000;
      const targetLatency = mseBuffer.getConfig().liveEdgeDelay || 0;
      const bufferEdge = buffered.end(buffered.length - 1);
      const currentLatency = mseBuffer.getCurrentLatency(false) / 1000;
      const timeToStall = bufferEdge - video.currentTime;

      // Mark if target latency changed
      if (targetLatency !== prevTargetLatency && prevTargetLatency !== 0) {
        buffer.mark();
        latency.mark();
        playbackRate.mark();
        stall.mark();
      }
      prevTargetLatency = targetLatency;

      // Update ranges
      const multiplier = mapValue(targetLatency);
      buffer.updateRange([0, targetLatency * multiplier]);
      latency.updateRange([0, targetLatency * multiplier]);
      playbackRate.updateRange([0, 2]);
      stall.updateRange([0, Math.max(stalled * 3, 3)]);

      // Update panels
      buffer.update(timeToStall);
      latency.update(currentLatency);
      playbackRate.update(video.playbackRate);
      stall.update(stalled);

      // Schedule next update
      if (!ac.signal.aborted) requestAnimationFrame(update);
    };
    requestAnimationFrame(update);

    return () => {
      ac.abort();
      container.innerHTML = '';
    };
  }, [isMSEReady]);

  return <div ref={ref} className="pointer-events-none absolute bottom-0 left-0 flex" {...props} />;
}

export default Stats;
