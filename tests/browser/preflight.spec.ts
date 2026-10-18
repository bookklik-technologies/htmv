import { test, expect } from '@playwright/test';

test('preflight: report is structured and product-honest, never optimistic (spec 11.1)', async ({ page }) => {
  await page.goto('/');
  const report = await page.evaluate(async () => {
    const m = (await import('/examples/shared/htmv/index.js')) as unknown as {
      compile: (s: string) => Promise<unknown>;
      createRenderer: (c: unknown) => Promise<{
        preflight(options: {
          profile: 'auto';
          allowedProfiles: string[];
        }): Promise<{
          supported: boolean;
          candidates: { profile: string; videoCodecSupported: boolean; diagnostics: unknown[] }[];
          selected?: { profile: string; extension: string; token: string };
          diagnostics: { code: string; message: string }[];
          estimatedBytes: number;
        }>;
        dispose(): Promise<void>;
      }>;
    };
    const compiled = await m.compile(
      '<hv-composition id="pf" width="320" height="180" fps="30" duration="30f" background="#000"><hv-scene duration="30f"><p>hi</p></hv-scene></hv-composition>'
    );
    const renderer = await m.createRenderer(compiled);
    try {
      const out = await renderer.preflight({ profile: 'auto', allowedProfiles: ['mp4', 'webm'] });
      return {
        candidates: out.candidates.map((c) => ({ profile: c.profile, videoCodecSupported: c.videoCodecSupported })),
        supported: out.supported,
        selectedProfile: out.selected?.profile ?? null,
        selectedExtension: out.selected?.extension ?? null,
        hasToken: typeof out.selected?.token === 'string' && out.selected.token.length > 0,
        diagnostics: out.diagnostics.map((d) => d.code),
        estimatedBytes: out.estimatedBytes
      };
    } finally {
      await renderer.dispose();
    }
  });
  // Capability report must be product-honest: browser API presence is not codec support (spec 1.4)
  expect(Array.isArray(report.candidates)).toBe(true);
  expect(report.candidates.length).toBeGreaterThan(0);
  if (report.supported) {
    expect(report.selectedExtension ?? '').toMatch(/^\.(mp4|webm)$/);
    expect(report.hasToken).toBe(true);
  } else {
    expect(report.diagnostics.length).toBeGreaterThan(0);
  }
});
