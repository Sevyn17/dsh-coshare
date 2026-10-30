// 原始升级请求，看 B 主端口子路径 WS 的真实响应
import net from 'node:net';
const [bUrl, id, wsPath = '/api/events.mux', direct] = process.argv.slice(2);
const u = new URL(bUrl);
const r = await fetch(bUrl, { redirect: 'manual' });
const ck = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
const path = direct ? wsPath : `/dsh-coshare/peer/${id}${wsPath}`;
const CRLF = '\r\n';
const s = net.connect(Number(u.port), u.hostname, () => {
  s.write([`GET ${path} HTTP/1.1`, `Host: ${u.host}`, `Origin: ${u.origin}`, `Cookie: ${ck}`, 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==', '', ''].join(CRLF));
});
let buf = '';
s.on('data', (d) => { buf += d.toString('latin1'); if (buf.includes(CRLF + CRLF)) { console.log(path, '→', buf.split(CRLF + CRLF)[0].split(CRLF)[0]); s.destroy(); process.exit(0); } });
s.on('close', () => { if (!buf) console.log(path, '→ closed with no response'); });
setTimeout(() => { console.log(path, '→ timeout; got:', JSON.stringify(buf.slice(0, 300))); s.destroy(); process.exit(0); }, 6000);
