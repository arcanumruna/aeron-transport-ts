/*
 * Copyright 2014-2025 Real Logic Limited.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Modified: ported to TypeScript for aeron-transport-ts.
 */
// Port of io/aeron/exceptions/AeronEvent.java @ 1.53.3
import { AeronException, type Category } from './AeronException.js';

/**
 * A means to capture an event of significance that does not require a stack trace, so it can be lighter-weight
 * and take up less space in a {@link DistinctErrorLog}.
 * <p>
 * Java overrides `fillInStackTrace` and `getStackTrace` to hold no frames; here `stack` is `undefined`, which
 * `jdkThrowable.ts` prints as an error with no frames (spec D18).
 */
export class AeronEvent extends AeronException {
    /**
     * Aeron event with provided message and {@link Category.WARN}, or with the message and the {@link Category}.
     *
     * @param message  to detail the event.
     * @param category of the event, {@link AeronException.Category.WARN} by default.
     */
    public constructor(message: string, category: Category = AeronException.Category.WARN) {
        super(message, null, false, false, category);
        this.stack = undefined;
    }
}
