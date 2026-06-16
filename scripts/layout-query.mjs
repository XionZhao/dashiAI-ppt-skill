#!/usr/bin/env node
import {
  compactJson,
  listLayouts,
  parseArgs,
} from './skill-workflow-utils.mjs';

const args = parseArgs(process.argv.slice(2));
const result = {
  theme: args.theme || null,
  role: args.role || args.use || null,
  keyword: args.keyword || args.q || null,
  needsMedia: args['needs-media'] === true || args.media === true,
  limit: Number(args.limit || 12),
};

const layouts = listLayouts({
  theme: result.theme,
  role: result.role,
  keyword: result.keyword,
  needsMedia: result.needsMedia,
  limit: result.limit,
});

process.stdout.write(compactJson({
  ...result,
  count: layouts.length,
  layouts,
}));
