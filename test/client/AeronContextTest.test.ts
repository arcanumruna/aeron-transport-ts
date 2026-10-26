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
// Port of io/aeron/AeronContextTest.java @ 1.53.3
import { describe, expect, it } from 'vitest';
import { AgentInvoker } from '../../src/agrona/concurrent/AgentInvoker.js';
import { Aeron } from '../../src/client/Aeron.js';
import { ConfigurationException } from '../../src/client/exceptions/ConfigurationException.js';
import { assertThrowsExactly } from '../support/Assertions.js';
import { mock } from '../support/Mockito.js';

describe('AeronContextTest', () => {
    // @NullAndEmptySource
    it.each([null, ''])('shouldUseEmptyStringIfNameIsEmpty %j', (name) => {
        const context = new Aeron.Context();
        expect(context.clientName()).toBe('');

        context.clientName(name);
        expect(context.clientName()).toBe('');
    });

    it.each(['a', 'gdajsdgajsd', '7326482374hdfy7dsyf8dyf9sd.-)'])('shouldAssignClientName %s', (clientName) => {
        const context = new Aeron.Context();

        context.clientName(clientName);
        expect(context.clientName()).toBe(clientName);
    });

    it('shouldRejectClientNameThatIsTooLong', () => {
        const name =
            'this is a very long value that we are hoping with be reject when the value gets ' +
            'set on the the context without causing issues will labels';
        const context = new Aeron.Context().clientName(name);

        const exception = assertThrowsExactly(ConfigurationException, () => context.conclude());
        expect(exception.message).toBe('ERROR - clientName length must <= 100');
    });

    it('shouldRequireRunningInTheInvokerModeIfDriverInvokerIsSpecified', () => {
        const driverAgentInvoker = mock(AgentInvoker).mock;
        const context = new Aeron.Context().useConductorAgentInvoker(false).driverAgentInvoker(driverAgentInvoker);

        const exception = assertThrowsExactly(ConfigurationException, () => context.conclude());
        expect(exception.message).toBe(
            'ERROR - Must use Aeron.Context.useConductorAgentInvoker(true) when ' +
                'Aeron.Context.driverAgentInvoker() is set',
        );
    });
});
