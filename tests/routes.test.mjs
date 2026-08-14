import { describe, expect, it } from 'vitest'
// Tested code comes from the BUILD OUTPUT (lib/), per the project's test
// route (BLOCKED.md): pure ESM, no TS syntax, vite never feeds it to esbuild.
import {
  CATALOG_PATHS,
  isLoopbackAddress,
  isLoopbackHostname,
  isTrustedApiRequest,
  makeCatalogRoutes,
} from '../lib/index.js'

/** A fake loopback client request (the web GUI is served on 127.0.0.1). */
function loopbackRequest(overrides = {}) {
  return {
    method: 'GET',
    url: CATALOG_PATHS.list,
    headers: {
      host: '127.0.0.1:3080',
      'sec-fetch-site': 'same-origin',
      ...(overrides.headers ?? {}),
    },
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    ...overrides,
  }
}

/** A minimal response double recording status + body. */
function responseDouble() {
  const record = { status: 0, body: '' }
  return {
    record,
    writeHead(status, headers) {
      record.status = status
      return record
    },
    end(body) {
      record.body = body
    },
  }
}

describe('catalog list route (task 3 transport)', () => {
  it('exposes the list endpoint under /api/plugin-catalog/list', () => {
    expect(CATALOG_PATHS.list).toBe('/api/plugin-catalog/list')
    const routes = makeCatalogRoutes({ fence: () => true, list: () => ({ entries: [] }) })
    expect(routes).toHaveLength(1)
    expect(routes[0].kind).toBe('exact')
    expect(routes[0].path).toBe(CATALOG_PATHS.list)
  })

  it('serves the plugin list projection to a trusted loopback client', async () => {
    const payload = { entries: [{ entryId: 'a', moduleName: 'a', enabled: true, fiberPhase: 'active', meta: null }] }
    const routes = makeCatalogRoutes({ fence: () => true, list: () => payload })
    const res = responseDouble()
    await routes[0].handler(loopbackRequest(), res)
    expect(res.record.status).toBe(200)
    expect(JSON.parse(res.record.body)).toEqual(payload)
  })

  it('forbids requests the fence declines (403)', async () => {
    const routes = makeCatalogRoutes({ fence: () => false, list: () => ({ entries: [] }) })
    const res = responseDouble()
    await routes[0].handler(loopbackRequest(), res)
    expect(res.record.status).toBe(403)
    expect(JSON.parse(res.record.body).code).toBe('forbidden')
  })

  it('rejects non-GET methods (405)', async () => {
    const routes = makeCatalogRoutes({ fence: () => true, list: () => ({ entries: [] }) })
    const res = responseDouble()
    await routes[0].handler(loopbackRequest({ method: 'POST' }), res)
    expect(res.record.status).toBe(405)
  })

  it('degrades list failures to a 500 JSON body, never a throw', async () => {
    const routes = makeCatalogRoutes({
      fence: () => true,
      list: () => { throw new Error('boom') },
    })
    const res = responseDouble()
    await routes[0].handler(loopbackRequest(), res)
    expect(res.record.status).toBe(500)
    expect(JSON.parse(res.record.body).code).toBe('internal')
  })
})

describe('loopback trust fence (task 3 transport)', () => {
  it('accepts a loopback socket + loopback Host, same-origin', () => {
    expect(isTrustedApiRequest(loopbackRequest(), [])).toBe(true)
  })

  it('rejects a cross-site fetch', () => {
    expect(isTrustedApiRequest(loopbackRequest({ headers: { host: '127.0.0.1:3080', 'sec-fetch-site': 'cross-site' } }), [])).toBe(false)
  })

  it('rejects a non-loopback socket without a trusted host', () => {
    expect(isTrustedApiRequest(loopbackRequest({ socket: { remoteAddress: '10.0.0.5' } }), [])).toBe(false)
  })

  it('accepts a non-loopback socket when the Host is explicitly trusted', () => {
    expect(isTrustedApiRequest(loopbackRequest({ socket: { remoteAddress: '10.0.0.5' } }), ['127.0.0.1:3080'])).toBe(true)
  })

  it('rejects a cross-origin Origin header', () => {
    expect(isTrustedApiRequest(loopbackRequest({ headers: { host: '127.0.0.1:3080', origin: 'http://evil.example' } }), [])).toBe(false)
  })

  it('classifies loopback hostnames and addresses', () => {
    expect(isLoopbackHostname('127.0.0.1')).toBe(true)
    expect(isLoopbackHostname('127.5.5.5')).toBe(true)
    expect(isLoopbackHostname('localhost')).toBe(true)
    expect(isLoopbackHostname('[::1]')).toBe(true)
    expect(isLoopbackHostname('10.0.0.5')).toBe(false)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('192.168.1.2')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })
})
