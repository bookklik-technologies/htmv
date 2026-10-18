import { test, expect, type Page } from '@playwright/test';

const examples = ['hello', 'data-template', 'edited-story', 'hold-and-loop', 'seeded-plugin', 'product-intro'];
async function open(page: Page, name: string) {
  await page.goto(`/examples/${name}/index.html`);
  await expect(page.locator('main')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
}
async function seek(page: Page, frame: number) {
  await page.evaluate(async (n) => { await (document.querySelector('hv-player') as any).seekToFrame(n); }, frame);
}
async function pixels(page: Page) {
  return page.locator('hv-player canvas').evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

test('gallery is the server entry and all example posters resolve', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/examples\/index.html$/);
  await expect(page.locator('.gallery-card')).toHaveCount(6);
  for (const image of await page.locator('.gallery-card img').all()) {
    await image.scrollIntoViewIfNeeded();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    const box = (await image.boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
  }
});

for (const example of examples) {
  test(`${example}: ready frame, final-frame seeking, source and responsive controls`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', (error) => errors.push(error.message));
    await open(page, example);
    const max = await page.locator('.hv-seek').getAttribute('max');
    await seek(page, Number(max));
    await expect(page.locator('#timecode')).toContainText(`Frame ${max} / ${max}`);
    await expect(page.locator('hv-player canvas')).toBeVisible();
    await page.locator('details').first().locator('summary').click();
    await expect(page.locator('#composition-source')).toContainText('<hv-composition');
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Next frame', exact: true }).focus();
    await expect(page.getByRole('button', { name: 'Next frame', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
    expect(errors).toEqual([]);
  });
}

test('hello automatic binding applies and resets headline, including unchanged inputs', async ({ page }) => {
  await open(page, 'hello'); await seek(page, 75); const before = await pixels(page);
  await page.getByLabel('Your headline').fill('Hello, HTMV');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#composition-source')).toContainText('Hello, HTMV');
  await seek(page, 75); expect(await pixels(page)).not.toBe(before);
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('#status')).toContainText('Already showing');
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#composition-source')).toContainText('Made with HTML');
});

test('typed data changes the actual frame and invalid revisions preserve working pixels', async ({ page }) => {
  await open(page, 'data-template'); await seek(page, 100); const before = await pixels(page);
  await page.getByLabel('Metric 1 label').fill('Downloads');
  await page.locator('[name="value-0"]').fill('98765');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('#composition-source')).toContainText('Downloads');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await seek(page, 100); const applied = await pixels(page); expect(applied).not.toBe(before);
  const revision = await page.locator('main').getAttribute('data-revision');
  // Bypass only native form validation to exercise HTMV's actual schema failure.
  await page.locator('[name="value-0"]').evaluate((input: HTMLInputElement) => { input.removeAttribute('min'); input.value = '-1'; });
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('#status')).toContainText('E_');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('main')).toHaveAttribute('data-revision', revision!);
  expect(await pixels(page)).toBe(applied);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.locator('#composition-source')).not.toContainText('Downloads');
});

test('PNG downloads decode to composition dimensions and WebVTT carries root cue timing', async ({ page }) => {
  await open(page, 'edited-story'); await seek(page, 45);
  const [png] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PNG' }).click()]);
  const pngStream = await png.createReadStream(); const chunks: Buffer[] = [];
  for await (const chunk of pngStream!) chunks.push(chunk);
  const bytes = Buffer.concat(chunks);
  expect(bytes.subarray(1, 4).toString()).toBe('PNG'); expect(bytes.readUInt32BE(16)).toBe(1280); expect(bytes.readUInt32BE(20)).toBe(720);
  const decoded = await page.evaluate(async (bytes) => { const image = await createImageBitmap(new Blob([new Uint8Array(bytes)])); const dimensions = [image.width, image.height]; image.close(); return dimensions; }, [...bytes]);
  expect(decoded).toEqual([1280, 720]);
  const [vtt] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download WebVTT' }).click()]);
  const stream = await vtt.createReadStream(); const text: Buffer[] = []; for await (const chunk of stream!) text.push(chunk);
  const captions = Buffer.concat(text).toString(); expect(captions).toContain('WEBVTT'); expect(captions).toContain('00:00:02.500 --> 00:00:04.500');
});

