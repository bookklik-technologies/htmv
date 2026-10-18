import { mountDemo } from '../shared/studio.js';
await mountDemo({
  auto: true, tag: '01 / Start with a scene', title: 'A few tags. Your first film.',
  description: 'A five-second title, styled with CSS and animated with HTMV. Change the words, then step through the same frames you can export.',
  form: '<label>Your headline<input name="headline" value="Made with HTML" required maxlength="40"></label><p>A scene, a heading, and two animations. The player automatically recompiles when the composition changes.</p>',
  read: (form) => ({ headline: form.get('headline') }),
  update: (source, values) => { source.querySelector('#headline').textContent = values.headline; }
});
