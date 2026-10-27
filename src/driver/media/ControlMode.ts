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
// Port of io/aeron/driver/media/ControlMode.java @ 1.53.3

/**
 * Control mode of a channel: the Java enum `ControlMode`, a class with one `static readonly` instance per constant in
 * the Java ordinal order, with `name()`, `ordinal()`, `values()` and `toString()`.
 */
export class ControlMode {
    private static nextOrdinal = 0;

    /**
     * The default when no control mode is specified. Will mean that the stream is a normal one without MDC or similar.
     */
    public static readonly NONE: ControlMode = new ControlMode('NONE');

    /**
     * The stream should use dynamic MDC.
     */
    public static readonly DYNAMIC: ControlMode = new ControlMode('DYNAMIC');

    /**
     * The stream should use manual MDC.
     */
    public static readonly MANUAL: ControlMode = new ControlMode('MANUAL');

    /**
     * The stream is being used as part of a response channel.
     */
    public static readonly RESPONSE: ControlMode = new ControlMode('RESPONSE');

    private readonly _name: string;
    private readonly _ordinal: number = 0;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = ControlMode.nextOrdinal++;
    }

    /**
     * The constants of the enum in ordinal order.
     */
    public static values(): ControlMode[] {
        return [ControlMode.NONE, ControlMode.DYNAMIC, ControlMode.MANUAL, ControlMode.RESPONSE];
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

    /**
     * Indicates if this is a multi-destination control mode.
     *
     * @return <code>true</code> if this is multi-destination <code>false</code> otherwise.
     */
    public isMultiDestination(): boolean {
        return this === ControlMode.DYNAMIC || this === ControlMode.MANUAL;
    }
}
