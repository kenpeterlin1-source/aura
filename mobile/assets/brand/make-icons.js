// Draws the AuraStream icon (amber crescent moon with three sound waves on near-black) and exports every size the app uses.
//   node assets/brand/make-icons.js   (needs sharp; run with NODE_PATH pointing at a node_modules that has it)
const sharp = require('sharp');
const path = require('path');
const out = (f) => path.join(__dirname, '..', 'images', f);

// Moon and waves drawn in a 1024 box; `s` scales them around the centre so the adaptive icon keeps them in its safe zone.
function art({ bg, fill, waveOpacity = [0.9, 0.6, 0.35], s = 1, glow = true }) {
  const g = (x) => 512 + (x - 512) * s;
  const r = (v) => v * s;
  const cx = g(381), cy = g(512); // moon left of centre so moon + waves sit centred
  const arc = (rad, i) => {
    const a = (d) => [cx + rad * Math.cos((d * Math.PI) / 180), cy + rad * Math.sin((d * Math.PI) / 180)];
    const [x1, y1] = a(-38), [x2, y2] = a(38);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${rad} ${rad} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" fill="none"
      stroke="${fill}" stroke-opacity="${waveOpacity[i]}" stroke-width="${r(34)}" stroke-linecap="round"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <radialGradient id="glow" cx="${cx / 10.24}%" cy="${cy / 10.24}%" r="55%">
      <stop offset="0" stop-color="#EF9F27" stop-opacity="0.22"/><stop offset="1" stop-color="#EF9F27" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="moon" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${fill === '#FFFFFF' ? '#FFFFFF' : '#FAC775'}"/><stop offset="1" stop-color="${fill}"/>
    </linearGradient>
    <mask id="cut"><rect width="1024" height="1024" fill="#fff"/><circle cx="${cx + r(95)}" cy="${cy - r(70)}" r="${r(185)}" fill="#000"/></mask>
  </defs>
  ${bg ? `<rect width="1024" height="1024" fill="${bg}"/>` : ''}
  ${glow && bg ? `<rect width="1024" height="1024" fill="url(#glow)"/>` : ''}
  <circle cx="${cx}" cy="${cy}" r="${r(215)}" fill="url(#moon)" mask="url(#cut)"/>
  ${[300, 380, 460].map((rad, i) => arc(r(rad), i)).join('\n  ')}
</svg>`;
}

const png = (svg, size, file) => sharp(Buffer.from(svg)).resize(size, size).png().toFile(out(file));

(async () => {
  const bg = '#080603';
  await png(art({ bg, fill: '#EF9F27', s: 0.82 }), 1024, 'icon.png');
  await png(art({ bg: null, fill: '#EF9F27', s: 0.72 }), 512, 'android-icon-foreground.png');
  await png(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${bg}"/>
    <circle cx="440" cy="512" r="560" fill="#EF9F27" fill-opacity="0.10"/></svg>`, 512, 'android-icon-background.png');
  await png(art({ bg: null, fill: '#FFFFFF', waveOpacity: [1, 1, 1], s: 0.72, glow: false }), 432, 'android-icon-monochrome.png');
  await png(art({ bg: null, fill: '#EF9F27', s: 0.9 }), 400, 'splash-icon.png');
  await png(art({ bg, fill: '#EF9F27', s: 0.9 }), 48, 'favicon.png');
  await png(art({ bg, fill: '#EF9F27', s: 0.82 }), 512, '../brand/aurastream-icon-512.png');
  console.log('icons written');
})();
