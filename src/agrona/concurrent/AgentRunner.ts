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
// Port of org/agrona/concurrent/AgentRunner.java @ Agrona 2.6.1
import type { ErrorHandler } from '../ErrorHandler.js';
import { ClosedByInterruptException, InterruptedException, JavaError, requireNonNull, Thread } from '../jdkLang.js';
import type { AutoCloseable } from '../jdkLang.js';
import type { Agent } from './Agent.js';
import { AgentTerminationException } from './AgentTerminationException.js';
import type { IdleStrategy } from './IdleStrategy.js';
import type { AtomicCounter } from './status/AtomicCounter.js';

/**
 * Not in Java. How the runner gets its next duty cycle onto the Node event loop (spec 4.1, D3, D11). A runner has no
 * thread of its own: it runs one duty cycle per call of a task it hands to {@link AgentRunnerScheduler.setImmediate}
 * (the yield, and the way a busy agent keeps going while I/O gets its turn) or to
 * {@link AgentRunnerScheduler.setTimeout} (an {@link IdleStrategy} park). Tests pass a scheduler that they drive, so
 * nothing waits on wall time.
 */
export interface AgentRunnerScheduler {
    /**
     * Run the task soon, after the pending I/O events.
     */
    setImmediate(task: () => void): void;

    /**
     * Run the task after at least {@code delayMs} milliseconds.
     *
     * @return a handle for {@link AgentRunnerScheduler.clearTimeout}.
     */
    setTimeout(task: () => void, delayMs: number): unknown;

    /**
     * Cancel a timer.
     */
    clearTimeout(handle: unknown): void;
}

/**
 * The scheduler of the Node event loop.
 */
export const NODE_SCHEDULER: AgentRunnerScheduler = {
    setImmediate(task: () => void): void {
        setImmediate(task);
    },

    setTimeout(task: () => void, delayMs: number): unknown {
        return setTimeout(task, delayMs);
    },

    clearTimeout(handle: unknown): void {
        clearTimeout(handle as NodeJS.Timeout);
    },
};

/**
 * Agent runner containing an {@link Agent} which is run on the event loop.
 * <p>
 * Java runs the agent on a {@link Thread}. There is one JS thread, so the runner is an <i>event loop task</i>
 * instead (spec D3): {@link AgentRunner.run} starts the agent and returns, and each duty cycle is a call of a task
 * that the runner schedules for itself. The "thread" of the runner is a logical {@link Thread} with an interrupt flag
 * and an alive flag, which {@link Thread.currentThread} reports while a duty cycle runs, so the interrupt handling of
 * the Java loop is kept. Because a duty cycle cannot be pre-empted, {@link AgentRunner.close} called from outside the
 * agent stops the loop at once, where Java waits for the thread (and interrupts it after a timeout).
 * <p>
 * <b>Note:</b> An instance should only be started once and then discarded, it should not be reused.
 */
export class AgentRunner implements AutoCloseable {
    /**
     * Indicates that the runner is being closed.
     */
    public static readonly TOMBSTONE: Thread = new Thread('tombstone');

    /**
     * Default retry timeout for closing.
     */
    public static readonly RETRY_CLOSE_TIMEOUT_MS = 5000;

    private _isRunning = true;
    private _isClosed = false;

    private readonly errorCounter: AtomicCounter | null;
    private readonly errorHandler: ErrorHandler;
    private readonly idleStrategy: IdleStrategy;
    private readonly _agent: Agent;
    private readonly scheduler: AgentRunnerScheduler;
    private _thread: Thread | null = null;

    private runnerThread: Thread | null = null;
    private isInAgent = false;
    private idleNs = 0;
    private hasTimer = false;
    private timerHandle: unknown = null;

    // One function each for the life of the runner, so scheduling a duty cycle creates no closure.
    private readonly onImmediate = (): void => {
        this.dutyCycle();
    };

    private readonly onTimer = (): void => {
        this.hasTimer = false;
        this.timerHandle = null;
        this.dutyCycle();
    };

