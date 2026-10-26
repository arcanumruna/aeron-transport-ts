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
// Port of io/aeron/driver/RetransmitHandler.java @ 1.53.3
import { type NanoClock } from '../agrona/concurrent/NanoClock.js';
import { type AtomicCounter } from '../agrona/concurrent/status/AtomicCounter.js';
import { type FeedbackDelayGenerator } from './FeedbackDelayGenerator.js';
import { type FlowControl } from './FlowControl.js';
import { type RetransmitSender } from './RetransmitSender.js';

// Java's nested `RetransmitAction.State` enum: the ordinals of the constants, as numbers so that a state is an `int`.
/**
 * The states of a {@link RetransmitAction}.
 */
const State = {
    DELAYED: 0,
    LINGERING: 1,
    INACTIVE: 2,
} as const;

/**
 * Java's nested `RetransmitHandler.RetransmitAction`: one slot of the preallocated pool.
 */
export class RetransmitAction {
    public expiryNs = 0;
    public termId = 0;
    public termOffset = 0;
    public length = 0;
    public state: number = State.INACTIVE;

    public delay(delayNs: number, nowNs: number): void {
        this.state = State.DELAYED;
        this.expiryNs = nowNs + delayNs;
    }

    public linger(timeoutNs: number, nowNs: number): void {
        this.state = State.LINGERING;
        this.expiryNs = nowNs + timeoutNs;
    }

    public cancel(): void {
        this.state = State.INACTIVE;
    }
}

/**
 * Handling of the reception of a NAK, requesting a frame to be retransmitted, with the delay and the linger.
 */
export class RetransmitHandler {
    private readonly retransmitActionPool: RetransmitAction[];
    private readonly nanoClock: NanoClock;
    private readonly delayGenerator: FeedbackDelayGenerator;
    private readonly lingerTimeoutGenerator: FeedbackDelayGenerator;
    private readonly hasGroupSemantics: boolean;
    private readonly retransmitOverflowCounter: AtomicCounter;

    private activeRetransmitCount = 0;

    /**
     * Create a handler for the dealing with the reception of frame request a frame to be retransmitted.
     *
     * @param nanoClock                 used to determine time.
     * @param delayGenerator            to use for delay determination.
     * @param lingerTimeoutGenerator    to use for linger timeout.
     * @param hasGroupSemantics         indicates multicast/MDC semantics.
     * @param maxRetransmits            max retransmits for when group semantics is enabled
     * @param retransmitOverflowCounter counter to track overflows.
     */
    public constructor(
        nanoClock: NanoClock,
        delayGenerator: FeedbackDelayGenerator,
        lingerTimeoutGenerator: FeedbackDelayGenerator,
        hasGroupSemantics: boolean,
        maxRetransmits: number,
        retransmitOverflowCounter: AtomicCounter,
    ) {
        this.nanoClock = nanoClock;
        this.delayGenerator = delayGenerator;
        this.lingerTimeoutGenerator = lingerTimeoutGenerator;
        this.hasGroupSemantics = hasGroupSemantics;
        this.retransmitOverflowCounter = retransmitOverflowCounter;

        const actualMaxRetransmits = this.hasGroupSemantics ? maxRetransmits : 1;

        this.retransmitActionPool = new Array<RetransmitAction>(actualMaxRetransmits);
        for (let i = 0; i < actualMaxRetransmits; i++) {
            this.retransmitActionPool[i] = new RetransmitAction();
        }
    }

