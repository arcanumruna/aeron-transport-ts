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
// Port of io/aeron/driver/PreferredMulticastFlowControl.java @ 1.53.3
import {
    PREFERRED_ASF,
    PREFERRED_ASF_BYTES,
    PreferredMulticastFlowControlAsf,
} from './PreferredMulticastFlowControlAsf.js';
import { TaggedMulticastFlowControl } from './TaggedMulticastFlowControl.js';

/**
 * Preferred multicast sender flow control strategy. A receiver that sends the preferred Application Specific
 * Feedback, or a group tag equal to the one of the strategy, is tracked.
 *
 * @deprecated use {@link TaggedMulticastFlowControl}.
 */
export class PreferredMulticastFlowControl extends TaggedMulticastFlowControl {
    /**
     * Property name used to set the Application Specific Feedback (ASF) value used to identify the preferred
     * receivers.
     */
    public static readonly PREFERRED_ASF_PROP_NAME: string = PreferredMulticastFlowControlAsf.PREFERRED_ASF_PROP_NAME;

    /**
     * Default value for the ASF, in hex.
     */
    public static readonly PREFERRED_ASF_DEFAULT: string = PreferredMulticastFlowControlAsf.PREFERRED_ASF_DEFAULT;

    /**
     * The ASF in hex (package-private in Java). Spec D118: defined in `PreferredMulticastFlowControlAsf.ts`.
     */
    public static readonly PREFERRED_ASF: string = PREFERRED_ASF;

    /**
     * The ASF bytes (package-private in Java). Spec D118: defined in `PreferredMulticastFlowControlAsf.ts`.
     */
    public static readonly PREFERRED_ASF_BYTES: Int8Array = PREFERRED_ASF_BYTES;

    /**
     * Default constructor.
     */
    public constructor() {
        super();
    }
}
