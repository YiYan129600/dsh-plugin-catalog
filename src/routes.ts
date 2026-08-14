/**
 * dsh-plugin-catalog — host HTTP surface (plan §5.1 transport for the list
 * page; Task 4 adds summary / update routes next to this file).
 *
 * The client half is a browser classic script that cannot import the Typert
 * generated client contribution (no generator step in this repo), so the
 * plugin list crosses the wire the way @linxin666/dsh-remote-web-ui does —
 * a plain same-origin `fetch('/api/...')` against routes the host registers
 * on `ctx.webServer`. The route family is loopback-fenced so the endpoint
 * stays browser-only (the web GUI is served on 127.0.0.1).
 *
 * The fence helpers below are copied from @linxin666/dsh-remote-web-ui
 * (lib/index.js, src/gate.ts + src/routes.ts) — a whitelisted read-only
 * reference. The connection package's trust predicate is internal, so
 * third-party /api plugins ship their own copy.
 */

/** Structural view of node:http request/responses the routes consume. */
export interface ApiRequestLike {
  method?: string
  url?: string
  headers: {
    host?: string
    origin?: string
    'sec-fetch-site'?: string
    cookie?: string
  }
  socket?: { remoteAddress?: string }
}

/** Structural view of node:http ServerResponse the routes write to. */
export interface ApiResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

/** Route paths (exact matches under /api). */
export const CATALOG_PATHS = {
  list: '/api/plugin-catalog/list',
} as const

/** One JSON response. */
export function writeJson(res: ApiResponseLike, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'referrer-policy': 'no-referrer',
  })
  res.end(JSON.stringify(body))
}

/** Whether a normalized URL hostname names the local loopback authority. */
export function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Whether a socket remote address names the loopback range (127/8, ::1, IPv4-mapped). */
export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) return false
  const normalized = address.toLowerCase()
  if (normalized === '::1') return true
  if (normalized.startsWith('::ffff:')) return isIPv4Loopback(normalized.slice(7))
  return isIPv4Loopback(normalized)
}

/** IPv4 127/8 predicate (four decimal octets, first == 127). */
export function isIPv4Loopback(v4: string): boolean {
  const parts = v4.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** The effective Host hostname of a request. */
function hostnameOf(request: ApiRequestLike): string | undefined {
  const host = request.headers.host
  if (typeof host !== 'string') return undefined
  try {
    return new URL(`http://${host}`).hostname
  } catch {
    return undefined
  }
}

/** Whether a request comes from the desktop loopback client (loopback socket AND loopback Host). */
export function isLoopbackClient(request: ApiRequestLike): boolean {
  const hostname = hostnameOf(request)
  if (hostname === undefined || !isLoopbackHostname(hostname)) return false
  return isLoopbackAddress(request.socket?.remoteAddress)
}

/**
 * Browser-trust fence for the /api/plugin-catalog routes: the request Host
 * must be ours (loopback or an explicitly trusted host), the socket must be
 * loopback for the loopback-only caller, cross-site fetches are refused, and
 * any Origin header must be same-origin.
 */
export function isTrustedApiRequest(request: ApiRequestLike, trustedHosts: readonly string[]): boolean {
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname
  if (!(isLoopbackClient(request) || trustedHosts.some((entry) => {
    const entryUrl = new URL(`http://${entry}`)
    return entryUrl.port === '' ? entryUrl.hostname === hostname : entryUrl.host === hostUrl.host
  }))) return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

/** Route family dependencies (fence + the data seam). */
export interface CatalogRouteDeps {
  /** Loopback trust fence; the handler 403s when it declines. */
  fence(request: ApiRequestLike): boolean
  /** Produce the plugin list projection (the host service's `list()`). */
  list(): { entries: unknown[] } | Promise<{ entries: unknown[] }>
}

/** The exact routes to register on `ctx.webServer`. */
export function makeCatalogRoutes(deps: CatalogRouteDeps): Array<{
  kind: 'exact'
  path: string
  handler: (request: ApiRequestLike, response: ApiResponseLike) => void | Promise<void>
}> {
  const handleList = async (request: ApiRequestLike, response: ApiResponseLike): Promise<void> => {
    if (request.method !== 'GET') {
      response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
      response.end('method not allowed')
      return
    }
    if (!deps.fence(request)) {
      writeJson(response, 403, { ok: false, code: 'forbidden' })
      return
    }
    try {
      writeJson(response, 200, await deps.list())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      writeJson(response, 500, { ok: false, code: 'internal', message })
    }
  }
  return [{ kind: 'exact', path: CATALOG_PATHS.list, handler: handleList }]
}
