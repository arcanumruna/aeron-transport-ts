// Interop helper (T23): a C subscriber that checks what it reads against the payload pattern of interop_publisher.
//
//   interop_subscriber -d <aeron dir> -c <channel> [-s <stream>] [-n <count>] [-l <last sequence>] [-S <len,len,...>] [-t <deadline ms>] [-q <quiet ms>] [-P <pause ms>] [-D <destination>]... [-E]
//
// It reads whole messages (fragment assembler) and checks, for each session, that the sequence numbers go up by one
// from the first message it reads, and that every byte is the pattern of the sequence number (a message of 1..3
// bytes holds the low bytes of the sequence only). Stops when `count` messages were read (0: no limit) or the message `last` was read, when stdin
// is closed, or at the deadline `-t`; after that it keeps polling for `-q` ms (default 300) to find
// messages that should not be there. Prints one JSON object per line on stdout, each flushed:
//   {"event":"ready"}                              the subscription exists
//   {"event":"available","sessionId":..,"joinPosition":..}   an image was created
//   {"event":"unavailable","sessionId":..,"eos":true|false}  an image ended; `eos` is the end of stream flag
//   {"event":"summary",...}                        the last line, with the counts and the first error
// `-P` makes a slow consumer: after the first message it reads, it stops polling for that many ms (once), so that the
// window of the receiver stops moving and the publisher is back pressured; then it reads on. Default: no pause.
//   {"event":"paused"}                             printed when the pause starts
// `-D` (repeatable, D116) adds a destination to a multi-destination subscription (`control-mode=manual`) before it
// reports ready, with `aeron_subscription_async_add_destination`.
// `-E` makes the subscriber wait for an image to end (a publication that closes) as well as for `count` / `last`, so
// that the end of stream of a publication that closes after its last message is part of the summary.
// Exit code 0 when the summary has no error and the count was reached.
#include <poll.h>
#include <sched.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "aeronc.h"
#include "interop_common.h"

#define MAX_SESSIONS 16
#define MAX_DESTINATIONS 16

typedef struct
{
    int32_t session_id;
    int64_t first;
    int64_t last;
    uint64_t count;
} session_t;

#define MAX_LENGTHS 32

typedef struct
{
    size_t lengths[MAX_LENGTHS];
    int length_count;
    session_t sessions[MAX_SESSIONS];
    int session_count;
    uint64_t count;
    uint64_t errors;
    char first_error[256];
    uint64_t available;
    uint64_t unavailable;
    uint64_t eos;
} state_t;

static state_t state;

static void record_error(state_t *state, const char *what, int32_t session_id, int64_t sequence, size_t length)
{
    if (0 == state->errors++)
    {
        snprintf(
            state->first_error, sizeof state->first_error, "%s (session %d, sequence %" PRId64 ", %zu bytes)", what,
            session_id, sequence, length);
    }
}

static void on_fragment(void *clientd, const uint8_t *buffer, size_t length, aeron_header_t *header)
{
    state_t *state = clientd;
    aeron_header_values_t values;
    aeron_header_values(header, &values);
    int32_t session_id = values.frame.session_id;

    session_t *session = NULL;
    for (int i = 0; i < state->session_count; i++)
    {
        if (state->sessions[i].session_id == session_id)
        {
            session = &state->sessions[i];
        }
    }

    /* the sequence: 4 bytes, or the low bytes of it for a message of 1..3 bytes */
    int64_t sequence = 0;
    for (size_t i = 0; i < length && i < 4; i++)
    {
        sequence |= (int64_t)buffer[i] << (8 * i);
    }

    if (NULL == session)
    {
        if (state->session_count == MAX_SESSIONS)
        {
            record_error(state, "too many sessions", session_id, sequence, length);
            return;
        }
        session = &state->sessions[state->session_count++];
        session->session_id = session_id;
        session->first = sequence;
        session->last = sequence - 1;
        session->count = 0;
    }

    int64_t expected = session->last + 1;
    int64_t mask = length >= 4 ? 0xffffffffLL : ((1LL << (8 * length)) - 1);
    if ((expected & mask) != sequence)
    {
        record_error(state, (sequence & mask) == ((session->last) & mask) ? "duplicate" : "gap or reorder", session_id, sequence, length);
        session->last = length >= 4 ? sequence : expected;
    }
    else
    {
        session->last = expected;
    }

    if (state->length_count > 0 && length != state->lengths[(uint32_t)session->last % (uint32_t)state->length_count])
    {
        record_error(state, "wrong length", session_id, sequence, length);
    }

    for (size_t i = 4; i < length; i++)
    {
        if (buffer[i] != interop_byte((uint32_t)sequence, i))
        {
            record_error(state, "payload byte differs", session_id, sequence, length);
            break;
        }
    }

    session->count++;
    state->count++;
}

