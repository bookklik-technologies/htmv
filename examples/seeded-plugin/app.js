import { mountDemo } from '../shared/studio.js';
import { particles } from './particles.js';
await mountDemo({
  tag: '06 / Deterministic extensions', title: 'Your canvas. HTMV’s clock.',
  description: 'A small custom renderer draws seeded particles from the requested time. Seek in any order: the same frame produces the same picture within this browser.',
  plugins: [particles], verify: true,
  pluginSource: `${await (await fetch('./particles.js')).text()}\n// Register during compilation:\n// const compiled = await compile(source, { plugins: [particles] });`,
  form: '<label>Particle count<input name="count" type="number" min="10" max="120" step="1" value="60" required></label><p>The plugin samples localTime and HTMV’s seeded random(channel, sampleIndex). It has no simulation state and does not use Math.random().</p>',
  read: (form) => ({ count: Number(form.get('count')) }),
  update: (source, values) => { source.querySelector('canvas').setAttribute('data-hv-plugin-props', JSON.stringify(values)); }
});
