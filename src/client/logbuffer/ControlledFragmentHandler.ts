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
// Port of io/aeron/logbuffer/ControlledFragmentHandler.java @ 1.53.3
import type { DirectBuffer } from '../../agrona/DirectBuffer.js';
import type { Header } from './Header.js';

/**
 * Action to be taken on return from {@link ControlledFragmentHandler.onFragment}: the nested Java enum
 * `ControlledFragmentHandler.Action`, also reachable as `ControlledFragmentHandler.Action`.
 */
export class Action {
    private static nextOrdinal = 0;

    /**
     * Abort the current polling operation and do not advance the position for this fragment.
     */
    public static readonly ABORT: Action = new Action('ABORT');

    /**
     * Break from the current polling operation and commit the position as of the end of the current fragment
     * being handled.
     */
    public static readonly BREAK: Action = new Action('BREAK');

    /**
     * Continue processing but commit the position as of the end of the current fragment so that
     * flow control is applied to this point.
     */
    public static readonly COMMIT: Action = new Action('COMMIT');

    /**
     * Continue processing until fragment limit or no fragments with position commit at end of poll as the in
     * {@link ControlledFragmentHandler.onFragment}.
     */
    public static readonly CONTINUE: Action = new Action('CONTINUE');

    private readonly _name: string;
    private readonly _ordinal: number = 0;

    private constructor(name: string) {
        this._name = name;
        this._ordinal = Action.nextOrdinal++;
    }

    public static values(): Action[] {
        return [Action.ABORT, Action.BREAK, Action.COMMIT, Action.CONTINUE];
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

/**
 * Handler for reading data that is coming from a log buffer. The frame will either contain a whole message
 * or a fragment of a message to be reassembled. Messages are fragmented if greater than the frame for MTU in length.
 * <p>
 * An interface with the method `onFragment`, as {@link FragmentHandler}.
 */
export interface ControlledFragmentHandler {
    /**
     * Callback for handling fragments of data being read from a log.
     * <p>
     * Within this callback reentrant calls to the {@link Aeron} client are not permitted and
     * will result in undefined behaviour.
     *
     * @param buffer containing the data.
     * @param offset at which the data begins.
     * @param length of the data in bytes.
     * @param header representing the metadata for the data.
     * @return The action to be taken with regard to the stream position after the callback.
     */
    onFragment(buffer: DirectBuffer, offset: number, length: number, header: Header): Action;
}

/**
 * The nested enum `ControlledFragmentHandler.Action`, beside the interface of the same name.
 */
export const ControlledFragmentHandler = { Action } as const;

type ActionType = Action;

// Declaration merging: `ControlledFragmentHandler.Action` is a type as well as a value, as the nested Java enum is.
// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ControlledFragmentHandler {
    export type Action = ActionType;
}
