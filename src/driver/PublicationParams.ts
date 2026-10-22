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
// Port of io/aeron/driver/PublicationParams.java @ 1.53.3
import { BitUtil } from '../agrona/BitUtil.js';
import type { UnsafeBuffer } from '../agrona/concurrent/UnsafeBuffer.js';
import {
    IllegalStateException,
    Integer,
    Long,
    LongOverflowError,
    NumberFormatException,
    RuntimeException,
} from '../agrona/jdk.js';
import { SystemUtil } from '../agrona/SystemUtil.js';
import { Aeron } from '../client/Aeron.js';
import { ChannelUri } from '../client/ChannelUri.js';
import { CommonContext } from '../client/CommonContext.js';
import { FrameDescriptor } from '../client/logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from '../client/logbuffer/LogBufferDescriptor.js';
import { Configuration } from './Configuration.js';
import { InvalidChannelException } from './exceptions/InvalidChannelException.js';
import type { MediaDriver } from './MediaDriver.js';

const {
    CONTROL_MODE_RESPONSE,
    EOS_PARAM_NAME,
    INITIAL_TERM_ID_PARAM_NAME,
    LINGER_PARAM_NAME,
    MAX_RESEND_PARAM_NAME,
    MDC_CONTROL_MODE_PARAM_NAME,
    MTU_LENGTH_PARAM_NAME,
    PROTOTYPE_CORRELATION_ID,
    PUBLICATION_WINDOW_LENGTH_PARAM_NAME,
    RESPONSE_CORRELATION_ID_PARAM_NAME,
    SESSION_ID_PARAM_NAME,
    SPARSE_PARAM_NAME,
    SPIES_SIMULATE_CONNECTION_PARAM_NAME,
    STREAM_ID_PARAM_NAME,
    TERM_ID_PARAM_NAME,
    TERM_LENGTH_PARAM_NAME,
    TERM_OFFSET_PARAM_NAME,
    UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
    UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
    UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
} = CommonContext;
const { INVALID_TAG } = ChannelUri;

/**
 * The part of a `NetworkPublication` or `IpcPublication` that `PublicationParams` reads. Placeholder for those two
 * classes, which are ported by T15 (`NetworkPublication`) and not at all for the IPC one (spec section 3); the task
 * that ports `NetworkPublication` replaces it with the class (a type-only import), as `DriverManagedResource` does for
 * `DriverConductor` (`docs/mapping.md`, "Sources").
 */
export interface PublicationLike {
    sessionId(): number;
    mtuLength(): number;
    termBufferLength(): number;
    channel(): string;
}

/**
 * The part of the `DriverConductor` that `PublicationParams` calls. Placeholder for the class, which T18 ports; that
 * task replaces it with the class (a type-only import).
 */
export interface DriverConductor {
    findNetworkPublicationByTag(tag: number): PublicationLike | null;
    findIpcPublicationByTag(tag: number): PublicationLike | null;
    nextAvailableSessionId(streamId: number, channel: string): number;
}

/**
 * The part of a `RawLog` that `PublicationParams.confirmMatch` reads. Placeholder for the class, which T15 ports; that
 * task replaces it with the class (a type-only import).
 */
export interface RawLog {
    metaData(): UnsafeBuffer;
    termLength(): number;
}

/**
 * Publication parameters of a channel URI with their defaults from the {@link MediaDriver.Context}. The Java class is
 * package-private; its fields and static methods are public here.
 */
export class PublicationParams {
    public static readonly PROTOTYPE_VALUE_CORRELATION_ID: number = -2;

    public lingerTimeoutNs = 0;
    public entityTag: number = ChannelUri.INVALID_TAG;
    public untetheredWindowLimitTimeoutNs = 0;
    public untetheredLingerTimeoutNs = 0;
    public untetheredRestingTimeoutNs = 0;
    public responseCorrelationId: number = Aeron.NULL_VALUE;
    public termLength = 0;
    public mtuLength = 0;
    public publicationWindowLength = 0;
    public initialTermId = 0;
    public termId = 0;
    public termOffset = 0;
    public sessionId = 0;
    public streamId = 0;
    public maxResend = 0;
    public hasPosition = false;
    public isSessionIdTagged = false;
    public signalEos = false;
    public isSparse = false;
    public spiesSimulateConnection = false;
    public isResponse = false;

