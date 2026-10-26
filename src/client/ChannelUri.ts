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
// Port of io/aeron/ChannelUri.java @ 1.53.3
import { AsciiEncoding } from '../agrona/AsciiEncoding.js';
import { Object2ObjectHashMap } from '../agrona/collections/Object2ObjectHashMap.js';
import { IllegalArgumentException, IllegalStateException, Long } from '../agrona/jdk.js';
import { hashCodeOf, objectsEquals, requireNonNull } from '../agrona/jdkUtil.js';
import { Strings } from '../agrona/Strings.js';
import { NULL_VALUE } from './NullValue.js';
import { CommonContext } from './CommonContext.js';
import { FrameDescriptor } from './logbuffer/FrameDescriptor.js';
import { LogBufferDescriptor } from './logbuffer/LogBufferDescriptor.js';

type State = 'MEDIA' | 'PARAMS_KEY' | 'PARAMS_VALUE';

const CHANNEL_TAG_INDEX = 0;
const ENTITY_TAG_INDEX = 1;

/**
 * `java.util.Arrays.equals(Object[], Object[])`.
 */
function arraysEquals(a: readonly string[], b: readonly string[]): boolean {
    if (a.length !== b.length) {
        return false;
    }

    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }

    return true;
}

/**
 * `java.util.Arrays.hashCode(Object[])`.
 */
function arraysHashCode(a: readonly string[]): number {
    let result = 1;
    for (const element of a) {
        result = (Math.imul(31, result) + hashCodeOf(element)) | 0;
    }

    return result;
}

/**
 * `java.util.Arrays.toString(Object[])`.
 */
function arraysToString(a: readonly string[]): string {
    return '[' + a.join(', ') + ']';
}

/**
 * Parser for Aeron channel URIs. The format is:
 * <pre>
 * aeron-uri = "aeron:" media [ "?" param *( "|" param ) ]
 * media     = *( "[^?:]" )
 * param     = key "=" value
 * key       = *( "[^=]" )
 * value     = *( "[^|]" )
 * </pre>
 * <p>
 * Multiple params with the same key are allowed, the last value specified takes precedence.
 *
 * @see ChannelUriStringBuilder
 */
export class ChannelUri {
    /**
     * URI Scheme for Aeron channels and destinations.
     */
    public static readonly AERON_SCHEME: string = 'aeron';

    /**
     * Qualifier for spy subscriptions which spy on outgoing network destined traffic efficiently.
     */
    public static readonly SPY_QUALIFIER: string = 'aeron-spy';

    /**
     * Invalid tag value returned when calling {@link #getTag(String)} and the channel is not tagged.
     */
    public static readonly INVALID_TAG: number = NULL_VALUE;

    /**
     * Max length in characters for the URI string.
     */
    public static readonly MAX_URI_LENGTH: number = 4095;

    private static readonly AERON_PREFIX: string = ChannelUri.AERON_SCHEME + ':';

    private _prefix: string | null;
    private _media: string;
    private readonly params: Object2ObjectHashMap<string, string>;
    private readonly tags: string[];

    /**
     * Construct with the components provided to avoid parsing.
     *
     * @param prefix empty if no prefix is required otherwise expected to be 'aeron-spy'
     * @param media  for the channel which is typically "udp" or "ipc".
     * @param params for the query string as key value pairs.
     */
    private constructor(prefix: string, media: string, params: Object2ObjectHashMap<string, string>) {
        this._prefix = prefix;
        this._media = media;
        this.params = params;
        this.tags = ChannelUri.splitTags(params.get(CommonContext.TAGS_PARAM_NAME));
    }

    /**
     * The prefix for the channel, or change the prefix from what has been parsed.
     *
     * @param prefix to replace the existing prefix, none to get it.
     * @return the prefix for the channel, or this for a fluent API.
     */
    public prefix(): string | null;
    public prefix(prefix: string | null): this;
    public prefix(prefix?: string | null): string | null | this {
        if (undefined === prefix) {
            return this._prefix;
        }

        this._prefix = prefix;
        return this;
    }

