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
// Port of org/agrona/concurrent/status/Position.java @ Agrona 2.6.1
import { ReadablePosition } from './ReadablePosition.js';

/**
 * Indicates how far through an abstract task a component has progressed as a counter value. Asynchronous
 * components can use this to monitor the progress of other components.
 */
export abstract class Position extends ReadablePosition {
    /**
     * Has this counter been closed and thus no longer be used?
     *
     * @return true if it has been closed otherwise false.
     */
    public abstract isClosed(): boolean;

    /**
     * Set the current position of a component with volatile memory semantics.
     *
     * @param value the current status of a component.
     */
    public abstract setVolatile(value: number): void;

    /**
     * Set the current position of a component with ordered memory semantics.
     *
     * @param value the current status of a component.
     */
    public abstract setOrdered(value: number): void;

    /**
     * Set the current position of a component with release memory semantics.
     *
     * @param value the current status of a component.
     */
    public abstract setRelease(value: number): void;

    /**
     * Set the current position of a component with opaque memory semantics.
     *
     * @param value the current status of a component.
     */
    public abstract setOpaque(value: number): void;

    /**
     * Set the current position of a component without any memory ordering semantics.
     *
     * @param value the current status of a component.
     */
    public abstract set(value: number): void;

    /**
     * Set the position to a new proposedValue if greater than the current value without memory ordering semantics.
     *
     * @param proposedValue for the new max.
     * @return true if a new max has been set otherwise false.
     */
    public abstract proposeMax(proposedValue: number): boolean;

    /**
     * Set the position to a new proposedValue if greater than the current value with ordered memory semantics.
     *
     * @param proposedValue for the new max.
     * @return true if a new max has been set otherwise false.
     */
    public abstract proposeMaxOrdered(proposedValue: number): boolean;

    /**
     * Set the position to a new proposedValue if greater than the current value with release memory semantics.
     *
     * @param proposedValue for the new max.
     * @return true if a new max has been set otherwise false.
     */
    public abstract proposeMaxRelease(proposedValue: number): boolean;

    /**
     * Set the position to a new proposedValue if greater than the current value with opaque memory semantics.
     *
     * @param proposedValue for the new max.
     * @return true if a new max has been set otherwise false.
     */
    public abstract proposeMaxOpaque(proposedValue: number): boolean;

    /**
     * Port-only (spec D137): add an `int` delta to the position with release memory semantics, for its single writer.
     * The default reads and sets the value; {@link UnsafeBufferPosition} adds to the two `int` halves of the counter,
     * so that no position above 2^31 is formed as a double (which V8 boxes across a call).
     *
     * @param delta an `int` in [0, 2^31 - 1].
     */
    public addRelease(delta: number): void {
        this.setRelease(this.get() + delta);
    }

    /**
     * Port-only (spec D137): read the position, with plain memory semantics, as its two `int` halves: `out[0]` the low
     * 32 bits and `out[1]` the high 32 bits. The default splits {@link get}; {@link UnsafeBufferPosition} reads the two
     * halves of the counter, so that no position above 2^31 is formed as a double (which V8 boxes across a call).
     *
     * @param out receives the low half at 0 and the high half at 1.
     */
    public getHalves(out: Int32Array): void {
        const value = this.get();
        const high = Math.floor(value / 4294967296);
        out[0] = (value - high * 4294967296) | 0;
        out[1] = high | 0;
    }
}
