import { mountDemo } from '../shared/studio.js';
const defaults = [['customers', 'Customers', 1200], ['projects', 'Projects', 84], ['countries', 'Countries', 16]];
await mountDemo({
  tag: '02 / Templates & typed data', title: 'One template. Every version.',
  description: 'Three cards share one component. JSON props drive the labels and animated numbers; scoped IDs keep each animation attached to its own card.',
  form: defaults.map(([id, label, value], i) => `<div class="metric-row"><label>Metric ${i + 1} label<input name="label-${i}" value="${label}" required maxlength="20"></label><label>Value<input name="value-${i}" type="number" value="${value}" min="0" max="999999" step="1" required></label></div>`).join(''),
  read: (form) => ({ items: defaults.map(([id], i) => ({ id, label: form.get(`label-${i}`), value: Number(form.get(`value-${i}`)) })) }),
  update: (source, values) => { source.querySelector('[data-hv-props]').textContent = JSON.stringify(values); }
});
