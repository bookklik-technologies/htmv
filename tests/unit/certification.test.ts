import { afterEach, describe, expect, it, vi } from 'vitest';
import { Rational } from '@htmv/core';
import { certifyProfile, certifiedProfiles, clearProfileCertifications, runPreflight } from '../../packages/exporter/src/preflight.js';

vi.mock('../../packages/exporter/src/probe.js', () => ({
  canEncodeVideoProbe: vi.fn(async () => true),
  canEncodeAudioProbe: vi.fn(async () => true),
  firstEncodableVideo: vi.fn(async () => 'vp8')
}));

afterEach(() => clearProfileCertifications());

const request = {
  width: 320, height: 180, fps: Rational.fromInteger(30n),
  range: { from: 0, toExclusive: 30 }, revisionHash: 'fixture',
  hasAudio: true, requested: 'auto' as const
};
const evidence = {
  fixtureId: 'independently-decoded-impulse-flash', measuredOffsetSeconds: 0.001,
  measuredDriftSeconds: 0.002, durationSeconds: 2, toleranceSeconds: 0.01
};

describe('configuration-scoped sync certification', () => {
  it('keeps strict audio blocked until matching measurement evidence is registered', async () => {
    expect((await runPreflight(request)).supported).toBe(false);
    const bootstrap = await runPreflight({ ...request, syncPolicy: 'allow-unverified' });
    expect(bootstrap.selected?.syncCertification).toBe('unverified');
    certifyProfile(bootstrap.selected!, evidence);
    expect((await runPreflight(request)).selected?.syncCertification).toBe('certified');
    expect((await runPreflight({ ...request, width: 640 })).supported).toBe(false);
    expect((await runPreflight({ ...request, audioBitrate: 128000 })).supported).toBe(false);
    expect((await runPreflight({ ...request, range: { from: 0, toExclusive: 90 } })).supported).toBe(false);
  });

  it('prefers a certified supported fallback over an uncertified first profile', async () => {
    const bootstrap = await runPreflight({ ...request, requested: 'webm', syncPolicy: 'allow-unverified' });
    certifyProfile(bootstrap.selected!, evidence);
    expect((await runPreflight(request)).selected?.profile).toBe('webm');
  });

  it('rejects evidence outside tolerance and returns a detached profile summary', async () => {
    const bootstrap = await runPreflight({ ...request, syncPolicy: 'allow-unverified' });
    expect(() => certifyProfile(bootstrap.selected!, { ...evidence, measuredOffsetSeconds: 1 })).toThrow();
    expect(() => certifyProfile(bootstrap.selected!, { ...evidence, toleranceSeconds: 1 })).toThrow();
    expect(() => certifyProfile(bootstrap.selected!, { ...evidence, measuredDriftSeconds: NaN })).toThrow();
    certifyProfile(bootstrap.selected!, evidence);
    (certifiedProfiles() as Set<string>).clear();
    expect((await runPreflight(request)).supported).toBe(true);
    clearProfileCertifications();
    expect((await runPreflight(request)).supported).toBe(false);
  });

  it('reports a diagnostic when allowed profiles exclude all candidates', async () => {
    const report = await runPreflight({ ...request, allowedProfiles: [] });
    expect(report.supported).toBe(false);
    expect(report.diagnostics[0].code).toBe('E_CODEC_ENCODE');
  });
});
