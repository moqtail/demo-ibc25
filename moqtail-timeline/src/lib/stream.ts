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

export class BroadcastStream<T> extends TransformStream<T> {
  #outputs = new Set<WritableStreamDefaultWriter<T>>();

  constructor() {
    super({
      transform: async (chunk, controller) => {
        controller.enqueue(chunk);
        await Promise.all(
          Array.from(this.#outputs).map(async output => {
            try {
              await output.write(chunk);
            } catch (err) {
              console.error('Error writing to output stream:', err);
              this.#outputs.delete(output);
            }
          }),
        );
      },
      flush: () => this.#outputs.forEach(output => output.close()),
    });
  }

  addOutput(sink: WritableStream<T>) {
    const writer = sink.getWriter();
    this.#outputs.add(writer);
    writer.closed.then(() => this.#outputs.delete(writer));
  }
}
