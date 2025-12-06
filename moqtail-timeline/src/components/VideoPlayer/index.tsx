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

import type { Video } from '@/types';
import { cn } from '@/lib/utils';
import * as Comlink from 'comlink';
import { useEffect, useRef, useState } from 'react';
import { MdOutlineReplay, MdClose, MdOutlineStarPurple500 } from 'react-icons/md';
import { ImEnlarge2, ImShrink2, ImPlay3, ImPause2 } from 'react-icons/im';
import { GoMute, GoUnmute } from 'react-icons/go';
import { TbChartBarOff, TbChartBarPopular } from 'react-icons/tb';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { actions as timelineActions } from '@/store/slices/timeline';
import { useMOQProcessor } from '@/hooks/useMOQProcessor';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { actions, selectors } from '@/store/slices/player';
import { selectors as generalSelectors } from '@/store/slices/general';
import MSEBuffer from './mseBuffer';
import { CgSpinner } from 'react-icons/cg';
import './font.css';
import Stats from './Stats';

interface ControlElementProps extends React.HTMLAttributes<HTMLButtonElement> {
  tooltip: string;
}

function ControlElement({ className, children, onClick, tooltip, hidden }: ControlElementProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild onClick={onClick}>
        <div
          hidden={hidden}
          className={cn(
            'text-background-light flex size-10 cursor-pointer items-center justify-center rounded-full bg-black opacity-60 @sm:size-18',
            className,
          )}
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <span>{tooltip}</span>
      </TooltipContent>
    </Tooltip>
  );
}

interface VideoProps extends React.HTMLAttributes<HTMLVideoElement> {
  item: Video;
  onRemove: (video: Video) => void;
  onPromote: () => void;
  isPromoted: boolean;
}

