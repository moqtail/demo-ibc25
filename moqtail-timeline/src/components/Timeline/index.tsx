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

import { cn, secondToTimecode } from '@/lib/utils';
import * as Comlink from 'comlink';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { selectors } from '@/store/slices/timeline';
import type { Category, TimelineEvent, TimelinePayload } from '@/types';
import { actions as playerActions } from '@/store/slices/player';
import { actions as timelineActions } from '@/store/slices/timeline';
import { useMOQProcessor } from '@/hooks/useMOQProcessor';
import { useEffect, useState } from 'react';
import TimelineTicks from './Ticks';
import { MAX_TIMELINE_SECONDS } from '@/constants';
import { Badge } from '@/components/ui/badge';

import { PiNumberCircleThree, PiNumberCircleTwo, PiNumberCircleOne } from 'react-icons/pi';
import { IoMdBasketball } from 'react-icons/io';

interface TimelineProps extends React.HTMLAttributes<HTMLDivElement> {
  clampPosition?: boolean;
}

function secondToPercentage(seconds: number) {
  return Math.min((seconds / MAX_TIMELINE_SECONDS) * 100, 100);
}

function secondToPosition(seconds: number, currentTime: number) {
  // For a live timeline, position items relative to the current time
  // Items closer to current time appear on the right
  const timeFromCurrent = currentTime - seconds;

  // Position relative to the right edge (live edge)
  // timeFromCurrent = 0 means position = 100% (far right)
  // timeFromCurrent = MAX_TIMELINE_SECONDS means position = 0% (far left)
  const currentMax = Math.min(currentTime, MAX_TIMELINE_SECONDS);
  return ((currentMax - timeFromCurrent) / currentMax) * 100;
}

function Timeline({ className, ...props }: TimelineProps) {
  const { mp, initialized } = useMOQProcessor();
  const dispatch = useAppDispatch();
  const [hasTimeline, setHasTimeline] = useState(false);

  useEffect(() => {
    if (!initialized) return;
    const ac = new AbortController();
    let requestId: bigint;

    const init = async () => {
      if (ac.signal.aborted) return;
      if (!mp) throw new Error('MOQtail processor not yet available, impossible state');

      // Initialize and get the catalog
      const catalog = await mp.init();

      // Check if we have a timeline track
      const timeline = catalog.getTimeline();

      // Subscribe to timeline, if it exists
      if (timeline) {
        // Get the dependee track
        if (!timeline.depends) throw new Error('Timeline dependees not found');
        const dependees = timeline.depends
          .map(name => catalog.getByTrackName(name))
          .filter(Boolean)
          .map(track => track!.name);

        // Handle timeline events
        async function handleTimelineEvent(payload: TimelinePayload) {
          // Check if we have events
          if (payload.records.length === 0) return;

          // Iterate over events
          for (const record of payload.records) {
            if (!record.start || !record.end) continue; // Skip events without start or end
            if (!record.metadata) continue; // Skip events without metadata

            // Calculate start and end times (for display)
            const start = record.media_pts / 90000; // FIXME: Hardcoded timescale
            const end = start + record.metadata.duration;

            dispatch(
              timelineActions.addEvent({
                trackNames: dependees,
                category: record.metadata.type,
                display: { start, end },
                media: { start: record.start, end: record.end },
              }),
            );
          }
        }

        requestId = await mp.addTimelineTrack(
          { mode: 'subscribe', trackName: timeline.name, priority: 100 },
          Comlink.proxy(handleTimelineEvent),
        );
        setHasTimeline(true);
      }
    };

    // Start the async process
    init().catch(error => {
      if (error.name === 'AbortError') return;
      console.error('Error initializing MOQtail processor:', error);
    });

    return () => {
      ac.abort('Component unmounted');
      if (requestId)
        mp?.removeTrack(requestId).catch(error => {
          console.error('Error removing track:', error);
        });
    };
  }, [initialized]);

  if (!initialized || !hasTimeline) return null;
  return <TimelineInner className={className} {...props} />;
}