    /**
     * The media over which the channel operates, or set the media over which the channel operates.
     *
     * @param media to replace the parsed value, none to get it.
     * @return the media over which the channel operates, or this for a fluent API.
     */
    public media(): string;
    public media(media: string): this;
    public media(media?: string): string | this {
        if (undefined === media) {
            return this._media;
        }

        ChannelUri.validateMedia(media);
        this._media = media;
        return this;
    }

    /**
     * Is the channel {@link #media()} equal to {@link CommonContext#UDP_MEDIA}.
     *
     * @return true the channel {@link #media()} equals {@link CommonContext#UDP_MEDIA}.
     */
    public isUdp(): boolean {
        return CommonContext.UDP_MEDIA === this._media;
    }

    /**
     * Is the channel {@link #media()} equal to {@link CommonContext#IPC_MEDIA}.
     *
     * @return true the channel {@link #media()} equals {@link CommonContext#IPC_MEDIA}.
     */
    public isIpc(): boolean {
        return CommonContext.IPC_MEDIA === this._media;
    }

    /**
     * The scheme for the URI. Must be "aeron".
     *
     * @return the scheme for the URI.
     */
    public scheme(): string {
        return ChannelUri.AERON_SCHEME;
    }

    /**
     * Get a value for a given parameter key, or the default value provided if the key does not exist.
     *
     * @param key          to lookup.
     * @param defaultValue to be returned if no key match is found.
     * @return the value if set for the key otherwise the default value provided, or null.
     */
    public get(key: string): string | null;
    public get(key: string, defaultValue: string): string;
    public get(key: string, defaultValue: string | null): string | null;
    public get(key: string, defaultValue?: string | null): string | null {
        const value = this.params.get(key);
        if (null !== value) {
            return value;
        }

        return undefined === defaultValue ? null : defaultValue;
    }

    /**
     * Put a key and value pair in the map of params.
     *
     * @param key   of the param to be put.
     * @param value of the param to be put.
     * @return the existing value otherwise null.
     */
    public put(key: string, value: string): string | null {
        return this.params.put(key, value);
    }

    /**
     * Remove a key pair in the map of params.
     *
     * @param key of the param to be removed.
     * @return the previous value of the param or null.
     */
    public remove(key: string): string | null {
        return this.params.remove(key);
    }

    /**
     * Does the URI contain a value for the given key.
     *
     * @param key to be lookup.
     * @return true if the key has a value otherwise false.
     */
    public containsKey(key: string): boolean {
        return this.params.containsKey(key);
    }

    /**
     * Get the channel tag, if it exists, that refers to another channel.
     *
     * @return channel tag if it exists or null if not in this URI.
     * @see CommonContext#TAGS_PARAM_NAME
     * @see CommonContext#TAG_PREFIX
     */
    public channelTag(): string | null {
        return this.tags.length > CHANNEL_TAG_INDEX ? this.tags[CHANNEL_TAG_INDEX]! : null;
    }

    /**
     * Get the entity tag, if it exists, that refers to an entity such as subscription or publication.
     *
     * @return entity tag if it exists or null if not in this URI.
     * @see CommonContext#TAGS_PARAM_NAME
     * @see CommonContext#TAG_PREFIX
     */
    public entityTag(): string | null {
        return this.tags.length > ENTITY_TAG_INDEX ? this.tags[ENTITY_TAG_INDEX]! : null;
    }

    /**
     * {@inheritDoc}
     */
    public equals(o: unknown): boolean {
        if (this === o) {
            return true;
        }

        if (!(o instanceof ChannelUri)) {
            return false;
        }

        const that = o;

        return (
            objectsEquals(this._prefix, that._prefix) &&
            objectsEquals(this._media, that._media) &&
            objectsEquals(this.params, that.params) &&
            arraysEquals(this.tags, that.tags)
        );
    }

