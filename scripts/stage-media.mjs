#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const [, , outDirArg, ...sourceArgs] = process.argv;

if (!outDirArg || !sourceArgs.length) {
  console.error('Usage: stage-media.mjs <output-ppt-dir> <media-file...>');
  process.exit(2);
}

const outDir = path.resolve(outDirArg);
const targetDir = path.join(outDir, 'assets/user-media');
fs.mkdirSync(targetDir, { recursive: true });

const usedNames = new Set();
const items = sourceArgs.map(sourceArg => {
  const source = path.resolve(sourceArg);
  if (!fs.existsSync(source)) throw new Error(`Media file does not exist: ${source}`);
  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new Error(`Media path is not a file: ${source}`);
  const ext = path.extname(source).toLowerCase();
  const kind = mediaKindForExt(ext);
  if (!kind) throw new Error(`Unsupported media file type: ${source}`);
  const name = uniqueName(slugify(path.basename(source, ext)), ext, usedNames);
  const relative = path.posix.join('assets/user-media', name);
  fs.copyFileSync(source, path.join(outDir, relative));
  return {
    source,
    relative,
    kind,
    mime: mimeForExt(ext),
  };
});

process.stdout.write(`${JSON.stringify({ outDir, items }, null, 2)}\n`);

function uniqueName(base, ext, used) {
  const safeBase = base || 'media';
  let name = `${safeBase}${ext}`;
  let index = 2;
  while (used.has(name)) {
    name = `${safeBase}-${index}${ext}`;
    index += 1;
  }
  used.add(name);
  return name;
}

function slugify(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function mediaKindForExt(ext) {
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.mov', '.m4v'].includes(ext)) return 'video';
  return null;
}

function mimeForExt(ext) {
  return {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.mov': 'video/quicktime',
    '.m4v': 'video/mp4',
  }[ext] || 'application/octet-stream';
}
