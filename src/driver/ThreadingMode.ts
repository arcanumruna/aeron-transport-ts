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
// Port of io/aeron/driver/ThreadingMode.java @ 1.53.3
import { IllegalArgumentException } from '../agrona/jdk.js';

/**
 * Threading mode to be employed by the {@link org.agrona.concurrent.Agent}s in the {@link MediaDriver}: the Java enum
 * `ThreadingMode`, a class with one `static readonly` instance per constant in the Java ordinal order, with `name()`,
 * `ordinal()`, `values()` and `toString()`. Only `INVOKER` runs in this port (spec D3).
 */
export class ThreadingMode {
    private static nextOrdinal = 0;

    /**
     * No threads are started in the {@link MediaDriver}.
     * <p>
     * All 3 {@link org.agrona.concurrent.Agent}s will be composed a {@link org.agrona.concurrent.CompositeAgent} and
     * made runnable via an {@link org.agrona.concurrent.AgentInvoker} in the {@link MediaDriver.Context}.
     */
    public static readonly INVOKER: ThreadingMode = new ThreadingMode('INVOKER');

    /**
     * One thread shared by all 3 {@link org.agrona.concurrent.Agent}s.
     */
    public static readonly SHARED: ThreadingMode = new ThreadingMode('SHARED');

    /**
     * One thread shared by both the {@link Sender} and {@link Receiver} agents,
     * plus one for the {@link DriverConductor}.
     */
    public static readonly SHARED_NETWORK: ThreadingMode = new ThreadingMode('SHARED_NETWORK');

    /**
     * 3 Threads, one dedicated to each of the {@link org.agrona.concurrent.Agent}s.
     */
    public static readonly DEDICATED: ThreadingMode = new ThreadingMode('DEDICATED');

    private readonly _name: string;
    private readonly _ordinal: number;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = ThreadingMode.nextOrdinal++;
    }

    /**
     * The constants of the enum in ordinal order.
     *
     * @return a new array of the constants.
     */
    public static values(): ThreadingMode[] {
        return [ThreadingMode.INVOKER, ThreadingMode.SHARED, ThreadingMode.SHARED_NETWORK, ThreadingMode.DEDICATED];
    }

    /**
     * The constant with the given name: Java's `Enum.valueOf` (`ThreadingMode.valueOf(String)`).
     *
     * @param name of the constant, exactly as declared.
     * @return the constant.
     * @throws IllegalArgumentException if the name is not that of a constant.
     */
    public static valueOf(name: string): ThreadingMode {
        for (const mode of ThreadingMode.values()) {
            if (mode._name === name) {
                return mode;
            }
        }

        throw new IllegalArgumentException('No enum constant io.aeron.driver.ThreadingMode.' + name);
    }

    public name(): string {
        return this._name;
    }

    public ordinal(): number {
        return this._ordinal;
    }

    public toString(): string {
        return this._name;
    }
}