    /**
     * {@inheritDoc}
     */
    public hashCode(): number {
        let result = 19;
        result = (Math.imul(31, result) + hashCodeOf(this._prefix)) | 0;
        result = (Math.imul(31, result) + hashCodeOf(this._media)) | 0;
        result = (Math.imul(31, result) + hashCodeOf(this.params)) | 0;
        result = (Math.imul(31, result) + arraysHashCode(this.tags)) | 0;

        return result;
    }

    /**
     * Generate a String representation of the URI that is valid for an Aeron channel.
     *
     * @return a String representation of the URI that is valid for an Aeron channel.
     */
    public toString(): string {
        let sb: string;
        if (this._prefix === null || this._prefix.length === 0) {
            sb = '';
        } else {
            sb = this._prefix;
            if (!this._prefix.endsWith(':')) {
                sb += ':';
            }
        }

        sb += ChannelUri.AERON_PREFIX + this._media;

        if (!this.params.isEmpty()) {
            sb += '?';

            // entrySet() iterates the slots backwards, as Java's Agrona EntryIterator does (forEach goes forwards)
            const iterator = this.params.entrySet().iterator();
            while (iterator.hasNext()) {
                const entry = iterator.next();
                sb += entry.getKey() + '=' + entry.getValue() + '|';
            }

            sb = sb.substring(0, sb.length - 1);
        }

        return sb;
    }

    /**
     * Initialise a channel for restarting a publication at a given position.
     *
     * @param position      at which the publication should be started.
     * @param initialTermId what which the stream would start.
     * @param termLength    for the stream.
     */
    public initialPosition(position: number, initialTermId: number, termLength: number): void {
        Long.checkSafe(position);
        if (position < 0 || 0 !== Long.and(position, FrameDescriptor.FRAME_ALIGNMENT - 1)) {
            throw new IllegalArgumentException('invalid position: ' + position);
        }

        const bitsToShift = LogBufferDescriptor.positionBitsToShift(termLength);
        const termId = LogBufferDescriptor.computeTermIdFromPosition(position, bitsToShift, initialTermId);
        const termOffset = Long.and(position, termLength - 1) | 0;

        this.put(CommonContext.INITIAL_TERM_ID_PARAM_NAME, String(initialTermId));
        this.put(CommonContext.TERM_ID_PARAM_NAME, String(termId));
        this.put(CommonContext.TERM_OFFSET_PARAM_NAME, String(termOffset));
        this.put(CommonContext.TERM_LENGTH_PARAM_NAME, String(termLength));
    }

