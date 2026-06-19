import { cpSync, copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const vendorRoot = 'web/assets/vendor';
rmSync(vendorRoot, { force: true, recursive: true });
mkdirSync(`${vendorRoot}/phosphor`, { recursive: true });
mkdirSync(`${vendorRoot}/inter/files`, { recursive: true });

for (const weight of ['regular', 'fill', 'bold']) {
  cpSync(`node_modules/@phosphor-icons/web/src/${weight}`, `${vendorRoot}/phosphor/${weight}`, {
    recursive: true
  });
}

const fontFiles = new Set();
for (const weight of ['400', '500', '600']) {
  const source = `node_modules/@fontsource/inter/${weight}.css`;
  const stylesheet = readFileSync(source, 'utf8');
  copyFileSync(source, `${vendorRoot}/inter/${weight}.css`);
  for (const match of stylesheet.matchAll(/files\/([^)\s]+)/g)) {
    fontFiles.add(match[1]);
  }
}
for (const filename of fontFiles) {
  copyFileSync(
    `node_modules/@fontsource/inter/files/${filename}`,
    `${vendorRoot}/inter/files/${filename}`
  );
}

const tailwind = spawnSync(
  'node_modules/.bin/tailwindcss',
  ['-i', './web/css/tailwind-input.css', '-o', './web/css/vendor.css', '--minify'],
  { stdio: 'inherit' }
);
if (tailwind.status !== 0) {
  process.exit(tailwind.status || 1);
}
