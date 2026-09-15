# dsh-fingerprint-signature

Human verification gate for DeepSeek Harness (DSH). It asks the browser's platform authenticator (Windows Hello, Touch ID, or the platform's available user-verification method) before a protected AI tool continues.

## MVP scope

- Host: `index.js`, DSH tools/settings/web-server APIs.
- Client: `client.js`, DSH settings slot and optional Better Sidebar tab.
- Configuration: Chinese name, English name, team-defined identity ID, generated binding UUID, active/disabled state, browser authenticator binding, and custom key/value variables.
- Tool: `dsh_fingerprint_signature` returns a one-shot `verified` result and configured context variables.
- Optional enforcement: list tool names in `protectedTools`; each listed tool consumes a successful one-shot grant.

The MVP deliberately does not identify which person is enrolled on the device. It also does not persist biometric data. The browser performs local user verification. The Host currently checks the returned credential ID and the pending request; cryptographic WebAuthn assertion verification is a follow-up hardening item before treating this as an audit-grade signature.

## Local development

```bash
npm install
npm run verify
```

The plugin is loaded by the DSH bundle manifest in `cordis.patch.yml`. `client.js` is served as the Web Client module and requires a secure DSH browser context for WebAuthn. If the platform or browser has no available authenticator, the tool returns `unavailable`/`failed` and the skill must stop.

For local DSH testing:

```bash
npm install
npm run build:client
dsh plugin --profile web add link:/Users/ttpai/tayGit/dsh-fingerprint-signature
```

Restart the DSH profile after linking. The “指纹签名” settings item is registered by the Client module; a window refresh alone does not reload it.
