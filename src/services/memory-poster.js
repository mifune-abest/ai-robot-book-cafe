import sharp from 'sharp';
import { escapeXml } from '../lib/validation.js';

const iconShapes = {
  book: '<path d="M-28-18h22q14 0 14 12v42Q2 25-28 29zM28-18H6Q-8-18-8-6v42Q-2 25 28 29z" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/>',
  star: '<path d="M0-34 9-11 34-10 14 6 21 31 0 17-21 31-14 6-34-10-9-11z" fill="currentColor"/>',
  music: '<path d="M-8-29v42q-9-6-18-1t-3 15q9 9 21-1V-15l29-7V5q-9-6-18-1t-3 15q9 9 21-1v-53z" fill="currentColor"/>',
  food: '<path d="M-30-5h60q-2 32-30 32T-30-5zm8-13h44M-15-30q8 8 0 16M2-34q8 8 0 16M19-30q8 8 0 16" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>',
  craft: '<path d="M0-31 8-9 31-8 13 6 19 30 0 16-19 30-13 6-31-8-8-9z" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="0" cy="0" r="7" fill="currentColor"/>',
  smile: '<circle r="31" fill="none" stroke="currentColor" stroke-width="7"/><circle cx="-11" cy="-8" r="4" fill="currentColor"/><circle cx="11" cy="-8" r="4" fill="currentColor"/><path d="M-13 7q13 15 26 0" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round"/>',
  animal: '<path d="M0 28q-27 0-27-18 0-12 10-15-3-19 8-23 9-2 13 14 4-16 13-14 11 4 8 23 10 3 10 15Q35 28 0 28z" fill="currentColor"/><circle cx="-10" cy="4" r="4" fill="#fff"/><circle cx="10" cy="4" r="4" fill="#fff"/>',
  sport: '<circle r="31" fill="none" stroke="currentColor" stroke-width="7"/><path d="M-30 0h60M0-30q-15 30 0 60M0-30q15 30 0 60" fill="none" stroke="currentColor" stroke-width="5"/>',
  cafe: '<path d="M-28-18h43v35q0 12-20 12t-20-12V-18zm43 8h11q12 0 12 11T26 12H15M-34 34h62" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>',
  rainbow: '<path d="M-34 22a34 34 0 0 1 68 0M-22 22a22 22 0 0 1 44 0M-10 22a10 10 0 0 1 20 0" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round"/>',
  heart: '<path d="M0 30-29 1q-14-19 5-31 15-8 24 7 9-15 24-7 19 12 5 31z" fill="currentColor"/>',
  rocket: '<path d="M0-34q24 13 20 43L7 25-7 25-20 9Q-24-21 0-34zM-9 27-20 38M9 27 20 38" fill="none" stroke="currentColor" stroke-width="7" stroke-linejoin="round"/><circle cy="-8" r="7" fill="currentColor"/>',
};

function robotSvg(entry, theme, x, y, scale, slotWidth) {
  const color = theme.color;
  const name = escapeXml(entry.nickname);
  const icon = iconShapes[theme.theme] || iconShapes.star;
  const headY = -92;
  const labelWidth = Math.min(slotWidth / scale - 20, 330);
  return `
    <g transform="translate(${x} ${y}) scale(${scale})">
      <ellipse cx="0" cy="93" rx="78" ry="18" fill="#17324D" opacity=".13"/>
      <path d="M-45 32-78 69M45 32 78 69" stroke="#17324D" stroke-width="17" stroke-linecap="round"/>
      <path d="M-29 80-47 115M29 80 47 115" stroke="#17324D" stroke-width="19" stroke-linecap="round"/>
      <rect x="-60" y="5" width="120" height="86" rx="31" fill="${color}" stroke="#17324D" stroke-width="11"/>
      <circle cx="0" cy="48" r="26" fill="#FFF8E8"/>
      <g transform="translate(0 48) scale(.62)" color="#17324D">${icon}</g>
      <rect x="-72" y="${headY}" width="144" height="112" rx="43" fill="#F9FCFF" stroke="#17324D" stroke-width="11"/>
      <path d="M0 ${headY}v-25" stroke="#17324D" stroke-width="9"/><circle cx="0" cy="${headY - 31}" r="12" fill="#F4C84A" stroke="#17324D" stroke-width="7"/>
      <circle cx="-27" cy="${headY + 48}" r="10" fill="#17324D"/><circle cx="27" cy="${headY + 48}" r="10" fill="#17324D"/>
      <path d="M-23 ${headY + 76}q23 20 46 0" fill="none" stroke="#17324D" stroke-width="8" stroke-linecap="round"/>
      <circle cx="-64" cy="${headY + 61}" r="8" fill="#F3A2B7" opacity=".8"/><circle cx="64" cy="${headY + 61}" r="8" fill="#F3A2B7" opacity=".8"/>
      <rect x="-${labelWidth / 2}" y="120" width="${labelWidth}" height="54" rx="24" fill="#fff" stroke="#17324D" stroke-width="5"/>
      <text x="0" y="156" text-anchor="middle" font-family="Hiragino Sans, Noto Sans JP, sans-serif" font-size="25" font-weight="800" fill="#17324D">${name}</text>
    </g>`;
}

