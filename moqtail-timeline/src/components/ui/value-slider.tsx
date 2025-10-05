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

import { useState, useCallback, useEffect } from 'react';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';

interface ValueSliderProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue?: (value: number) => string;
  onValueCommit: (value: number) => void;
  className?: string;
  suffix?: string;
}

function ValueSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  formatValue = val => val.toFixed(2),
  onValueCommit,
  className = 'w-full',
  suffix = '',
}: ValueSliderProps) {
  const [currentValue, setCurrentValue] = useState(value);
  const [isChanging, setIsChanging] = useState(false);

  const handleValueChange = useCallback((values: number[]) => {
    setCurrentValue(values[0]);
    setIsChanging(true);
  }, []);

  const handleValueCommit = useCallback(
    (values: number[]) => {
      const newValue = values[0];
      setCurrentValue(newValue);
      setIsChanging(false);
      onValueCommit(newValue);
    },
    [onValueCommit],
  );

  // Reset current value when external value changes (unless we're actively changing)
  useEffect(() => {
    if (!isChanging) {
      setCurrentValue(value);
    }
  }, [value, isChanging]);

  const displayValue = isChanging ? currentValue : value;

  return (
    <>
      <Label htmlFor={id} className="whitespace-nowrap">
        {label} ({formatValue(displayValue)}
        {suffix})
      </Label>
      <Slider
        id={id}
        value={[currentValue]}
        onValueChange={handleValueChange}
        onValueCommit={handleValueCommit}
        max={max}
        min={min}
        step={step}
        className={className}
      />
    </>
  );
}

export { ValueSlider };
export type { ValueSliderProps };
