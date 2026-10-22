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
// Port of io/aeron/AeronCounters.java @ 1.53.3

/**
 * Aeron-reserved counter type ids and the helpers around them.
 * <p>
 * Only the two type ids that `status/HeartbeatTimestamp` and `status/LocalSocketAddressStatus` need are ported so
 * far (see `docs/mapping.md`, "Not ported"); the task that needs the rest adds it, in Java order.
 */
export class AeronCounters {
    private constructor() {}

    /**
     * A counter for tracking the last heartbeat of an entity with a given registration id.
     */
    public static readonly DRIVER_HEARTBEAT_TYPE_ID = 11;

    /**
     * Counter used to store the status of a bind address and port for the local end of a channel.
     * <p>
     * When the value is {@link ChannelEndpointStatus.ACTIVE} then the key value and label will be updated with the
     * socket address and port which is bound.
     */
    public static readonly DRIVER_LOCAL_SOCKET_ADDRESS_STATUS_TYPE_ID = 14;
}
