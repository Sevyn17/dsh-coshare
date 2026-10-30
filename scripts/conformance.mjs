/**
 * 对照脚本（G1 §5）：代码与 D18 基线不走样。每次提交前跑。
 * 对照：RPC ↔ M1/M2 · 控制接口 ↔ M3 · 配置 ↔ S6 · 错误码 ↔ 客户端提示 · 挂载点 ↔ M2/M4。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
let bad = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) bad++;
};

const docs = {
  m1: read('.devkit/00 基线/模块/M1 实例身份与配对.md'),
  m2: read('.devkit/00 基线/模块/M2 配对与共享管理页.md'),
  m3: read('.devkit/00 基线/模块/M3 共享网关.md'),
  m4: read('.devkit/00 基线/模块/M4 远程工作区接入.md'),
  s6: read('.devkit/00 基线/共享/S6 配置与环境.md'),
};
const hostIndex = read('src/host/index.ts');
const service = read('src/host/service.ts');
const api = read('src/client/api.ts');
const clientIndex = read('src/client/index.tsx');
const panel = read('src/client/panel.tsx');

// 1. 本地 RPC：代码里注册的方法都在 M1/M2 登记
const rpcBlock = hostIndex.slice(hostIndex.indexOf('rpcMethods'));
const methods = [...rpcBlock.matchAll(/^\s*'([a-z]+(?:\.[a-z]+)+)'\s*:/gm)].map((m) => m[1]);
check('RPC 方法已从代码提取', methods.length >= 10, methods.join(' · '));
for (const m of methods) check(`RPC ${m} 在 M1/M2/M4 登记`, docs.m1.includes(m) || docs.m2.includes(m) || docs.m4.includes(m));

// 2. 网关控制接口 ↔ M3
for (const p of ['ping', 'pair/request', 'pair/status', 'unpair']) {
  check(`控制接口 ${p}：代码 + M3`, service.includes(`'${p}'`) && docs.m3.includes(p));
}

// 3. 配置 ↔ S6 + cordis.patch.yml
const cordis = read('cordis.patch.yml');
for (const key of ['enabled', 'listenHost', 'port', 'allowedCidrs', 'advertiseHosts', 'inviteTtlMinutes', 'stateFile']) {
  check(`配置 ${key}：Schema + S6 + cordis.patch.yml`, hostIndex.includes(`${key}:`) && docs.s6.includes(key) && cordis.includes(key));
}

// 4. 服务端错误码都有客户端中文提示
const codes = new Set([...service.matchAll(/new Error\('([A-Z_]+)'/g)].map((m) => m[1]));
check('服务端错误码已提取', codes.size > 0, [...codes].join(' · '));
for (const c of codes) check(`错误码 ${c} 在 api.ts ERROR_TEXT`, api.includes(`${c}:`));

// 5. 挂载点 ↔ M2/M4
check('plugins.detail.section 挂载（M2）', clientIndex.includes('plugins.detail.section') && docs.m2.includes('plugins.detail.section'));
check('sidebar.panellist 入口（M4）', clientIndex.includes('sidebar.panellist') && docs.m4.includes('sidebar.panellist'));
check('main 面板 dsh-share-panel（M4）', (clientIndex + panel).includes('dsh-share-panel') && docs.m4.includes('dsh-share-panel'));

console.log(bad === 0 ? '\n全部对照通过（0 偏差）' : `\n${bad} 处偏差，见上`);
process.exit(bad === 0 ? 0 : 1);
