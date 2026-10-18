/** Trusted application code. No network access or previous-frame state. */
export const particles = {
  id: 'htmv-particles', version: '1.0.0', execution: 'main', capabilities: [],
  validate: () => [],
  prepare: async () => ({
    render({ ctx, width, height, localTime, random, props }) {
      const t = Number(localTime.num) / Number(localTime.den);
      const colors = ['#2563eb', '#00ff99', '#ffc000'];
      for (let i = 0; i < props.count; i++) {
        const x = ((random('x', i) * width + t * (15 + random('speed', i) * 35)) % (width + 40)) - 20;
        const y = random('y', i) * height + Math.sin(t + random('phase', i) * Math.PI * 2) * 25;
        const radius = 3 + random('radius', i) * 12;
        ctx.globalAlpha = .25 + random('alpha', i) * .55;
        ctx.fillStyle = colors[i % colors.length]; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill();
      }
    }, dispose() {}
  })
};