test('freeze input selects a different source frame and finite loop count changes exact duration', async ({ page }) => {
  await open(page, 'hold-and-loop'); await seek(page, 30); const before = await pixels(page);
  await page.getByLabel('Freeze at (seconds)').fill('8'); await page.getByLabel('Repetitions').fill('3');
  await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('.hv-seek')).toHaveAttribute('max', '179');
  await seek(page, 30); expect(await pixels(page)).not.toBe(before);
  await expect(page.locator('#timecode')).toContainText('1001/1000 s');
  await page.getByRole('button', { name: 'Next frame', exact: true }).click();
  await expect(page.locator('#timecode')).toContainText('31031/30000 s');
});

test('plugin is reproducible across shuffled requests and respects particle count', async ({ page }) => {
  await open(page, 'seeded-plugin');
  await page.getByRole('button', { name: 'Verify repeatable frame' }).click();
  await expect(page.locator('#status')).toContainText('pixel-identical');
  const before = await pixels(page);
  await page.getByLabel('Particle count').fill('10'); await page.getByRole('button', { name: 'Apply changes' }).click();
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false'); await seek(page, 45);
  expect(await pixels(page)).not.toBe(before);
});

test('chapter ranges cover exactly 1800 frames and caption range timing is local', async ({ page }) => {
  await open(page, 'product-intro');
  const ranges = await page.evaluate(async () => {
    const { chapterRanges } = await import('/examples/shared/studio.js');
    return chapterRanges(document.querySelector('hv-composition'));
  });
  expect(ranges.map((r: any) => r.from)).toEqual([0, 195, 420, 690, 945, 1215, 1395, 1620]);
  expect(ranges.at(-1).toExclusive).toBe(1800);
  for (const range of ranges) {
    await page.locator(`[data-chapter="${range.index}"]`).click();
    await expect(page.locator('#timecode')).toContainText(`Frame ${range.from} /`);
    await seek(page, range.toExclusive - 1);
  }
  const vtt = await page.evaluate(async () => (await (document.querySelector('hv-player') as any).renderer.renderCaptions({ range: { from: 945, toExclusive: 1215 } })).text());
  expect(vtt).toContain('00:00:00.500 --> 00:00:04.000');
});

test('audio export is strict until opt-in and cancellation restores editing', async ({ page }) => {
  await open(page, 'edited-story');
  await expect(page.getByLabel('I accept unverified audio synchronization', { exact: false })).not.toBeChecked();
  await page.getByRole('button', { name: 'Export full video' }).click();
  await expect(page.locator('#status')).toContainText('E_AUDIO_DELAY_UNVERIFIED');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'false');
  const supported = await page.evaluate(async () => (await (document.querySelector('hv-player') as any).renderer.preflight({ profile: 'auto', syncPolicy: 'allow-unverified' })).supported);
  test.skip(!supported, 'No supported audiovisual encoder reported by preflight.');
  await page.getByLabel('I accept unverified audio synchronization', { exact: false }).check();
  await page.getByRole('button', { name: 'Export full video' }).click();
  await expect(page.getByLabel('Music level (0–1)')).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel export' }).click();
  await expect(page.locator('#status')).toContainText('Export cancelled');
  await expect(page.getByLabel('Music level (0–1)')).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export full video' }).click()]);
  expect(download.suggestedFilename()).toMatch(/\.(mp4|webm)$/);
  await expect(page.locator('#status')).toContainText('audio synchronization is unverified');
});

