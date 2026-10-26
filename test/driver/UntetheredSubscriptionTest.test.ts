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
// Port of io/aeron/driver/UntetheredSubscriptionTest.java @ 1.53.3
import { describe, it } from 'vitest';

describe('UntetheredSubscriptionTest', () => {
    // The test is made of an IpcPublication and an IpcSubscriptionLink, which are not ported (spec section 3, D54).
    // The life cycle of the untethered subscription of a NetworkPublication and of a PublicationImage is covered by
    // NetworkPublicationExtraTest and PublicationImageLifecycleExtraTest.
    it.skip('shouldLifeCycleTimeoutsAndRelink', () => {});
});