    /**
     * Parse a {@link CharSequence} which contains an Aeron URI.
     *
     * @param uri to be parsed.
     * @return a new {@link ChannelUri} representing the URI string.
     */
    public static parse(uri: string): ChannelUri {
        const length = uri.length;
        if (length > ChannelUri.MAX_URI_LENGTH) {
            throw new IllegalArgumentException(
                'URI length (' +
                    length +
                    ') exceeds max supported length (' +
                    ChannelUri.MAX_URI_LENGTH +
                    '): ' +
                    uri.substring(0, ChannelUri.MAX_URI_LENGTH),
            );
        }

        let position = 0;
        let prefix: string;
        if (ChannelUri.startsWith(uri, 0, CommonContext.SPY_PREFIX)) {
            prefix = ChannelUri.SPY_QUALIFIER;
            position = CommonContext.SPY_PREFIX.length;
        } else {
            prefix = '';
        }

        if (!ChannelUri.startsWith(uri, position, ChannelUri.AERON_PREFIX)) {
            throw new IllegalArgumentException("Aeron URIs must start with 'aeron:', found: " + uri);
        } else {
            position += ChannelUri.AERON_PREFIX.length;
        }

        let builder = '';
        const params = new Object2ObjectHashMap<string, string>();
        let media: string | null = null;
        let key: string | null = null;

        let state: State = 'MEDIA';
        for (let i = position; i < length; i++) {
            const c = uri.charAt(i);
            switch (state) {
                case 'MEDIA':
                    switch (c) {
                        case '?':
                            media = builder;
                            builder = '';
                            state = 'PARAMS_KEY';
                            break;

                        case ':':
                        case '|':
                        case '=':
                            throw new IllegalArgumentException(
                                "encountered '" + c + "' within media definition at index " + i + ' in ' + uri,
                            );

                        default:
                            builder += c;
                    }
                    break;

                case 'PARAMS_KEY':
                    if (c === '=') {
                        if (builder.length === 0) {
                            throw new IllegalStateException('empty key not allowed at index ' + i + ' in ' + uri);
                        }
                        key = builder;
                        builder = '';
                        state = 'PARAMS_VALUE';
                    } else {
                        if (c === '|') {
                            throw new IllegalStateException('invalid end of key at index ' + i + ' in ' + uri);
                        }
                        builder += c;
                    }
                    break;

                case 'PARAMS_VALUE':
                    if (c === '|') {
                        params.put(key as string, builder);
                        builder = '';
                        state = 'PARAMS_KEY';
                    } else {
                        builder += c;
                    }
                    break;

                default:
                    throw new IllegalStateException('unexpected state=' + String(state) + ' in ' + uri);
            }
        }

        switch (state) {
            case 'MEDIA':
                media = builder;
                ChannelUri.validateMedia(media);
                break;

            case 'PARAMS_VALUE':
                params.put(key as string, builder);
                break;

            default:
                throw new IllegalStateException('no more input found, state=' + String(state) + ' in ' + uri);
        }

        return new ChannelUri(prefix, media as string, params);
    }

    /**
     * Add a sessionId to a given channel.
     *
     * @param channel   to add sessionId to.
     * @param sessionId to add to channel.
     * @return new string that represents channel with sessionId added.
     */
    public static addSessionId(channel: string, sessionId: number): string {
        const channelUri = ChannelUri.parse(channel);
        channelUri.put(CommonContext.SESSION_ID_PARAM_NAME, String(sessionId));

        return channelUri.toString();
    }

    /**
     * Add alias to the uri if none exists.
     *
     * @param uri   to add alias to.
     * @param alias to add to the uri.
     * @return original uri if alias is empty or one is already defined, otherwise new uri with an alias.
     */
    public static addAliasIfAbsent(uri: string, alias: string | null): string {
        if (!Strings.isEmpty(alias)) {
            const channelUri = ChannelUri.parse(uri);
            if (!channelUri.containsKey(CommonContext.ALIAS_PARAM_NAME)) {
                channelUri.put(CommonContext.ALIAS_PARAM_NAME, alias);
                return channelUri.toString();
            }
        }
        return uri;
    }

    /**
     * Transforms an alias of the given uri using the given function. The function will be invoked with the original
     * alias or null if absent. The function's return value will be used as the alias in the returned uri. If the
     * function returns null or an empty string, the alias will be removed.
     *
     * @param uri      the uri to transform the alias of.
     * @param function the transformation function.
     * @return uri equivalent to the one passed in with its alias transformed.
     */
    public static transformAlias(uri: string, function_: (alias: string | null) => string | null): string {
        const channelUri = ChannelUri.parse(uri);
        const originalAlias = channelUri.get(CommonContext.ALIAS_PARAM_NAME);
        const transformedAlias = function_(originalAlias);
        if (Strings.isEmpty(transformedAlias)) {
            channelUri.remove(CommonContext.ALIAS_PARAM_NAME);
        } else {
            channelUri.put(CommonContext.ALIAS_PARAM_NAME, transformedAlias);
        }
        return channelUri.toString();
    }

    /**
     * Is the param value tagged? (starts with the "tag:" prefix).
     *
     * @param paramValue to check if tagged.
     * @return true if tagged or false if not.
     * @see CommonContext#TAGS_PARAM_NAME
     * @see CommonContext#TAG_PREFIX
     */
    public static isTagged(paramValue: string): boolean {
        return ChannelUri.startsWith(paramValue, 0, CommonContext.TAG_PREFIX);
    }

