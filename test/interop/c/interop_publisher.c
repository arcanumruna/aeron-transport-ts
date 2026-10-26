// Interop helper (T23): a C publisher of messages whose bytes are derived from their sequence number.
//
//   interop_publisher -d <aeron dir> -c <channel> [-s <stream>] [-n <count>] [-f <first sequence>] [-S <len,len,...>]
//                     [-x] [-t <deadline ms>] [-w <ms to hold the publication open at the end>]
//
// Message `sequence` is `lengths[sequence % lengths.size()]` bytes long. It offers `count` messages from `first` (it
// waits for a subscriber as long as offers answer NOT_CONNECTED, up to the deadline `-t`), prints one JSON line
// ({"event":"sent",...}) on stdout, holds the publication open until stdin closes or `-w` ms have passed (so the test decides when the
// publication ends), then closes it (the subscriber sees the end of the stream). `-x` makes an exclusive publication.
// Exit code 0 when all messages were offered.
#include <poll.h>
#include <sched.h>
#include <stdbool.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#include "aeronc.h"
#include "interop_common.h"

#define MAX_LENGTHS 32

static int parse_lengths(const char *text, size_t *lengths)
{
    int n = 0;
    char *copy = strdup(text);
    for (char *token = strtok(copy, ","); NULL != token && n < MAX_LENGTHS; token = strtok(NULL, ","))
    {
        lengths[n++] = (size_t)strtoull(token, NULL, 10);
    }
    free(copy);
    return n;
}

