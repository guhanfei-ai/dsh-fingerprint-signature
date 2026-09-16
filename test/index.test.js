import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { normalizeConfig, runFingerprintHelper, apply } from '../index.js'

function fakeSpawn(response, code = 0) {
  return () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => { child.emit('close', null, 'SIGTERM') }
    queueMicrotask(() => {
      child.stdout.emit('data', JSON.stringify(response))
      child.emit('close', code, null)
    })
    return child
  }
}

function fakeWebServer() {
  const routes = []
  const server = {
    register(route) { routes.push(route) },
  }
  return { server, route: () => routes[0], routes }
}

async function callRoute(route, method, path, payload, headers = {}) {
  const chunks = payload === undefined ? [] : [Buffer.from(JSON.stringify(payload))]
  const req = new EventEmitter()
  req.method = method
  req.url = path
  req.headers = { host: '127.0.0.1:5600', ...headers }
  req[Symbol.asyncIterator] = async function* () { yield* chunks }
  const res = {
    headers: {},
    body: '',
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers) },
    write(text) { this.body += text },
    end(text) { if (text) this.body += text; this.finished = true },
  }
  await route.handler(req, res)
  try { return { status: res.status, body: JSON.parse(res.body) } } catch { return { status: res.status, body: res.body } }
}

const verifiedSpawn = () => fakeSpawn({ status: 'verified' })
const cancelledSpawn = () => fakeSpawn({ status: 'cancelled' }, 1)

// 慢速 helper：用宏任务延迟结算，模拟真实 Touch ID 弹窗期间的时间窗口。
function slowVerifiedSpawn(delayMs = 20) {
  let spawns = 0
  return {
    impl: () => {
      spawns += 1
      const child = new EventEmitter()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      child.kill = () => { child.emit('close', null, 'SIGTERM') }
      setTimeout(() => {
        child.stdout.emit('data', JSON.stringify({ status: 'verified' }))
        child.emit('close', 0, null)
      }, delayMs)
      return child
    },
    count: () => spawns,
  }
}

function makeCtx() {
  const web = fakeWebServer()
  const registered = []
  const handlers = {}
  const ctx = {
    webServer: web.server,
    tools: { register: (spec) => registered.push(spec) },
    systemPrompt: { section: () => {} },
    on: (event, handler) => { handlers[event] = handler },
  }
  return { ctx, route: web.route, registered, handlers }
}

// 路由级测试统一注入固定的 helperPath，避免依赖本机是否真的安装了原生二进制。
const fakeHelperDeps = (spawnImpl) => ({ spawnImpl, helperPath: '/tmp/dsh-fake-helper' })

test('platform helper returns verified status without exposing browser credentials', async () => {
  const result = await runFingerprintHelper('继续执行', { helperPath: '/tmp/helper', spawnImpl: fakeSpawn({ status: 'verified' }) })
  assert.deepEqual(result, { status: 'verified' })
})

test('platform helper maps cancellation and unavailable helper', async () => {
  const cancelled = await runFingerprintHelper('取消', { helperPath: '/tmp/helper', spawnImpl: fakeSpawn({ status: 'cancelled' }, 1) })
  assert.equal(cancelled.status, 'cancelled')
  const unavailable = await runFingerprintHelper('不可用', { helperPath: '' })
  assert.equal(unavailable.status, 'unavailable')
})

test('platform helper rejects verified output from a failed process', async () => {
  const result = await runFingerprintHelper('异常退出', { helperPath: '/tmp/helper', spawnImpl: fakeSpawn({ status: 'verified' }, 1) })
  assert.equal(result.status, 'failed')
})

test('configuration defaults to fail-closed activation state', () => {
  const config = normalizeConfig({})
  assert.equal(config.signatureEnabled, false)
  assert.equal(config.bindingUuid, '')
})

test('activation requires platform verification before saving signature variables', async () => {
  const { ctx, route } = makeCtx()
  const plugin = apply(ctx, {}, fakeHelperDeps(cancelledSpawn()))
  const response = await callRoute(route(), 'POST', '/fingerprint-signature/api/activate', { zhName: ' 张三 ', customVariables: [{ key: 'env', value: 'prod' }] })
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'cancelled')
  assert.equal(response.body.config.signatureEnabled, false)
  assert.equal(plugin.getConfig().zhName, '')
  assert.deepEqual(plugin.getConfig().customVariables, [])
})

