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

import { useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { Video } from '@/types';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { actions, selectors } from '@/store/slices/player';
import VideoPlayer from '../VideoPlayer';

function VideoGrid({ videos }: { videos: Video[] }) {
  const dispatch = useAppDispatch();

  const getSpanClasses = (index: number, total: number) => {
    if (total === 1) return 'col-span-5 row-span-3';

    if (index === 0) {
      if (total === 2 || total === 3) return 'col-span-4 row-span-3';
      if (total === 4) return 'col-span-4 row-span-3';
      if (total >= 5) return 'col-span-3 row-span-3';
    }

    return 'col-span-1 row-span-1';
  };

  const handleRemove = (video: Video) => {
    if (videos.length <= 1) return;
    dispatch(actions.removeVideo(video.id));
  };

  // Promotion state
  const promoted = useAppSelector(selectors.getPromoted);
  const hasPromotedVideo = promoted && videos.some(v => promoted.id === v.id);

  return (
    <div className="grid h-full max-h-full w-full grid-cols-5 grid-rows-3 gap-2 overflow-hidden">
      <AnimatePresence>
        {videos.map((video, i) => (
          <motion.div
            key={video.id}
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.3 }}
            className={cn(
              'flex overflow-hidden rounded',
              promoted?.index === i && promoted?.id === video.id
                ? [getSpanClasses(0, videos.length), 'order-first']
                : getSpanClasses(i, videos.length),
              i === 0 && hasPromotedVideo && getSpanClasses(promoted.index, videos.length),
            )}
          >
            <div className="flex h-full min-h-0 w-full">
              <VideoPlayer
                item={video}
                onRemove={handleRemove}
                onPromote={() => dispatch(actions.setPromoted({ index: i, id: video.id }))}
                isPromoted={promoted?.index === i && promoted?.id === video.id}
              />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

type StageProps = React.HTMLAttributes<HTMLDivElement>;

function Stage({ className, ...props }: StageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videos = useAppSelector(selectors.getVideos);

  return (
    <div
      {...props}
      ref={stageRef}
      className={cn(className, 'flex h-full max-h-full w-full flex-col overflow-hidden')}
    >
      <div className="max-h-full min-h-0 flex-1 overflow-hidden py-2">
        <VideoGrid videos={videos} />
      </div>
    </div>
  );
}

export default Stage;
