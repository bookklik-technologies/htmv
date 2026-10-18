import { mountDemo } from '../shared/studio.js';
import { particles } from '../seeded-plugin/particles.js';
await mountDemo({
  tag: '05 / The product is the demo', title: 'Meet HTMV. In one minute.',
  description: 'Eight chapters. One HTML composition. Watch actual templates, media, frozen time, and a custom particle renderer, then export the full film or just the chapter you want.',
  chapters: true, captions: true, plugins: [particles],
  pluginSource: `${await (await fetch('../seeded-plugin/particles.js')).text()}\n// compile(source, { plugins: [particles] });`
});