    /**
     * Called on reception of a NAK to start retransmit handling.
     *
     * @param termId           from the NAK and the term id of the buffer to retransmit from.
     * @param termOffset       from the NAK and the offset of the data to retransmit.
     * @param length           of the missing data.
     * @param termLength       of the term buffer.
     * @param mtuLength        for the publication.
     * @param flowControl      for the publication (to clamp the retransmission length).
     * @param retransmitSender to call if an immediate retransmit is required.
     */
    public onNak(
        termId: number,
        termOffset: number,
        length: number,
        termLength: number,
        mtuLength: number,
        flowControl: FlowControl,
        retransmitSender: RetransmitSender,
    ): void {
        if (0 !== length) {
            const retransmitLength = flowControl.maxRetransmissionLength(termOffset, length, termLength, mtuLength);
            const action = this.scanForAvailableRetransmit(termId, termOffset, retransmitLength);
            if (null !== action) {
                action.termId = termId;
                action.termOffset = termOffset;
                action.length = retransmitLength;

                const delay = this.delayGenerator.generateDelayNs();
                if (0 === delay) {
                    retransmitSender.resend(termId, termOffset, action.length);
                    action.linger(this.lingerTimeoutGenerator.generateDelayNs(), this.nanoClock.nanoTime());
                } else {
                    action.delay(delay, this.nanoClock.nanoTime());
                }
            }
        }
    }

    /**
     * Called to indicate a retransmission is received that may obviate the need to send one ourselves.
     * <p>
     * NOTE: Currently only called from unit tests. Would be used for retransmitting from receivers for NAK suppression.
     *
     * @param termId     of the data.
     * @param termOffset of the data.
     */
    public onRetransmitReceived(termId: number, termOffset: number): void {
        const action = this.scanForExistingRetransmit(termId, termOffset);

        if (null !== action && State.DELAYED === action.state) {
            this.removeRetransmit(action);
        }
    }

    /**
     * Called to process any outstanding timeouts.
     *
     * @param nowNs            time in nanoseconds.
     * @param retransmitSender to call on retransmissions.
     */
    public processTimeouts(nowNs: number, retransmitSender: RetransmitSender): void {
        if (this.activeRetransmitCount > 0) {
            const pool = this.retransmitActionPool;
            for (let i = 0, length = pool.length; i < length; i++) {
                const action = pool[i]!;
                if (State.DELAYED === action.state && action.expiryNs - nowNs < 0) {
                    retransmitSender.resend(action.termId, action.termOffset, action.length);
                    action.linger(this.lingerTimeoutGenerator.generateDelayNs(), this.nanoClock.nanoTime());
                } else if (State.LINGERING === action.state && action.expiryNs - nowNs < 0) {
                    this.removeRetransmit(action);
                }
            }
        }
    }

    private scanForAvailableRetransmit(termId: number, termOffset: number, _length: number): RetransmitAction | null {
        if (0 === this.activeRetransmitCount) {
            return this.addRetransmit(this.retransmitActionPool[0]!);
        }

        let availableAction: RetransmitAction | null = null;
        const pool = this.retransmitActionPool;
        for (let i = 0, poolLength = pool.length; i < poolLength; i++) {
            const action = pool[i]!;
            switch (action.state) {
                case State.INACTIVE:
                    if (null === availableAction) {
                        availableAction = action;
                    }
                    break;

                case State.DELAYED:
                case State.LINGERING:
                    if (
                        action.termId === termId &&
                        action.termOffset <= termOffset &&
                        termOffset < action.termOffset + action.length
                    ) {
                        return null;
                    }

                    if (!this.hasGroupSemantics) {
                        // this is unicast, and the NAK does NOT overlap the previous one, so just reuse it
                        availableAction = action;
                    }
                    break;
            }
        }

        if (this.hasGroupSemantics) {
            if (null !== availableAction) {
                return this.addRetransmit(availableAction);
            }

            this.retransmitOverflowCounter.increment();
        }

        return availableAction;
    }

    private scanForExistingRetransmit(termId: number, termOffset: number): RetransmitAction | null {
        if (0 === this.activeRetransmitCount) {
            return null;
        }

        const pool = this.retransmitActionPool;
        for (let i = 0, length = pool.length; i < length; i++) {
            const action = pool[i]!;
            switch (action.state) {
                case State.DELAYED:
                case State.LINGERING:
                    if (action.termId === termId && action.termOffset === termOffset) {
                        return action;
                    }
                    break;

                default:
                    break;
            }
        }

        return null;
    }

    private addRetransmit(retransmitAction: RetransmitAction): RetransmitAction {
        ++this.activeRetransmitCount;
        return retransmitAction;
    }

    private removeRetransmit(action: RetransmitAction): void {
        --this.activeRetransmitCount;
        action.cancel();
    }
}
