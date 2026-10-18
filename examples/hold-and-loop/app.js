import { mountDemo } from '../shared/studio.js';
await mountDemo({
  tag: '04 / Structural clocks', title: 'Hold the moment. Keep moving.',
  description: 'A real video frame is frozen while the title runs on its own finite loop. Step through exact rational frame times at 30000/1001 fps; five loops last 10.01 seconds.',
  form: '<label>Freeze at (seconds)<input name="freeze" type="number" value="2" min="0" max="11" step="0.1" required></label><label>Repetitions<input name="count" type="number" value="5" min="1" max="8" step="1" required></label><p>Each iteration lasts 60 frames. Changing the count changes the composition duration without changing the frozen source time.</p>',
  read: (form) => ({ freeze: Number(form.get('freeze')), count: Number(form.get('count')) }),
  update: (source, values) => {
    const frames = values.count * 60;
    source.setAttribute('duration', `${frames}f`);
    source.querySelector('hv-freeze').setAttribute('at', `${values.freeze}s`);
    // A freeze sample must lie within its own duration, even when the root is shorter.
    source.querySelector('hv-freeze').setAttribute('duration', `${Math.max(360, frames)}f`);
    source.querySelector('hv-loop').setAttribute('count', values.count);
  }
});
