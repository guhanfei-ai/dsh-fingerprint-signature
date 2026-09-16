import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import Schema from '@deepseek-ai/schemastery'

export const name = 'fingerprint-signature'
export const inject = ['tools', 'systemPrompt', 'settings', 'webServer', 'sessions']
export const SETTINGS_NAMESPACE = 'fingerprint-signature'

const MAX_NAME_LENGTH = 120
const MAX_ID_LENGTH = 160
const MAX_VARIABLES = 64
const MAX_KEY_LENGTH = 80
const MAX_VALUE_LENGTH = 2000
const REQUEST_TTL_MS = 120_000
const HELPER_OUTPUT_LIMIT = 16 * 1024
// 64 个变量 × 2000 字符的合法配置约 130KB，配置路由的 body 上限必须容纳整个 schema 合法域。
const CONFIG_BODY_LIMIT = 256 * 1024
const PACKAGE_ROOT = dirname(fileURLToPath(import.meta.url))

export const Config = Schema.object({
  version: Schema.number().default(1),
  zhName: Schema.string().default('').description('Chinese name shown in the successful human-verification context.'),
  enName: Schema.string().default('').description('English name shown in the successful human-verification context.'),
  identityId: Schema.string().default('').description('Team-defined identity identifier; it is not matched to the local authenticator.'),
  bindingUuid: Schema.string().default('').description('System-generated binding UUID; generated at the first verified activation and read-only afterwards.'),
  signatureEnabled: Schema.boolean().default(false).description('Whether human verification is enabled; activation requires one successful platform verification.'),
  protectedTools: Schema.array(Schema.string()).default([]).description('Optional tool names that require a one-shot human verification.'),
  customVariables: Schema.array(Schema.object({
    id: Schema.string().default(''),
    key: Schema.string().default(''),
    value: Schema.string().default(''),
  })).default([]),
})

const EMPTY_CONFIG = {
  version: 1,
  zhName: '',
  enName: '',
  identityId: '',
  bindingUuid: '',
  signatureEnabled: false,
  protectedTools: [],
  customVariables: [],
}

