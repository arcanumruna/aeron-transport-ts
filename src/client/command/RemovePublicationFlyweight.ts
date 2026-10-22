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
// Port of io/aeron/command/RemovePublicationFlyweight.java @ 1.53.3
import { BitUtil } from '../../agrona/BitUtil.js';
import { type MutableDirectBuffer } from '../../agrona/MutableDirectBuffer.js';
import { ByteOrder } from '../../agrona/jdk.js';
import { RemoveMessageFlyweight } from './RemoveMessageFlyweight.js';

const { SIZE_OF_LONG } = BitUtil;
const { LITTLE_ENDIAN } = ByteOrder;

/**
 * Command message flyweight to remove a publication.
 * <pre>
 *   0                   1                   2                   3
 *   0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
 *  +---------------------------------------------------------------+
 *  |                         Client ID                             |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                    Command Correlation ID                     |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                  Registration ID to be removed                |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 *  |                            Flags                              |
 *  |                                                               |
 *  +---------------------------------------------------------------+
 * </pre>
 * <p>
 * The flags word is read and written through its low 32 bit half (`getInt` / `putInt`, little endian), not as a
 * `long`: the only flag is bit 0, so the result is Java's for every 64 bit pattern, and a flags word with a high bit
 * set by a peer (outside +/-(2^53 - 1), spec D5) never throws.
 */
export class RemovePublicationFlyweight extends RemoveMessageFlyweight {
    private static readonly FLAGS_FIELD_OFFSET = RemoveMessageFlyweight.REGISTRATION_ID_FIELD_OFFSET + SIZE_OF_LONG;

    private static readonly FLAG_REVOKE = 0x1;

    /**
     * Wrap the buffer at a given offset for updates.
     *
     * @param buffer to wrap.
     * @param offset at which the message begins.
     * @return this for a fluent API.
     */
    public override wrap(buffer: MutableDirectBuffer, offset: number): RemovePublicationFlyweight {
        super.wrap(buffer, offset);

        return this;
    }

    /**
     * Length of the message in bytes.
     *
     * @return length of the message in bytes.
     */
    public static override length(): number {
        return RemoveMessageFlyweight.length() + SIZE_OF_LONG;
    }

    /**
     * Is the flags field within the length of the message received?
     *
     * @param messageLength length of the message received.
     * @return `true` if the flags field is present.
     */
    public flagsFieldIsValid(messageLength: number): boolean {
        return messageLength >= RemovePublicationFlyweight.FLAGS_FIELD_OFFSET + SIZE_OF_LONG;
    }

    /**
     * Is the revoke flag set?
     *
     * @return `true` if the publication is to be revoked.
     */
    public revoke(): boolean;
    /**
     * Is the revoke flag set, when the flags field is within the length of the message?
     *
     * @param messageLength length of the message received.
     * @return `true` if the flags field is present and the publication is to be revoked.
     */
    public revoke(messageLength: number): boolean;
    /**
     * Set or clear the revoke flag.
     *
     * @param revoke `true` to revoke the publication.
     * @return this for a fluent API.
     */
    public revoke(revoke: boolean): RemovePublicationFlyweight;
    public revoke(arg?: number | boolean): boolean | RemovePublicationFlyweight {
        if (undefined === arg) {
            return (
                (this.buffer.getInt(this.offset + RemovePublicationFlyweight.FLAGS_FIELD_OFFSET, LITTLE_ENDIAN) &
                    RemovePublicationFlyweight.FLAG_REVOKE) >
                0
            );
        }

        if (typeof arg === 'number') {
            return this.flagsFieldIsValid(arg) && this.revoke();
        }

        let flags = this.buffer.getInt(this.offset + RemovePublicationFlyweight.FLAGS_FIELD_OFFSET, LITTLE_ENDIAN);

        if (arg) {
            flags |= RemovePublicationFlyweight.FLAG_REVOKE;
        } else {
            flags &= ~RemovePublicationFlyweight.FLAG_REVOKE;
        }

        this.buffer.putInt(this.offset + RemovePublicationFlyweight.FLAGS_FIELD_OFFSET, flags, LITTLE_ENDIAN);

        return this;
    }
}
