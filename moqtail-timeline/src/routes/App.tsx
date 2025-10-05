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

import { Navigate } from 'react-router';
import Stage from '../components/Stage';
import Timeline from '../components/Timeline';
import Settings from '../components/Settings';
import { useAppSelector } from '@/store/hooks';
import { selectors as generalSelectors } from '@/store/slices/general';
import { selectors as playerSelectors } from '@/store/slices/player';
import { selectors as timelineSelectors } from '@/store/slices/timeline';
import ReloadPrompt from '@/components/ReloadPrompt';

function App() {
  const isReady = useAppSelector(playerSelectors.isReady);
  const hasError = useAppSelector(generalSelectors.hasConnectionError);
  const hasLiveVideo = useAppSelector(playerSelectors.hasLiveVideo);

  // Return nothing if we are not playing
  const hasStarted = useAppSelector(timelineSelectors.hasStarted);

  if (!isReady) return <Navigate to="/" replace />;
  return (
    <div data-main className="font-nunito flex h-full w-full flex-col items-center justify-center">
      <Stage className="container-lg grow" />
      {hasLiveVideo && (
        <div
          hidden={!hasStarted}
          className="container-lg my-8 inline-flex w-full flex-col items-center justify-center px-8 text-center"
        >
          <Timeline />
          <Settings />
        </div>
      )}
      {hasError && <ReloadPrompt />}
    </div>
  );
}

export default App;
