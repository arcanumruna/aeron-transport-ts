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
// Port of org/agrona/concurrent/Agent.java @ Agrona 2.6.1
/**
 * An Agent is scheduled to do work on a thread on a duty cycle. Each Agent should have a defined role in a system.
 * <p>
 * {@link Agent.onStart}, {@link Agent.doWork}, and {@link Agent.onClose} will all be called by the same thread and in
 * a threadsafe manner if the agent runs successfully. {@link Agent.onClose} will be called if the agent fails to run.
 * <p>
 * Java's `default` methods `onStart` and `onClose` do nothing. An interface cannot hold a default, so an agent that
 * does not need one implements it as an empty method.
 */
export interface Agent {
    /**
     * To be overridden by Agents that need to do resource init on start.
     * <p>
     * This method will be called by the agent thread once on start.
     */
    onStart(): void;

    /**
     * An agent should implement this method to do its work.
     * <p>
     * The return value is used for implementing a backoff strategy that can be employed when no work is
     * currently available for the agent to process.
     * <p>
     * If the Agent wished to terminate and close then a {@link AgentTerminationException} can be thrown.
     *
     * @return 0 to indicate no work was currently available, a positive value otherwise.
     * @throws Error if an error has occurred.
     */
    doWork(): number;

    /**
     * To be overridden by Agents that need to do resource cleanup on close.
     * <p>
     * This method will be called after the agent thread has terminated or if the agent is closed before it runs.
     */
    onClose(): void;

    /**
     * Get the name of this agent's role.
     *
     * @return the name of this agent's role.
     */
    roleName(): string;
}
