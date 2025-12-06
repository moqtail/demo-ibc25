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

import { Button } from '@/components/ui/button';
import { MdMobileOff, MdWarning } from 'react-icons/md';
import { useAppDispatch } from '@/store/hooks';
import { actions } from '@/store/slices/player';
import { useNavigate } from 'react-router';
import { useMediaQuery } from 'usehooks-ts';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

function checkAPIAvailability(): boolean {
  return (
    'MediaSource' in window &&
    'MediaSourceHandle' in window &&
    'WebTransport' in window &&
    'ReadableStream' in window
  );
}

function Entry() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const isSmall = useMediaQuery('(max-width: 640px)');

  return (
    <div className="container mx-auto flex h-full w-full items-center justify-center max-lg:px-4">
      <div className="flex max-w-md flex-col items-stretch justify-center gap-4 py-4">
        <img
          width={200}
          height={288.44}
          className="mb-8 self-center"
          src="/moqtail.svg"
          alt="MOQtail Logo"
        />
        <h1 className="self-center text-center text-xl font-bold md:text-3xl">
          MOQ Live Streaming with
          <br />
          AI-Generated Event Timeline
        </h1>
        <Alert variant="destructive" hidden={!isSmall}>
          <MdMobileOff />
          <AlertTitle>Heads up!</AlertTitle>
          <AlertDescription>
            This demo is best experienced on a desktop or laptop due to video playback and layout
            considerations.
          </AlertDescription>
        </Alert>
        <Alert variant="destructive" hidden={checkAPIAvailability()}>
          <MdWarning />
          <AlertTitle>Unsupported Browser</AlertTitle>
          <AlertDescription>
            Your browser does not support all the necessary APIs required for this demo. Please try
            using the latest version of Chrome on desktop.
          </AlertDescription>
        </Alert>
        <Button
          className="basketball-button h-12 cursor-pointer"
          disabled={!checkAPIAvailability()}
          onClick={() => {
            dispatch(actions.setConnectionOptions({ url: 'https://localhost:4433' }));
            navigate('/demo');
          }}
        >
          <div className="relative flex items-center justify-center gap-2">
            <span className="ml-6 font-bold transition-all duration-700">
              {isSmall
                ? "I Understand, Let's Watch Some Basketball!"
                : "Let's Watch Some Basketball!"}
            </span>
          </div>
        </Button>
      </div>
    </div>
  );
}

export default Entry;
