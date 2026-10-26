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
// Port of org/agrona/nio/TransportPoller.java @ Agrona 2.6.1
import { Integer } from '../jdk.js';
import type { AutoCloseable } from '../jdkLang.js';

/**
 * Implements the common functionality for a transport poller.
 * <p>
 * Node has no selector (spec 4.2): a datagram socket pushes what it receives into the ring of its transport, and a
 * poller visits every transport in turn, so Java's `Selector` is the list of registered transports, which the
 * subclass fills. `T` is the type of an entry (for the data poller, a channel endpoint with its transport).
 */
export class TransportPoller<T = unknown> implements AutoCloseable {
    /**
     * System property name for the threshold beyond which individual channel/socket polling will swap to using
     * a selector. Kept for the configuration surface; with no selector the transports are always visited in turn.
     */
    public static readonly ITERATION_THRESHOLD_PROP_NAME = 'org.agrona.transport.iteration.threshold';

    /**
     * Default threshold beyond which individual channel/socket polling will swap to using a selector.
     */
    public static readonly ITERATION_THRESHOLD_DEFAULT = 5;

    /**
     * Threshold beyond which individual channel/socket polling will swap to using a selector.
     *
     * @see ITERATION_THRESHOLD_PROP_NAME
     * @see ITERATION_THRESHOLD_DEFAULT
     */
    public static readonly ITERATION_THRESHOLD: number = Integer.getInteger(
        TransportPoller.ITERATION_THRESHOLD_PROP_NAME,
        TransportPoller.ITERATION_THRESHOLD_DEFAULT,
    );

    /**
     * The registered transports, in registration order. This is what Java's `Selector` holds as registered keys.
     */
    protected readonly transports: T[] = [];

    /**
     * Default constructor.
     */
    public constructor() {}

    /**
     * Close the poller down. Returns immediately. The registered transports are forgotten, not closed (a selector
     * does not close its channels).
     */
    public close(): void {
        this.transports.length = 0;
    }

    /**
     * Java's explicit call to `Selector.selectNow()` followed by clearing out the set without processing. There is
     * no selector and no selected-key set to clear, so it does nothing.
     */
    public selectNowWithoutProcessing(): void {}
}