test('verified activation saves variables and generates the binding uuid once', async () => {
  const { ctx, route } = makeCtx()
  const plugin = apply(ctx, {}, fakeHelperDeps(verifiedSpawn()))
  const response = await callRoute(route(), 'POST', '/fingerprint-signature/api/activate', { zhName: ' 张三 ', bindingUuid: 'attacker-chosen-uuid', customVariables: [{ key: 'env', value: 'prod' }] })
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'verified')
  assert.equal(response.body.config.signatureEnabled, true)
  assert.equal(response.body.config.zhName, '张三')
  assert.equal(response.body.config.customVariables[0].key, 'env')
  assert.match(response.body.config.bindingUuid, /^[0-9a-f-]{36}$/)
  assert.notEqual(response.body.config.bindingUuid, 'attacker-chosen-uuid')
  const saved = plugin.getConfig()
  assert.equal(saved.signatureEnabled, true)
  assert.equal(saved.bindingUuid, response.body.config.bindingUuid)

  const again = await callRoute(route(), 'POST', '/fingerprint-signature/api/activate', { zhName: '李四', bindingUuid: 'another-attacker-uuid' })
  assert.equal(again.body.status, 'verified')
  assert.equal(again.body.config.zhName, '李四')
  assert.equal(again.body.config.bindingUuid, saved.bindingUuid)
})

