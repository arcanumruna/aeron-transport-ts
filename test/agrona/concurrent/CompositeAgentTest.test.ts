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
// Port of org/agrona/concurrent/CompositeAgentTest.java @ Agrona 2.6.1
import { beforeEach, describe, expect, it } from 'vitest';
import type { Agent } from '../../../src/agrona/concurrent/Agent.js';
import { CompositeAgent } from '../../../src/agrona/concurrent/CompositeAgent.js';
import { IllegalArgumentException, NullPointerException, RuntimeException } from '../../../src/agrona/jdk.js';
import { assertThrows } from '../../support/Assertions.js';
import { mockAgent as createMockAgent } from '../../support/MockAgent.js';
import type { MockAgent } from '../../support/MockAgent.js';

class AgentException extends RuntimeException {
    public readonly index: number;

    public constructor(index: number) {
        super();
        this.index = index;
    }
}

describe('CompositeAgentTest', () => {
    let agents: MockAgent[];

    beforeEach(() => {
        agents = [createMockAgent(), createMockAgent(), createMockAgent()];
    });

    it('shouldNotAcceptEmptyList', () => {
        assertThrows(IllegalArgumentException, () => new CompositeAgent());
    });

    it('shouldNotAcceptNullAgents', () => {
        assertThrows(NullPointerException, () => new CompositeAgent(agents[0]!, null as unknown as Agent, agents[1]!));
    });

    it('shouldApplyLifecycleToAll', () => {
        const compositeAgent = new CompositeAgent(agents[0]!, agents[1]!, agents[2]!);

        compositeAgent.onStart();
        for (const agent of agents) {
            expect(agent.onStart).toHaveBeenCalledTimes(1);
        }

        compositeAgent.doWork();
        for (const agent of agents) {
            expect(agent.doWork).toHaveBeenCalledTimes(1);
        }

        compositeAgent.onClose();
        for (const agent of agents) {
            expect(agent.onClose).toHaveBeenCalledTimes(1);
        }
    });

    it('shouldApplyLifecycleToAllDespiteExceptions', () => {
        const compositeAgent = new CompositeAgent(agents[0]!, agents[1]!, agents[2]!);

        for (let i = 0; i < agents.length; i++) {
            const index = i;
            const agent = agents[index]!;
            agent.onStart.mockImplementation(() => {
                throw new AgentException(index);
            });
        }

        try {
            compositeAgent.onStart();
        } catch (e) {
            for (const suppressed of (e as RuntimeException).getSuppressed()) {
                expect(suppressed instanceof AgentException).toBe(true);
            }
        }

        for (const agent of agents) {
            expect(agent.onStart).toHaveBeenCalledTimes(1);
        }

        for (let i = 0; i < agents.length; i++) {
            const index = i;
            const agent = agents[index]!;
            agent.doWork.mockImplementation(() => {
                throw new AgentException(index);
            });
        }

        for (let i = 0; i < agents.length; i++) {
            try {
                compositeAgent.doWork();
            } catch (e) {
                expect((e as AgentException).index).toBe(i);
            }
        }

        for (const agent of agents) {
            expect(agent.doWork).toHaveBeenCalledTimes(1);
        }

        for (let i = 0; i < agents.length; i++) {
            const index = i;
            const agent = agents[index]!;
            agent.onClose.mockImplementation(() => {
                throw new AgentException(index);
            });
        }

        try {
            compositeAgent.onClose();
        } catch (e) {
            for (const suppressed of (e as RuntimeException).getSuppressed()) {
                expect(suppressed instanceof AgentException).toBe(true);
            }
        }

        for (const agent of agents) {
            expect(agent.onClose).toHaveBeenCalledTimes(1);
        }
    });
});
