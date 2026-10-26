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
// Not in Aeron (spec 4.1, D8, D11, D100): the one agent of the event loop runner of an embedded driver.
import type { Agent } from '../agrona/concurrent/Agent.js';
import type { AgentInvoker } from '../agrona/concurrent/AgentInvoker.js';
import { AgentTerminationException } from '../agrona/concurrent/AgentTerminationException.js';

/**
 * The agent that the {@link AgentRunner} of a {@link MediaDriver} runs on the event loop: a composite of the driver's
 * agents (the {@link AgentInvoker} of the driver, which holds Java's {@code CompositeAgent} of sender, receiver, native
 * resource agent and conductor) and of the conductors of the clients that connect to the driver in this process
 * ({@link EmbeddedAgent.host}), each in the {@link AgentInvoker} that started it. One duty cycle runs the driver, then
 * each client, in the order the clients were hosted.
 * <p>
 * Java's {@code DynamicCompositeAgent} is the same idea with a thread safe list; here the list is replaced, never
 * changed, so a client that is hosted or removed during a duty cycle (a callback that closes the client) leaves the
 * cycle in progress with the list it started with. The list changes when a client connects or closes, and a duty
 * cycle allocates nothing.
 * <p>
 * The invokers handle the errors of their agents (the error handler and the error counter, an
 * {@link AgentTerminationException}), as they do when the application steps them, so this agent has none to handle.
 * When the invoker of the driver is closed (the driver was told to terminate), this agent ends the runner.
 */
export class EmbeddedAgent implements Agent {
    private readonly driver: AgentInvoker;
    private hosted: readonly AgentInvoker[] = [];

    public constructor(driver: AgentInvoker) {
        this.driver = driver;
    }

    /**
     * Run the conductor of a client in each duty cycle, after the driver. Does nothing if it is hosted already.
     *
     * @param invoker of the conductor of the client, started.
     */
    public host(invoker: AgentInvoker): void {
        if (!this.hosted.includes(invoker)) {
            this.hosted = [...this.hosted, invoker];
        }
    }

    /**
     * Stop running the conductor of a client. Does nothing if it is not hosted.
     *
     * @param invoker of the conductor of the client.
     */
    public unhost(invoker: AgentInvoker): void {
        if (this.hosted.includes(invoker)) {
            this.hosted = this.hosted.filter((hosted) => hosted !== invoker);
        }
    }

    /**
     * The number of clients that run in this agent.
     */
    public hostedCount(): number {
        return this.hosted.length;
    }

    public onStart(): void {
        // the invoker of the driver was started by MediaDriver.launch, and each client's by Aeron.connect
    }

    public doWork(): number {
        let workCount = this.driver.invoke();

        const hosted = this.hosted;
        for (let i = 0; i < hosted.length; i++) {
            workCount += (hosted[i] as AgentInvoker).invoke();
        }

        if (this.driver.isClosed()) {
            throw new AgentTerminationException(true);
        }

        return workCount;
    }

    public onClose(): void {
        this.hosted = [];
        this.driver.close();
    }

    public roleName(): string {
        return this.driver.agent().roleName();
    }
}