int main(int argc, char **argv)
{
    const char *dir = NULL, *channel = NULL, *length_text = "100";
    int32_t stream_id = 1001;
    uint64_t count = 1, first = 0;
    int64_t deadline_ms = 60000, hold_ms = 60000;
    bool exclusive = false;
    int opt;

    while ((opt = getopt(argc, argv, "d:c:s:n:f:S:t:w:x")) != -1)
    {
        switch (opt)
        {
            case 'd': dir = optarg; break;
            case 'c': channel = optarg; break;
            case 's': stream_id = (int32_t)strtol(optarg, NULL, 10); break;
            case 'n': count = strtoull(optarg, NULL, 10); break;
            case 'f': first = strtoull(optarg, NULL, 10); break;
            case 'S': length_text = optarg; break;
            case 't': deadline_ms = strtoll(optarg, NULL, 10); break;
            case 'w': hold_ms = strtoll(optarg, NULL, 10); break;
            case 'x': exclusive = true; break;
            default: fprintf(stderr, "bad option\n"); return 2;
        }
    }

    if (NULL == dir || NULL == channel)
    {
        fprintf(stderr, "usage: -d dir -c channel [-s stream] [-n count] [-f first] [-S lengths] [-x]\n");
        return 2;
    }

    size_t lengths[MAX_LENGTHS];
    int length_count = parse_lengths(length_text, lengths);
    size_t max_length = 1;
    for (int i = 0; i < length_count; i++)
    {
        max_length = lengths[i] > max_length ? lengths[i] : max_length;
    }

    uint8_t *buffer = malloc(max_length);
    aeron_context_t *context = NULL;
    aeron_t *aeron = NULL;
    aeron_async_add_publication_t *async_pub = NULL;
    aeron_async_add_exclusive_publication_t *async_xpub = NULL;
    aeron_publication_t *pub = NULL;
    aeron_exclusive_publication_t *xpub = NULL;
    int status = 1;
    int64_t start = interop_now_ms();
    uint64_t sent = 0, back_pressured = 0, not_connected = 0, admin_action = 0;

    if (aeron_context_init(&context) < 0 || aeron_context_set_dir(context, dir) < 0 || aeron_init(&aeron, context) < 0 ||
        aeron_start(aeron) < 0)
    {
        fprintf(stderr, "aeron init: %s\n", aeron_errmsg());
        goto cleanup;
    }

    if (exclusive)
    {
        if (aeron_async_add_exclusive_publication(&async_xpub, aeron, channel, stream_id) < 0)
        {
            fprintf(stderr, "add exclusive publication: %s\n", aeron_errmsg());
            goto cleanup;
        }
        while (NULL == xpub)
        {
            if (aeron_async_add_exclusive_publication_poll(&xpub, async_xpub) < 0 ||
                interop_now_ms() - start > deadline_ms)
            {
                fprintf(stderr, "exclusive publication: %s\n", aeron_errmsg());
                goto cleanup;
            }
            sched_yield();
        }
    }
    else
    {
        if (aeron_async_add_publication(&async_pub, aeron, channel, stream_id) < 0)
        {
            fprintf(stderr, "add publication: %s\n", aeron_errmsg());
            goto cleanup;
        }
        while (NULL == pub)
        {
            if (aeron_async_add_publication_poll(&pub, async_pub) < 0 || interop_now_ms() - start > deadline_ms)
            {
                fprintf(stderr, "publication: %s\n", aeron_errmsg());
                goto cleanup;
            }
            sched_yield();
        }
    }

    while (sent < count)
    {
        uint32_t sequence = (uint32_t)(first + sent);
        size_t length = lengths[sequence % (uint32_t)length_count];
        interop_fill(buffer, sequence, length);
        int64_t result = exclusive ? aeron_exclusive_publication_offer(xpub, buffer, length, NULL, NULL)
                                   : aeron_publication_offer(pub, buffer, length, NULL, NULL);
        if (result > 0)
        {
            sent++;
        }
        else if (AERON_PUBLICATION_BACK_PRESSURED == result)
        {
            back_pressured++;
        }
        else if (AERON_PUBLICATION_NOT_CONNECTED == result)
        {
            not_connected++;
        }
        else if (AERON_PUBLICATION_ADMIN_ACTION == result)
        {
            admin_action++;
        }
        else
        {
            fprintf(
                stderr, "offer of message %" PRIu64 " answered %" PRId64 ": %s\n", first + sent, result, aeron_errmsg());
            goto cleanup;
        }

        if (interop_now_ms() - start > deadline_ms)
        {
            fprintf(stderr, "deadline: %" PRIu64 " of %" PRIu64 " offered\n", sent, count);
            goto cleanup;
        }

        if (result <= 0)
        {
            sched_yield();
        }
    }

    int64_t position = exclusive ? aeron_exclusive_publication_position(xpub) : aeron_publication_position(pub);
    aeron_publication_constants_t constants;
    if (exclusive)
    {
        aeron_exclusive_publication_constants(xpub, &constants);
    }
    else
    {
        aeron_publication_constants(pub, &constants);
    }
    int32_t session_id = constants.session_id;
    printf(
        "{\"event\":\"sent\",\"sent\":%" PRIu64 ",\"first\":%" PRIu64 ",\"position\":%" PRId64 ",\"sessionId\":%d,\"backPressured\":%" PRIu64
        ",\"notConnected\":%" PRIu64 ",\"adminAction\":%" PRIu64 "}\n",
        sent, first, position, session_id, back_pressured, not_connected, admin_action);
    fflush(stdout);

    /* hold the publication open until the test closes stdin (or the hold time passes) */
    int64_t hold_start = interop_now_ms();
    struct pollfd fds = { .fd = 0, .events = POLLIN };
    while (interop_now_ms() - hold_start < hold_ms)
    {
        if (poll(&fds, 1, 50) > 0)
        {
            char scratch[64];
            if (read(0, scratch, sizeof scratch) <= 0)
            {
                break;
            }
        }
    }
    status = 0;

cleanup:
    if (NULL != pub)
    {
        aeron_publication_close(pub, NULL, NULL);
    }
    if (NULL != xpub)
    {
        aeron_exclusive_publication_close(xpub, NULL, NULL);
    }
    if (NULL != aeron)
    {
        aeron_close(aeron);
    }
    if (NULL != context)
    {
        aeron_context_close(context);
    }
    free(buffer);
    return status;
}
