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
// Not in Java (spec D118): the static members of io/aeron/driver/PreferredMulticastFlowControl.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import { System } from '../agrona/jdkLang.js';

/**
 * The legacy Application Specific Feedback (ASF) of the preferred multicast flow control, read from the system
 * property when the module is loaded, as Java's static initialisers of `PreferredMulticastFlowControl` do.
 * <p>
 * `TaggedMulticastFlowControl` (the ASF bytes) and `Configuration` (the property name and default) read these, and
 * `PreferredMulticastFlowControl` extends `TaggedMulticastFlowControl`: the constants are in their own module so that
 * neither of the two imports the class that extends the other (an `extends` of a class that is still loading is a
 * `ReferenceError`). `PreferredMulticastFlowControl` re-exports them as its static members.
 */
export const PreferredMulticastFlowControlAsf = {
    /**
     * Property name for setting the ASF of the preferred flow control.
     */
    PREFERRED_ASF_PROP_NAME: 'aeron.PreferredMulticastFlowControl.asf',

    /**
     * Default ASF value, in hex.
     */
    PREFERRED_ASF_DEFAULT: 'FFFFFFFFFFFFFFFF',
} as const;

/**
 * The ASF in hex, from {@link PreferredMulticastFlowControlAsf.PREFERRED_ASF_PROP_NAME}.
 */
export const PREFERRED_ASF: string = System.getProperty(
    PreferredMulticastFlowControlAsf.PREFERRED_ASF_PROP_NAME,
    PreferredMulticastFlowControlAsf.PREFERRED_ASF_DEFAULT,
);

/**
 * The ASF bytes. An `Int8Array`, as Java's `byte[]` is signed: they are compared with `getByte`, which is signed too.
 */
export const PREFERRED_ASF_BYTES: Int8Array = new Int8Array(BitUtil.fromHex(PREFERRED_ASF).buffer);
