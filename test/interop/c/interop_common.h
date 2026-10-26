// Shared by the interop helpers (T23): the payload pattern, which is the same as `fillMessage` / `checkMessage` of
// test/support/SystemRig.ts, and a monotonic clock.
#ifndef INTEROP_COMMON_H
#define INTEROP_COMMON_H

#include <inttypes.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <time.h>

/* Byte i of message `sequence`: the sequence as 4 little endian bytes, then a pattern of it. */
static inline uint8_t interop_byte(uint32_t sequence, size_t i)
{
    return i < 4 ? (uint8_t)((sequence >> (8 * i)) & 0xff) : (uint8_t)((sequence * 31u + (uint32_t)i * 7u) & 0xff);
}

static inline void interop_fill(uint8_t *buffer, uint32_t sequence, size_t length)
{
    for (size_t i = 0; i < length; i++)
    {
        buffer[i] = interop_byte(sequence, i);
    }
}

static inline int64_t interop_now_ms(void)
{
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (int64_t)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

#endif
