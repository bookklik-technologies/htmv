import { mountDemo } from '../shared/studio.js';
await mountDemo({
  tag: '03 / Media, mixing & captions', title: 'Make the cut. Set the mood.',
  description: 'Two local video clips, a crossfade, animated titles, a repeating music bed, and a chime mixed at the cut. Timed captions appear in the picture and download as WebVTT. Press Play to hear the mix.',
  audio: true, captions: true,
  form: '<label>Music level (0–1)<input name="gain" type="number" value="0.25" min="0" max="1" step="0.05" required></label><p>The clips are silent. Two audio layers demonstrate gain, repetition, and fades independently of the video timeline. All media is bundled locally.</p>',
  read: (form) => ({ gain: Number(form.get('gain')) }),
  update: (source, values) => { source.querySelector('hv-audio#music').setAttribute('gain', values.gain); }
});
