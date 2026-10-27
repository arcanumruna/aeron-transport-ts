// Regression test of issue #64: the IPv6 leg of `scripts/multicast-probe.mjs` reports a host that cannot do IPv6
// multicast, and fails with REQUIRE_IPV6_MULTICAST=1. The interface of the leg is set to one that does not exist, so that
// the result does not depend on the host.
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function probe(env: Record<string, string>) {
    return spawnSync(process.execPath, ['scripts/multicast-probe.mjs'], {
        encoding: 'utf8',
        env: { ...process.env, REQUIRE_IPV6_MULTICAST: '', GITHUB_ACTIONS: '', ...env },
    });
}

describe.skipIf('linux' !== process.platform)('multicastProbeIpv6LegRegression', () => {
    it('aHostWithoutIpv6MulticastFailsTheProbeWhenItIsRequired', () => {
        const result = probe({ MULTICAST_PROBE_IPV6_INTERFACE: 'nonexistent0', REQUIRE_IPV6_MULTICAST: '1' });

        expect(result.stderr).toContain('multicast probe FAILED: IPv6 group');
        expect(result.stderr).toContain('REQUIRE_IPV6_MULTICAST=1');
        expect(result.status).toBe(1);
    });

    it('aHostWithoutIpv6MulticastIsReportedButPassesWhenItIsNotRequired', () => {
        const result = probe({ MULTICAST_PROBE_IPV6_INTERFACE: 'nonexistent0' });

        expect(result.stdout).toContain('IPv6 multicast probe unavailable on nonexistent0');
        expect(result.stdout).not.toContain('::warning');
        expect(result.status).toBe(0);
    });

    it('aGitHubRunnerWithoutIpv6MulticastGetsAWarningAnnotation', () => {
        const result = probe({ MULTICAST_PROBE_IPV6_INTERFACE: 'nonexistent0', GITHUB_ACTIONS: 'true' });

        expect(result.stdout).toContain('::warning title=IPv6 multicast::IPv6 multicast probe unavailable');
        expect(result.status).toBe(0);
    });
});
