// The argument shapes of node's `dgram.Socket.send` that the fake sockets of the tests accept, as node reads them:
// `(buffer, callback)` on a connected socket, `(buffer, offset, length[, callback])`,
// `(buffer, port, address[, callback])` and `(buffer, offset, length, port, address[, callback])`.
export type SendCallback = (err: Error | null, bytes: number) => void;

export interface SendArgs {
    offset: number;
    length: number;
    port: number | undefined;
    address: string | undefined;
    callback: SendCallback | undefined;
}

export function parseSendArgs(buffer: Uint8Array, args: unknown[]): SendArgs {
    let offset = 0;
    let length = buffer.length;
    let rest = args;
    if ('number' === typeof args[0] && 'number' === typeof args[1]) {
        offset = args[0];
        length = args[1];
        rest = args.slice(2);
    }

    let port: number | undefined;
    let address: string | undefined;
    let callback: SendCallback | undefined;
    if ('number' === typeof rest[0]) {
        port = rest[0];
        address = rest[1] as string | undefined;
        callback = rest[2] as SendCallback | undefined;
    } else {
        callback = rest[0] as SendCallback | undefined;
    }

    return { offset, length, port, address, callback };
}
