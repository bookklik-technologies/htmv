import { mountDemo } from '../shared/studio.js';
import { senangIconNames, senangShapeCatalog } from '../shared/htmv/senangstart.js';
import { buildComposition, layouts } from './composition.js';

const option = (value, label = value) => `<option value="${value}">${label}</option>`;
const field = (label, name, value, list) => `<label>${label}<input name="${name}" value="${value}" list="${list}" required autocomplete="off"></label>`;

await mountDemo({
  title: 'One idea. Many directions.',
  description: 'Explore twelve directions: editorial, posters, quotes, tickets, journeys, showcases, kinetic type, and more. Mix three video formats with the full SenangStart Icons and Shapes catalogs. Copy the source and make your own.',
  form: `<label>Composition<select name="layout">${Object.entries(layouts).map(([value, label]) => option(value, label)).join('')}</select></label>
    <label>Video format<select name="format">${option('landscape', 'Landscape · 16:9')}${option('portrait', 'Portrait · 9:16')}${option('square', 'Square · 1:1')}</select></label>
    <label>Headline<input name="headline" value="Make room for different." maxlength="42" required></label>
    <label>Supporting line<input name="subtitle" value="Your story, outside the template." maxlength="70" required></label>
    ${field('SenangStart icon · type to search', 'icon', 'sparkles', 'icon-names')}
    <datalist id="icon-names">${senangIconNames.map((name) => option(name)).join('')}</datalist>
    ${field('SenangStart shape · type to search', 'shape', 'soft-nova', 'shape-names')}
    <datalist id="shape-names">${senangShapeCatalog.map((shape) => option(shape.name, `${shape.label} · ${shape.category}`)).join('')}</datalist>
    <label>Shape style<select name="variant">${option('auto', 'Automatic · shape default')}</select></label>
    <div class="palette-inputs"><label>Background<input type="color" name="background" value="#f5f0e8"></label><label>Text & icon<input type="color" name="ink" value="#232c28"></label><label>Primary<input type="color" name="accent" value="#cf492e"></label><label>Secondary<input type="color" name="secondary" value="#dfb96e"></label></div>
    <p>${senangIconNames.length} icons and ${senangShapeCatalog.length} shapes. Styles depend on the selected shape. Apply to compile; Reset restores all controls.</p>`,
  read: (form) => Object.fromEntries(form),
  update: (source, values) => {
    const composition = new DOMParser().parseFromString(buildComposition(values), 'text/html').querySelector('hv-composition');
    for (const attribute of [...source.attributes]) source.removeAttribute(attribute.name);
    for (const attribute of composition.attributes) source.setAttribute(attribute.name, attribute.value);
    source.replaceChildren(...composition.childNodes);
  }
});

const form = document.querySelector('.settings');
const shapeInput = form.elements.namedItem('shape');
const variantSelect = form.elements.namedItem('variant');
const updateVariants = () => {
  const shape = senangShapeCatalog.find((entry) => entry.name === shapeInput.value);
  const previous = variantSelect.value;
  variantSelect.innerHTML = option('auto', 'Automatic · shape default') + (shape?.variants ?? []).map((variant) => option(variant)).join('');
  variantSelect.value = shape?.variants.includes(previous) ? previous : 'auto';
};
shapeInput.addEventListener('input', updateVariants);
form.addEventListener('reset', () => queueMicrotask(updateVariants));
updateVariants();
