import { test, expect } from '@playwright/test';

test('M0 slice: title+paint export if the browser exposes an encoder', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const m = (await import('/examples/shared/htmv/index.js')) as unknown as {
      compile: (s: string) => Promise<unknown>;
      createRenderer: (c: unknown) => Promise<{
        preflight(options: unknown): Promise<{
          supported: boolean;
          selected?: {
            profile: string;
            extension: string;
            token: string;
            fps: { numerator: number; denominator: number };
          };
          diagnostics: { code: string; message: string }[];
        }>;
        renderFrame(frame: number): Promise<{ frame: number; close(): void }>;
        exportVideo(options: unknown): Promise<unknown>;
        dispose(): Promise<void>;
      }>;
    };
    const compiled = await m.compile(
      `<hv-composition id="m0" width="320" height="180" fps="30" duration="30f" background="#102030">
        <hv-scene duration="30f">
          <h1 id="m0-title" style="position:absolute;left:40px;top:60px;width:240px;height:60px;font-size:40px;color:white">Hi</h1>
          <hv-animation target="#m0-title" property="opacity" duration="30f" from="0" to="1" fill="both"></hv-animation>
        </hv-scene>
      </hv-composition>`
    );
    const renderer = await m.createRenderer(compiled);
    const out: Record<string, unknown> = {};
    try {
      const report = await renderer.preflight({ profile: 'auto', allowedProfiles: ['mp4', 'webm'] });
      out.supported = report.supported;
      out.selected = report.selected?.profile ?? null;
      out.diags = report.diagnostics.map((d) => d.code);
      if (report.supported && report.selected) {
        const frame = await renderer.renderFrame(15);
        out.paintFrameOk = frame.frame === 15;
        frame.close();
        const exportResult = (await renderer.exportVideo({
          configuration: report.selected,
          target: { kind: 'memory' }
        })) as { kind: string; blob?: Blob; manifest?: { outputFrameCount: number; status: string } };
        out.exportKind = exportResult.kind;
        out.frames = exportResult.manifest?.outputFrameCount;
        out.status = exportResult.manifest?.status;
        if (exportResult.kind === 'blob' && exportResult.blob) {
          out.bytes = exportResult.blob.size;
          out.mime = exportResult.blob.type;
        }
      }
      return out;
    } catch (e) {
      return { error: String(e).slice(0, 300), ...(out as Record<string, unknown>) };
    } finally {
      await renderer.dispose();
    }
  });
  console.log('M0 result:', JSON.stringify(result));
  if (result.supported && result.exportKind) {
    expect(result.exportKind).toBe('blob');
    expect(result.status).toBe('complete');
    expect(result.frames).toBe(30);
  } else {
    // honest capability reporting when codec support is absent (spec 1.4)
    expect(result.supported).toBe(false);
    expect((result.diags as string[]).length).toBeGreaterThan(0);
  }
});
