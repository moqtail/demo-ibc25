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

import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function secondToTimecode(seconds: number) {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const pad = (n: number) => n.toString().padStart(2, '0');

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

export function ntptoms(ntpTimestamp?: number) {
  if (!ntpTimestamp) return NaN;

  const ntpEpochOffset = 2208988800000; // milliseconds between 1970 and 1900

  // Split the 64-bit NTP timestamp into upper and lower 32-bit parts
  const upperPart = Math.floor(ntpTimestamp / Math.pow(2, 32));
  const lowerPart = ntpTimestamp % Math.pow(2, 32);

  // Calculate milliseconds for upper and lower parts
  const upperMilliseconds = upperPart * 1000;
  const lowerMilliseconds = (lowerPart / Math.pow(2, 32)) * 1000;

  // Combine both parts and adjust for the NTP epoch offset
  return upperMilliseconds + lowerMilliseconds - ntpEpochOffset;
}
