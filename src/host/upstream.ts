/**
 * A 端：用 `ctx.connection.authenticatedUrl()` 拿带启动令牌的地址，GET 一次换取宿主签发的
 * 登录 Cookie（303 + Set-Cookie），之后网关在服务端把它附加到转发请求上。
 * 先例：dsh-mobile exchangeUpstreamCookie（refer/dsh-mobile-pkg/package/lib/index.mjs:7237-7317）。
 */
import http from 'node:http';

const REFRESH_MARGIN_MS = 60_000;

export class UpstreamAuth {
  private cookie: string | undefined;
  private expiresAt = 0;
  private task: Promise<string> | undefined;

  constructor(
    private readonly origin: () => string,
    private readonly authenticatedUrl: (base: string) => string,
  ) {}

  /** 宿主根地址（如 http://127.0.0.1:3211）。 */
  upstreamOrigin(): URL {
    return new URL(this.origin());
  }

  async cookieHeader(): Promise<string> {
    if (this.cookie !== undefined && this.expiresAt > Date.now() + REFRESH_MARGIN_MS) return this.cookie;
    this.task ??= this.exchange().finally(() => {
      this.task = undefined;
    });
    return this.task;
  }

  invalidate(): void {
    this.cookie = undefined;
  }

  private async exchange(): Promise<string> {
    const base = this.upstreamOrigin();
    const target = new URL(this.authenticatedUrl(`${base.origin}/`));
    if (target.origin !== base.origin || target.search === '') throw new Error('UPSTREAM_AUTH: unexpected authenticated url');
    return new Promise<string>((resolve, reject) => {
      const req = http.request(
        {
          hostname: base.hostname.replace(/^\[|\]$/g, ''),
          port: Number(base.port),
          method: 'GET',
          path: `${target.pathname}${target.search}`,
          headers: { host: base.host, accept: 'text/html', 'accept-encoding': 'identity' },
          agent: false,
        },
        (res) => {
          res.resume();
          const sc = res.headers['set-cookie']?.[0];
          const pair = sc?.split(';', 1)[0];
          const maxAge = Number(/(?:^|;\s*)Max-Age=(\d+)/i.exec(sc ?? '')?.[1] ?? NaN);
          if (res.statusCode !== 303 || pair === undefined || !/^[^=;\s]+=[^;\s]+$/.test(pair) || !(maxAge > 0)) {
            reject(new Error(`UPSTREAM_AUTH: status ${String(res.statusCode)}`));
            return;
          }
          this.cookie = pair;
          this.expiresAt = Date.now() + maxAge * 1000;
          resolve(pair);
        },
      );
      req.setTimeout(5000, () => req.destroy(new Error('UPSTREAM_AUTH: timeout')));
      req.on('error', reject);
      req.end();
    });
  }
}
