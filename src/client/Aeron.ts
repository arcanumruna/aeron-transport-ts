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
// Port of io/aeron/Aeron.java @ 1.53.3

/**
 * Aeron entry point for communicating to the Media Driver for creating Publications and Subscriptions.
 * <p>
 * Only the static constants are ported so far (see `docs/mapping.md`, "Not ported"); phase 2 adds the rest, in Java
 * order.
 */
export class Aeron {
    /**
     * Used to represent a null value for when some value is not yet set.
     */
    public static readonly NULL_VALUE: number = -1;
}
