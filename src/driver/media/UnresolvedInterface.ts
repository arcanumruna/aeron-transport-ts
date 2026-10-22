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
// Port of io/aeron/driver/media/UnresolvedInterface.java @ 1.53.3
import { IllegalArgumentException } from '../../agrona/jdk.js';
import { Strings } from '../../agrona/Strings.js';
import type { ProtocolFamily } from '../jdkNet.js';
import { InterfaceSearchAddress } from './InterfaceSearchAddress.js';
import { NamedInterface } from './NamedInterface.js';
import type { ResolvedInterface } from './ResolvedInterface.js';

/**
 * Interface specification as found, for example, in the {@code interface=} channel parameter. Java's sealed interface
 * permits {@link InterfaceSearchAddress} and {@link NamedInterface}.
 */
export interface UnresolvedInterface {
    /** @throws SocketException */
    resolve(multicast: boolean, protocolFamily: ProtocolFamily): ResolvedInterface;
}

/**
 * The static method of the Java interface: `UnresolvedInterface.parse(String)`. The type and the value share a name.
 */
export const UnresolvedInterface = {
    /** @throws UnknownHostException */
    parse(str: string | null): UnresolvedInterface {
        if (Strings.isEmpty(str)) {
            throw new IllegalArgumentException('interface is null or empty');
        }

        if (str.charAt(0) === NamedInterface.OPENING_CHAR) {
            return NamedInterface.parse(str);
        } else {
            return InterfaceSearchAddress.parse(str);
        }
    },
} as const;
