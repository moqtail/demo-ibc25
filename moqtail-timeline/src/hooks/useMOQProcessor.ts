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

import type { MOQProcessorClass } from '@/lib/moq';

import { useEffect, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import MOQProcessorWorker from '@/lib/moq?worker';
import { CARPCatalog } from '@/lib/carp';
import { useAppSelector } from '@/store/hooks';
import store from '@/store';
import { actions as generalActions } from '@/store/slices/general';
import { actions as playerActions, selectors } from '@/store/slices/player';
import { actions as timelineActions } from '@/store/slices/timeline';

type MOQWrapperCreateReturn = MOQProcessorWrapper &
  Omit<Awaited<Comlink.RemoteObject<MOQProcessorClass>['prototype']>, keyof MOQProcessorWrapper>;

class MOQProcessorWrapper {
  private constructor(private instance: Comlink.Remote<InstanceType<MOQProcessorClass>>) {}

  static create(instance: Comlink.Remote<InstanceType<MOQProcessorClass>>): MOQWrapperCreateReturn {
    const wrapper = new MOQProcessorWrapper(instance);
    return new Proxy(wrapper, {
      get: (target, prop) => {
        switch (prop) {
          case 'init':
            return target.init.bind(target);
          default:
            return Reflect.get(target.instance, prop);
        }
      },
    }) as MOQWrapperCreateReturn;
  }

  async init() {
    // Initialize the instance
    const { object } = await this.instance.init(
      Comlink.proxy(async () => {
        store.dispatch(playerActions.clearVideos());
        store.dispatch(timelineActions.clearEvents());
        store.dispatch(generalActions.setConnectionError(true));
      }),
    );
    return CARPCatalog.from(object);
  }
}

class MOQProcessor {
  private static klass: Comlink.Remote<MOQProcessorClass> | null = null;
  private static instance: MOQWrapperCreateReturn | null = null;
  private static ready: Promise<Comlink.Remote<InstanceType<MOQProcessorClass>>> | null = null;
  private static refCount = 0;

  private constructor() {
    MOQProcessor.refCount++;
  }

  static async dispose() {
    this.refCount--;
    this.ready?.finally(async () => {
      if (this.refCount <= 0 && this.klass) {
        await this.instance?.close();
        this.klass[Comlink.releaseProxy]();
        this.klass = null;
        this.instance = null;
      }
    });
  }

  public async getInstance() {
    await MOQProcessor.ready;
    return MOQProcessor.instance;
  }

  static async create(...args: ConstructorParameters<MOQProcessorClass>) {
    const processor = new MOQProcessor();
    if (!this.klass) {
      const worker = new MOQProcessorWorker();
      this.klass = Comlink.wrap<MOQProcessorClass>(worker);

      // Construct the instance
      this.ready = new this.klass(...args);
      this.ready
        .then(instance => {
          this.instance = MOQProcessorWrapper.create(instance);
        })
        .catch(err => {
          console.error('Error creating MOQProcessor instance:', err);
        });
    }
    return processor;
  }
}

export function useMOQProcessor() {
  const mp = useRef<MOQWrapperCreateReturn | null>(null);
  const relayUrl = useAppSelector(selectors.getRelayUrl, () => true /* disable state changes */);
  const [initialized, setInitialized] = useState<boolean>(false);

  useEffect(() => {
    const ac = new AbortController();
    const init = async () => {
      const processor = await MOQProcessor.create(relayUrl);
      const instance = await processor.getInstance();
      if (ac.signal.aborted) return;
      mp.current = instance;
      setInitialized(true);
    };

    init();
    return () => {
      ac.abort();
      MOQProcessor.dispose();
    };
  }, []);

  return { initialized, mp: mp.current };
}
