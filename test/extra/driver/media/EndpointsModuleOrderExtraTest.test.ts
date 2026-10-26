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
// Extra test of T13 (port-only): the modules of the endpoints load in any order. `Configuration` creates the default
// endpoint suppliers, which import the endpoints, which extend `UdpChannelTransport`; so the transport must not import
// `Configuration` back, or loading the transport first would find `UdpChannelTransport` still unevaluated when
// `SendChannelEndpoint` extends it. The FIRST import of this file is the transport, and each test file has its own module
// graph, so this is the order that fails if the cycle comes back (mutation: import `Configuration` in UdpChannelTransport).
import { UdpChannelTransport } from '../../../../src/driver/media/UdpChannelTransport.js';
import { describe, expect, it } from 'vitest';
import { Configuration } from '../../../../src/driver/Configuration.js';
import { DataTransportPoller } from '../../../../src/driver/media/DataTransportPoller.js';
import { ReceiveChannelEndpoint } from '../../../../src/driver/media/ReceiveChannelEndpoint.js';
import { SendChannelEndpoint } from '../../../../src/driver/media/SendChannelEndpoint.js';

describe('module order', () => {
    it('loads the transport first, then Configuration, and the endpoints extend the transport', () => {
        expect(Object.getPrototypeOf(SendChannelEndpoint)).toBe(UdpChannelTransport);
        expect(Object.getPrototypeOf(ReceiveChannelEndpoint)).toBe(UdpChannelTransport);
        expect(Configuration.sendChannelEndpointSupplier().constructor.name).toBe('DefaultSendChannelEndpointSupplier');
        expect(Configuration.receiveChannelEndpointSupplier().constructor.name).toBe(
            'DefaultReceiveChannelEndpointSupplier',
        );
        expect(typeof DataTransportPoller).toBe('function');
    });
});
