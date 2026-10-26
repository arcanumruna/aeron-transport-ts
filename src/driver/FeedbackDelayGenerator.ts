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
// Port of io/aeron/driver/FeedbackDelayGenerator.java @ 1.53.3
/**
 * Generator for delays used by feedback.
 */
export interface FeedbackDelayGenerator {
    /**
     * Generate a new delay value on initial request.
     *
     * @return delay value in nanoseconds
     */
    generateDelayNs(): number;

    /**
     * Generate a new delay value on a retried request. Java's default method returns {@link #generateDelayNs()}; here
     * every implementation declares it, and one that does not override Java's default returns `generateDelayNs()`.
     *
     * @return delay value in nanoseconds
     */
    retryDelayNs(): number;
}