    /**
     * Create an agent runner and initialise it.
     *
     * @param idleStrategy to use for Agent run loop
     * @param errorHandler to be called if an {@link Error} is encountered
     * @param errorCounter to be incremented each time an exception is encountered. This may be null.
     * @param agent        to be run in this thread.
     * @param scheduler    that runs the duty cycles; the Node event loop if omitted.
     */
    public constructor(
        idleStrategy: IdleStrategy,
        errorHandler: ErrorHandler,
        errorCounter: AtomicCounter | null,
        agent: Agent,
        scheduler: AgentRunnerScheduler = NODE_SCHEDULER,
    ) {
        requireNonNull(idleStrategy, 'idleStrategy');
        requireNonNull(errorHandler, 'errorHandler');
        requireNonNull(agent, 'agent');

        this.idleStrategy = idleStrategy;
        this.errorHandler = errorHandler;
        this.errorCounter = errorCounter;
        this._agent = agent;
        this.scheduler = scheduler;
    }

    /**
     * Start the given agent runner on the event loop. The Java overload that takes a {@code ThreadFactory} is not
     * ported.
     *
     * @param runner the agent runner to start.
     * @return the logical thread that has been started.
     */
    public static startOnThread(runner: AgentRunner): Thread {
        runner.run();
        return runner.thread() ?? AgentRunner.TOMBSTONE;
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
     * Has the {@link Agent} been closed?
     *
     * @return has the {@link Agent} been closed?
     */
    public isClosed(): boolean {
        return this._isClosed;
    }

    /**
     * Get the thread which is running that {@link Agent}.
     * <p>
     * If null then the runner has not been started. If {@link AgentRunner.TOMBSTONE} then the runner is being closed.
     *
     * @return the thread running the {@link Agent}.
     */
    public thread(): Thread | null {
        return this._thread;
    }

    /**
     * Run an {@link Agent}.
     * <p>
     * This method calls {@link Agent.onStart} and returns. The duty cycles then run from the event loop until the
     * runner is stopped via {@link AgentRunner.close}, the agent throws an {@link AgentTerminationException} or the
     * thread is interrupted, and {@link Agent.onClose} is called when the loop ends.
     */
    public run(): void {
        if (null === this._thread) {
            const thread = new Thread(this._agent.roleName(), true);
            this._thread = thread;
            this.runnerThread = thread;

            const previous = Thread.switchTo(thread);
            this.isInAgent = true;
            let failed = true;
            try {
                try {
                    this._agent.onStart();
                } catch (t) {
                    this._isRunning = false;
                    this.errorHandler.onError(t as Error);
                    if (t instanceof JavaError) {
                        throw t;
                    }
                }
                failed = false;
            } finally {
                this.isInAgent = false;
                Thread.switchTo(previous);
                if (failed) {
                    this.die();
                }
            }

            if (this._isRunning) {
                this.scheduleNext(0);
            } else {
                this.terminate();
            }
        }
    }

    /**
     * Stop the running Agent and cleanup.
     * <p>
     * This is equivalent to calling {@link AgentRunner.close} using the default
     * {@link AgentRunner.RETRY_CLOSE_TIMEOUT_MS} value and a {@code null} action.
     * <p>
     * If the agent has not been run then it is closed without running. If it is running, it is stopped and its
     * {@link Agent.onClose} has been called when this returns: a duty cycle cannot be in progress, as this is
     * running on the only thread. When called from inside the agent's own duty cycle, the cycle finishes and the loop
     * ends after it.
     * <p>
     * <em><strong>NOTE:</strong> if the caller thread is interrupted while invoking this method then the agent thread
     * is interrupted as well, the fail action is called with it and the interrupt is restored on the caller.
     * </em>
     * <p>
     * An optional action is invoked when the close of a running agent was interrupted. It accepts the agent runner
     * thread as the parameter (e.g. to log it). If the action is {@code null}, a message is written to
     * {@code stderr}. The timeout of Java's {@code Thread.join} cannot expire here and is accepted for compatibility.
     *
     * @param retryCloseTimeoutMs timeout in milliseconds that defines how long to wait before interrupting the agent
     *                            thread.
     * @param closeFailAction     function to invoke before retrying after close timeout.
     */
    public close(
        _retryCloseTimeoutMs: number = AgentRunner.RETRY_CLOSE_TIMEOUT_MS,
        closeFailAction: ((thread: Thread) => void) | null = null,
    ): void {
        if (this._isClosed) {
            return;
        }

        this._isRunning = false;

        const thread = this._thread;
        this._thread = AgentRunner.TOMBSTONE;
        if (null === thread) {
            try {
                this._agent.onClose();
            } catch (t) {
                this.errorHandler.onError(t as Error);
                if (t instanceof JavaError) {
                    throw t;
                }
            } finally {
                this._isClosed = true;
            }
        } else if (AgentRunner.TOMBSTONE !== thread) {
            if (this.isInAgent) {
                // Called from the agent itself: the cycle in progress ends the loop and calls onClose
                return;
            }

            // Thread.join would throw InterruptedException, clearing the flag, if this thread were interrupted
            const wasInterrupted = Thread.interrupted();
            if (wasInterrupted) {
                this.failAction(closeFailAction, thread, 'close interrupted');
                thread.interrupt();
            }

            // the join: the loop ends now, as it would after the thread saw isRunning == false
            this.terminate();

            if (wasInterrupted) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * Not in Java. Ask for the next duty cycle now if the runner is waiting on an idle strategy's park timer. A
     * datagram arriving, a send completing or a client call (spec D8) calls this, so that I/O does not wait for the
     * park to end. It schedules at most one {@code setImmediate}, and does nothing if the runner is not parked.
     */
    public wake(): void {
        if (this.hasTimer) {
            this.scheduler.clearTimeout(this.timerHandle);
            this.hasTimer = false;
            this.timerHandle = null;
            this.scheduleNext(0);
        }
    }

    private failAction(closeFailAction: ((thread: Thread) => void) | null, thread: Thread, message: string): void {
        if (null === closeFailAction) {
            console.error(this._agent.roleName() + ' failed to close due to ' + message + ', retrying...');
        } else {
            closeFailAction(thread);
        }
    }

    /**
     * One turn of Java's {@code workLoop}: the {@code while (isRunning)} test, then one duty cycle.
     */
    private dutyCycle(): void {
        if (this._isClosed) {
            return;
        }

        if (!this._isRunning) {
            this.terminate();
            return;
        }

        const previous = Thread.switchTo(this.runnerThread!);
        this.isInAgent = true;
        this.idleNs = 0;
        let failed = true;
        try {
            this.doWork(this.idleStrategy, this._agent);
            failed = false;
        } finally {
            this.isInAgent = false;
            Thread.switchTo(previous);
            if (failed) {
                // an Error was rethrown: the thread ends without calling onClose
                this.die();
            }
        }

        if (this._isRunning) {
            this.scheduleNext(this.idleNs);
        } else {
            this.terminate();
        }
    }

    private scheduleNext(delayNs: number): void {
        if (delayNs > 0) {
            this.hasTimer = true;
            this.timerHandle = this.scheduler.setTimeout(this.onTimer, Math.max(1, Math.ceil(delayNs / 1_000_000)));
        } else {
            this.scheduler.setImmediate(this.onImmediate);
        }
    }

    /**
     * The end of Java's {@code run}: {@link Agent.onClose} on the runner's thread, then the runner is closed.
     */
    private terminate(): void {
        const previous = Thread.switchTo(this.runnerThread!);
        this.isInAgent = true;
        try {
            this._agent.onClose();
        } catch (t) {
            this.errorHandler.onError(t as Error);
            if (t instanceof JavaError) {
                throw t;
            }
        } finally {
            this.isInAgent = false;
            Thread.switchTo(previous);
            this.die();
        }
    }

    /**
     * The {@code finally} of Java's {@code run}: the runner is closed and its thread is dead.
     */
    private die(): void {
        if (this.hasTimer) {
            this.scheduler.clearTimeout(this.timerHandle);
            this.hasTimer = false;
            this.timerHandle = null;
        }

        this._isClosed = true;
        this.runnerThread!.setAlive(false);
    }

    private doWork(idleStrategy: IdleStrategy, agent: Agent): void {
        try {
            const workCount = agent.doWork();
            this.idleNs = idleStrategy.idle(workCount);
            if (workCount <= 0 && Thread.currentThread().isInterrupted()) {
                this._isRunning = false;
            }
        } catch (t) {
            if (t instanceof InterruptedException || t instanceof ClosedByInterruptException) {
                this._isRunning = false;
                Thread.currentThread().interrupt();
            } else if (t instanceof AgentTerminationException) {
                this._isRunning = false;
                if (!t.isExpected()) {
                    this.handleError(t);
                }
            } else {
                if (Thread.currentThread().isInterrupted()) {
                    this._isRunning = false;
                }

                this.handleError(t as Error);
                if (this._isRunning && Thread.currentThread().isInterrupted()) {
                    this._isRunning = false;
                }

                if (t instanceof JavaError) {
                    throw t;
                }
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
