# dsh-fingerprint-signature

Human verification gate for DeepSeek Harness (DSH). A native helper asks the operating system authenticator (Windows Hello, Touch ID, or the platform's available user-verification method) before a protected AI tool continues.

> This is the lightweight, earlier experiment in human confirmation. For cryptographically binding authorization to the exact action an agent is about to execute, see [dsh-human-intent](https://github.com/guhanfei-ai/dsh-human-intent).

## MVP scope

- Host: `index.js`, DSH tools/settings/web-server APIs.
- Client: `client.js`, DSH settings slot and optional Better Sidebar tab.
- Fingerprint feature: off by default. Activating or deactivating triggers a platform verification immediately; activation saves the current signature variables and generates the binding UUID on the first success.
- Signature variables: four built-in fields (Chinese name, English name, team-defined identity ID, binding UUID) plus custom key/value variables. Every "save variables" requires a fingerprint verification; saves are rejected outright while the feature is off, and no save route can flip the activation state or rewrite the binding UUID.
- Tool: `dsh_fingerprint_signature` answers in three states — verified (injects the signature variables), verification failed (returns a message telling the AI to stop), and feature disabled (returns "fingerprint feature is off; tool call is void; signature variables are unavailable" and tells the AI to stop).
- Optional enforcement: list tool names in `protectedTools`; each listed tool consumes a successful one-shot grant.

The MVP deliberately does not identify which person is enrolled on the device. It also does not persist biometric data. A small native helper asks the operating system authenticator and returns only a status JSON object to the Host.

## Local development

```bash
npm install
npm run verify
```

The plugin is loaded by the DSH bundle manifest in `cordis.patch.yml`. `client.js` is only the settings and pending-request UI; verification does not depend on the browser address, Chrome, or WebAuthn. Build the helper with `npm run build:native` on the target platform. If no platform helper is installed, the tool returns `unavailable` and the skill must stop.

For local DSH testing:

```bash
npm install
npm run build:client
dsh plugin --profile web add link:/absolute/path/to/dsh-fingerprint-signature
```

Restart the DSH profile after linking. The “指纹签名” settings item is registered by the Client module; a window refresh alone does not reload it.
