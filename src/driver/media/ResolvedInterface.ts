/*
 * Copyright 2025 Adaptive Financial Consulting Limited.
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
// Port of io/aeron/driver/media/ResolvedInterface.java @ 1.53.3
import { requireNonNull } from '../../agrona/jdkLang.js';
import type { InetSocketAddress, NetworkInterface } from '../jdkNet.js';

/**
 * Java's `record ResolvedInterface(NetworkInterface localInterface, InetSocketAddress address)`: two read-only fields,
 * the compact constructor's null check, and the accessors `localInterface` and `address` as the fields.
 */
export class ResolvedInterface {
    public readonly localInterface: NetworkInterface | null;
    public readonly address: InetSocketAddress;

    public constructor(localInterface: NetworkInterface | null, address: InetSocketAddress) {
        requireNonNull(address, 'address must not be null');
        this.localInterface = localInterface;
        this.address = address;
    }
}
