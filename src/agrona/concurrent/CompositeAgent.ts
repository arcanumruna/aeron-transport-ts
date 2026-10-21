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
// Port of org/agrona/concurrent/CompositeAgent.java @ Agrona 2.6.1
import { IllegalArgumentException, RuntimeException } from '../jdk.js';
import { requireNonNull } from '../jdkLang.js';
import type { Agent } from './Agent.js';

/**
 * Group several {@link Agent}s into one composite, so they can be scheduled as a unit.
 * <p>
 * Runs the sub-agents in the order they were given. If one of them throws from {@link CompositeAgent.doWork}, the
 * exception propagates and the next call carries on with the sub-agent after it.
 * <p>
 * <b>Note:</b> Java's two constructors, one over a {@code List} and one over varargs, are one: pass the agents, or a
 * single array.
 */
export class CompositeAgent implements Agent {
    private readonly agents: Agent[];
    private readonly _roleName: string;
    private agentIndex = 0;

    /**
     * @param agents the parts of this agent, as an array.
     * @throws IllegalArgumentException if the array is empty.
     */
    public constructor(agents: readonly Agent[]);

    /**
     * @param agents the parts of this agent.
     * @throws IllegalArgumentException if the list is empty.
     */
    public constructor(...agents: Agent[]);

    public constructor(...args: (Agent | readonly Agent[])[]) {
        const agents: readonly Agent[] = 1 === args.length && Array.isArray(args[0]) ? args[0] : (args as Agent[]);

        if (0 === agents.length) {
            throw new IllegalArgumentException('requires at least one sub-agent');
        }

        this.agents = new Array<Agent>(agents.length);
        let roleName = '[';

        let i = 0;
        for (const agent of agents) {
            requireNonNull(agent, 'agent cannot be null');
            roleName += agent.roleName() + ',';
            this.agents[i++] = agent;
        }

        this._roleName = roleName.slice(0, -1) + ']';
    }

    public roleName(): string {
        return this._roleName;
    }

    public onStart(): void {
        let ce: RuntimeException | null = null;
        for (const agent of this.agents) {
            try {
                agent.onStart();
            } catch (ex) {
                if (null === ce) {
                    ce = new RuntimeException(this.constructor.name + ': underlying agent error on start');
                }
                ce.addSuppressed(ex as Error);
            }
        }

        if (null !== ce) {
            throw ce;
        }
    }

    public doWork(): number {
        let workCount = 0;

        const agents = this.agents;
        while (this.agentIndex < agents.length) {
            const agent = agents[this.agentIndex++]!;
            workCount += agent.doWork();
        }

        this.agentIndex = 0;

        return workCount;
    }

    public onClose(): void {
        let ce: RuntimeException | null = null;
        for (const agent of this.agents) {
            try {
                agent.onClose();
            } catch (ex) {
                if (null === ce) {
                    ce = new RuntimeException(this.constructor.name + ': underlying agent error on close');
                }
                ce.addSuppressed(ex as Error);
            }
        }

        if (null !== ce) {
            throw ce;
        }
    }
}
