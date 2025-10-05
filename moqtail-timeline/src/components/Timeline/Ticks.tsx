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

import { useAppSelector } from '@/store/hooks';
import { selectors } from '@/store/slices/timeline';
import { useMemo, useRef, type JSX } from 'react';
import { MAX_TIMELINE_SECONDS } from '@/constants';
import { useTimelineScale } from './useTimelineScale';
import { cn, secondToTimecode } from '@/lib/utils';
import { useMediaQuery } from 'usehooks-ts';

const SEGMENT_SECONDS = 10;
const STROKE_WIDTH = 2;

interface TickProps {
  xOffset: number;
  separation: number;
  delta: number;
  label: number;
  labelDisplayModulo: number;
}

function TickSegment({ xOffset, separation, delta, label, labelDisplayModulo }: TickProps) {
  // Construct the lines
  const ticks = useMemo(() => {
    const ticks: JSX.Element[] = [];
    for (let s = 0, i = 0; s < SEGMENT_SECONDS; s += delta, i++) {
      const x = i * separation;
      let h = 4;
      if (s % 10 === 0) h *= 3;
      else if (s % 5 === 0) h *= 2;

      // Check if values are valid numbers
      if (isNaN(x) || isNaN(h) || !isFinite(x) || !isFinite(h)) continue;

      ticks.push(
        <line
          key={`tick-${s}`}
          x1={x}
          y1={0}
          x2={x}
          y2={h}
          className="stroke-timeline"
          strokeWidth={STROKE_WIDTH}
        />,
      );
    }
    return ticks;
  }, [separation, delta]);

  if (isNaN(xOffset) || !isFinite(xOffset)) return null;
  return (
    <g transform={`translate(${xOffset},0)`}>
      {ticks}
      {label % labelDisplayModulo === 0 && (
        <text
          x={0}
          y={30}
          className="fill-timeline 3xl:text-xl text-xs"
          ref={el => {
            if (el) {
              const textWidth = el.getBBox().width;
              el.setAttribute('x', `${-textWidth / 2}`);
            }
          }}
        >
          {secondToTimecode(label)}
        </text>
      )}
    </g>
  );
}

type TimelineTicksProps = React.HTMLAttributes<SVGSVGElement>;

function TimelineTicks({ className, ...props }: TimelineTicksProps) {
  const ref = useRef<SVGSVGElement>(null);
  const position = useAppSelector(selectors.getPosition);
  const { separation, deltaSeconds, visibleDuration } = useTimelineScale(ref);
  const isXL = useMediaQuery('(min-width:1280px)');

  // Calculate the segment count - ensure we have enough segments to cover the timeline plus overflow
  const segmentCount = Math.ceil(visibleDuration / SEGMENT_SECONDS) + 2;
  const segmentWidth = (SEGMENT_SECONDS / deltaSeconds) * separation;

  // TODO: Display markers from getMarkers

  return (
    <svg ref={ref} width="100%" height={40} className={cn('select-none', className)} {...props}>
      {Array.from({ length: segmentCount }).map((_, i) => {
        let segmentTime: number;
        let xOffset: number;

        if (position <= MAX_TIMELINE_SECONDS) {
          // Normal timeline - show from 0 to position
          segmentTime = i * SEGMENT_SECONDS;
          xOffset = i * segmentWidth + STROKE_WIDTH / 2;
        } else {
          // Rotating timeline - show a sliding window that ends at current position
          // Calculate the time range that should be visible
          const timelineSpan = (segmentCount - 1) * SEGMENT_SECONDS; // Total time span shown
          const startTime = position - timelineSpan; // Start of visible time range

          // Calculate segment time - each segment represents a 10-second interval
          // Floor to 10-second boundaries so labels only show fixed intervals (0:00, 0:10, 0:20, etc.)
          const rawSegmentTime = startTime + i * SEGMENT_SECONDS;
          segmentTime = Math.floor(rawSegmentTime / SEGMENT_SECONDS) * SEGMENT_SECONDS;

          // For smooth scrolling, calculate the sub-segment offset
          const positionWithinSegment = position % SEGMENT_SECONDS;
          const pixelOffsetWithinSegment = (positionWithinSegment / SEGMENT_SECONDS) * segmentWidth;

          // Base position for this segment
          xOffset = i * segmentWidth + STROKE_WIDTH / 2;

          // Apply the smooth scrolling offset so the timeline moves continuously
          xOffset -= pixelOffsetWithinSegment;

          // Ensure segment time is never negative
          segmentTime = Math.max(0, segmentTime + SEGMENT_SECONDS);
        }

        if (isNaN(xOffset) || isNaN(segmentTime) || isNaN(separation) || isNaN(deltaSeconds))
          return null;

        // Decide how often to show labels based on zoom level
        let labelDisplayModulo = 10;
        if (deltaSeconds > 1) labelDisplayModulo = 20;
        if (deltaSeconds > 2) labelDisplayModulo = 30;
        if (deltaSeconds > 5) labelDisplayModulo = 60;
        if (isXL) labelDisplayModulo *= 2;

        return (
          <TickSegment
            key={`segment-${i}-${Math.floor(segmentTime / SEGMENT_SECONDS)}`}
            xOffset={xOffset}
            delta={deltaSeconds}
            separation={separation}
            label={segmentTime}
            labelDisplayModulo={labelDisplayModulo}
          />
        );
      })}
    </svg>
  );
}

export default TimelineTicks;