    /**
     * Get the value of the tag from a given parameter value. A tag is a `long` held in a `number` (spec D5): one
     * outside +/-(2^53 - 1) throws `RangeError`.
     *
     * @param paramValue to extract the tag value from.
     * @return the value of the tag or {@link #INVALID_TAG} if not tagged.
     * @see CommonContext#TAGS_PARAM_NAME
     * @see CommonContext#TAG_PREFIX
     */
    public static getTag(paramValue: string): number {
        return ChannelUri.isTagged(paramValue)
            ? AsciiEncoding.parseLongAscii(paramValue, 4, paramValue.length - 4)
            : ChannelUri.INVALID_TAG;
    }

    /**
     * Create a channel URI for a destination, i.e. a channel that uses {@code media} and {@code interface} parameters
     * of the original channel and adds specified {@code endpoint} to it. For example given the input channel is
     * {@code aeron:udp?mtu=1440|ttl=0|endpoint=localhost:8090|term-length=128k|interface=eth0} and the endpoint is
     * {@code 192.168.0.14} the output of this method will be {@code aeron:udp?endpoint=192.168.0.14|interface=eth0}.
     *
     * @param channel  for which the destination is being added.
     * @param endpoint for the target destination.
     * @return new channel URI for a destination.
     */
    public static createDestinationUri(channel: string, endpoint: string): string {
        const channelUri = ChannelUri.parse(channel);
        const uri =
            ChannelUri.AERON_PREFIX + channelUri.media() + '?' + CommonContext.ENDPOINT_PARAM_NAME + '=' + endpoint;
        const networkInterface = channelUri.get(CommonContext.INTERFACE_PARAM_NAME);

        if (null !== networkInterface) {
            return uri + '|' + CommonContext.INTERFACE_PARAM_NAME + '=' + networkInterface;
        }

        return uri;
    }

    /**
     * Uses the supplied endpoint to resolve any wildcard ports. If the existing endpoint has a value of "0" for then
     * the port of this endpoint will be used instead. If the endpoint is not specified in this uri, then the whole
     * supplied endpoint is used. If the endpoint exists and has a non-wildcard port, then the existing endpoint is
     * retained.
     *
     * @param resolvedEndpoint The endpoint to supply a resolved endpoint port.
     * @throws IllegalArgumentException if the supplied resolvedEndpoint does not have a port or the port is zero.
     * @throws NullPointerException     if the supplied resolvedEndpoint is null
     */
    public replaceEndpointWildcardPort(resolvedEndpoint: string | null): void {
        const resolved = requireNonNull(resolvedEndpoint, 'resolvedEndpoint is null');
        const portSeparatorIndex = resolved.lastIndexOf(':');
        if (-1 === portSeparatorIndex) {
            throw new IllegalArgumentException('No port specified on resolvedEndpoint=' + resolved);
        }
        if (resolved.endsWith(':0')) {
            throw new IllegalArgumentException('Wildcard port specified on resolvedEndpoint=' + resolved);
        }

        const existingEndpoint = this.get(CommonContext.ENDPOINT_PARAM_NAME);
        if (null === existingEndpoint) {
            this.put(CommonContext.ENDPOINT_PARAM_NAME, resolved);
        } else if (existingEndpoint.endsWith(':0')) {
            const endpoint =
                existingEndpoint.substring(0, existingEndpoint.length - 2) +
                resolved.substring(resolved.lastIndexOf(':'));
            this.put(CommonContext.ENDPOINT_PARAM_NAME, endpoint);
        }
    }

    /**
     * Call consumer for each parameter defined in the URI.
     *
     * @param consumer to be invoked for each parameter.
     */
    public forEachParameter(consumer: (key: string, value: string) => void): void {
        this.params.forEach(consumer);
    }