static void on_available(void *clientd, aeron_subscription_t *subscription, aeron_image_t *image)
{
    state_t *state = clientd;
    aeron_image_constants_t constants;
    aeron_image_constants(image, &constants);
    state->available++;
    printf(
        "{\"event\":\"available\",\"sessionId\":%d,\"joinPosition\":%" PRId64 "}\n", constants.session_id,
        constants.join_position);
    fflush(stdout);
}

static void on_unavailable(void *clientd, aeron_subscription_t *subscription, aeron_image_t *image)
{
    state_t *state = clientd;
    aeron_image_constants_t constants;
    aeron_image_constants(image, &constants);
    bool eos = aeron_image_is_end_of_stream(image);
    state->unavailable++;
    state->eos += eos ? 1 : 0;
    printf("{\"event\":\"unavailable\",\"sessionId\":%d,\"eos\":%s}\n", constants.session_id, eos ? "true" : "false");
    fflush(stdout);
}

static bool stdin_closed(void)
{
    struct pollfd fds = { .fd = 0, .events = POLLIN };
    if (poll(&fds, 1, 0) > 0)
    {
        char scratch[64];
        return read(0, scratch, sizeof scratch) <= 0;
    }
    return false;
}

static void print_json_string(const char *text)
{
    putchar('"');
    for (; '\0' != *text; text++)
    {
        if ('"' == *text || '\\' == *text)
        {
            putchar('\\');
        }
        putchar(*text);
    }
    putchar('"');
}