test('applied data and chapter video exports decode with the right frame counts', async ({ page }) => {
  test.setTimeout(120000);
  for (const name of ['data-template', 'product-intro']) {
    await open(page, name);
    if (name === 'data-template') {
      await page.getByLabel('Metric 1 label').fill('Downloads');
      await page.getByRole('button', { name: 'Apply changes' }).click();
      await expect(page.locator('#composition-source')).toContainText('Downloads');
    } else await page.locator('[data-chapter="7"]').click();
    const supported = await page.evaluate(async () => (await (document.querySelector('hv-player') as any).renderer.preflight({ profile: 'auto' })).supported);
    test.skip(!supported, 'No supported video encoder reported by preflight.');
    await seek(page, name === 'data-template' ? 149 : 1799);
    const reference = await pixels(page);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: name === 'data-template' ? 'Export full video' : 'Export selected chapter', exact: false }).click()]);
    await expect(page.getByRole('button', { name: 'Download manifest' })).toBeVisible();
    const stream = await download.createReadStream(); const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(chunk);
    const bytes = [...Buffer.concat(chunks)];
    const result = await page.evaluate(async ({ bytes, frames, reference, mimeType }) => {
      const { compile, createRenderer } = await import('/examples/shared/htmv/index.js');
      const blob = new Blob([new Uint8Array(bytes)], { type: mimeType });
      const url = URL.createObjectURL(blob); const video = document.createElement('video');
      video.preload = 'auto'; video.src = url;
      const duration = await new Promise<number>((resolve, reject) => { video.onloadedmetadata = () => resolve(video.duration); video.onerror = () => reject(new Error('Exported video metadata could not be decoded')); });
      video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url);
      const c = await compile(`<hv-composition id="roundtrip" width="1280" height="720" fps="30" duration="${frames}f"><hv-video src="asset:output" duration="${frames}f" audio="mute" style="position:absolute;width:1280px;height:720px;"></hv-video></hv-composition>`, { assets: { output: blob } });
      const r = await createRenderer(c);
      try {
        const result = await r.renderFrame(frames - 1); const canvas = document.createElement('canvas'); canvas.width = 1280; canvas.height = 720;
        const ctx = canvas.getContext('2d')!; ctx.drawImage(result.image, 0, 0); result.close(); const actual = ctx.getImageData(0, 0, 1280, 720).data;
        const expected = new Image(); expected.src = reference; await expected.decode(); ctx.drawImage(expected, 0, 0); const pixels = ctx.getImageData(0, 0, 1280, 720).data;
        let sum = 0; let count = 0; for (let i = 0; i < actual.length; i += 64) for (let channel = 0; channel < 3; channel++) { sum += (actual[i + channel] - pixels[i + channel]) ** 2; count++; }
        return { frames: c.metadata.durationFrames, duration, meanSquaredError: sum / count };
      }
      finally { await r.dispose(); await c.dispose(); }
    }, { bytes, frames: name === 'data-template' ? 150 : 180, reference, mimeType: download.suggestedFilename().endsWith('.mp4') ? 'video/mp4' : 'video/webm' });
    expect(result.frames).toBe(name === 'data-template' ? 150 : 180);
    expect(result.duration).toBeCloseTo(result.frames / 30, 3);
    expect(result.meanSquaredError).toBeLessThan(200);
    const [manifestDownload] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download manifest' }).click()]);
    const manifestStream = await manifestDownload.createReadStream(); const manifestChunks: Buffer[] = []; for await (const chunk of manifestStream!) manifestChunks.push(chunk);
    const manifest = JSON.parse(Buffer.concat(manifestChunks).toString());
    expect(manifest.outputFrameCount).toBe(result.frames);
    expect(manifest.exportedRange).toEqual(name === 'data-template' ? { from: 0, toExclusive: 150 } : { from: 1620, toExclusive: 1800 });
    expect(manifest.revisionHash).toBe(await page.locator('main').getAttribute('data-revision'));
  }
});
