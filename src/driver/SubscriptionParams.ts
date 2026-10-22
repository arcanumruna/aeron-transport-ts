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
// Port of io/aeron/driver/SubscriptionParams.java @ 1.53.3
import { IllegalArgumentException, IllegalStateException, Integer } from '../agrona/jdk.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { Aeron } from '../client/Aeron.js';
import type { ChannelUri } from '../client/ChannelUri.js';
import { CommonContext, InferableBoolean } from '../client/CommonContext.js';
import { FrameDescriptor } from '../client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { Configuration } from './Configuration.js';
import type { MediaDriver } from './MediaDriver.js';
import { UdpChannel } from './media/UdpChannel.js';

const {
    CONTROL_MODE_RESPONSE,
    GROUP_PARAM_NAME,
    INITIAL_TERM_ID_PARAM_NAME,
    MDC_CONTROL_MODE_PARAM_NAME,
    RECEIVER_WINDOW_LENGTH_PARAM_NAME,
    REJOIN_PARAM_NAME,
    RELIABLE_STREAM_PARAM_NAME,
    SPARSE_PARAM_NAME,
    TERM_ID_PARAM_NAME,
    TERM_OFFSET_PARAM_NAME,
    TETHER_PARAM_NAME,
    UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
    UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
    UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
} = CommonContext;

/**
 * Subscription parameters of a channel URI with their defaults from the {@link MediaDriver.Context}. The Java class is
 * package-private; its fields and static methods are public here.
 */
export class SubscriptionParams {
    public initialTermId = 0;
    public termId = 0;
    public termOffset = 0;
    public sessionId = 0;
    public hasJoinPosition = false;
    public hasSessionId = false;
    public isReliable = true;
    public isRejoin = true;
    public isSparse = true;
    public isTether = true;
    public isResponse = false;
    public group: InferableBoolean = InferableBoolean.INFER;
    public receiverWindowLength = 0;
    public untetheredWindowLimitTimeoutNs = 0;
    public untetheredLingerTimeoutNs = 0;
    public untetheredRestingTimeoutNs = 0;

    public static getSubscriptionParams(
        channelUri: ChannelUri,
        context: MediaDriver.Context,
        publisherTermBufferLength: number,
    ): SubscriptionParams {
        const params = new SubscriptionParams();

        const sessionIdStr = channelUri.get(CommonContext.SESSION_ID_PARAM_NAME);
        if (null !== sessionIdStr) {
            params.sessionId = Integer.parseInt(sessionIdStr);
            params.hasSessionId = true;
        }

        if (CONTROL_MODE_RESPONSE === channelUri.get(MDC_CONTROL_MODE_PARAM_NAME)) {
            params.isResponse = true;
        }

        let count = 0;

        const initialTermIdStr = channelUri.get(INITIAL_TERM_ID_PARAM_NAME);
        count = initialTermIdStr !== null ? count + 1 : count;

        const termIdStr = channelUri.get(TERM_ID_PARAM_NAME);
        count = termIdStr !== null ? count + 1 : count;

        const termOffsetStr = channelUri.get(TERM_OFFSET_PARAM_NAME);
        count = termOffsetStr !== null ? count + 1 : count;

        if (count > 0) {
            if (count < 3) {
                throw new IllegalArgumentException(
                    'params must be used as a complete set: ' +
                        INITIAL_TERM_ID_PARAM_NAME +
                        ' ' +
                        TERM_ID_PARAM_NAME +
                        ' ' +
                        TERM_OFFSET_PARAM_NAME +
                        ' channel=' +
                        channelUri,
                );
            }

            params.initialTermId = Integer.parseInt(initialTermIdStr as string);
            params.termId = Integer.parseInt(termIdStr as string);
            params.termOffset = Integer.parseInt(termOffsetStr as string);

            if (params.termOffset < 0 || params.termOffset > LogBufferDescriptor.TERM_MAX_LENGTH) {
                throw new IllegalArgumentException(
                    TERM_OFFSET_PARAM_NAME + '=' + params.termOffset + ' out of range: channel=' + channelUri,
                );
            }

            if (!FrameDescriptor.isFrameAligned(params.termOffset)) {
                throw new IllegalArgumentException(
                    TERM_OFFSET_PARAM_NAME +
                        '=' +
                        params.termOffset +
                        ' must be a multiple of FRAME_ALIGNMENT: channel=' +
                        channelUri,
                );
            }

            if (((params.termId - params.initialTermId) | 0) < 0) {
                throw new IllegalStateException(
                    'difference greater than 2^31 - 1: ' +
                        INITIAL_TERM_ID_PARAM_NAME +
                        '=' +
                        params.initialTermId +
                        ' when ' +
                        TERM_ID_PARAM_NAME +
                        '=' +
                        params.termId +
                        ' channel=' +
                        channelUri,
                );
            }

            params.hasJoinPosition = true;
        }

        const reliableStr = channelUri.get(RELIABLE_STREAM_PARAM_NAME);
        params.isReliable = null !== reliableStr ? 'true' === reliableStr : context.reliableStream();

        const rejoinStr = channelUri.get(REJOIN_PARAM_NAME);
        params.isRejoin = null !== rejoinStr ? 'true' === rejoinStr : context.rejoinStream();

        const tetherStr = channelUri.get(TETHER_PARAM_NAME);
        params.isTether = null !== tetherStr ? 'true' === tetherStr : context.tetherSubscriptions();

        const sparseStr = channelUri.get(SPARSE_PARAM_NAME);
        params.isSparse = null !== sparseStr ? 'true' === sparseStr : context.termBufferSparseFile();

        const groupStr = channelUri.get(GROUP_PARAM_NAME);
        params.group = null !== groupStr ? InferableBoolean.parse(groupStr) : context.receiverGroupConsideration();

        const rcvWndLength = UdpChannel.parseBufferLength(channelUri, RECEIVER_WINDOW_LENGTH_PARAM_NAME);
        params.receiverWindowLength = Configuration.receiverWindowLength(
            0 !== publisherTermBufferLength
                ? publisherTermBufferLength
                : channelUri.isIpc()
                  ? context.ipcTermBufferLength()
                  : context.publicationTermBufferLength(),
            0 !== rcvWndLength ? rcvWndLength : context.initialWindowLength(),
        );

        params.getUntetheredWindowLimitTimeout(channelUri, context);
        params.getUntetheredLingerTimeout(channelUri, context);
        params.getUntetheredRestingTimeout(channelUri, context);

        return params;
    }