function VideoPlayer({ className, item, onRemove, onPromote, isPromoted }: VideoProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const { mp, initialized } = useMOQProcessor();
  const dispatch = useAppDispatch();

  // Visual controls
  const [objectCover, setObjectCover] = useState(false);
  const [playing, setPlaying] = useState(true);

  // Sound controls
  const [muted, setMuted] = useState(true);
  const videos = useAppSelector(selectors.getVideos);
  const isHovered = useAppSelector(selectors.getHoveredId);

  // Video overlay
  const overlayRef = useRef<HTMLDivElement>(null);
  const [showStats, setShowStats] = useState(false);
  const [initializedOverlay, setInitializedOverlay] = useState(false);
  useEffect(() => {
    if (!ref.current || !overlayRef.current) return;
    const video = ref.current;
    const overlay = overlayRef.current;
    const innerDiv = overlay.querySelector('div');

    if (innerDiv) {
      const spanCount = innerDiv.querySelectorAll('span').length;
      Object.assign(innerDiv.style, {
        width: '41.2%',
        height: `${5.9375 * spanCount}%`,
        top: '10.6%',
        paddingLeft: '8px',
        paddingRight: '8px',
        backgroundColor: 'rgba(65, 0, 0, 0.75)',
      });
    }

    function updateOverlay() {
      const container = video.getBoundingClientRect();
      const videoRatio = video.videoWidth / video.videoHeight;
      const containerRatio = container.width / container.height;

      let displayWidth, displayHeight, offsetX, offsetY;

      if (videoRatio > containerRatio) {
        // Video is wider → limited by width
        displayWidth = container.width;
        displayHeight = container.width / videoRatio;
        offsetX = 0;
        offsetY = (container.height - displayHeight) / 2;
      } else {
        // Video is taller → limited by height
        displayHeight = container.height;
        displayWidth = container.height * videoRatio;
        offsetY = 0;
        offsetX = (container.width - displayWidth) / 2;
      }

      // Overlay position and size
      overlay.style.left = offsetX + 'px';
      overlay.style.top = offsetY + 'px';
      overlay.style.width = displayWidth + 'px';
      overlay.style.height = displayHeight + 'px';

      // Dynamically adjust font size to fit height, prevent overflow
      const spans = overlay.querySelector('div')?.querySelectorAll('span') ?? [];
      if (spans.length > 0) {
        // Calculate available height per span
        const availableHeight = overlay.clientHeight / spans.length;
        // Use the same font size and line height for all spans
        let fontSize = Math.max(8, availableHeight * 0.85);
        for (const span of spans) {
          span.style.fontSize = `${fontSize}px`;
          span.style.lineHeight = `${fontSize}px`;
          // Shrink font size if text overflows horizontally
          while (
            span.scrollWidth > span.clientWidth &&
            fontSize > 8 // minimum font size
          ) {
            fontSize -= 1;
            span.style.fontSize = `${fontSize}px`;
            span.style.lineHeight = `${fontSize}px`;
          }
        }
      }
    }

    // Update overlay on RAF until it settles
    const ac = new AbortController();
    const clock = overlay.querySelector('#clock') as HTMLSpanElement;
    const latency = overlay.querySelector('#latency') as HTMLSpanElement;
    const raf = () => {
      if (isNaN(video.currentTime) || isNaN(video.duration) || video.duration === 0)
        return requestAnimationFrame(raf);

      if (item.type === 'live') {
        // Update clock text
        const now = performance.now() + performance.timeOrigin;
        const date = new Date(now);
        const ms = String(date.getMilliseconds()).padStart(3, '0');
        clock.textContent = `Subscriber Time: ${date.toLocaleTimeString('en-US', { hour12: false })}.${ms}`;

        // Update latency text
        const latencyString = MSEBuffer.getInstance().getCurrentLatency(true);
        latency.textContent = `Latency: ${latencyString} (s)`;
      }

      // Update overlay position and size
      updateOverlay();

      // Continue if not aborted
      if (!ac.signal.aborted) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);

    return () => {
      ac.abort();
    };
  }, [item.type, isPromoted]);

  // Control play/pause
  useEffect(() => {
    if (ref.current) {
      if (playing) {
        ref.current.play().catch(error => {
          // Only log error if video is still in the document
          if (ref.current && document.body.contains(ref.current))
            console.error('Error playing video:', error);
        });
      } else {
        ref.current.pause();
      }
    }
  }, [playing]);

  // Control mute/unmute and volume
  useEffect(() => {
    if (!ref.current || videos.length === 0) return;
    const video = ref.current;
    const isOnlyVideo = videos.length === 1;
    const isFirstVideo = videos[0].id === item.id;
    const isLastVideo = videos[videos.length - 1].id === item.id;

    // Hover state takes precedence
    if (isHovered) {
      if (isHovered === item.id && !muted) {
        video.volume = 1;
        video.muted = false;
      } else {
        video.muted = true;
      }
      return;
    }

    if (isOnlyVideo) {
      video.volume = 1;
      video.muted = muted;
      return;
    }

    // Multiple videos
    if (!muted) {
      video.volume = isFirstVideo ? 0.2 : isLastVideo ? 1 : 0;
      video.muted = false;
    } else {
      video.muted = true;
    }
  }, [muted, videos, isHovered]);

  // Attach event listeners on <video>
  const closeFetch = useAppSelector(generalSelectors.getCloseFetchOnEnd);
  useEffect(() => {
    if (!ref.current) return;
    const video = ref.current;

    const handlePlay = () => setPlaying(true);
    const handlePause = () => setPlaying(false);
    const handleTimeUpdate = () => {
      if (item.type === 'live') {
        dispatch(timelineActions.updatePosition(video.currentTime));
      } else if (closeFetch && video.currentTime === video.duration) {
        // For VOD, close remove window if ended and setting is enabled
        onRemove(item);
      }

      // Display only when video metadata is loaded
      if (video.readyState >= 1 && video.currentTime) setInitializedOverlay(true);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
    };
  }, [dispatch, item.type, closeFetch, onRemove]);

  // Configure the MoQ session
  useEffect(() => {
    if (!initialized) return;
    const ac = new AbortController();
    const requestIds: Promise<bigint[]>[] = [];
    let videoRequestId: Promise<bigint>;
    let mseBuffer: MSEBuffer;

    const init = async () => {
      if (ac.signal.aborted) return;
      if (!mp) throw new Error('MOQtail processor not yet available, impossible state');
      if (!ref.current) throw new Error('Video ref not set, impossible state');

      // Create a media source
      const source = await mp.createMediaSource();
      // @ts-expect-error MediaSourceHandle is not baseline
      ref.current!.srcObject = source.handle;

      // Initialize and get the catalog
      const catalog = await mp.init();

      if (item.type === 'live') {
        let trackName;
        // Find the video track
        if (item.trackNames && item.trackNames.length > 0) {
          trackName = item.trackNames.find(name => catalog.getRole(name) === 'video');
        } else trackName = catalog.getVideo()?.name;
        if (!trackName) throw new Error('No video track found in the catalog');
        videoRequestId = mp.addMediaTrack({ mode: 'subscribe', trackName }, source.id);
        requestIds.push(videoRequestId.then(id => [id]));

        // Find the audio track
        if (item.trackNames && item.trackNames.length > 0) {
          trackName = item.trackNames.find(name => catalog.getRole(name) === 'audio');
        } else trackName = catalog.getAudio()?.name;

        if (trackName)
          requestIds.push(
            mp.addMediaTrack({ mode: 'subscribe', trackName }, source.id).then(id => [id]),
          );
      } else {
        const videoTrackName = item.trackNames.find(name => catalog.getRole(name) === 'video');
        if (!videoTrackName) throw new Error('No video track found in the catalog');
        const audioTrackName = item.trackNames.find(name => catalog.getRole(name) === 'audio');
        if (!audioTrackName) throw new Error('No audio track found in the catalog');

        // Fetch both audio and video tracks
        const pacedRequestIds = mp.addPacedMediaTracks(
          { mode: 'fetch', trackName: videoTrackName, location: item.location, priority: 50 },
          { mode: 'fetch', trackName: audioTrackName, location: item.location, priority: 50 },
          source.id,
        );
        requestIds.push(pacedRequestIds);
      }

      // Seek to buffer end
      let gotNotification = 0;
      let target = 0;
      async function bufferNotification(start: number, end: number) {
        if (gotNotification >= requestIds.length || !ref.current) return false;

        // For live, seek to the max end, for VOD seek to the min start
        target = Math.max(target, item.type === 'live' ? end : start);

        gotNotification++;
        if (gotNotification === requestIds.length) {
          console.log('All buffers ready, seeking to', target);
          ref.current.currentTime = target;
        }
        return true;
      }

      // Attach the buffer controller for live streams
      if (item.type === 'live') mseBuffer = MSEBuffer.attachSingleton(ref.current);

      // Now we can start the playback
      const ids = await Promise.all(requestIds);
      await Promise.all(
        ids.flat().map(async id => {
          if (id === (await videoRequestId))
            mp.startMedia(
              id,
              Comlink.proxy(bufferNotification),
              mseBuffer ? Comlink.proxy(mseBuffer.getPRFTListener()) : undefined,
            );
          else mp.startMedia(id, Comlink.proxy(bufferNotification));
        }),
      );
    };

    // Start the async process
    init().catch(error => {
      if (error.name === 'AbortError') return;
      console.error('Error initializing MOQtail processor:', error);
      onRemove(item);
    });

    return () => {
      ac.abort('Component unmounted');
      mseBuffer?.dispose();
      requestIds.forEach(async ids =>
        (await ids).forEach(async id =>
          mp?.removeTrack(id).catch(error => {
            console.error('Error removing track:', error);
          }),
        ),
      );
    };
  }, [initialized]);

  // On-demand state for the UI
  const video = ref.current;
  const isAtEnd = video && video.currentTime === video.duration;

  return (
    <div
      className={cn('group grid h-full w-full place-items-center', className)}
      onMouseEnter={() => dispatch(actions.setHoveredId(item.id))}
      onMouseLeave={() => dispatch(actions.setHoveredId(null))}
    >
      <div className="relative inset-0 z-10 col-span-full row-span-full h-full min-h-0">
        <video
          ref={ref}
          className={cn('h-full', {
            'object-cover': objectCover,
            'object-contain': !objectCover,
          })}
          autoPlay
        />
        <div
          ref={overlayRef}
          className={cn('@container absolute top-0 text-[28.5px]', isAtEnd && 'bg-black/60')}
        >
          {item.type === 'live' && (
            <div
              className="absolute flex h-full w-full flex-col"
              hidden={initializedOverlay ? !isPromoted : true}
            >
              <span id="clock" className="font-dejavu flex flex-1 items-center truncate" />
              <span id="latency" className="font-dejavu flex flex-1 items-center truncate" />
            </div>
          )}
          <span
            className={cn(
              'absolute top-0 right-0 rounded-bl-xl px-2 py-1 text-sm font-bold text-white uppercase shadow @md:text-2xl @3xl:px-4 @3xl:py-2 @3xl:text-4xl @7xl:text-7xl',
              item.type === 'live' ? 'animate-pulse bg-red-500' : 'bg-green-600',
            )}
            hidden={!initializedOverlay}
          >
            {item.type === 'live' ? 'live' : 'replay'}
          </span>
          <Stats hidden={(initializedOverlay ? !isPromoted : true) || !showStats} />
        </div>
      </div>
      <div
        className="z-20 col-span-full row-span-full flex h-full min-h-0 items-center justify-center"
        hidden={initializedOverlay}
      >
        <CgSpinner className="size-32 animate-spin" />
      </div>
      <div
        className={cn(
          '@container z-30 col-span-full row-span-full flex h-full w-full items-center justify-center border-0 border-red-500 opacity-0 transition-opacity delay-300 duration-150 ease-in-out group-hover:opacity-100 group-hover:delay-0',
          isAtEnd && 'opacity-100',
        )}
      >
        <div className="flex h-min w-full flex-wrap items-center justify-center gap-4">
          {item.type === 'vod' && (
            <ControlElement
              onClick={() => {
                if (isAtEnd) video.currentTime = video.buffered.start(0);
                setPlaying(!playing);
              }}
              tooltip={playing ? 'Pause' : isAtEnd ? 'Replay' : 'Play'}
              hidden={!initializedOverlay}
            >
              {playing ? (
                <ImPause2 className="size-4 @sm:size-6" />
              ) : isAtEnd ? (
                <MdOutlineReplay className="size-6 @sm:size-8" />
              ) : (
                <ImPlay3 className="size-4 @sm:size-6" />
              )}
            </ControlElement>
          )}
          <ControlElement
            onClick={() => setObjectCover(!objectCover)}
            tooltip={objectCover ? 'Contain' : 'Cover'}
            hidden={!initializedOverlay || !!isAtEnd}
          >
            {objectCover ? (
              <ImShrink2 className="size-4 @sm:size-6" />
            ) : (
              <ImEnlarge2 className="size-4 @sm:size-6" />
            )}
          </ControlElement>
          <ControlElement
            onClick={onPromote}
            hidden={isPromoted || !initializedOverlay || !!isAtEnd}
            tooltip="Promote"
          >
            <MdOutlineStarPurple500 className="size-4 @sm:size-6" />
          </ControlElement>
          <ControlElement
            onClick={() => setMuted(!muted)}
            tooltip={muted ? 'Unmute' : 'Mute'}
            hidden={!initializedOverlay || !!isAtEnd}
          >
            {muted ? (
              <GoUnmute className="size-4 @sm:size-6" />
            ) : (
              <GoMute className="size-4 @sm:size-6" />
            )}
          </ControlElement>
          {item.type === 'vod' && (
            <ControlElement
              className="col-span-1 bg-red-500"
              onClick={() => onRemove(item)}
              tooltip="Close"
            >
              <MdClose className="size-4 @sm:size-6" />
            </ControlElement>
          )}
          {item.type === 'live' && (
            <ControlElement
              className="col-span-1"
              onClick={() => setShowStats(!showStats)}
              hidden={!initializedOverlay || !isPromoted}
              tooltip={showStats ? 'Hide Stats' : 'Show Stats'}
            >
              {showStats ? (
                <TbChartBarOff className="size-4 @sm:size-6" />
              ) : (
                <TbChartBarPopular className="size-4 @sm:size-6" />
              )}
            </ControlElement>
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoPlayer;