test('deactivation requires verification and keeps signature variables', async () => {
  const first = makeCtx()
  const plugin = apply(first.ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1' }, fakeHelperDeps(cancelledSpawn()))
  const cancelled = await callRoute(first.route(), 'POST', '/fingerprint-signature/api/deactivate')
  assert.equal(cancelled.body.status, 'cancelled')
  assert.equal(cancelled.body.config.signatureEnabled, true)
  assert.equal(plugin.getConfig().zhName, '张三')

  const second = makeCtx()
  const plugin2 = apply(second.ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1' }, fakeHelperDeps(verifiedSpawn()))
  const off = await callRoute(second.route(), 'POST', '/fingerprint-signature/api/deactivate')
  assert.equal(off.body.status, 'verified')
  assert.equal(off.body.config.signatureEnabled, false)
  assert.equal(off.body.config.zhName, '张三')
  assert.equal(plugin2.getConfig().bindingUuid, 'u-1')
})

test('settings save requires fingerprint verification and cannot touch state or uuid', async () => {
  const { ctx, route } = makeCtx()
  const plugin = apply(ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1' }, fakeHelperDeps(cancelledSpawn()))
  const denied = await callRoute(route(), 'POST', '/fingerprint-signature/api/settings', { zhName: '张三丰', signatureEnabled: false, bindingUuid: 'attacker-chosen-uuid' })
  assert.equal(denied.status, 200)
  assert.equal(denied.body.status, 'cancelled')
  assert.equal(denied.body.config.zhName, '张三')
  assert.equal(plugin.getConfig().zhName, '张三')

  const allowed = makeCtx()
  const plugin2 = apply(allowed.ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1' }, fakeHelperDeps(verifiedSpawn()))
  const saved = await callRoute(allowed.route(), 'POST', '/fingerprint-signature/api/settings', { zhName: '张三丰', signatureEnabled: false, bindingUuid: 'attacker-chosen-uuid' })
  assert.equal(saved.body.status, 'verified')
  assert.equal(saved.body.config.zhName, '张三丰')
  assert.equal(saved.body.config.signatureEnabled, true)
  assert.equal(saved.body.config.bindingUuid, 'u-1')
  assert.equal(plugin2.getConfig().zhName, '张三丰')
})

test('settings save is blocked while the fingerprint feature is disabled', async () => {
  const { ctx, route } = makeCtx()
  const plugin = apply(ctx, { zhName: '张三', signatureEnabled: false, bindingUuid: 'u-1' }, fakeHelperDeps(() => { throw new Error('helper must not be spawned') }))
  const response = await callRoute(route(), 'POST', '/fingerprint-signature/api/settings', { zhName: '李四' })
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'disabled')
  assert.equal(response.body.config.zhName, '张三')
  assert.equal(plugin.getConfig().zhName, '张三')
})

test('concurrent settings saves only start one platform verification', async () => {
  const { ctx, route } = makeCtx()
  const slow = slowVerifiedSpawn()
  apply(ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1' }, { spawnImpl: slow.impl, helperPath: '/tmp/dsh-fake-helper' })
  const [first, second] = await Promise.all([
    callRoute(route(), 'POST', '/fingerprint-signature/api/settings', { zhName: '张三丰' }),
    callRoute(route(), 'POST', '/fingerprint-signature/api/settings', { zhName: '李四' }),
  ])
  assert.equal(slow.count(), 1)
  const outcomes = [first, second].sort((a, b) => (a.status === 409 ? 1 : 0) - (b.status === 409 ? 1 : 0))
  assert.equal(outcomes[0].status, 200)
  assert.equal(outcomes[0].body.status, 'verified')
  assert.equal(outcomes[1].status, 409)
})

test('concurrent activation attempts only start one platform verification', async () => {
  const { ctx, route } = makeCtx()
  const slow = slowVerifiedSpawn()
  apply(ctx, {}, { spawnImpl: slow.impl, helperPath: '/tmp/dsh-fake-helper' })
  const [first, second] = await Promise.all([
    callRoute(route(), 'POST', '/fingerprint-signature/api/activate', { zhName: '张三' }),
    callRoute(route(), 'POST', '/fingerprint-signature/api/activate', { zhName: '李四' }),
  ])
  assert.equal(slow.count(), 1)
  const outcomes = [first, second].sort((a, b) => (a.status === 409 ? 1 : 0) - (b.status === 409 ? 1 : 0))
  assert.equal(outcomes[0].status, 200)
  assert.equal(outcomes[0].body.status, 'verified')
  assert.equal(outcomes[1].status, 409)
  assert.equal(outcomes[1].body.ok, false)
})

test('deactivating the fingerprint feature voids outstanding one-shot grants', async () => {
  const { ctx, route, registered, handlers } = makeCtx()
  const plugin = apply(ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1', protectedTools: ['dangerous_tool'] }, fakeHelperDeps(verifiedSpawn()))
  const tool = registered.find((spec) => spec.name === 'dsh_fingerprint_signature')
  const guard = handlers['tools/pre-execute']
  const allow = () => Promise.resolve({ kind: 'allow' })

  await tool.execute({ reason: '继续' }, { agent: { id: 's1' } })
  const allowed = await guard({ name: 'dangerous_tool', agent: { id: 's1' } }, allow)
  assert.equal(allowed.kind, 'allow')

  await tool.execute({ reason: '继续' }, { agent: { id: 's2' } })
  assert.ok(plugin.grants.get('s2'))

  const off = await callRoute(route(), 'POST', '/fingerprint-signature/api/deactivate')
  assert.equal(off.body.status, 'verified')
  assert.equal(plugin.grants.size, 0)

  const denied = await guard({ name: 'dangerous_tool', agent: { id: 's2' } }, allow)
  assert.equal(denied.kind, 'deny')
})

test('a maximum-size legitimate configuration survives the route body limit', async () => {
  const { ctx, route } = makeCtx()
  const plugin = apply(ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1' }, fakeHelperDeps(verifiedSpawn()))
  const customVariables = Array.from({ length: 40 }, (_, i) => ({ id: `var_bulk_${i}`, key: `key_${i}`, value: 'x'.repeat(2000) }))
  const response = await callRoute(route(), 'POST', '/fingerprint-signature/api/settings', { customVariables })
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'verified')
  assert.equal(plugin.getConfig().customVariables.length, 40)
  assert.equal(plugin.getConfig().customVariables[39].value.length, 2000)
})

test('signature tool fails closed when not activated and injects variables after activation', async () => {
  const { ctx, route, registered } = makeCtx()
  const plugin = apply(ctx, {}, fakeHelperDeps(verifiedSpawn()))
  const tool = registered.find((spec) => spec.name === 'dsh_fingerprint_signature')

  const closed = JSON.parse(await tool.execute({ reason: '测试' }, { agent: { id: 's1' } }))
  assert.equal(closed.verified, false)
  assert.equal(closed.status, 'disabled')
  assert.equal(closed.message, '指纹功能未开启，工具调用无效，无法读取签名变量')
  assert.equal(closed.zh_name, undefined)

  await callRoute(route(), 'POST', '/fingerprint-signature/api/activate', { zhName: '张三', customVariables: [{ id: 'var_1', key: 'env', value: 'prod' }] })
  const granted = JSON.parse(await tool.execute({ reason: '继续' }, { agent: { id: 's1' } }))
  assert.equal(granted.verified, true)
  assert.equal(granted.zh_name, '张三')
  assert.match(granted.binding_uuid, /^[0-9a-f-]{36}$/)
  assert.deepEqual(granted.custom_variables, { env: 'prod' })
  assert.equal(plugin.grants.get('s1').requestId, granted.request_id)

  const failed = makeCtx()
  apply(failed.ctx, { zhName: '张三', signatureEnabled: true, bindingUuid: 'u-1' }, fakeHelperDeps(cancelledSpawn()))
  const failedTool = failed.registered.find((spec) => spec.name === 'dsh_fingerprint_signature')
  const rejected = JSON.parse(await failedTool.execute({ reason: '继续' }, { agent: { id: 's1' } }))
  assert.equal(rejected.verified, false)
  assert.equal(rejected.status, 'cancelled')
  assert.equal(rejected.message, '真人验证未通过，请终止相关操作')
})
