import {cloudflareTest} from '@cloudflare/vitest-plugin';
import {defineConfig} from 'vitest/config';
export default defineConfig({plugins:[cloudflareTest({wrangler:{configPath:'./wrangler.emoji-publication-v3-test.jsonc'}})],
 test:{include:['./test/emoji-publication-v3.test.ts'],fileParallelism:false,setupFiles:['./test/setup.ts'],globalSetup:['./test/emoji-publication-setup.mjs']}});
