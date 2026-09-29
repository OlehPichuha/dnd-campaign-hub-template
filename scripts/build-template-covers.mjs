import { mkdirSync, writeFileSync } from 'node:fs';

// Original vector placeholders; no third-party campaign art is bundled.
const covers = [
  ['journal', 'ЖУРНАЛ', '#554255', '#b89777', 'M180 170h400M180 238h310M180 306h360M180 374h260'],
  ['console', 'КОНСОЛЬ', '#303953', '#d76480', 'M176 188l86 73-86 73M294 335h230M176 418h370'],
  ['foundry', 'FOUNDRY', '#334a50', '#a9c5c0', 'M240 190l140-80 140 80v170l-140 80-140-80zM380 110v330M240 190l140 80 140-80'],
  ['npcs', 'NPC', '#394651', '#d8b77a', 'M375 135a78 78 0 1 0 0 156a78 78 0 1 0 0-156M215 416c12-81 64-123 160-123s148 42 160 123'],
  ['drow', 'СОНЦЕ', '#383556', '#c9b2d1', 'M375 165v-65M375 345v65M245 255h-65M570 255h-65M282 162l-45-45M468 348l45 45M468 162l45-45M282 348l-45 45M375 179a76 76 0 1 0 0 152a76 76 0 1 0 0-152'],
  ['notes', 'НОТАТКИ', '#3d4650', '#b5c5be', 'M208 145h335v280H208zM255 207h215M255 267h215M255 327h165'],
  ['prices', 'ДОВІДНИК', '#514737', '#e3c687', 'M180 220h390M180 288h390M180 356h390M300 178v220M455 178v220'],
  ['academy', 'АКАДЕМІЯ', '#343d5a', '#cad6e5', 'M208 235l167-88 167 88-167 88zM252 255v151M335 255v151M415 255v151M498 255v151M214 410h325'],
];

const output = new URL('../public/images/', import.meta.url);
mkdirSync(output, { recursive: true });
for (const [name, label, background, accent, symbol] of covers) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 750 500" role="img" aria-label="Ілюстрація розділу ${label}">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="#101923"/></linearGradient><radialGradient id="glow"><stop stop-color="${accent}" stop-opacity=".24"/><stop offset="1" stop-color="${accent}" stop-opacity="0"/></radialGradient></defs>
  <rect width="750" height="500" fill="url(#bg)"/><circle cx="390" cy="255" r="305" fill="url(#glow)"/>
  <path d="M0 420q187-82 375 0t375 0" fill="none" stroke="${accent}" stroke-opacity=".18" stroke-width="2"/><path d="M0 446q187-82 375 0t375 0" fill="none" stroke="${accent}" stroke-opacity=".14" stroke-width="2"/>
  <rect x="30" y="30" width="690" height="440" fill="none" stroke="${accent}" stroke-opacity=".42" stroke-width="2"/>
  <path d="${symbol}" fill="none" stroke="${accent}" stroke-width="13" stroke-linecap="round" stroke-linejoin="round" opacity=".8"/>
  <text x="45" y="456" fill="${accent}" font-family="Arial,sans-serif" font-weight="700" font-size="24" letter-spacing="5">${label}</text>
</svg>`;
  writeFileSync(new URL(`${name}-placeholder.svg`, output), svg);
}
console.log(`Created ${covers.length} original cover placeholders.`);