export async function createMemoryPoster({ entries, themes }) {
  const width = 2048;
  const height = 1152;
  const count = entries.length;
  const columns = Math.min(8, Math.max(1, Math.ceil(Math.sqrt(count * 1.7))));
  const rows = Math.ceil(count / columns);
  const areaTop = 260;
  const areaBottom = 1085;
  const slotWidth = 1820 / columns;
  const slotHeight = (areaBottom - areaTop) / rows;
  const maxScale = count <= 4 ? 1.65 : count <= 8 ? 1.25 : 1;
  const scale = Math.min(maxScale, slotWidth / 235, slotHeight / 315);
  const themeMap = new Map(themes.map((item) => [item.id, item]));

  const robots = entries.map((entry, index) => {
    const row = Math.floor(index / columns);
    const itemsThisRow = row === rows - 1 ? count - row * columns : columns;
    const column = index - row * columns;
    const rowWidth = itemsThisRow * slotWidth;
    const startX = (width - rowWidth) / 2 + slotWidth / 2;
    const x = startX + column * slotWidth;
    const y = areaTop + row * slotHeight + Math.min(110, slotHeight * 0.42);
    return robotSvg(entry, themeMap.get(entry.id), x, y, scale, slotWidth);
  }).join('\n');

  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#DDF5F5"/><stop offset="1" stop-color="#FFF8E8"/></linearGradient>
        <pattern id="confetti" width="130" height="95" patternUnits="userSpaceOnUse"><circle cx="18" cy="20" r="6" fill="#F4C84A"/><rect x="88" y="48" width="12" height="12" rx="3" fill="#F3A2B7" transform="rotate(18 94 54)"/><path d="M48 70l7 13 15 2-11 10" fill="none" stroke="#46A879" stroke-width="6"/></pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#sky)"/>
      <rect width="100%" height="100%" fill="url(#confetti)" opacity=".42"/>
      <rect y="920" width="100%" height="232" fill="#D79B66"/>
      <path d="M0 948H2048" stroke="#A46C45" stroke-width="12"/>
      <g opacity=".98">
        <rect x="50" y="105" width="330" height="760" rx="18" fill="#8E5F3D"/>
        <rect x="76" y="135" width="278" height="690" fill="#F7E9C8"/>
        <path d="M76 300h278M76 465h278M76 630h278" stroke="#8E5F3D" stroke-width="18"/>
        <g fill="#F05A47"><rect x="95" y="178" width="35" height="104"/><rect x="270" y="185" width="50" height="97"/></g>
        <g fill="#2F8FB8"><rect x="142" y="160" width="52" height="122"/><rect x="218" y="183" width="38" height="99"/></g>
        <g fill="#46A879"><rect x="104" y="343" width="48" height="104"/><rect x="170" y="332" width="34" height="115"/><rect x="250" y="350" width="65" height="97"/></g>
        <g fill="#6B72C9"><rect x="92" y="500" width="70" height="112"/><rect x="180" y="525" width="45" height="87"/><rect x="248" y="490" width="62" height="122"/></g>
        <g fill="#F4A62A"><rect x="105" y="670" width="44" height="137"/><rect x="170" y="689" width="70" height="118"/><rect x="262" y="658" width="46" height="149"/></g>
        <rect x="1668" y="105" width="330" height="760" rx="18" fill="#8E5F3D"/>
        <rect x="1694" y="135" width="278" height="690" fill="#F7E9C8"/>
        <path d="M1694 300h278M1694 465h278M1694 630h278" stroke="#8E5F3D" stroke-width="18"/>
        <g fill="#EC6E9C"><rect x="1712" y="170" width="54" height="112"/><rect x="1790" y="188" width="42" height="94"/><rect x="1850" y="155" width="84" height="127"/></g>
        <g fill="#2F8FB8"><rect x="1716" y="340" width="65" height="107"/><rect x="1800" y="326" width="42" height="121"/><rect x="1865" y="360" width="62" height="87"/></g>
        <g fill="#F4C84A"><rect x="1712" y="505" width="44" height="107"/><rect x="1778" y="485" width="72" height="127"/><rect x="1875" y="522" width="48" height="90"/></g>
        <g fill="#46A879"><rect x="1715" y="664" width="66" height="143"/><rect x="1800" y="680" width="37" height="127"/><rect x="1855" y="650" width="73" height="157"/></g>
      </g>
      <rect x="398" y="45" width="1252" height="172" rx="58" fill="#17324D"/>
      <text x="1024" y="118" text-anchor="middle" font-family="Hiragino Sans, Noto Sans JP, sans-serif" font-size="54" font-weight="800" fill="#F4C84A">AI ROBOT BOOK CAFE</text>
      <text x="1024" y="180" text-anchor="middle" font-family="Hiragino Sans, Noto Sans JP, sans-serif" font-size="58" font-weight="900" fill="#fff">きょうの おもいで</text>
      ${robots}
      <text x="1024" y="1120" text-anchor="middle" font-family="Hiragino Sans, Noto Sans JP, sans-serif" font-size="24" font-weight="700" fill="#17324D">${count}にんのロボットが ぜんいんしゅうごう！</text>
    </svg>`);
  return sharp(svg).png({ compressionLevel: 9 }).toBuffer();
}
