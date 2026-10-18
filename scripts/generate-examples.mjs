/** Development only. Run the example server first; no generation occurs in visitor pages. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const baseURL = (process.env.HTMV_EXAMPLES_URL || 'http://127.0.0.1:8899').replace(/\/$/, '');
const mode = process.argv[2] || '--all';
if (!['--all', '--samples', '--posters', '--film'].includes(mode)) throw new Error('Use --all, --samples, --posters, or --film.');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(120000);
page.on('pageerror', (error) => console.error(error.message));
async function save(path, bytes) { const target = resolve(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, new Uint8Array(bytes)); console.log(`Wrote ${path} (${bytes.length} bytes)`); }

function wave(kind) {
  const rate = 48000, seconds = 2, channels = 2;
  const bytes = Buffer.alloc(44 + rate * seconds * channels * 2);
  bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(channels, 22); bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * channels * 2, 28); bytes.writeUInt16LE(channels * 2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
  for (let i = 0; i < rate * seconds; i++) {
    const t = i / rate;
    for (let channel = 0; channel < channels; channel++) {
      const signal = kind === 'pulse'
        ? (Math.sin(2 * Math.PI * 130 * t) * .25 + Math.sin(2 * Math.PI * 196 * t) * .13 + Math.sin(2 * Math.PI * 260 * t) * .09) * (.6 + .4 * Math.cos(4 * Math.PI * t))
        : (Math.sin(2 * Math.PI * (channel ? 784 : 523) * t) * .35 + Math.sin(2 * Math.PI * 1046 * t) * .12) * Math.exp(-3 * t) * Math.min(1, t / .01, (seconds - t) / .1);
      bytes.writeInt16LE(Math.round(signal * 32767), 44 + (i * channels + channel) * 2);
    }
  }
  return bytes;
}

function sampleSource(kind) {
  const orbit = kind === 'orbit';
  const shapes = Array.from({ length: orbit ? 4 : 7 }, (_, i) => {
    const colors = ['#2563eb', '#00ff99', '#ffc000', '#164e63'];
    const size = orbit ? 170 + i * 35 : 75;
    const left = orbit ? 50 + i * 145 : -100 + i * 115;
    const top = orbit ? 120 + (i % 2) * 90 : 130 + (i % 3) * 40;
    return `<div id="s${i}" style="position:absolute;left:${left}px;top:${top}px;width:${size}px;height:${orbit ? size : 350}px;border-radius:${orbit ? '50%' : '35px'};background-color:${colors[i % colors.length]};opacity:${orbit ? .8 : .7};"></div><hv-animation target="#s${i}" property="translate-y" duration="359f" from="${orbit ? 120 : 100}px" to="${orbit ? -100 : -130}px" easing="ease-in-out" fill="both"></hv-animation><hv-animation target="#s${i}" property="translate-x" duration="359f" from="-35px" to="35px" fill="both"></hv-animation>`;
  }).join('');
  return `<hv-composition id="sample" width="640" height="360" fps="30" duration="360f" background="${orbit ? '#142536' : '#242239'}"><hv-scene duration="360f"><div style="position:absolute;left:0;top:0;width:640px;height:360px;background:linear-gradient(135deg,${orbit ? '#142536,#244638' : '#242239,#17395a'});overflow:hidden;">${shapes}<div style="position:absolute;left:40px;top:40px;width:560px;height:280px;border:1px solid #6a838c;border-radius:20px;"></div></div></hv-scene></hv-composition>`;
}

try {
  await page.goto(`${baseURL}/examples/index.html`);
  if (mode === '--all' || mode === '--samples') {
    for (const kind of ['pulse', 'chime']) await save(`examples/shared/media/${kind}.wav`, wave(kind));
    for (const kind of ['orbit', 'ribbons']) {
      const bytes = await page.evaluate(async (source) => {
        const { compile, createRenderer } = await import(new URL('./shared/htmv/index.js', location.href).href);
        const c = await compile(source); const r = await createRenderer(c);
        try {
          const report = await r.preflight({ profile: 'mp4', videoBitrate: 600000 });
          if (!report.selected) throw new Error(`MP4 sample generation unsupported: ${JSON.stringify(report)}`);
          const result = await r.exportVideo({ configuration: report.selected, target: { kind: 'memory' } });
          return Array.from(new Uint8Array(await result.blob.arrayBuffer()));
        } finally { await r.dispose(); await c.dispose(); }
      }, sampleSource(kind));
      await save(`examples/shared/media/${kind}.mp4`, bytes);
    }
  }
  if (mode === '--all' || mode === '--film' || mode === '--posters') {
    const examples = ['hello', 'data-template', 'edited-story', 'hold-and-loop', 'seeded-plugin', 'product-intro'];
    for (const example of mode === '--film' ? ['product-intro'] : examples) {
      await page.goto(`${baseURL}/examples/${example}/index.html`);
      await page.waitForSelector('main[data-ready="true"]');
      const bytes = await page.evaluate(async () => {
        const player = document.querySelector('hv-player');
        const blob = await player.renderer.renderStill({ frame: 45, type: 'png' });
        const bitmap = await createImageBitmap(blob); const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360; canvas.getContext('2d').drawImage(bitmap, 0, 0, 640, 360); bitmap.close();
        return Array.from(new Uint8Array(await (await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))).arrayBuffer()));
      });
      await save(`examples/shared/posters/${example}.png`, bytes);
      if (example === 'product-intro' && mode !== '--posters') {
        const bytes = await page.evaluate(async () => {
          const r = document.querySelector('hv-player').renderer;
          const report = await r.preflight({ profile: 'mp4', videoBitrate: 2500000 });
          if (!report.selected) throw new Error(`MP4 film generation unsupported: ${JSON.stringify(report)}`);
          const result = await r.exportVideo({ configuration: report.selected, target: { kind: 'memory' } });
          return { video: Array.from(new Uint8Array(await result.blob.arrayBuffer())), manifest: result.manifest };
        });
        await save('examples/product-intro/htmv-product-introduction.mp4', bytes.video);
        await writeFile(resolve(root, 'examples/product-intro/render-manifest.json'), `${JSON.stringify(bytes.manifest, null, 2)}\n`);
      }
    }
  }
} finally { await browser.close(); }
