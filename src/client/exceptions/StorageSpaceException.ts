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
// Port of io/aeron/exceptions/StorageSpaceException.java @ 1.53.3
import { IOException } from '../../driver/jdkNet.js';
import { AeronException } from './AeronException.js';

/**
 * A request to allocate a resource (e.g. log buffer) failed due to insufficient storage space available.
 */
export class StorageSpaceException extends AeronException {
    /**
     * Construct the exception for the with detailed message.
     *
     * @param message detail for the exception.
     */
    public constructor(message: string) {
        super(message);
    }

    /**
     * Check if given exception denotes an out of disc space error, i.e. which on Linux is represented by error code
     * `ENOSPC(28)` and on Windows by error code `ERROR_DISK_FULL(112)`.
     *
     * @param error to check.
     * @return `true` if cause is {@link IOException} with a specific error.
     */
    public static isStorageSpaceError(error: Error | null): boolean {
        let cause: Error | null = error;
        while (null !== cause) {
            if (cause instanceof StorageSpaceException) {
                return true;
            } else if (cause instanceof IOException) {
                const msg = cause.message;
                if ('No space left on device' === msg || 'There is not enough space on the disk' === msg) {
                    return true;
                }
            }
            // Throwable.getCause()
            const next: unknown = cause.cause;
            cause = next instanceof Error ? next : null;
        }
        return false;
    }
}