function textOut(value) {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function normalizeString(value, name, max) {
  const result = String(value ?? '').trim()
  if (result.length > max) throw new Error(`${name} must not exceed ${max} characters`)
  return result
}

export function normalizeConfig(input = {}) {
  const raw = { ...EMPTY_CONFIG, ...(input && typeof input === 'object' ? input : {}) }
  const customVariables = Array.isArray(raw.customVariables) ? raw.customVariables : []
  if (customVariables.length > MAX_VARIABLES) throw new Error(`customVariables must not exceed ${MAX_VARIABLES} entries`)
  const keys = new Set()
  const variables = customVariables.map((item) => {
    const key = normalizeString(item?.key, 'custom variable key', MAX_KEY_LENGTH)
    const value = normalizeString(item?.value, `custom variable ${key || '(empty)'}`, MAX_VALUE_LENGTH)
    if (!key) throw new Error('custom variable key must not be empty')
    if (keys.has(key)) throw new Error(`duplicate custom variable key ${JSON.stringify(key)}`)
    keys.add(key)
    return { id: normalizeString(item?.id, 'custom variable id', 80) || `var_${randomUUID()}`, key, value }
  })
  return {
    version: 1,
    zhName: normalizeString(raw.zhName, 'zhName', MAX_NAME_LENGTH),
    enName: normalizeString(raw.enName, 'enName', MAX_NAME_LENGTH),
    identityId: normalizeString(raw.identityId, 'identityId', MAX_ID_LENGTH),
    bindingUuid: normalizeString(raw.bindingUuid, 'bindingUuid', 64),
    signatureEnabled: raw.signatureEnabled === true,
    protectedTools: Array.isArray(raw.protectedTools) ? raw.protectedTools.map((name) => normalizeString(name, 'protected tool name', 120)).filter(Boolean) : [],
    customVariables: variables,
  }
}

function configForContext(config) {
  const customVariables = Object.fromEntries(config.customVariables.map(({ key, value }) => [key, value]))
  return {
    zh_name: config.zhName,
    en_name: config.enName,
    identity_id: config.identityId,
    binding_uuid: config.bindingUuid,
    custom_variables: customVariables,
  }
}

function result(status, requestId, extra = {}) {
  return {
    verified: status === 'verified',
    status,
    ...(requestId ? { request_id: requestId } : {}),
    ...extra,
  }
}

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

async function body(req, maxBytes = 64 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function trustedRequest(req) {
  const host = String(req?.headers?.host ?? '')
  if (!host) return false
  if (String(req?.headers?.['sec-fetch-site'] ?? '') === 'cross-site') return false
  const origin = String(req?.headers?.origin ?? '')
  if (!origin) return /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
  try { return new URL(origin).host === host } catch { return false }
}

function sessionIdOf(exec) {
  return exec?.agent?.id ?? exec?.agent?.session?.id ?? 'local'
}

function defineTool(spec) { return spec }

function helperCandidates() {
  if (process.env.DSH_FINGERPRINT_HELPER) return [process.env.DSH_FINGERPRINT_HELPER]
  if (process.platform === 'darwin') return [resolve(PACKAGE_ROOT, 'native/bin/dsh-fingerprint-auth')]
  if (process.platform === 'win32') return [resolve(PACKAGE_ROOT, 'native/bin/dsh-fingerprint-auth.exe')]
  return []
}

export function resolveFingerprintHelper() {
  return helperCandidates().find((candidate) => existsSync(candidate))
}

function nativeStatus(value) {
  const status = String(value || '').toLowerCase()
  return ['verified', 'cancelled', 'failed', 'unavailable', 'timeout'].includes(status) ? status : 'failed'
}

/** Run a platform helper without a shell; biometric data never crosses this boundary. */
export function runFingerprintHelper(reason, {
  spawnImpl = spawn,
  helperPath = resolveFingerprintHelper(),
  timeoutMs = REQUEST_TTL_MS,
  signal,
} = {}) {
  return new Promise((resolveResult) => {
    if (!helperPath) {
      resolveResult({ status: 'unavailable', error: 'platform fingerprint helper is not installed' })
      return
    }
    let output = ''
    let settled = false
    let timer
    let child
    const onAbort = () => {
      if (settled) return
      finish({ status: 'cancelled' })
      child?.kill()
    }
    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolveResult(value)
    }
    if (signal?.aborted) {
      finish({ status: 'cancelled' })
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      child = spawnImpl(helperPath, ['--reason', reason], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      finish({ status: 'unavailable', error: error instanceof Error ? error.message : String(error) })
      return
    }
    const append = (chunk) => {
      output += String(chunk)
      if (output.length > HELPER_OUTPUT_LIMIT) {
      finish({ status: 'failed', error: 'platform helper output too large' })
      child.kill()
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', () => {})
    child.once('error', (error) => finish({ status: 'unavailable', error: error.message }))
    child.once('close', (code, signal) => {
      if (settled) return
      let payload
      try { payload = JSON.parse(output.trim()) } catch { payload = null }
      if (!payload || typeof payload !== 'object') {
        finish({ status: code === 2 ? 'unavailable' : signal ? 'cancelled' : 'failed', error: 'invalid platform helper response' })
        return
      }
      const status = nativeStatus(payload.status)
      if (status === 'verified' && (code !== 0 || signal)) {
        finish({ status: 'failed', error: 'platform helper exited unsuccessfully after reporting verified' })
        return
      }
      finish({ status, ...(payload.error ? { error: String(payload.error) } : {}) })
    })
    timer = setTimeout(() => {
      finish({ status: 'timeout', error: 'platform verification timed out' })
      child.kill()
    }, timeoutMs)
  })
}

const VERIFICATION_FAILED_MESSAGE = '真人验证未通过，请终止相关操作'
const FEATURE_DISABLED_MESSAGE = '指纹功能未开启，工具调用无效，无法读取签名变量'

const GUIDANCE = `## Human verification (dsh-fingerprint-signature)

When a skill explicitly requires human verification, call dsh_fingerprint_signature before the protected step. Continue only when the result has verified=true. The result includes the configured identity fields and custom variables. Any other outcome (cancelled, failed, unavailable, expired, or disabled) means the human verification did not pass: read the result's message field and stop the protected work immediately; do not retry on your own. When disabled, the plugin is still loaded but the fingerprint feature is turned off; tell the human to activate it in the settings panel before continuing.`

export function apply(ctx, entryConfig = {}, deps = {}) {
  let active = normalizeConfig(entryConfig)
  let settingsScope = null
  const pending = new Map()
  const grants = new Map()
  const clients = new Set()

  const readConfig = () => active
  const pendingList = () => [...pending.values()].map((p) => ({ requestId: p.requestId, reason: p.reason, expiresAt: p.expiresAt }))

  function notify(message) {
    for (const res of clients) {
      try { res.write(`data: ${JSON.stringify(message)}\n\n`) } catch { clients.delete(res) }
    }
  }

  const saveConfig = (next, { generateBinding = false } = {}) => {
    const normalized = normalizeConfig(next)
    if (!normalized.bindingUuid) normalized.bindingUuid = active.bindingUuid || (generateBinding ? randomUUID() : '')
    active = normalized
    try { settingsScope?.update(active)?.catch(() => {}) } catch { /* settings layer unavailable; config stays in memory */ }
    notify({ type: 'state', config: readConfig(), pending: pendingList() })
    return active
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (settingsCtx) => {
      settingsScope = settingsCtx.settings.register(SETTINGS_NAMESPACE, Config, { base: active })
      active = normalizeConfig(settingsScope.get())
      settingsCtx.effect?.(() => () => {
        active = normalizeConfig(entryConfig)
        settingsScope = null
      })
    })
  }

  function settle(requestId, value) {
    const request = pending.get(requestId)
    if (!request) return false
    pending.delete(requestId)
    clearTimeout(request.timer)
    request.resolve(value)
    notify({ type: 'request-settled', requestId })
    return true
  }

  function startVerification(reason, sessionId = 'local') {
    const requestId = `req_${randomUUID()}`
    const expiresAt = Date.now() + REQUEST_TTL_MS
    return new Promise((resolve) => {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        controller.abort()
        settle(requestId, result('expired', requestId))
      }, REQUEST_TTL_MS)
      pending.set(requestId, { requestId, sessionId, reason, expiresAt, resolve, timer, controller })
      notify({ type: 'request-created', requestId, reason, expiresAt })
      runFingerprintHelper(reason, { signal: controller.signal, spawnImpl: deps.spawnImpl, helperPath: deps.helperPath }).then((verification) => {
        if (!pending.has(requestId)) return
        if (verification.status === 'verified') {
          settle(requestId, result('verified', requestId, { ...configForContext(readConfig()), method: 'platform' }))
        } else {
          settle(requestId, result(verification.status, requestId, verification.error ? { error: verification.error } : {}))
        }
      })
    })
  }

  if (ctx.webServer?.register) {
    const registerRoutes = () => ctx.webServer.register({
      kind: 'prefix',
      path: '/fingerprint-signature/api',
      handler: async (req, res) => {
        if (!trustedRequest(req)) return json(res, 403, { ok: false, error: 'forbidden' })
        try {
          const path = new URL(req.url ?? '/', 'http://dsh.internal').pathname.slice('/fingerprint-signature/api'.length)
          if (req.method === 'GET' && path === '/events') {
            res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive' })
            res.write(`data: ${JSON.stringify({ type: 'state', config: readConfig(), pending: pendingList() })}\n\n`)
            clients.add(res)
            req.on('close', () => clients.delete(res))
            return
          }
          if (req.method === 'GET' && path === '/state') {
            return json(res, 200, { ok: true, config: readConfig(), pending: pendingList() })
          }
          if (req.method === 'POST' && path === '/settings') {
            if (!readConfig().signatureEnabled) {
              return json(res, 200, { ok: true, status: 'disabled', config: readConfig() })
            }
            const payload = await body(req, CONFIG_BODY_LIMIT)
            delete payload.signatureEnabled
            delete payload.bindingUuid
            const draft = normalizeConfig({ ...readConfig(), ...payload })
            // 单飞检查必须紧贴 startVerification（中间不能有 await），否则并发请求会各弹一个系统验证窗口。
            if (pending.size > 0) return json(res, 409, { ok: false, error: 'another verification request is already pending' })
            const verification = await startVerification('保存签名变量：验证通过后才会写入', 'settings-panel')
            if (!verification.verified) {
              return json(res, 200, { ok: true, status: verification.status, ...(verification.error ? { error: verification.error } : {}), config: readConfig() })
            }
            const next = saveConfig(draft)
            return json(res, 200, { ok: true, status: 'verified', config: next })
          }
          if (req.method === 'POST' && path === '/activate') {
            const payload = await body(req, CONFIG_BODY_LIMIT)
            delete payload.bindingUuid
            const draft = normalizeConfig({ ...readConfig(), ...payload, signatureEnabled: true })
            // 单飞检查必须紧贴 startVerification（中间不能有 await），否则并发请求会各弹一个系统验证窗口。
            if (pending.size > 0) return json(res, 409, { ok: false, error: 'another verification request is already pending' })
            const verification = await startVerification('激活指纹签名：验证通过后保存签名变量', 'settings-panel')
            if (!verification.verified) {
              return json(res, 200, { ok: true, status: verification.status, ...(verification.error ? { error: verification.error } : {}), config: readConfig() })
            }
            const next = saveConfig(draft, { generateBinding: true })
            return json(res, 200, { ok: true, status: 'verified', config: next })
          }
          if (req.method === 'POST' && path === '/deactivate') {
            const current = readConfig()
            if (!current.signatureEnabled) return json(res, 200, { ok: true, status: 'noop', config: current })
            if (pending.size > 0) return json(res, 409, { ok: false, error: 'another verification request is already pending' })
            const verification = await startVerification('禁用指纹签名：验证通过后关闭签名功能', 'settings-panel')
            if (!verification.verified) {
              return json(res, 200, { ok: true, status: verification.status, ...(verification.error ? { error: verification.error } : {}), config: readConfig() })
            }
            grants.clear()
            const next = saveConfig({ ...current, signatureEnabled: false })
            return json(res, 200, { ok: true, status: 'verified', config: next })
          }
          if (req.method === 'POST' && ['/binding', '/register/options', '/authorize/options', '/verify'].includes(path)) {
            return json(res, 410, { ok: false, error: 'browser WebAuthn flow has been removed; verification is provided by the platform helper' })
          }
          if (req.method === 'POST' && path === '/cancel') {
            const payload = await body(req)
            const requestId = String(payload.requestId)
            const request = pending.get(requestId)
            if (!request) return json(res, 410, { ok: false, error: 'request expired or already settled' })
            request.controller?.abort()
            settle(requestId, result('cancelled', requestId))
            return json(res, 200, { ok: true })
          }
          return json(res, 404, { ok: false, error: 'not found' })
        } catch (error) {
          return json(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    if (typeof ctx.effect === 'function') ctx.effect(registerRoutes)
    else registerRoutes()
  }

  ctx.systemPrompt?.section({ name: 'tool:fingerprint-signature', order: 108, text: GUIDANCE })

  ctx.tools.register(defineTool({
    name: 'dsh_fingerprint_signature',
    description: 'Require a one-shot human verification through the operating system authenticator, then return configured identity and custom variables. Stop when verified is false.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Short explanation shown to the human.' } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: REQUEST_TTL_MS + 5_000,
    async execute(args, exec) {
      const config = readConfig()
      const sessionId = sessionIdOf(exec)
      if (!config.signatureEnabled) return JSON.stringify(result('disabled', null, { message: FEATURE_DISABLED_MESSAGE }))
      if (pending.size > 0) return JSON.stringify(result('unavailable', null, { error: 'another verification request is already pending', message: VERIFICATION_FAILED_MESSAGE }))
      const reason = normalizeString(args?.reason || '请确认允许 AI 继续执行关键操作', 'reason', 500)
      const value = await startVerification(reason, sessionId)
      if (!value.verified) value.message = VERIFICATION_FAILED_MESSAGE
      if (value.verified) grants.set(sessionId, { requestId: value.request_id, expiresAt: Date.now() + 30_000 })
      return JSON.stringify(value)
    },
  }))

  ctx.on?.('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name === 'dsh_fingerprint_signature') return decision
    const protectedTools = readConfig().protectedTools ?? []
    if (!Array.isArray(protectedTools) || !protectedTools.includes(exec.name)) return decision
    if (!readConfig().signatureEnabled) return { kind: 'deny', reason: '指纹功能未开启，受保护工具不允许执行' }
    const grant = grants.get(sessionIdOf(exec))
    if (!grant || grant.expiresAt <= Date.now()) {
      grants.delete(sessionIdOf(exec))
      return { kind: 'deny', reason: 'human verification required: call dsh_fingerprint_signature first' }
    }
    grants.delete(sessionIdOf(exec))
    return decision
  })

  return { getConfig: readConfig, pending, grants }
}
