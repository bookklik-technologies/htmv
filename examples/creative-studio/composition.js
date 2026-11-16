import { senangIcon, senangShape } from '../shared/htmv/senangstart.js';

export const layouts = {
  editorial: 'Editorial split',
  poster: 'Type-led poster',
  orbit: 'Orbital composition',
  collage: 'Cut-paper collage',
  gallery: 'Modular gallery',
  banner: 'Diagonal banner',
  quote: 'Pull-quote editorial',
  ticket: 'Event ticket',
  steps: 'Three-step journey',
  showcase: 'Object showcase',
  marquee: 'Kinetic type bands',
  report: 'Illustrated report'
};

const formats = { landscape: [1280, 720], portrait: [720, 1280], square: [1080, 1080] };
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

export function buildComposition(values) {
  if (!Object.hasOwn(layouts, values.layout) || !Object.hasOwn(formats, values.format)) throw new Error('Choose a listed layout and format.');
  for (const color of [values.background, values.ink, values.accent, values.secondary]) {
    if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Use six-digit hex colors for this example.');
  }
  const [width, height] = formats[values.format];
  const unit = Math.min(width, height);
  const portrait = height > width;
  const variant = values.variant === 'auto' ? undefined : values.variant;
  const shapeSource = senangShape(values.shape, { color: values.accent, primary: values.accent, secondary: values.secondary, variant });
  const iconSource = senangIcon(values.icon, { color: values.ink });
  const parts = [];
  let serial = 0;
  const position = (left, top, boxWidth, boxHeight) => `position:absolute;left:${left * width}px;top:${top * height}px;width:${boxWidth * width}px;height:${boxHeight * height}px;`;
  const motion = (id, index, rotate = false) => `<hv-animation target="#${id}" property="opacity" start="${index * 3}f" duration="18f" from="0" to="1" easing="ease-out" fill="both"></hv-animation><hv-animation target="#${id}" property="${rotate ? 'rotate' : 'translate-y'}" start="${index * 3}f" duration="36f" from="${rotate ? '-12deg' : '24px'}" to="${rotate ? '0deg' : '0px'}" easing="ease-out" fill="both"></hv-animation>`;
  const image = (source, left, top, boxWidth, boxHeight, rotate = false) => {
    const id = `art-${++serial}`;
    parts.push(`<img id="${id}" src="${escape(source)}" alt="" style="${position(left, top, boxWidth, boxHeight)}object-fit:contain;">${motion(id, serial, rotate)}`);
  };
  const block = (left, top, boxWidth, boxHeight, color, radius = 0, rotation = 0) => parts.push(`<div style="${position(left, top, boxWidth, boxHeight)}background-color:${color};border-radius:${radius}px;transform:rotate(${rotation}deg);"></div>`);
  const text = (id, content, left, top, boxWidth, boxHeight, size, align = 'left', delay = 1) => {
    parts.push(`<p id="${id}" style="${position(left, top, boxWidth, boxHeight)}font-size:${unit * size}px;color:${values.ink};text-align:${align};line-height:1.02;overflow-wrap:anywhere;">${escape(content)}</p>${motion(id, delay)}`);
  };
  const title = (left, top, boxWidth, boxHeight, size, align = 'left') => text('headline', values.headline, left, top, boxWidth, boxHeight, size, align);
  const subtitle = (left, top, boxWidth, align = 'left') => text('subtitle', values.subtitle, left, top, boxWidth, .12, .026, align);
  const largeShape = (left, top, size) => image(shapeSource, left, top, size * unit / width, size * unit / height, true);

  if (values.layout === 'editorial') {
    block(0, 0, portrait ? 1 : .54, portrait ? .56 : 1, values.secondary);
    largeShape(portrait ? .27 : .63, portrait ? .64 : .22, .55);
    image(iconSource, .07, .07, .08, .08);
    title(.07, .23, portrait ? .86 : .47, .3, portrait ? .11 : .105);
    subtitle(.07, portrait ? .45 : .76, portrait ? .84 : .44);
  } else if (values.layout === 'poster') {
    largeShape(portrait ? .38 : .65, portrait ? .53 : .18, .68);
    title(.07, .1, .86, .4, portrait ? .15 : .17);
    block(.07, .68, .14, .012, values.accent);
    subtitle(.07, .76, .72);
    image(iconSource, .82, .79, .08, .08);
  } else if (values.layout === 'orbit') {
    const centerX = width * .5;
    const centerY = height * .45;
    const radius = unit * .34;
    for (let index = 0; index < 8; index++) {
      const angle = index * Math.PI / 4;
      const size = unit * .12;
      image(index % 2 ? iconSource : shapeSource, (centerX + Math.cos(angle) * radius - size / 2) / width, (centerY + Math.sin(angle) * radius - size / 2) / height, size / width, size / height, true);
    }
    title(.2, .34, .6, .23, .085, 'center');
    subtitle(.15, .85, .7, 'center');
  } else if (values.layout === 'collage') {
    block(.04, .08, .53, .66, values.secondary, 0, -6);
    block(.45, .28, .49, .52, values.accent, 0, 7);
    largeShape(portrait ? .28 : .57, .34, .44);
    title(.1, .16, portrait ? .78 : .65, .4, .12);
    block(.04, .81, .92, .15, values.background);
    subtitle(.08, .84, .75);
    image(iconSource, .78, .1, .13, .13, true);
  } else if (values.layout === 'gallery') {
    title(.06, .08, .88, .24, .09);
    const columns = portrait ? 2 : 3;
    const rows = portrait ? 3 : 2;
    for (let index = 0; index < 6; index++) {
      const left = .06 + (index % columns) * (.88 / columns);
      const top = .37 + Math.floor(index / columns) * (.43 / rows);
      block(left, top, .88 / columns - .015, .43 / rows - .015, index % 2 ? values.secondary : values.accent, 8);
      image(index % 2 ? iconSource : shapeSource, left + .035, top + .02, .88 / columns - .085, .43 / rows - .055, true);
    }
    subtitle(.06, .86, .88);
  } else if (values.layout === 'banner') {
    block(-.1, .25, 1.2, .42, values.secondary, 0, -12);
    largeShape(portrait ? .4 : .69, .48, .45);
    image(iconSource, .07, .07, .1, .1);
    title(.08, .3, .84, .38, .12);
    subtitle(.08, .82, .75);
  } else if (values.layout === 'quote') {
    block(.06, .09, .012, .72, values.accent);
    text('quotation', '“', .11, .07, .22, .22, .26);
    largeShape(portrait ? .66 : .76, .72, .22);
    title(.12, .29, .76, .4, .105);
    block(.12, .74, .12, .008, values.secondary);
    subtitle(.12, .79, .64);
    image(iconSource, .81, .08, .08, .08);
  } else if (values.layout === 'ticket') {
    block(.05, .08, .9, .84, values.secondary, 16);
    block(.08, .12, portrait ? .84 : .65, portrait ? .61 : .76, values.background, 8);
    text('ticket-label', 'ADMIT / 01', .12, .16, .55, .08, .028);
    title(.12, .29, portrait ? .76 : .56, .36, .085);
    subtitle(.12, portrait ? .61 : .75, portrait ? .72 : .53);
    for (let index = 0; index < 10; index++) {
      block(portrait ? .1 + index * .08 : .77, portrait ? .76 : .16 + index * .066, portrait ? .045 : .004, portrait ? .003 : .035, values.ink);
    }
    largeShape(portrait ? .13 : .8, portrait ? .79 : .2, .13);
    image(iconSource, portrait ? .76 : .81, portrait ? .81 : .69, .08, .08);
  } else if (values.layout === 'steps') {
    title(.07, .08, .86, .24, .085);
    subtitle(.07, portrait ? .29 : .33, .84);
    block(portrait ? .16 : .15, portrait ? .46 : .59, portrait ? .006 : .65, portrait ? .39 : .008, values.secondary);
    for (const [index, label] of ['Imagine', 'Compose', 'Move'].entries()) {
      const left = portrait ? .08 : .07 + index * .3;
      const top = portrait ? .44 + index * .15 : .52;
      block(left, top, portrait ? .16 : .13, portrait ? .075 : .15, values.secondary, 8);
      text(`step-number-${index}`, `0${index + 1}`, left, top + .015, portrait ? .16 : .13, .07, .055, 'center', index * 5 + 1);
      text(`step-label-${index}`, label, portrait ? .3 : left, portrait ? top + .02 : .73, portrait ? .57 : .25, .09, .045, 'left', index * 5 + 3);
    }
    image(iconSource, .83, .87, .07, .07);
  } else if (values.layout === 'showcase') {
    block(portrait ? .07 : .51, portrait ? .39 : .09, portrait ? .86 : .43, portrait ? .45 : .76, values.secondary, 24);
    block(portrait ? .2 : .59, portrait ? .73 : .73, portrait ? .6 : .27, .06, values.accent, 4);
    largeShape(portrait ? .25 : .56, portrait ? .43 : .2, portrait ? .5 : width === height ? .34 : .6);
    title(.07, portrait ? .08 : .19, portrait ? .86 : .4, portrait ? .24 : .38, .085);
    subtitle(.07, portrait ? .87 : .67, portrait ? .84 : .38);
    image(iconSource, portrait ? .79 : .07, portrait ? .42 : .08, .07, .07);
  } else if (values.layout === 'marquee') {
    block(0, .04, 1, .17, values.secondary);
    block(0, .79, 1, .17, values.accent);
    for (const [index, word] of ['MAKE', 'CREATE', 'MOVE'].entries()) {
      const id = `band-word-${index}`;
      text(id, word, .07 + index * .3, .1, .26, .08, portrait ? .035 : .055);
      parts.push(`<hv-animation target="#${id}" property="translate-x" start="12f" duration="156f" from="${index % 2 ? '-20px' : '20px'}" to="${index % 2 ? '20px' : '-20px'}" easing="linear" fill="both"></hv-animation>`);
    }
    largeShape(portrait ? .69 : .8, .62, .18);
    title(.07, .32, .86, .38, .115);
    subtitle(.07, .83, .84);
  } else if (values.layout === 'report') {
    title(.07, .07, .86, .25, .085);
    text('report-label', 'COMPOSITION STUDY / SAMPLE DATA', .07, .34, .86, .07, portrait ? .022 : .025);
    const baseline = .76;
    for (const [index, barHeight] of [.12, .23, .31].entries()) {
      const left = .1 + index * .21;
      block(left, baseline - barHeight, .14, barHeight, index === 1 ? values.accent : values.secondary, 4);
      text(`bar-label-${index}`, `0${index + 1}`, left, .79, .14, .06, .028, 'center', index * 4 + 1);
    }
    block(.07, baseline, .86, .004, values.ink);
    largeShape(portrait ? .77 : .79, .45, .16);
    subtitle(.07, .88, .84);
  }

  return `<hv-composition id="creative-studio" width="${width}" height="${height}" fps="30" duration="180f" background="${values.background}"><hv-assets><hv-asset id="outfit" kind="font" src="../shared/brand/Outfit.ttf" family="Outfit" weight="700"></hv-asset></hv-assets><style>p { font-family:Outfit; font-weight:700; margin:0; }</style><hv-scene duration="180f">${parts.join('')}</hv-scene></hv-composition>`;
}