function TimelineInner({ className, ...props }: TimelineProps) {
  const position = useAppSelector(selectors.getPosition);
  const events = useAppSelector(selectors.getEvents);
  const categories = useAppSelector(selectors.getCategories);
  return (
    <div
      {...props}
      className={cn(className, '3xl:gap-4 flex w-full flex-col items-center justify-end')}
    >
      <div className="flex justify-center gap-3 pb-3">
        {categories
          .filter(category => category.type === 'event')
          .map((category, index) => (
            <TimelineCategoryButton key={index} category={category} />
          ))}
      </div>
      <div className="flex flex-col self-end" style={{ width: `${secondToPercentage(position)}%` }}>
        <div className="bg-timeline 3xl:h-14 relative h-6 w-full">
          <div className="border-timeline 3xl:min-h-14 relative min-h-6 w-full overflow-hidden border-2">
            {events
              .filter(({ display }) => display.start <= position && display.end <= position)
              .filter(({ display }) => display.end >= position - MAX_TIMELINE_SECONDS)
              .filter(({ category }) => categories.find(c => c.name === category)?.enabled)
              .map(item => (
                <TimelineItem key={item.id} item={item} position={position} />
              ))}
          </div>
        </div>
        <div className="flex justify-between">
          <TimelineTicks />
        </div>
      </div>
    </div>
  );
}

function TimelineCategoryButton({ category }: { category: Category }) {
  const dispatch = useAppDispatch();

  const handleClick = (event: React.MouseEvent) => {
    const isShift = event.shiftKey;
    if (isShift) {
      // Toggle all categories
      const newState = !category.enabled;
      dispatch(timelineActions.toggleAllCategories(newState));
    } else {
      // Toggle single category
      dispatch(timelineActions.toggleCategory(category.name));
    }
  };

  let icon = <IoMdBasketball />;
  if (category.name === '1_POINT') icon = <PiNumberCircleOne />;
  else if (category.name === '2_POINT') icon = <PiNumberCircleTwo />;
  else if (category.name === '3_POINT') icon = <PiNumberCircleThree />;

  return (
    <Badge
      variant="outline"
      className={cn(
        '3xl:px-4 3xl:py-2 3xl:text-2xl 3xl:[&>svg]:size-10 cursor-pointer gap-2 transition-all duration-150 select-none hover:brightness-125',
        !category.enabled && 'opacity-50',
      )}
      style={{
        color: category.enabled ? category.color : 'gray',
        backgroundColor: category.enabled ? category.color + '20' : 'transparent',
      }}
      onClick={handleClick}
    >
      {icon}
      <span>{category.name.replace('_', ' ')}</span>
    </Badge>
  );
}

function TimelineItem({ item, position }: { item: TimelineEvent; position: number }) {
  const dispatch = useAppDispatch();
  const category = useAppSelector(state =>
    selectors.getCategories(state).find(c => c.name === item.category),
  );
  if (!category) return null;

  const startPosition = secondToPosition(item.display.start, position);
  const endPosition = secondToPosition(item.display.end, position);

  // Calculate the actual left position and width properly
  const leftPosition = Math.min(startPosition, endPosition);
  const rightPosition = Math.max(startPosition, endPosition);
  const width = rightPosition - leftPosition;
  const duration = Math.round(item.display.end - item.display.start);

  const handleClick = () => {
    dispatch(
      playerActions.addVideo({
        type: 'vod',
        trackNames: item.trackNames,
        location: item.media,
      }),
    );
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild onClick={() => handleClick()}>
        <div
          className="border-x-timeline 3xl:h-16 absolute top-1/2 h-5.5 min-w-2 -translate-y-1/2 cursor-pointer border-1"
          style={{ left: `${leftPosition}%`, width: `${width}%`, backgroundColor: category.color }}
        ></div>
      </TooltipTrigger>
      <TooltipContent color={category.color}>
        <span>
          Event from {secondToTimecode(item.display.start)} to {secondToTimecode(item.display.end)}
          <br />
          Duration: {duration} seconds
        </span>
      </TooltipContent>
    </Tooltip>
  );
}

export default Timeline;