int main(int argc, char **argv)
{
    const char *dir = NULL, *channel = NULL;
    int32_t stream_id = 1001;
    uint64_t want = 0;
    int64_t last_target = -1;
    int64_t deadline_ms = 60000, quiet_ms = 300, pause_ms = 0;
    const char *destinations[MAX_DESTINATIONS];
    int destination_count = 0;
    bool wait_for_end = false;
    int opt;

    while ((opt = getopt(argc, argv, "d:c:s:n:l:S:t:q:P:D:E")) != -1)
    {
        switch (opt)
        {
            case 'd': dir = optarg; break;
            case 'c': channel = optarg; break;
            case 's': stream_id = (int32_t)strtol(optarg, NULL, 10); break;
            case 'n': want = strtoull(optarg, NULL, 10); break;
            case 'l': last_target = strtoll(optarg, NULL, 10); break;
            case 'S':
            {
                char *copy = strdup(optarg);
                for (char *token = strtok(copy, ","); NULL != token && state.length_count < MAX_LENGTHS;
                     token = strtok(NULL, ","))
                {
                    state.lengths[state.length_count++] = (size_t)strtoull(token, NULL, 10);
                }
                free(copy);
                break;
            }
            case 't': deadline_ms = strtoll(optarg, NULL, 10); break;
            case 'q': quiet_ms = strtoll(optarg, NULL, 10); break;
            case 'P': pause_ms = strtoll(optarg, NULL, 10); break;
            case 'E': wait_for_end = true; break;
            case 'D':
                if (destination_count == MAX_DESTINATIONS)
                {
                    fprintf(stderr, "too many destinations\n");
                    return 2;
                }
                destinations[destination_count++] = optarg;
                break;
            default: fprintf(stderr, "bad option\n"); return 2;
        }
    }

    if (NULL == dir || NULL == channel)
    {
        fprintf(stderr, "usage: -d dir -c channel [-s stream] [-n count] [-t deadline ms] [-q quiet ms]\n");
        return 2;
    }

    aeron_context_t *context = NULL;
    aeron_t *aeron = NULL;
    aeron_async_add_subscription_t *async = NULL;
    aeron_subscription_t *subscription = NULL;
    aeron_fragment_assembler_t *assembler = NULL;
    int status = 1;
    int64_t start = interop_now_ms();

    if (aeron_context_init(&context) < 0 || aeron_context_set_dir(context, dir) < 0 || aeron_init(&aeron, context) < 0 ||
        aeron_start(aeron) < 0)
    {
        fprintf(stderr, "aeron init: %s\n", aeron_errmsg());
        goto cleanup;
    }

    if (aeron_async_add_subscription(&async, aeron, channel, stream_id, on_available, &state, on_unavailable, &state) < 0)
    {
        fprintf(stderr, "add subscription: %s\n", aeron_errmsg());
        goto cleanup;
    }

    while (NULL == subscription)
    {
        if (aeron_async_add_subscription_poll(&subscription, async) < 0 || interop_now_ms() - start > deadline_ms)
        {
            fprintf(stderr, "subscription: %s\n", aeron_errmsg());
            goto cleanup;
        }
        sched_yield();
    }

    for (int i = 0; i < destination_count; i++)
    {
        aeron_async_destination_t *async_destination = NULL;
        if (aeron_subscription_async_add_destination(&async_destination, aeron, subscription, destinations[i]) < 0)
        {
            fprintf(stderr, "add destination %s: %s\n", destinations[i], aeron_errmsg());
            goto cleanup;
        }

        int polled = 0;
        while (0 == polled)
        {
            polled = aeron_subscription_async_destination_poll(async_destination);
            if (polled < 0 || (0 == polled && interop_now_ms() - start > deadline_ms))
            {
                fprintf(stderr, "destination %s: %s\n", destinations[i], aeron_errmsg());
                goto cleanup;
            }
            sched_yield();
        }
    }

    if (aeron_fragment_assembler_create(&assembler, on_fragment, &state) < 0)
    {
        fprintf(stderr, "assembler: %s\n", aeron_errmsg());
        goto cleanup;
    }

    printf("{\"event\":\"ready\"}\n");
    fflush(stdout);

    int64_t reached_ms = 0;
    int idle = 0;
    while (interop_now_ms() - start < deadline_ms)
    {
        int read_fragments = aeron_subscription_poll(subscription, aeron_fragment_assembler_handler, assembler, 16);
        if (read_fragments < 0)
        {
            fprintf(stderr, "poll: %s\n", aeron_errmsg());
            goto cleanup;
        }

        if (pause_ms > 0 && state.count > 0)
        {
            printf("{\"event\":\"paused\"}\n");
            fflush(stdout);
            usleep((useconds_t)(pause_ms * 1000));
            pause_ms = 0;
        }

        bool reached = want > 0 && state.count >= want;
        for (int i = 0; last_target >= 0 && i < state.session_count; i++)
        {
            reached = reached || state.sessions[i].last >= last_target;
        }

        reached = reached && (!wait_for_end || state.unavailable > 0);

        if (0 == reached_ms && reached)
        {
            reached_ms = interop_now_ms();
        }

        if (0 != reached_ms && interop_now_ms() - reached_ms >= quiet_ms)
        {
            break;
        }

        if (0 == read_fragments)
        {
            if (++idle % 64 == 0)
            {
                if (stdin_closed())
                {
                    break;
                }
                usleep(200);
            }
            else
            {
                sched_yield();
            }
        }
    }

    printf("{\"event\":\"summary\",\"count\":%" PRIu64 ",\"errors\":%" PRIu64 ",\"firstError\":", state.count, state.errors);
    print_json_string(state.first_error);
    printf(
        ",\"available\":%" PRIu64 ",\"unavailable\":%" PRIu64 ",\"eos\":%" PRIu64 ",\"sessions\":[", state.available,
        state.unavailable, state.eos);
    for (int i = 0; i < state.session_count; i++)
    {
        printf(
            "%s{\"sessionId\":%d,\"first\":%" PRId64 ",\"last\":%" PRId64 ",\"count\":%" PRIu64 "}", i > 0 ? "," : "",
            state.sessions[i].session_id, state.sessions[i].first, state.sessions[i].last, state.sessions[i].count);
    }
    printf("]}\n");
    fflush(stdout);
    status = (0 == state.errors && 0 != reached_ms) || (0 == state.errors && 0 == want && last_target < 0) ? 0 : 1;

cleanup:
    if (NULL != subscription)
    {
        aeron_subscription_close(subscription, NULL, NULL);
    }
    if (NULL != aeron)
    {
        aeron_close(aeron);
    }
    if (NULL != context)
    {
        aeron_context_close(context);
    }
    if (NULL != assembler)
    {
        aeron_fragment_assembler_delete(assembler);
    }
    return status;
}
