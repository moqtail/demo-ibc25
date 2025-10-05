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

import { FaGear } from 'react-icons/fa6';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { ValueSlider } from '@/components/ui/value-slider';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { actions, selectors } from '@/store/slices/player';
import { actions as generalActions, selectors as generalSelectors } from '@/store/slices/general';
import {
  DEFAULT_CATCHUP_PLAYBACK_RATE,
  DEFAULT_LIVE_EDGE_DELAY,
  DEFAULT_LIVE_EDGE_TOLERANCE,
} from '@/constants';

function Settings() {
  const dispatch = useAppDispatch();
  const mse = useAppSelector(selectors.getMSEBufferConfig);
  const closeFetch = useAppSelector(generalSelectors.getCloseFetchOnEnd);

  // MSE Options
  const liveDelay = mse?.liveEdgeDelay ?? DEFAULT_LIVE_EDGE_DELAY;
  const liveTolerance = mse?.liveEdgeTolerance ?? DEFAULT_LIVE_EDGE_TOLERANCE;
  const catchupRate = mse?.catchupPlaybackRate ?? DEFAULT_CATCHUP_PLAYBACK_RATE;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="bg-muted flex h-8 cursor-pointer items-center justify-center gap-2 text-xs">
          <FaGear />
          <span>Open Settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="mt-3 flex flex-col items-start justify-start gap-4">
          <div className="flex items-center gap-3">
            <Checkbox
              id="fetch_close"
              checked={closeFetch}
              onCheckedChange={checked =>
                typeof checked === 'boolean' && dispatch(generalActions.setFetchClose(checked))
              }
            />
            <Label htmlFor="fetch_close">
              Close the replay window automatically when the playback ends
            </Label>
          </div>
          <div className="grid w-full grid-cols-[auto_1fr] items-center gap-x-3 gap-y-4">
            <ValueSlider
              id="live_delay"
              label="Target latency"
              value={liveDelay}
              min={0.1}
              max={5}
              step={0.1}
              suffix="s"
              onValueCommit={value =>
                dispatch(actions.setMSEBufferConfig({ liveEdgeDelay: value }))
              }
            />

            <ValueSlider
              id="live_tol"
              label="Latency tolerance"
              value={liveTolerance}
              min={0.1}
              max={0.5}
              step={0.05}
              suffix="s"
              onValueCommit={value =>
                dispatch(actions.setMSEBufferConfig({ liveEdgeTolerance: value }))
              }
            />

            <ValueSlider
              id="catchup_rate"
              label="Playback catchup rate"
              value={catchupRate}
              min={1.0}
              max={1.5}
              step={0.05}
              formatValue={value => `${(1 - (value - 1)).toFixed(2)}-${value.toFixed(2)}`}
              suffix="x"
              onValueCommit={value =>
                dispatch(actions.setMSEBufferConfig({ catchupPlaybackRate: value }))
              }
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default Settings;
