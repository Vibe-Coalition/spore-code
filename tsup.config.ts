import {defineConfig} from 'tsup';

export default defineConfig({
  entry: ['src/bin/spore.tsx'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  splitting: false,
  outDir: 'dist/bin',
  banner: {
    js: '#!/usr/bin/env node'
  }
});
