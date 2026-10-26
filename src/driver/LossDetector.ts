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
// Port of io/aeron/driver/LossDetector.java @ 1.53.3
import { type UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import { Aeron } from '../client/Aeron.js';
import { TermGapScanner, type GapHandler } from '../client/logbuffer/TermGapScanner.js';
import { type FeedbackDelayGenerator } from './FeedbackDelayGenerator.js';
import { type LossHandler } from './LossHandler.js';

const { scanForGap } = TermGapScanner;

/**
 * Detects loss in a term buffer and signals it, with delays and retries, to a {@link LossHandler}.
 */
export class LossDetector implements GapHandler {
    private deadlineNs: number = Aeron.NULL_VALUE;

    private scannedTermId = 0;
    private scannedTermOffset = -1;
    private scannedLength = 0;

    private activeTermId = 0;
    private activeTermOffset = -1;
    private activeLength = 0;

    private readonly delayGenerator: FeedbackDelayGenerator;
    private readonly lossHandler: LossHandler;

    /**
     * Create a loss detector for a channel.
     *
     * @param delayGenerator to use for delay determination
     * @param lossHandler    to call when signalling a gap
     */
    public constructor(delayGenerator: FeedbackDelayGenerator, lossHandler: LossHandler) {
        this.delayGenerator = delayGenerator;
        this.lossHandler = lossHandler;
    }

    /**
     * Scan for gaps and handle received data.
     * <p>
     * The handler keeps track from scan to scan what is a gap and what must have been repaired.
     * <p>
     * Positions are `number`s (spec D5). `termLengthMask` is a power of two less one, so `position & termLengthMask`
     * is exact for any position below 2^53 (the `int` conversion drops multiples of 2^32, which the term length
     * divides), and the term count is the position divided by the term length, truncated to an `int` as Java's
     * `(int)(position >>> positionBitsToShift)`.
     *
     * @param termBuffer          to scan
     * @param rebuildPosition     to start scanning from
     * @param hwmPosition         to scan up to
     * @param nowNs               time in nanoseconds
     * @param termLengthMask      used for offset calculation
     * @param positionBitsToShift used for position calculation
     * @param initialTermId       used by the scanner
     * @return packed outcome of the scan, see {@link pack}.
     */
    public scan(
        termBuffer: UnsafeBuffer,
        rebuildPosition: number,
        hwmPosition: number,
        nowNs: number,
        termLengthMask: number,
        positionBitsToShift: number,
        initialTermId: number,
    ): number {
        let lossFound = false;
        let rebuildOffset = rebuildPosition & termLengthMask;

        if (rebuildPosition < hwmPosition) {
            const termLength = termLengthMask + 1;
            const rebuildTermCount = Math.floor(rebuildPosition / termLength) | 0;
            const hwmTermCount = Math.floor(hwmPosition / termLength) | 0;

            const rebuildTermId = (initialTermId + rebuildTermCount) | 0;
            const hwmTermOffset = hwmPosition & termLengthMask;
            const limitOffset = rebuildTermCount === hwmTermCount ? hwmTermOffset : termLength;

            rebuildOffset = scanForGap(termBuffer, rebuildTermId, rebuildOffset, limitOffset, this);
            if (rebuildOffset < limitOffset) {
                if (
                    this.scannedTermOffset !== this.activeTermOffset ||
                    this.scannedTermId !== this.activeTermId ||
                    this.scannedLength !== this.activeLength
                ) {
                    this.activateGap(nowNs);
                    lossFound = true;
                }

                this.checkTimerExpiry(nowNs);
            }
        }

        return LossDetector.pack(rebuildOffset, lossFound);
    }

    /**
     * {@inheritDoc}
     */
    public onGap(termId: number, offset: number, length: number): void {
        this.scannedTermId = termId;
        this.scannedTermOffset = offset;
        this.scannedLength = length;
    }

    /**
     * Pack the values for workCount and rebuildOffset into a `number` for returning on the stack (spec D13).
     * <p>
     * The layout is `rebuildOffset * 2 + lossFound`, where Java packs `(rebuildOffset << 32) | lossFound` into a
     * `long`, which D5 cannot hold above 2^53. The offset is the high part and the flag the low bit, so that the
     * outcome of a term of up to 2^30 bytes (`TERM_MAX_LENGTH`) is at most 2^31 + 1, and one of a 64 KiB term is a
     * small integer, which V8 does not box.
     *
     * @param rebuildOffset value to be packed, in [0, 2^31).
     * @param lossFound     value to be packed.
     * @return a number with rebuildOffset and lossFound packed into it.
     * @throws RangeError if `rebuildOffset` is not an `int` in [0, 2^31) (never wraps).
     */
    public static pack(rebuildOffset: number, lossFound: boolean): number {
        if (!(rebuildOffset >= 0 && rebuildOffset <= 0x7fffffff)) {
            throw new RangeError('rebuildOffset outside [0, 2^31): ' + rebuildOffset);
        }

        return rebuildOffset * 2 + (lossFound ? 1 : 0);
    }

    /**
     * Has loss been found in the scan?
     *
     * @param scanOutcome into which the loss found value has been packed.
     * @return if loss has been found or not.
     */
    public static lossFound(scanOutcome: number): boolean {
        return (scanOutcome & 1) !== 0;
    }

    /**
     * The offset up to which the log has been rebuilt.
     *
     * @param scanOutcome into which the offset value has been packed.
     * @return the offset up to which the log has been rebuilt.
     */
    public static rebuildOffset(scanOutcome: number): number {
        return scanOutcome >>> 1;
    }

    private activateGap(nowNs: number): void {
        this.activeTermId = this.scannedTermId;
        this.activeTermOffset = this.scannedTermOffset;
        this.activeLength = this.scannedLength;

        this.deadlineNs = nowNs + this.delayGenerator.generateDelayNs();
    }

    private checkTimerExpiry(nowNs: number): void {
        if (this.deadlineNs - nowNs <= 0) {
            this.lossHandler.onGapDetected(this.activeTermId, this.activeTermOffset, this.activeLength);
            this.deadlineNs = nowNs + this.delayGenerator.retryDelayNs();
        }
    }
}
