# dsh-coshare

[中文说明](README.zh.md)

Pair DeepSeek Harness (DSH) instances on your LAN, then open another computer's full DSH inside your own: browse sessions, send messages, approve tools, edit files. Execution and model cost stay on the computer being accessed.

## Features

- **Stock UI**: the embedded page is the other DSH's own interface, including its other plugins.
- **Device switcher**: a top-bar dropdown switches between paired devices without reloading them.
- **Per-device approval**: the requester uses an invite code; you allow it only after both sides show the same 6-digit code.
- **Encrypted transport**: TLS-PSK (TLS 1.2, ECDHE-PSK) on the LAN. No certificates, no external service.
- **Revoke any time**: revoking cuts the device off immediately; one switch pauses all access.

## Install

Requires the DSH runtime Node ≥ 24.9 (the bundled one works).

### From a local package (current method)

Download `dsh-coshare-<version>.tgz` from [Releases](https://github.com/Sevyn17/dsh-coshare/releases).

- **Desktop**: open **Plugins**, enter the full path of the tgz in the install box, install and enable, then restart DSH.
- **CLI**:

  ```sh
  dsh plugin --profile web add /path/to/dsh-coshare-0.1.0.tgz
  dsh --profile web
  ```

Install it on both computers.

### From npm (after publishing)

```sh
dsh plugin --profile web add dsh-coshare
```

## Usage

1. Open **协作共享** (Co-share) in the sidebar on both computers.
2. On the computer to be accessed (A): ⚙ → **让别人访问我** (Let others access me) → **生成邀请码** (Generate invite) → copy. The first time, it asks to turn on the access service.
3. On the accessing computer (B): ⚙ → **我访问别人** (Access others), paste the code, check the device name in the preview, click **发起配对** (Request pairing).
4. A shows a confirmation card. Check that both sides show the same 6-digit code, then click **允许** (Allow).
5. B opens A's interface. Use the top-bar dropdown to switch devices later.

> Allowing a device grants it full control of this computer (run commands, edit files, approve tools). Pair only devices you trust.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `listenHost` | `0.0.0.0` | Access service bind address |
| `port` | `0` | Access service port; 0 = random first time, then reused |
| `allowedCidrs` | private ranges | Source networks allowed to connect |
| `advertiseHosts` | empty | Addresses put in invite codes; empty = detected LAN NICs |
| `inviteTtlMinutes` | `10` | Invite lifetime (1–60 minutes) |

## Limitations

- LAN only; no internet access yet.
- A phone reaching B through dsh-mobile cannot see A.
- Windows Firewall may prompt the first time; allow DSH on private networks.

## Development

```sh
npm install
npm run build      # emits lib/
npm test
npm pack           # produces dsh-coshare-<version>.tgz
```

## License

[Apache-2.0](LICENSE)
