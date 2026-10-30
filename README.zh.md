# dsh-coshare 协作共享

[English](README.md)

在局域网里把多台电脑上的 DeepSeek Harness（DSH）配对起来，然后在自己的 DSH 里直接打开对方的完整界面：看会话、发消息、审批、改文件。所有执行和模型费用都发生在被访问的那台电脑上。

## 功能

- **原版界面**：内嵌的就是对方 DSH 的原版页面，包括对方装的其他插件。
- **多设备切换**：顶栏下拉切换已配对的设备，切换时页面保留不重载。
- **逐台确认**：对方用邀请码发起请求，你看到 6 位校验码与对方一致后才点「允许」。
- **加密传输**：局域网内走 TLS-PSK（TLS 1.2，ECDHE-PSK），不需要证书，不依赖外部服务。
- **随时撤销**：撤销后对方的连接立即断开；也可以一键暂停所有访问。

## 安装

需要 DSH 运行时 Node ≥ 24.9（DSH 自带的即可）。

### 从本地包安装（目前的方式）

在 [Releases](https://github.com/Sevyn17/dsh-coshare/releases) 下载 `dsh-coshare-<版本>.tgz`。

- **桌面版**：打开 **插件** 页面，在安装框里填 tgz 文件的完整路径（例如 `C:\Downloads\dsh-coshare-0.1.0.tgz`），安装并启用，然后重启 DSH。
- **命令行**：

  ```sh
  dsh plugin --profile web add C:/Downloads/dsh-coshare-0.1.0.tgz
  dsh --profile web
  ```

两台电脑都要安装。

### 从 npm 安装（发布后）

```sh
dsh plugin --profile web add dsh-coshare
```

## 使用

1. 两台电脑都打开左侧栏的 **协作共享**。
2. 被访问的电脑（A）：点 ⚙ → **让别人访问我** → **生成邀请码** → 复制。第一次生成时会询问是否开启访问服务。
3. 访问方（B）：点 ⚙ → **我访问别人**，粘贴邀请码，确认预览里的设备名后点 **发起配对**。
4. A 上出现确认卡。核对双方显示的 6 位校验码一致后点 **允许**。
5. B 自动打开 A 的界面。之后用顶栏下拉切换设备。

> 允许即授予对方这台电脑的完全控制权（执行命令、改文件、审批），只配对你信任的设备。

## 配置

一般不用改。插件配置页可调：

| 项 | 默认 | 说明 |
|---|---|---|
| `listenHost` | `0.0.0.0` | 访问服务监听地址 |
| `port` | `0` | 访问服务端口；0 = 首次随机，之后沿用 |
| `allowedCidrs` | 私网三段 | 允许连入的来源网段 |
| `advertiseHosts` | 空 | 写进邀请码的地址；空 = 自动取本机局域网网卡 |
| `inviteTtlMinutes` | `10` | 邀请码有效期（1–60 分钟） |

## 限制

- 只支持局域网，暂不支持外网访问。
- 手机经 dsh-mobile 访问 B 时看不到 A。
- Windows 防火墙首次可能弹窗询问，需允许 DSH 接受局域网连接。

## 开发

```sh
npm install
npm run build      # 输出 lib/
npm test
npm pack           # 生成 dsh-coshare-<版本>.tgz
```

## 许可证

[Apache-2.0](LICENSE)
