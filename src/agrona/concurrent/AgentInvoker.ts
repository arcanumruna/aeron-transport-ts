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
// Port of org/agrona/concurrent/AgentInvoker.java @ Agrona 2.6.1
import type { ErrorHandler } from '../ErrorHandler.js';
import { ClosedByInterruptException, InterruptedException, JavaError, requireNonNull, Thread } from '../jdkLang.js';
import type { AutoCloseable } from '../jdkLang.js';
import type { Agent } from './Agent.js';
import { AgentTerminationException } from './AgentTerminationException.js';
import type { AtomicCounter } from './status/AtomicCounter.js';

/**
 * {@link Agent} container which does not start a thread. It instead allows the duty cycle {@link Agent.doWork} to be
 * invoked directly. {@link AgentInvoker.start} should be called to allow the {@link Agent.onStart} to fire before any
 * calls to {@link AgentInvoker.invoke} of the agent duty cycle.
 * <p>
 * Exceptions which occur during the {@link Agent.doWork} invocation will be caught and passed to the provided
 * {@link ErrorHandler}.
 * <p>
 * <b>Note:</b> This class is not threadsafe.
 */
export class AgentInvoker implements AutoCloseable {
    private _isClosed = false;
    private _isStarted = false;
    private _isRunning = false;

    private readonly errorCounter: AtomicCounter | null;
    private readonly errorHandler: ErrorHandler;
    private readonly _agent: Agent;

    /**
     * Create an agent and initialise it.
     *
     * @param errorHandler to be called if an {@link Error} is encountered
     * @param errorCounter to be incremented each time an exception is encountered. This may be null.
     * @param agent        to be run in this thread.
     */
    public constructor(errorHandler: ErrorHandler, errorCounter: AtomicCounter | null, agent: Agent) {
        requireNonNull(errorHandler, 'errorHandler');
        requireNonNull(agent, 'agent');

        this.errorHandler = errorHandler;
        this.errorCounter = errorCounter;
        this._agent = agent;
    }

    /**
     * Has the {@link Agent} been started?
     *
     * @return has the {@link Agent} been started?
     */
    public isStarted(): boolean {
        return this._isStarted;
    }

    /**
     * Has the {@link Agent} been running?
     *
     * @return has the {@link Agent} been started successfully and not closed?
     */
    public isRunning(): boolean {
        return this._isRunning;
    }

    /**
     * Has the {@link Agent} been closed?
     *
     * @return has the {@link Agent} been closed?
     */
    public isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * The {@link Agent} which is contained.
     *
     * @return {@link Agent} being contained.
     */
    public agent(): Agent {
        return this._agent;
    }

    /**
     * Mark the invoker as started and call the {@link Agent.onStart} method.
     * <p>
     * Startup logic will only be performed once.
     */
    public start(): void {
        try {
            if (!this._isStarted) {
                this._isStarted = true;
                this._agent.onStart();
                this._isRunning = true;
            }
        } catch (t) {
            this.errorHandler.onError(t as Error);
            if (t instanceof JavaError) {
                throw t;
            }

            this.close();
        }
    }

    /**
     * Invoke the {@link Agent.doWork} method and return the work count.
     * <p>
     * If an error occurs then the {@link AtomicCounter.increment} will be called on the errorCounter if not null
     * and the {@link Error} will be passed to the {@link ErrorHandler.onError} method. If the error
     * is an {@link AgentTerminationException} then {@link AgentInvoker.close} will be called after the error handler.
     * <p>
     * If not successfully started or after closed then this method will return without invoking the {@link Agent}.
     *
     * @return the work count for the {@link Agent.doWork} method.
     */
    public invoke(): number {
        let workCount = 0;
        if (this._isRunning) {
            try {
                workCount = this._agent.doWork();
                if (workCount <= 0 && Thread.currentThread().isInterrupted()) {
                    this._isRunning = false;
                }
            } catch (t) {
                if (t instanceof InterruptedException || t instanceof ClosedByInterruptException) {
                    this.close();
                    Thread.currentThread().interrupt();
                } else if (t instanceof AgentTerminationException) {
                    this._isRunning = false;
                    if (!t.isExpected()) {
                        this.handleError(t);
                    }
                    this.close();
                } else {
                    const isInterrupted = Thread.currentThread().isInterrupted();
                    if (isInterrupted) {
                        this._isRunning = false;
                    }

                    this.handleError(t as Error);
                    if (t instanceof JavaError) {
                        throw t;
                    }

                    if (isInterrupted || Thread.currentThread().isInterrupted()) {
                        this._isRunning = false;
                        this.close();
                    }
                }
            }
        }

        return workCount;
    }

    /**
     * Mark the invoker as closed and call the {@link Agent.onClose} logic for clean up.
     * <p>
     * The cleanup logic will only be performed once.
     */
    public close(): void {
        try {
            if (!this._isClosed) {
                this._isRunning = false;
                this._isClosed = true;
                this._agent.onClose();
            }
        } catch (t) {
            this.errorHandler.onError(t as Error);
            if (t instanceof JavaError) {
                throw t;
            }
        }
    }

    private handleError(throwable: Error): void {
        if (null !== this.errorCounter && this._isRunning && !this.errorCounter.isClosed()) {
            this.errorCounter.increment();
        }

        this.errorHandler.onError(throwable);
    }
}
