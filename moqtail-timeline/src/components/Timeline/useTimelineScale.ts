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
import { useEffect, useState } from 'react';
import { MAX_TIMELINE_SECONDS } from '@/constants';

const MIN_PX_SEP = 5; // Minimum pixel separation between ticks

interface TimelineScale {
  separation: number;
  deltaSeconds: number;
  visibleDuration: number;
  width: number;
}

export function useTimelineScale(
  containerRef: React.RefObject<HTMLElement | SVGSVGElement | null>,
): TimelineScale {
  const position = useAppSelector(selectors.getPosition);
  const [width, setWidth] = useState(0);

  // Track the container width
  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const observer = new ResizeObserver(() => setWidth(container.clientWidth));
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);

  // Get the duration visible on the timeline
  const visibleDuration = Math.min(MAX_TIMELINE_SECONDS, position);

  // Calculate how many ticks we can show
  let maxTicks = Math.floor(width / MIN_PX_SEP);

  // Calculate tick spacing based on timeline width and duration
  let separation = MIN_PX_SEP;
  let deltaSeconds = visibleDuration / maxTicks;

  if (deltaSeconds <= 1) {
    deltaSeconds = 1;
    separation = width / visibleDuration;
  } else {
    // Round to nice intervals
    if (deltaSeconds <= 2) deltaSeconds = 2;
    else if (deltaSeconds <= 5) deltaSeconds = 5;
    else if (deltaSeconds <= 10) deltaSeconds = 10;

    maxTicks = Math.floor(visibleDuration / deltaSeconds);
    separation = width / maxTicks;
  }

  return { separation, deltaSeconds, visibleDuration, width };
}
