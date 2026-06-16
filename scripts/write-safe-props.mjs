#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import {
  compactJson,
  normalizeProps,
} from './skill-workflow-utils.mjs';

const [, , layout, propsArg] = process.argv;

if (!layout || !propsArg) {
  console.error('Usage: node scripts/write-safe-props.mjs <layout> <props-json-or-file>');
  process.exit(2);
}

let props;
try {
  const source = propsArg.trim().startsWith('{') || propsArg.trim().startsWith('[')
    ? propsArg
    : readFileSync(propsArg, 'utf8');
  props = JSON.parse(source);
} catch (error) {
  console.error(`Invalid props JSON: ${error.message}`);
  process.exit(2);
}

const result = normalizeProps(layout, props);
process.stdout.write(compactJson({
  layout,
  ...result,
}));

if (result.errors?.length) process.exit(1);