    /**
     * Determines if this channel has specified <code>control-mode=response</code>.
     *
     * @return true if this channel has specified <code>control-mode=response</code>.
     */
    public hasControlModeResponse(): boolean {
        return CommonContext.CONTROL_MODE_RESPONSE === this.get(CommonContext.MDC_CONTROL_MODE_PARAM_NAME);
    }

    /**
     * Take an endpoint with the format <code>host:port</code> and replace the port with a wildcard (<code>0</code>).
     *
     * @param endpoint to replace with a wildcard.
     * @return  the transformed value.
     */
    public static replacePortWithWildcard(endpoint: string | null): string | null {
        if (null === endpoint) {
            return null;
        }

        const i = endpoint.lastIndexOf(':');
        if (-1 === i) {
            return null;
        }

        return endpoint.substring(0, i + 1) + '0';
    }

    /**
     * Determines if the supplied channel has specified <code>control-mode=response</code>.
     *
     * @param channelUri to check if the control mode is response
     * @return true if the supplied channel has specified <code>control-mode=response</code>.
     */
    public static isControlModeResponse(channelUri: string): boolean {
        return ChannelUri.parse(channelUri).hasControlModeResponse();
    }

    private static validateMedia(media: string): void {
        if (CommonContext.IPC_MEDIA === media || CommonContext.UDP_MEDIA === media) {
            return;
        }

        throw new IllegalArgumentException('unknown media: ' + media);
    }

    private static startsWith(input: string, position: number, prefix: string): boolean {
        if (input.length - position < prefix.length) {
            return false;
        }

        for (let i = 0; i < prefix.length; i++) {
            if (input.charAt(position + i) !== prefix.charAt(i)) {
                return false;
            }
        }

        return true;
    }

    private static splitTags(tagsValue: string | null): string[] {
        let tags: string[] = [];

        if (null !== tagsValue) {
            const tagCount = ChannelUri.countTags(tagsValue);
            if (tagCount === 1) {
                tags = [tagsValue];
            } else {
                let tagStartPosition = 0;
                let tagIndex = 0;
                tags = new Array<string>(tagCount);

                for (let i = 0, length = tagsValue.length; i < length; i++) {
                    if (tagsValue.charAt(i) === ',') {
                        tags[tagIndex++] = tagsValue.substring(tagStartPosition, i);
                        tagStartPosition = i + 1;

                        if (tagIndex >= tagCount - 1) {
                            tags[tagIndex] = tagsValue.substring(tagStartPosition, length);
                        }
                    }
                }
            }
        }

        return tags;
    }

    private static countTags(tags: string): number {
        let count = 1;

        for (let i = 0, length = tags.length; i < length; i++) {
            if (tags.charAt(i) === ',') {
                ++count;
            }
        }

        return count;
    }

    /**
     * The parameters, prefix, media and tags in which this channel differs from `that` (package-private in Java).
     *
     * @param that channel to compare with.
     * @return a map of the differing names to a description of the difference.
     */
    public diff(that: ChannelUri): Map<string, string> {
        const differingValues = new Map<string, string>();

        if (!objectsEquals(this._prefix, that._prefix)) {
            differingValues.set('prefix', this._prefix + ' != ' + that._prefix);
        }

        if (!objectsEquals(this._media, that._media)) {
            differingValues.set('media', this._media + ' != ' + that._media);
        }

        if (!objectsEquals(this.params, that.params)) {
            this.params.forEach((key, value) => {
                const thatValue = that.params.get(key);
                if (!objectsEquals(value, thatValue)) {
                    differingValues.set(key, value + ' != ' + String(thatValue));
                }
            });
        }

        if (!arraysEquals(this.tags, that.tags)) {
            differingValues.set(
                CommonContext.TAGS_PARAM_NAME,
                arraysToString(this.tags) + ' != ' + arraysToString(that.tags),
            );
        }

        return differingValues;
    }
}
