#!/usr/bin/env node
/**
 * Lossless PNG optimization for documentation screenshots.
 * Uses sharp to re-encode PNGs with maximum compression.
 * Run: node scripts/optimize-images.mjs
 */

import sharp from 'sharp';
import { readdir, stat } from 'node:fs/promises';
import { join, extname } from 'node:path';

const IMG_DIR = new URL('../static/img', import.meta.url).pathname;

async function findPngs(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findPngs(full));
    } else if (extname(entry.name).toLowerCase() === '.png') {
      files.push(full);
    }
  }
  return files;
}

async function optimize() {
  const pngs = await findPngs(IMG_DIR);
  let totalBefore = 0;
  let totalAfter = 0;

  console.log(`Found ${pngs.length} PNG files to optimize...\n`);

  for (const file of pngs) {
    const before = (await stat(file)).size;
    totalBefore += before;

    const buffer = await sharp(file)
      .png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 })
      .toBuffer();

    if (buffer.length < before) {
      const { default: { writeFile } } = await import('node:fs/promises');
      await writeFile(file, buffer);
      totalAfter += buffer.length;
      const saved = ((1 - buffer.length / before) * 100).toFixed(1);
      console.log(`  ${file.replace(IMG_DIR + '/', '')}  ${fmt(before)} → ${fmt(buffer.length)}  (-${saved}%)`);
    } else {
      totalAfter += before;
      console.log(`  ${file.replace(IMG_DIR + '/', '')}  ${fmt(before)} (already optimal)`);
    }
  }

  console.log(`\nTotal: ${fmt(totalBefore)} → ${fmt(totalAfter)}  (-${((1 - totalAfter / totalBefore) * 100).toFixed(1)}%)`);
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

optimize().catch(err => { console.error(err); process.exit(1); });