    private getUntetheredWindowLimitTimeout(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        this.untetheredWindowLimitTimeoutNs = SubscriptionParams.getTimeoutNs(
            channelUri,
            UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
            ctx.untetheredWindowLimitTimeoutNs(),
        );
    }

    private getUntetheredLingerTimeout(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        this.untetheredLingerTimeoutNs = SubscriptionParams.getTimeoutNs(
            channelUri,
            UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
            ctx.untetheredLingerTimeoutNs(),
        );

        if (Aeron.NULL_VALUE === this.untetheredLingerTimeoutNs) {
            this.untetheredLingerTimeoutNs = this.untetheredWindowLimitTimeoutNs;
        }
    }

    private getUntetheredRestingTimeout(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        this.untetheredRestingTimeoutNs = SubscriptionParams.getTimeoutNs(
            channelUri,
            UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
            ctx.untetheredRestingTimeoutNs(),
        );
    }

    private static getTimeoutNs(channelUri: ChannelUri, paramName: string, defaultValue: number): number {
        const timeoutString = channelUri.get(paramName);
        return null !== timeoutString ? SystemUtil.parseDuration(paramName, timeoutString) : defaultValue;
    }

    public toString(): string {
        return (
            'SubscriptionParams' +
            '\n{' +
            '\n    initialTermId=' +
            this.initialTermId +
            '\n    termId=' +
            this.termId +
            '\n    termOffset=' +
            this.termOffset +
            '\n    sessionId=' +
            this.sessionId +
            '\n    hasJoinPosition=' +
            this.hasJoinPosition +
            '\n    hasSessionId=' +
            this.hasSessionId +
            '\n    isReliable=' +
            this.isReliable +
            '\n    isRejoin=' +
            this.isRejoin +
            '\n    isSparse=' +
            this.isSparse +
            '\n    isTether=' +
            this.isTether +
            '\n    isResponse=' +
            this.isResponse +
            '\n    group=' +
            this.group +
            '\n    receiverWindowLength=' +
            this.receiverWindowLength +
            '\n    untetheredWindowLimitTimeoutNs=' +
            this.untetheredWindowLimitTimeoutNs +
            '\n    untetheredRestingTimeoutNs=' +
            this.untetheredRestingTimeoutNs +
            '\n    untetheredLingerTimeoutNs=' +
            this.untetheredLingerTimeoutNs +
            '\n}'
        );
    }
}
