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
// Port of io/aeron/driver/media/ImageConnection.java @ 1.53.3
import { Long } from '../../agrona/jdk.js';
import type { InetSocketAddress } from '../jdkNet.js';

/**
 * State tracking for a connection endpoint to an image from transport.
 * <p>
 * Java pads the hot fields against false sharing; a JS object has no field layout to control (spec D11, D19), so the
 * padding classes are not ported.
 */
export class ImageConnection {
    /**
     * Time of the last observed activity on this connection for tracking liveness.
     */
    public timeOfLastActivityNs: number = 0;

    /**
     * Time of the last observed from the source.
     */
    public timeOfLastFrameNs = 0;

    /**
     * End of the stream position.
     */
    public eosPosition: number = Long.MAX_VALUE;

    /**
     * Was the end of the stream from source observed?
     */
    public isEos = false;

    /**
     * Control address for the source.
     */
    public readonly controlAddress: InetSocketAddress;

    /**
     * Construct a representation of a connection to an image.
     *
     * @param timeOfLastActivityNs seen on this image.
     * @param controlAddress       for the source of the image.
     */
    public constructor(timeOfLastActivityNs: number, controlAddress: InetSocketAddress) {
        this.controlAddress = controlAddress;
        this.timeOfLastActivityNs = timeOfLastActivityNs;
    }
}
