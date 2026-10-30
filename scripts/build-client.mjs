// Client bundle build: src/client (TS/React) -> lib/client/client.js
// dsh 浏览器半部的装载契约（dsh-mobile 先例逐字对照）：
//   window.__ModuleLoader__.load({ id: "<pkg>", factory: (require) => {...} })
// 工厂接收宿主注入的 require（react/react-dom 在宿主白名单里）——
// 我们 bundle 顶层裸 require("react") 在浏览器无 require 即抛错（真机验收复现）。
import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(new URL(import.meta.url)));
const out = join(root, '..', 'lib', 'client');
mkdirSync(out, { recursive: true });

// 第一步：esbuild 打 CJS 体（external react/react-dom 由宿主 require 提供）
await build({
  entryPoints: [join(root, '..', 'src', 'client', 'index.tsx')],
  bundle: true,
  format: 'cjs',
  outfile: join(out, 'client.js'),
  sourcemap: 'external',
  jsx: 'automatic',
  target: 'es2022',
  external: ['react', 'react-dom'],
  logLevel: 'info',
});

// 第二步：包一层 __ModuleLoader__.load（dsh-mobile 同款装载协议）
const body = await import('node:fs').then((fs) => fs.readFileSync(join(out, 'client.js'), 'utf8'));
const wrapped = `window.__ModuleLoader__.load({
\tid: "dsh-coshare",
\tfactory: (require) => {
\t\tvar module = { exports: {} };
\t\tvar exports = module.exports;
${body
  .split('\n')
  .map((l) => `\t\t${l}`)
  .join('\n')}
\t\treturn module.exports;
\t}
});
`;
writeFileSync(join(out, 'client.js'), wrapped, 'utf8');
console.log('client.js wrapped for __ModuleLoader__ (dsh-mobile 协议)');
