import { randomUUID } from 'node:crypto'
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

export const Config = Schema.object({
  version: Schema.number().default(1),
  zhName: Schema.string().default('').description('Chinese name shown in the successful human-verification context.'),
  enName: Schema.string().default('').description('English name shown in the successful human-verification context.'),
  identityId: Schema.string().default('').description('Team-defined identity identifier; it is not matched to the local authenticator.'),
  bindingUuid: Schema.string().default('').description('System-generated binding UUID; read-only after first generation.'),
  signatureEnabled: Schema.boolean().default(true).description('Whether human verification is enabled.'),
  credentialId: Schema.string().default('').description('Browser credential identifier; public metadata only.'),
  rpId: Schema.string().default('').description('WebAuthn relying-party identifier for the local DSH page.'),
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
  signatureEnabled: true,
  credentialId: '',
  rpId: '',
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
    signatureEnabled: raw.signatureEnabled !== false,
    credentialId: normalizeString(raw.credentialId, 'credentialId', 1024),
    rpId: normalizeString(raw.rpId, 'rpId', 255),
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

const GUIDANCE = `## Human verification (dsh-fingerprint-signature)

When a skill explicitly requires human verification, call dsh_fingerprint_signature before the protected step. Continue only when the result has verified=true. The result includes the configured identity fields and custom variables. A false result means cancelled, failed, unavailable, expired, or disabled; do not continue.`

export function apply(ctx, entryConfig = {}) {
  let active = normalizeConfig(entryConfig)
  const pending = new Map()
  const grants = new Map()
  const clients = new Set()

  const readConfig = () => active
  const saveConfig = (next) => {
    const normalized = normalizeConfig(next)
    if (!normalized.bindingUuid) normalized.bindingUuid = active.bindingUuid || randomUUID()
    active = normalized
    return active
  }

  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(SETTINGS_NAMESPACE, Config, { base: active })
      active = normalizeConfig(scope.get())
      if (!active.bindingUuid) {
        active = saveConfig(active)
        scope.update({ bindingUuid: active.bindingUuid }).catch(() => {})
      }
      settingsCtx.effect?.(() => () => { active = normalizeConfig(entryConfig) })
    })
  }

  function notify(message) {
    for (const res of clients) {
      try { res.write(`data: ${JSON.stringify(message)}\n\n`) } catch { clients.delete(res) }
    }
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
            res.write(`data: ${JSON.stringify({ type: 'state', config: readConfig(), pending: [...pending.values()].map((p) => ({ requestId: p.requestId, reason: p.reason, expiresAt: p.expiresAt })) })}\n\n`)
            clients.add(res)
            req.on('close', () => clients.delete(res))
            return
          }
          if (req.method === 'GET' && path === '/state') {
            return json(res, 200, { ok: true, config: readConfig(), pending: [...pending.values()].map((p) => ({ requestId: p.requestId, reason: p.reason, expiresAt: p.expiresAt })) })
          }
          if (req.method === 'POST' && path === '/settings') {
            const payload = await body(req)
            const next = saveConfig({ ...readConfig(), ...payload })
            return json(res, 200, { ok: true, config: next })
          }
          if (req.method === 'POST' && path === '/binding') {
            const payload = await body(req)
            const next = saveConfig({ ...readConfig(), credentialId: payload.credentialId, rpId: payload.rpId })
            return json(res, 200, { ok: true, config: next })
          }
          if (req.method === 'POST' && path === '/register/options') {
            const rpId = String(payloadHost(req) || 'localhost').replace(/:\d+$/, '')
            return json(res, 200, { ok: true, options: { challenge: randomUUID(), rpId, userId: randomUUID(), userName: readConfig().identityId || 'dsh-user' } })
          }
          if (req.method === 'POST' && path === '/authorize/options') {
            const payload = await body(req)
            const request = pending.get(String(payload.requestId))
            if (!request) return json(res, 410, { ok: false, error: 'request expired or already settled' })
            return json(res, 200, { ok: true, options: { challenge: randomUUID(), rpId: readConfig().rpId || String(payloadHost(req) || 'localhost').replace(/:\d+$/, ''), credentialId: readConfig().credentialId } })
          }
          if (req.method === 'POST' && path === '/verify') {
            const payload = await body(req)
            if (payload.verified !== true) return json(res, 400, { ok: false, error: 'verified must be true' })
            const request = pending.get(String(payload.requestId))
            if (!request) return json(res, 410, { ok: false, error: 'request expired or already settled' })
            if (!readConfig().credentialId || String(payload.credentialId || '') !== readConfig().credentialId) {
              return json(res, 403, { ok: false, error: 'credential mismatch; bind this browser authenticator first' })
            }
            // MVP：浏览器已完成 userVerification，并回传已绑定 credentialId。
            // 服务端尚未保存公钥并校验 assertion 签名；生产强化阶段必须补上。
            settle(request.requestId, result('verified', request.requestId, configForContext(readConfig())))
            return json(res, 200, { ok: true })
          }
          if (req.method === 'POST' && path === '/cancel') {
            const payload = await body(req)
            if (!settle(String(payload.requestId), result('cancelled', String(payload.requestId)))) return json(res, 410, { ok: false, error: 'request expired or already settled' })
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
    description: 'Require a one-shot human verification through the DSH browser platform authenticator, then return configured identity and custom variables. Stop when verified is false.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Short explanation shown to the human.' } },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => textOut(value) },
    timeoutMs: REQUEST_TTL_MS + 5_000,
    async execute(args, exec) {
      const config = readConfig()
      const sessionId = sessionIdOf(exec)
      if (!config.signatureEnabled) return JSON.stringify(result('disabled'))
      if (pending.size > 0) return JSON.stringify(result('unavailable', null, { error: 'another verification request is already pending' }))
      const requestId = `req_${randomUUID()}`
      const reason = normalizeString(args?.reason || '请确认允许 AI 继续执行关键操作', 'reason', 500)
      const expiresAt = Date.now() + REQUEST_TTL_MS
      const promise = new Promise((resolve) => {
        const timer = setTimeout(() => settle(requestId, result('expired', requestId)), REQUEST_TTL_MS)
        pending.set(requestId, { requestId, sessionId, reason, expiresAt, resolve, timer })
        notify({ type: 'request-created', requestId, reason, expiresAt })
      })
      const value = await promise
      if (value.verified) grants.set(sessionId, { requestId, expiresAt: Date.now() + 30_000 })
      return JSON.stringify(value)
    },
  }))

  ctx.on?.('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow') return decision
    if (exec.name === 'dsh_fingerprint_signature') return decision
    const protectedTools = readConfig().protectedTools ?? []
    if (!Array.isArray(protectedTools) || !protectedTools.includes(exec.name)) return decision
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

function payloadHost(req) {
  return String(req?.headers?.host ?? '').split(',')[0].trim()
}
