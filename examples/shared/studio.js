import { compile, createRenderer, registerElements } from './htmv/index.js';

const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function offerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Every range is half open. Transition overlaps belong to the next chapter. */
export function chapterRanges(composition) {
  const scenes = [...composition.querySelector('hv-series').children].filter((el) => el.localName === 'hv-scene');
  let from = 0;
  return scenes.map((scene, index) => {
    const duration = Number(scene.getAttribute('duration').replace('f', ''));
    const next = scene.nextElementSibling;
    const overlap = next?.localName === 'hv-transition' ? Number(next.getAttribute('duration').replace('f', '')) : 0;
    const chapter = { name: scene.dataset.chapter || scene.id, from, toExclusive: from + duration - overlap, index };
    from = chapter.toExclusive;
    return chapter;
  });
}

export async function mountDemo(config) {
  const source = document.querySelector('hv-composition');
  const original = source.cloneNode(true);
  const slug = location.pathname.split('/').filter(Boolean).at(-2);
  const chapters = config.chapters ? chapterRanges(source) : [];
  let selectedChapter = 0;
  let owned = null;
  let generation = 0;
  let compilation = null;
  let controller = null;
  let busy = false;
  let ready = false;
  let manifest = null;
  let currentSource = source.outerHTML;

  const main = document.createElement('main'); main.className = 'page';
  main.innerHTML = `
    <header class="page-header"><a class="wordmark" href="../index.html"><img src="../shared/brand/logo.svg" alt="">HTMV</a><span class="eyebrow">CAPABILITIES IN MOTION</span><a class="header-link" href="../index.html">All examples ↗</a></header>
    <section class="intro-heading"><p class="eyebrow">${escape(config.tag)}</p><h1>${escape(config.title)}</h1><p class="description">${escape(config.description)}</p></section>
    <div class="workspace ${config.form ? '' : 'solo'}"><section aria-label="Composition preview"><div class="screen"></div>
      <div class="video-meta"><span id="format">Preparing composition</span><output id="timecode" aria-label="Exact frame time"></output></div>
      <div class="toolbar"><button data-action="replay">Replay</button><button data-action="previous" aria-label="Previous frame">← Frame</button><button data-action="next" aria-label="Next frame">Frame →</button><button data-action="still">Download PNG</button>${config.captions ? '<button data-action="captions">Download WebVTT</button>' : ''}${config.verify ? '<button data-action="verify">Verify repeatable frame</button>' : ''}</div>
    </section>${config.form ? `<form class="settings"><h2>Make it yours</h2><fieldset>${config.form}<div class="form-actions"><button class="primary" type="submit">Apply changes</button><button type="reset">Reset</button></div></fieldset></form>` : ''}</div>
    ${chapters.length ? '<nav class="chapters" aria-label="Film chapters"></nav><div class="toolbar"><button data-action="chapter-play">Play selected chapter</button><button data-action="chapter-export">Export selected chapter</button></div>' : ''}
    <section class="export-bar" aria-label="Export composition"><div class="export-copy"><h2>Made here. Exported here.</h2><p id="status" role="status" aria-live="polite">Preparing the composition…</p></div><div class="export-actions"><button data-action="manifest" hidden>Download manifest</button><button data-action="cancel" hidden>Cancel export</button><button class="primary" data-action="export">Export full video ↓</button></div>
    ${config.audio ? '<label class="audio-policy"><input type="checkbox" id="allow-unverified">I accept unverified audio synchronization for this export.<small>Strict preflight is the default. Uncertified profiles report E_AUDIO_DELAY_UNVERIFIED. Opting in retains the warning in the render manifest.</small></label>' : ''}
    <progress aria-label="Video export progress" hidden max="1" value="0"></progress></section>
    <details><summary>Composition source · currently applied inputs</summary><button data-action="copy">Copy source</button><pre><code id="composition-source"></code></pre></details>
    ${config.pluginSource ? '<details><summary>Plugin registration · trusted application JavaScript</summary><pre><code id="plugin-source"></code></pre></details>' : ''}
    <footer class="page-footer"><span>HTML in. Video out. Every preview is rendered by HTMV.</span><a href="../../README.md">Library & documentation ↗</a></footer>`;
  document.body.append(main);
  const $ = (selector) => main.querySelector(selector);
  const status = $('#status');
  const player = document.createElement('hv-player'); player.setAttribute('controls', '');
  const form = $('form');
  const buttons = () => [...main.querySelectorAll('button, input, select')];
  const availability = new Map();
  const setBusy = (value) => {
    busy = value;
    main.setAttribute('aria-busy', String(value));
    if (value) for (const el of buttons()) { availability.set(el, el.disabled); el.disabled = true; }
    else { for (const [el, disabled] of availability) if (el.isConnected) el.disabled = disabled; availability.clear(); }
    $('[data-action="cancel"]').disabled = false;
  };
  const showError = (error) => {
    const diagnostics = error?.diagnostics;
    status.textContent = diagnostics?.length ? diagnostics.map((d) => `${d.code}: ${d.message}`).join(' ') : error?.message || String(error);
  };
  const syncSource = () => { $('#composition-source').textContent = currentSource; };
  const showTime = (frame) => {
    const metadata = player.renderer?.metadata;
    if (!metadata) return;
    const { numerator: p, denominator: q } = metadata.fps;
    const n = BigInt(frame) * BigInt(q); const d = BigInt(p);
    const gcd = (a, b) => b ? gcd(b, a % b) : a;
    const factor = gcd(n, d);
    $('#timecode').textContent = `Frame ${frame} / ${metadata.durationFrames - 1} · ${n / factor}/${d / factor} s`;
    const chapter = chapters.findLast((c) => c.from <= frame);
    if (chapter) {
      selectedChapter = chapter.index;
      for (const button of main.querySelectorAll('[data-chapter]')) {
        if (Number(button.dataset.chapter) === selectedChapter) button.setAttribute('aria-current', 'true');
        else button.removeAttribute('aria-current');
      }
    }
  };
  player.addEventListener('hv-frame', ({ detail }) => showTime(detail.frame));
  player.addEventListener('hv-error', ({ detail }) => showError(detail));
  player.addEventListener('hv-ready', () => {
    ready = true;
    const m = player.renderer.metadata;
    $('#format').textContent = `${m.width} × ${m.height} · ${m.fps.numerator}/${m.fps.denominator} FPS · ${m.durationFrames} frames`;
    main.dataset.revision = player.renderer.revisionHash;
    main.dataset.ready = 'true';
    if (config.auto) { currentSource = source.outerHTML; syncSource(); }
    showTime(0);
  });

  // Registration happens before connection; explicit players connect only after receiving a renderer.
  registerElements();
  customElements.upgrade(player);

  const retire = async (revision) => {
    if (!revision) return;
    await revision.renderer.whenIdle(); await revision.renderer.dispose(); await revision.compiled.dispose();
  };
  const buildSource = (values) => {
    const candidate = original.cloneNode(true);
    config.update?.(candidate, values);
    return candidate.outerHTML;
  };
  const apply = async (values) => {
    if (controller) return;
    const candidate = buildSource(values);
    if (ready && candidate === currentSource) { status.textContent = 'Already showing these inputs. Ready to play or export.'; return; }
    const token = ++generation;
    compilation?.abort(); compilation = new AbortController();
    player.pause(); setBusy(true); status.textContent = 'Compiling a new revision…';
    let next = null;
    try {
      if (config.auto) {
        const parsed = new DOMParser().parseFromString(candidate, 'text/html').querySelector('hv-composition');
        const result = new Promise((resolve, reject) => {
          const cleanup = () => { player.removeEventListener('hv-ready', onReady); player.removeEventListener('hv-error', onError); };
          const onReady = () => { cleanup(); resolve(); }; const onError = (event) => { cleanup(); reject(event.detail); };
          player.addEventListener('hv-ready', onReady); player.addEventListener('hv-error', onError);
        });
        // replaceChildren preserves the source element observed by the automatic player.
        source.replaceChildren(...parsed.childNodes);
        await result;
      } else {
        const compiled = await compile(candidate, { baseURL: document.baseURI, plugins: config.plugins || [], signal: compilation.signal });
        next = { compiled, renderer: null };
        next.renderer = await createRenderer(compiled);
        const first = await next.renderer.renderFrame(0); first.close();
        if (token !== generation) return;
        const previous = owned;
        const bound = new Promise((resolve, reject) => {
          const cleanup = () => { player.removeEventListener('hv-ready', onReady); player.removeEventListener('hv-error', onError); };
          const onReady = () => { cleanup(); resolve(); }; const onError = (event) => { cleanup(); reject(event.detail); };
          player.addEventListener('hv-ready', onReady); player.addEventListener('hv-error', onError);
        });
        player.renderer = next.renderer;
        if (!player.isConnected) $('.screen').append(player);
        await bound;
        owned = next; next = null;
        await retire(previous);
      }
      if (token === generation) {
        currentSource = candidate; syncSource(); manifest = null; $('[data-action="manifest"]').hidden = true;
        status.textContent = 'Ready. Play, step through frames, or export this composition.';
      }
    } catch (error) { if (token === generation && error?.name !== 'AbortError') showError(error); }
    finally {
      if (next?.renderer) await retire(next); else if (next?.compiled) await next.compiled.dispose();
      if (token === generation) setBusy(false);
    }
  };

  const action = async (work) => {
    if (!ready || busy) return;
    player.pause(); setBusy(true);
    try { await work(); } catch (error) { showError(error); }
    finally { setBusy(false); }
  };
  const exportVideo = (range) => action(async () => {
    controller = new AbortController();
    const cancel = $('[data-action="cancel"]'); cancel.hidden = false;
    const progress = $('progress'); progress.hidden = false; progress.value = 0; progress.max = 1;
    status.textContent = 'Checking available browser encoders…';
    try {
      const allow = $('#allow-unverified')?.checked === true;
      const report = await player.renderer.preflight({ profile: 'auto', allowedProfiles: ['mp4', 'webm'], ...(range ? { range } : {}), ...(allow ? { syncPolicy: 'allow-unverified' } : {}) });
      controller.signal.throwIfAborted();
      if (!report.supported || !report.selected) {
        const diagnostics = [...report.diagnostics, ...report.candidates.flatMap((c) => c.diagnostics)];
        throw new Error([...new Set(diagnostics.map((d) => `${d.code}: ${d.message}`))].join(' ') || 'No supported encoder is available in this browser.');
      }
      const result = await player.renderer.exportVideo({ configuration: report.selected, target: { kind: 'memory' }, signal: controller.signal,
        onProgress: ({ phase, completedFrames, totalFrames }) => {
          progress.max = totalFrames; progress.value = completedFrames;
          status.textContent = `${phase} · ${completedFrames} / ${totalFrames} frames`;
        }
      });
      if (result.kind !== 'blob') throw new Error('Expected an in-memory video file.');
      offerDownload(result.blob, `${slug}${range ? `-${range.from}-${range.toExclusive}` : ''}${report.selected.extension}`);
      manifest = result.manifest; $('[data-action="manifest"]').hidden = false;
      status.textContent = `Exported ${manifest.outputFrameCount} frames as ${report.selected.profile.toUpperCase()} · ${(result.blob.size / 1048576).toFixed(1)} MB.${report.selected.audio && report.selected.syncCertification === 'unverified' ? ' Warning: audio synchronization is unverified (E_AUDIO_DELAY_UNVERIFIED). See the manifest.' : ''}`;
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') status.textContent = 'Export cancelled. Ready to preview or export again.';
      else { showError(error); if (player.renderer.state === 'error') { ready = false; status.textContent += ' Reload the page to recreate the renderer.'; } }
    } finally { controller = null; cancel.hidden = true; progress.hidden = true; }
  });

  main.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]'); if (!button) return;
    const range = chapters[selectedChapter];
    const actions = {
      replay: () => action(async () => { await player.seekToFrame(0); await player.play(); }),
      previous: () => action(() => player.seekToFrame(Math.max(0, player.currentFrame - 1))),
      next: () => action(() => player.seekToFrame(Math.min(player.renderer.metadata.durationFrames - 1, player.currentFrame + 1))),
      still: () => action(async () => { const frame = player.currentFrame; offerDownload(await player.renderer.renderStill({ frame, type: 'png' }), `${slug}-frame-${frame}.png`); status.textContent = `Downloaded frame ${frame} as PNG.`; }),
      captions: () => action(async () => { offerDownload(await player.renderer.renderCaptions(), `${slug}.vtt`); status.textContent = 'Downloaded captions as WebVTT.'; }),
      export: () => exportVideo(),
      'chapter-export': () => exportVideo({ from: range.from, toExclusive: range.toExclusive }),
      'chapter-play': () => action(async () => { await player.seekToFrame(range.from); await player.play({ range: { from: range.from, toExclusive: range.toExclusive } }); }),
      cancel: () => controller?.abort(),
      manifest: () => manifest && offerDownload(new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }), `${slug}-manifest.json`),
      copy: async () => { try { await navigator.clipboard.writeText(currentSource); status.textContent = 'Composition source copied.'; } catch { status.textContent = 'Clipboard unavailable. Select and copy the source below.'; } },
      verify: () => action(async () => {
        const read = async (frame) => {
          const result = await player.renderer.renderFrame(frame);
          try { const canvas = document.createElement('canvas'); canvas.width = result.image.width; canvas.height = result.image.height; const ctx = canvas.getContext('2d'); ctx.drawImage(result.image, 0, 0); return new Uint8Array(await crypto.subtle.digest('SHA-256', ctx.getImageData(0, 0, canvas.width, canvas.height).data)); }
          finally { result.close(); }
        };
        const a = await read(45); await read(120); const b = await read(45); await player.seekToFrame(45);
        if (!a.every((byte, i) => byte === b[i])) throw new Error('Repeatability check failed.');
        status.textContent = 'Verified: frame 45 is pixel-identical after rendering frame 120, then frame 45 again.';
      })
    };
    void actions[button.dataset.action]?.();
  });

  if (chapters.length) {
    for (const chapter of chapters) {
      const button = document.createElement('button'); button.dataset.chapter = chapter.index;
      const seconds = Math.floor(chapter.from / 30);
      button.innerHTML = `<span>00:${String(seconds).padStart(2, '0')}</span>${escape(chapter.name)}`;
      button.addEventListener('click', () => action(() => player.seekToFrame(chapter.from)));
      $('.chapters').append(button);
    }
  }
  form?.addEventListener('submit', (event) => { event.preventDefault(); if (!busy && form.reportValidity()) void apply(config.read(new FormData(form))); });
  form?.addEventListener('reset', (event) => {
    event.preventDefault();
    if (busy) return;
    for (const input of form.querySelectorAll('input')) { input.value = input.defaultValue; input.checked = input.defaultChecked; }
    void apply(config.read(new FormData(form)));
  });
  if (config.pluginSource) $('#plugin-source').textContent = config.pluginSource;
  syncSource();

  window.addEventListener('pagehide', () => { ++generation; compilation?.abort(); controller?.abort(); player.pause(); player.remove(); void retire(owned); owned = null; });
  // A cached history entry contains disposed sessions; recreate them on restoration.
  window.addEventListener('pageshow', (event) => { if (event.persisted) location.reload(); });
  if (config.auto) {
    player.setAttribute('for', source.id);
    const initialReady = new Promise((resolve) => player.addEventListener('hv-ready', resolve, { once: true }));
    setBusy(true); $('.screen').append(player);
    player.addEventListener('hv-error', () => setBusy(false), { once: true });
    await initialReady; setBusy(false);
    status.textContent = 'Ready. Edit the headline, play, or download any frame.';
  } else await apply(form ? config.read(new FormData(form)) : {});
}
