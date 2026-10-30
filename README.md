# dsh-coshare

[中文说明](README.zh.md)

Pair DeepSeek Harness (DSH) instances on your LAN, then open another computer's full DSH inside your own: browse sessions, send messages, approve tools, edit files. Execution and model cost stay on the computer being accessed.

## Features

- **Stock UI**: the embedded page is the other DSH's own interface, including its other plugins.
- **Device switcher**: a top-bar dropdown switches between paired devices without reloading them; the last viewed device opens automatically next time.
- **Per-device approval**: the requester uses an invite code; you allow it only after both sides show the same 6-digit code.
- **Encrypted transport**: TLS-PSK (TLS 1.2, ECDHE-PSK) on the LAN. No certificates, no external service.
- **Revoke any time**: revoking cuts the device off immediately; one switch pauses all access.
- **Phone access**: a phone connected to B through [dsh-mobile](https://github.com/saya-ch/dsh-mobile) can open A from B's Co-share panel (see below).

## Install

Requires the DSH runtime Node ≥ 24.9 (the bundled one works).

### From a local package (current method)

Download `dsh-coshare-<version>.tgz` from [Releases](https://github.com/Sevyn17/dsh-coshare/releases).

- **Desktop**: open **Plugins**, enter the full path of the tgz in the install box (for example `C:\Downloads\dsh-coshare-0.1.1.tgz`), install and enable, then **fully quit DSH (including the tray icon) and start it again**. Closing the window is not enough.
- **CLI**:

  ```sh
  dsh plugin --profile web add /path/to/dsh-coshare-0.1.1.tgz
  dsh --profile web
  ```

Install it on both computers.

### Upgrade

1. Remove the old version: `dsh plugin --profile <profile> remove dsh-coshare` (the desktop profile is `desktop`), or uninstall it on the Plugins page.
2. Install the new package as above.
3. Fully quit DSH (including the tray icon) and start it again.

Pairing data lives in `~/.dsh/dsh-coshare/` and survives uninstalling.

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

### Phone access (through dsh-mobile)

The phone connects to B through dsh-mobile and opens A in B's Co-share panel. A's page is forwarded under B's main port at `/dsh-coshare/peer/<deviceId>/`, so no 127.0.0.1 address is involved.

dsh-mobile only allows WebSocket paths it knows. Each accessed device needs 2 paths allowed:

1. Open the device once on the phone so the blocked requests are recorded.
2. On B, open dsh-mobile **Diagnostics** → **Third-party WebSocket paths** and click **Allow all**. You can also add them under "Add path manually (advanced)"; the device ID must be the real 12-character ID, which the hint at the top of the Co-share page already fills in.

dsh-mobile allows at most 16 paths, so at most 8 devices.

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `listenHost` | `0.0.0.0` | Access service bind address |
| `port` | `0` | Access service port; 0 = random first time, then reused |
| `allowedCidrs` | private ranges | Source networks allowed to connect |
| `advertiseHosts` | empty | Addresses put in invite codes; empty = detected LAN NICs |
| `inviteTtlMinutes` | `10` | Invite lifetime (1–60 minutes) |

## Troubleshooting

- **Stuck on "connecting", or told DSH has not restarted**: DSH was not fully quit after installing or upgrading. Quit it (including the tray icon) and start it again.
- **The other computer's IP changed**: remove the device and pair again. Addresses are not updated automatically yet.
- **The phone says dsh-mobile has changed**: dsh-mobile's security check changed; update dsh-coshare.
- **The page on the phone does not update or the session list is empty**: check that the WebSocket paths are allowed in dsh-mobile (see Phone access).
- **Windows Firewall prompt**: allow DSH on private networks.

## Limitations

- LAN only; for internet access, reach B through one of dsh-mobile's remote channels.
- Phone access depends on dsh-mobile's CSRF rules; a dsh-mobile update may require updating this plugin.

## Development

```sh
npm install
npm run build      # emits lib/
npm test
npm pack           # produces dsh-coshare-<version>.tgz
```

`scripts/redeploy.sh` installs the plugin into isolated test instances; `scripts/dev/` holds diagnostic and regression scripts, with usage at the top of each file.

## License

[Apache-2.0](LICENSE)