    public static getPublicationParams(
        channelUri: ChannelUri,
        ctx: MediaDriver.Context,
        driverConductor: DriverConductor,
        streamId: number,
        canonicalForm: string,
    ): PublicationParams {
        const params = new PublicationParams();

        params.termLength = channelUri.isIpc() ? ctx.ipcTermBufferLength() : ctx.publicationTermBufferLength();
        params.mtuLength = channelUri.isIpc() ? ctx.ipcMtuLength() : ctx.mtuLength();

        params.getStreamId(channelUri, streamId);
        params.getEntityTag(channelUri, driverConductor);
        params.getSessionId(channelUri, driverConductor, streamId, canonicalForm);
        params.getTermBufferLength(channelUri);
        params.getMtuLength(channelUri);
        params.getPublicationWindowLength(channelUri, ctx);
        params.getLingerTimeoutNs(channelUri, ctx);
        params.getEos(channelUri);
        params.getSparse(channelUri, ctx);
        params.getSpiesSimulateConnection(channelUri, ctx);
        params.getUntetheredWindowLimitTimeout(channelUri, ctx);
        params.getUntetheredLingerTimeout(channelUri, ctx);
        params.getUntetheredRestingTimeout(channelUri, ctx);
        params.getMaxResend(channelUri, ctx);

        let count = 0;

        const initialTermIdStr = channelUri.get(INITIAL_TERM_ID_PARAM_NAME);
        count = initialTermIdStr !== null ? count + 1 : count;

        const termIdStr = channelUri.get(TERM_ID_PARAM_NAME);
        count = termIdStr !== null ? count + 1 : count;

        const termOffsetStr = channelUri.get(TERM_OFFSET_PARAM_NAME);
        count = termOffsetStr !== null ? count + 1 : count;

        if (count > 0) {
            if (count < 3) {
                throw new InvalidChannelException(
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

            params.initialTermId = PublicationParams.parseInt(initialTermIdStr as string, INITIAL_TERM_ID_PARAM_NAME);
            params.termId = PublicationParams.parseInt(termIdStr as string, TERM_ID_PARAM_NAME);
            params.termOffset = PublicationParams.parseInt(termOffsetStr as string, TERM_OFFSET_PARAM_NAME);

            if (params.termOffset > params.termLength) {
                throw new InvalidChannelException(
                    TERM_OFFSET_PARAM_NAME +
                        '=' +
                        params.termOffset +
                        ' > ' +
                        TERM_LENGTH_PARAM_NAME +
                        '=' +
                        params.termLength +
                        ': channel=' +
                        channelUri,
                );
            }

            if (params.termOffset < 0 || params.termOffset > LogBufferDescriptor.TERM_MAX_LENGTH) {
                throw new InvalidChannelException(
                    TERM_OFFSET_PARAM_NAME + '=' + params.termOffset + ' out of range: channel=' + channelUri,
                );
            }

            if (!FrameDescriptor.isFrameAligned(params.termOffset)) {
                throw new InvalidChannelException(
                    TERM_OFFSET_PARAM_NAME +
                        '=' +
                        params.termOffset +
                        ' must be a multiple of FRAME_ALIGNMENT: channel=' +
                        channelUri,
                );
            }

            if (((params.termId - params.initialTermId) | 0) < 0) {
                throw new InvalidChannelException(
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

            params.hasPosition = true;
        } else {
            params.initialTermId = BitUtil.generateRandomisedId();
            params.termId = params.initialTermId;
            params.termOffset = 0;
        }

        params.isResponse = CONTROL_MODE_RESPONSE === channelUri.get(MDC_CONTROL_MODE_PARAM_NAME);
        params.responseCorrelationId = PublicationParams.parseResponseCorrelationId(channelUri);

        return params;
    }

    private getPublicationWindowLength(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        const pubWindowParam = channelUri.get(PUBLICATION_WINDOW_LENGTH_PARAM_NAME);
        if (null !== pubWindowParam) {
            const pubWindow = SystemUtil.parseSize(PUBLICATION_WINDOW_LENGTH_PARAM_NAME, pubWindowParam);
            if (pubWindow < this.mtuLength) {
                throw new InvalidChannelException(
                    PUBLICATION_WINDOW_LENGTH_PARAM_NAME +
                        '=' +
                        pubWindow +
                        ' cannot be less than the ' +
                        MTU_LENGTH_PARAM_NAME +
                        '=' +
                        this.mtuLength,
                );
            }

            if (pubWindow > this.termLength >> 1) {
                throw new InvalidChannelException(
                    PUBLICATION_WINDOW_LENGTH_PARAM_NAME +
                        '=' +
                        pubWindow +
                        ' must not exceed half the ' +
                        TERM_LENGTH_PARAM_NAME +
                        '=' +
                        this.termLength,
                );
            }

            this.publicationWindowLength = pubWindow | 0;
        } else {
            this.publicationWindowLength = Configuration.producerWindowLength(
                this.termLength,
                channelUri.isIpc() ? ctx.ipcPublicationTermWindowLength() : ctx.publicationTermWindowLength(),
            );
        }
    }

    private getStreamId(channelUri: ChannelUri, streamId: number): void {
        const streamIdParam = channelUri.get(STREAM_ID_PARAM_NAME);
        if (null !== streamIdParam) {
            const configuredStreamId = PublicationParams.parseInt(streamIdParam, STREAM_ID_PARAM_NAME);
            if (streamId !== configuredStreamId) {
                throw new InvalidChannelException(
                    STREAM_ID_PARAM_NAME + '=' + configuredStreamId + ' does not match provided streamId=' + streamId,
                );
            }
        }

        this.streamId = streamId;
    }

    private getEntityTag(channelUri: ChannelUri, driverConductor: DriverConductor): void {
        const tagParam = channelUri.entityTag();
        if (null !== tagParam) {
            this.entityTag = PublicationParams.parseEntityTag(tagParam, driverConductor, channelUri);
        }
    }

    private getTermBufferLength(channelUri: ChannelUri): void {
        const termLengthParam = channelUri.get(TERM_LENGTH_PARAM_NAME);
        if (null !== termLengthParam) {
            const termLength = SystemUtil.parseSize(TERM_LENGTH_PARAM_NAME, termLengthParam) | 0;
            LogBufferDescriptor.checkTermLength(termLength);
            PublicationParams.validateTermLength(this, termLength, channelUri);
            this.termLength = termLength;
        }
    }

    private getMtuLength(channelUri: ChannelUri): void {
        const mtuParam = channelUri.get(MTU_LENGTH_PARAM_NAME);
        if (null !== mtuParam) {
            const mtuLength = SystemUtil.parseSize(MTU_LENGTH_PARAM_NAME, mtuParam) | 0;
            Configuration.validateMtuLength(mtuLength);
            PublicationParams.validateMtuLength(this, mtuLength, channelUri);
            this.mtuLength = mtuLength;
        }

        const maxMessageLength = FrameDescriptor.computeMaxMessageLength(this.termLength);
        if (this.mtuLength > maxMessageLength) {
            throw new InvalidChannelException(
                'MTU greater than max message length for term length: mtu=' +
                    this.mtuLength +
                    ' maxMessageLength=' +
                    maxMessageLength +
                    ' termLength=' +
                    this.termLength +
                    ' channel=' +
                    channelUri,
            );
        }
    }

    public static validateTermLength(
        params: PublicationParams,
        explicitTermLength: number,
        channelUri: ChannelUri,
    ): void {
        if (params.isSessionIdTagged && explicitTermLength !== params.termLength) {
            throw new InvalidChannelException(
                TERM_LENGTH_PARAM_NAME +
                    '=' +
                    explicitTermLength +
                    ' does not match session-id tag value: channel=' +
                    channelUri,
            );
        }
    }

    public static validateMtuLength(
        params: PublicationParams,
        explicitMtuLength: number,
        channelUri: ChannelUri,
    ): void {
        if (params.isSessionIdTagged && explicitMtuLength !== params.mtuLength) {
            throw new InvalidChannelException(
                MTU_LENGTH_PARAM_NAME +
                    '=' +
                    explicitMtuLength +
                    ' does not match session-id tag value: channel=' +
                    channelUri,
            );
        }
    }

    private static formatMatchError(
        paramName: string,
        existingValue: string,
        newValue: string,
        existingChannelUri: string,
        newChannelUri: string,
    ): string {
        return (
            "existing publication has different '" +
            paramName +
            "': existing=" +
            existingValue +
            ' requested=' +
            newValue +
            ' existingChannel=' +
            existingChannelUri +
            ' channel=' +
            newChannelUri
        );
    }

    public static confirmMatch(
        channelUri: ChannelUri,
        params: PublicationParams,
        rawLog: RawLog,
        existingSessionId: number,
        existingChannel: string,
        existingInitialTermId: number,
        existingTermId: number,
        existingTermOffset: number,
    ): void {
        const mtuLength = LogBufferDescriptor.mtuLength(rawLog.metaData());
        if (channelUri.containsKey(MTU_LENGTH_PARAM_NAME) && mtuLength !== params.mtuLength) {
            throw new IllegalStateException(
                PublicationParams.formatMatchError(
                    MTU_LENGTH_PARAM_NAME,
                    String(mtuLength),
                    String(params.mtuLength),
                    existingChannel,
                    channelUri.toString(),
                ),
            );
        }

        if (channelUri.containsKey(TERM_LENGTH_PARAM_NAME) && rawLog.termLength() !== params.termLength) {
            throw new IllegalStateException(
                PublicationParams.formatMatchError(
                    TERM_LENGTH_PARAM_NAME,
                    String(rawLog.termLength()),
                    String(params.termLength),
                    existingChannel,
                    channelUri.toString(),
                ),
            );
        }

        if (channelUri.containsKey(SESSION_ID_PARAM_NAME) && params.sessionId !== existingSessionId) {
            throw new IllegalStateException(
                PublicationParams.formatMatchError(
                    SESSION_ID_PARAM_NAME,
                    String(existingSessionId),
                    String(params.sessionId),
                    existingChannel,
                    channelUri.toString(),
                ),
            );
        }

        if (channelUri.containsKey(INITIAL_TERM_ID_PARAM_NAME) && params.initialTermId !== existingInitialTermId) {
            throw new IllegalStateException(
                PublicationParams.formatMatchError(
                    INITIAL_TERM_ID_PARAM_NAME,
                    String(existingInitialTermId),
                    String(params.initialTermId),
                    existingChannel,
                    channelUri.toString(),
                ),
            );
        }

        if (channelUri.containsKey(TERM_ID_PARAM_NAME) && params.termId !== existingTermId) {
            throw new IllegalStateException(
                PublicationParams.formatMatchError(
                    TERM_ID_PARAM_NAME,
                    String(existingTermId),
                    String(params.termId),
                    existingChannel,
                    channelUri.toString(),
                ),
            );
        }

        if (channelUri.containsKey(TERM_OFFSET_PARAM_NAME) && params.termOffset !== existingTermOffset) {
            throw new IllegalStateException(
                PublicationParams.formatMatchError(
                    TERM_OFFSET_PARAM_NAME,
                    String(existingTermOffset),
                    String(params.termOffset),
                    existingChannel,
                    channelUri.toString(),
                ),
            );
        }
    }

    public static validateSpiesSimulateConnection(
        params: PublicationParams,
        existingSpiesSimulateConnection: boolean,
        channel: string,
        existingChannel: string,
    ): void {
        if (params.spiesSimulateConnection !== existingSpiesSimulateConnection) {
            throw new IllegalStateException(
                'existing publication has different spiesSimulateConnection: existing=' +
                    existingSpiesSimulateConnection +
                    ' requested=' +
                    params.spiesSimulateConnection +
                    ' existingChannel=' +
                    existingChannel +
                    ' channel=' +
                    channel,
            );
        }
    }

    private getLingerTimeoutNs(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        const lingerParam = channelUri.get(LINGER_PARAM_NAME);
        if (null !== lingerParam) {
            this.lingerTimeoutNs = SystemUtil.parseDuration(LINGER_PARAM_NAME, lingerParam);
        } else {
            this.lingerTimeoutNs = ctx.publicationLingerTimeoutNs();
        }
    }

    private getSessionId(
        channelUri: ChannelUri,
        driverConductor: DriverConductor,
        streamId: number,
        canonicalForm: string,
    ): void {
        const sessionIdStr = channelUri.get(SESSION_ID_PARAM_NAME);
        if (null !== sessionIdStr) {
            this.isSessionIdTagged = ChannelUri.isTagged(sessionIdStr);
            if (this.isSessionIdTagged) {
                let tag: number;
                try {
                    tag = ChannelUri.getTag(sessionIdStr);
                } catch (ex) {
                    // Java: catch (final RuntimeException ex). A LongOverflowError (a tag outside +/-(2^53 - 1), spec
                    // D5) is a tag Java would have accepted; it is an invalid tag here.
                    if (ex instanceof RuntimeException || ex instanceof LongOverflowError) {
                        throw new InvalidChannelException(
                            SESSION_ID_PARAM_NAME + '=' + sessionIdStr + ' has an invalid tag: channel=' + channelUri,
                            ex,
                        );
                    }
                    throw ex;
                }

                if (channelUri.isIpc()) {
                    const publication = driverConductor.findIpcPublicationByTag(tag);
                    if (null === publication) {
                        throw new InvalidChannelException(
                            SESSION_ID_PARAM_NAME +
                                '=' +
                                sessionIdStr +
                                ' must reference an IPC publication: ' +
                                'channel=' +
                                channelUri,
                        );
                    }

                    this.sessionId = publication.sessionId();
                    this.mtuLength = publication.mtuLength();
                    this.termLength = publication.termBufferLength();
                } else {
                    const publication = driverConductor.findNetworkPublicationByTag(tag);
                    if (null === publication) {
                        throw new InvalidChannelException(
                            SESSION_ID_PARAM_NAME +
                                '=' +
                                sessionIdStr +
                                ' must reference a network publication: ' +
                                'channel=' +
                                channelUri,
                        );
                    }

                    this.sessionId = publication.sessionId();
                    this.mtuLength = publication.mtuLength();
                    this.termLength = publication.termBufferLength();
                }
            } else {
                this.sessionId = PublicationParams.parseInt(sessionIdStr, SESSION_ID_PARAM_NAME);
            }
        } else {
            this.sessionId = driverConductor.nextAvailableSessionId(streamId, canonicalForm);
        }
    }

    private getEos(channelUri: ChannelUri): void {
        const eosStr = channelUri.get(EOS_PARAM_NAME);
        this.signalEos = null === eosStr || 'true' === eosStr;
    }

    private getSparse(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        const sparseStr = channelUri.get(SPARSE_PARAM_NAME);
        this.isSparse = null !== sparseStr ? 'true' === sparseStr : ctx.termBufferSparseFile();
    }

    private getSpiesSimulateConnection(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        const sscStr = channelUri.get(SPIES_SIMULATE_CONNECTION_PARAM_NAME);
        this.spiesSimulateConnection = null !== sscStr ? 'true' === sscStr : ctx.spiesSimulateConnection();
    }

    private getTimeoutNs(channelUri: ChannelUri, paramName: string, defaultValue: number): number {
        const timeoutString = channelUri.get(paramName);
        return null !== timeoutString ? SystemUtil.parseDuration(paramName, timeoutString) : defaultValue;
    }

    private getUntetheredWindowLimitTimeout(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        this.untetheredWindowLimitTimeoutNs = this.getTimeoutNs(
            channelUri,
            UNTETHERED_WINDOW_LIMIT_TIMEOUT_PARAM_NAME,
            ctx.untetheredWindowLimitTimeoutNs(),
        );
    }

    private getUntetheredLingerTimeout(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        this.untetheredLingerTimeoutNs = this.getTimeoutNs(
            channelUri,
            UNTETHERED_LINGER_TIMEOUT_PARAM_NAME,
            ctx.untetheredLingerTimeoutNs(),
        );

        if (Aeron.NULL_VALUE === this.untetheredLingerTimeoutNs) {
            this.untetheredLingerTimeoutNs = this.untetheredWindowLimitTimeoutNs;
        }
    }

    private getUntetheredRestingTimeout(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        this.untetheredRestingTimeoutNs = this.getTimeoutNs(
            channelUri,
            UNTETHERED_RESTING_TIMEOUT_PARAM_NAME,
            ctx.untetheredRestingTimeoutNs(),
        );
    }

    private getMaxResend(channelUri: ChannelUri, ctx: MediaDriver.Context): void {
        const maxRetransmtsString = channelUri.get(MAX_RESEND_PARAM_NAME);
        if (maxRetransmtsString === null) {
            this.maxResend = ctx.maxResend();
        } else {
            this.maxResend = PublicationParams.parseInt(maxRetransmtsString, MAX_RESEND_PARAM_NAME);
            if (this.maxResend <= 0 || this.maxResend > Configuration.MAX_RESEND_MAX) {
                throw new InvalidChannelException(
                    'invalid ' +
                        MAX_RESEND_PARAM_NAME +
                        '=' +
                        this.maxResend +
                        ', must be > 0 and <= ' +
                        Configuration.MAX_RESEND_MAX,
                );
            }
        }
    }

    private static parseInt(value: string, paramName: string): number {
        try {
            return Integer.parseInt(value);
        } catch (ex) {
            if (!(ex instanceof NumberFormatException)) {
                throw ex;
            }
            throw new InvalidChannelException('invalid ' + paramName + ', must be a number', ex);
        }
    }

    private static parseLong(value: string, paramName: string): number {
        try {
            return Long.parseLong(value);
        } catch (ex) {
            // A LongOverflowError (a long outside +/-(2^53 - 1), spec D5) is a number Java would have accepted.
            if (!(ex instanceof NumberFormatException || ex instanceof LongOverflowError)) {
                throw ex;
            }
            throw new InvalidChannelException('invalid ' + paramName + ', must be a number', ex);
        }
    }

    private static parseResponseCorrelationId(channelUri: ChannelUri): number {
        const idStr = channelUri.get(RESPONSE_CORRELATION_ID_PARAM_NAME, '-1');
        if (PROTOTYPE_CORRELATION_ID === idStr) {
            return PublicationParams.PROTOTYPE_VALUE_CORRELATION_ID;
        }

        try {
            const value = Long.parseLong(idStr);
            if (value < -1) {
                throw new NumberFormatException('responseCorrelationId must be positive');
            }

            return value;
        } catch (ex) {
            if (!(ex instanceof NumberFormatException || ex instanceof LongOverflowError)) {
                throw ex;
            }
            throw new InvalidChannelException(
                'invalid ' +
                    RESPONSE_CORRELATION_ID_PARAM_NAME +
                    ", must be a number greater than or equal to -1, or '" +
                    PROTOTYPE_CORRELATION_ID +
                    "'",
                ex,
            );
        }
    }

    private static parseEntityTag(tagParam: string, driverConductor: DriverConductor, channelUri: ChannelUri): number {
        let entityTag: number;
        try {
            entityTag = Long.parseLong(tagParam);
        } catch (ex) {
            if (!(ex instanceof NumberFormatException || ex instanceof LongOverflowError)) {
                throw ex;
            }
            throw new InvalidChannelException('invalid entity tag, must be a number', ex);
        }

        if (INVALID_TAG === entityTag) {
            throw new InvalidChannelException(INVALID_TAG + ' tag is reserved: channel=' + channelUri);
        }

        const networkPublication = driverConductor.findNetworkPublicationByTag(entityTag);
        if (null !== networkPublication) {
            throw new InvalidChannelException(
                entityTag +
                    ' entityTag already in use: existingChannel=' +
                    networkPublication.channel() +
                    ' channel=' +
                    channelUri,
            );
        }

        const ipcPublication = driverConductor.findIpcPublicationByTag(entityTag);
        if (null !== ipcPublication) {
            throw new InvalidChannelException(
                entityTag +
                    ' entityTag already in use: existingChannel=' +
                    ipcPublication.channel() +
                    ' channel=' +
                    channelUri,
            );
        }

        return entityTag;
    }

    public toString(): string {
        return (
            'PublicationParams{' +
            'lingerTimeoutNs=' +
            this.lingerTimeoutNs +
            ', entityTag=' +
            this.entityTag +
            ', termLength=' +
            this.termLength +
            ', mtuLength=' +
            this.mtuLength +
            ', initialTermId=' +
            this.initialTermId +
            ', termId=' +
            this.termId +
            ', termOffset=' +
            this.termOffset +
            ', streamId=' +
            this.streamId +
            ', sessionId=' +
            this.sessionId +
            ', hasPosition=' +
            this.hasPosition +
            ', isSessionIdTagged=' +
            this.isSessionIdTagged +
            ', isSparse=' +
            this.isSparse +
            ', signalEos=' +
            this.signalEos +
            ', spiesSimulateConnection=' +
            this.spiesSimulateConnection +
            ', maxResend=' +
            this.maxResend +
            ', publicationWindowLength=' +
            this.publicationWindowLength +
            '}'
        );
    }
}
