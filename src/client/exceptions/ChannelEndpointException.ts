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
// Port of io/aeron/exceptions/ChannelEndpointException.java @ 1.53.3
import { AeronException } from './AeronException.js';

/**
 * Exception raised when a channel endpoint has an error: the status indicator of the endpoint says which.
 */
export class ChannelEndpointException extends AeronException {
    private readonly _statusIndicatorId: number = 0;

    /**
     * Construct an exception for a channel endpoint.
     *
     * @param statusIndicatorId of the channel endpoint.
     * @param message           detail for the error.
     */
    public constructor(statusIndicatorId: number, message: string) {
        super(message);
        this._statusIndicatorId = statusIndicatorId;
    }

    /**
     * Get the id of the status indicator of the channel endpoint.
     *
     * @return the id of the status indicator of the channel endpoint.
     */
    public statusIndicatorId(): number {
        return this._statusIndicatorId;
    }
}
