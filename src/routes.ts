/**
 * dsh-plugin-catalog — host HTTP surface (plan §5.1 transport for the list
 * page; Task 4 adds the summary / update routes below).
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
  /** Parsed JSON body (the host webServer provides it for POST routes). */
  body?: unknown
  /** Raw body string (fallback when the host passes an unparsed body). */
  rawBody?: string
}

/** Structural view of node:http ServerResponse the routes write to. */
export interface ApiResponseLike {
  writeHead(status: number, headers?: Record<string, string>): unknown
  end(body?: string): unknown
}

/** Route paths (exact matches under /api). */
export const CATALOG_PATHS = {
  list: '/api/plugin-catalog/list',
  summary: '/api/plugin-catalog/summary',
  summaryEstimate: '/api/plugin-catalog/summary/estimate',
  updates: '/api/plugin-catalog/updates',
  update: '/api/plugin-catalog/update',
} as const

/** Route family dependencies (fence + the data seams). */
export interface CatalogRouteDeps {
  /** Loopback trust fence; the handler 403s when it declines. */
  fence(request: ApiRequestLike): boolean
  /** Produce the plugin list projection (the host service's `list()`). */
  list(): { entries: unknown[] } | Promise<{ entries: unknown[] }>
  /** AI summary generation (plan §5.5) — optional; 501 when absent. */
  summarize?(deps: { packageName: string; repository: string | null; version: string | null }): Promise<unknown>
  /** Pre-trigger cost estimate (plan §5.5) — optional; 501 when absent. */
  estimate?(deps: { repository: string | null }): Promise<unknown>
  /** Update check (plan §5.6), `force` bypasses the 24h cache — optional. */
  checkUpdates?(deps: { force: boolean }): Promise<unknown>
  /** UpdateRunner command generation (never executes) — optional. */
  updateCommand?(deps: { packages: string[] }): unknown
}

/** Decode the request body: parsed object first, raw JSON string fallback. */
function bodyOf(request: ApiRequestLike): Record<string, unknown> {
  if (typeof request.body === 'object' && request.body !== null) return request.body as Record<string, unknown>
  if (typeof request.rawBody === 'string' && request.rawBody !== '') {
    try {
      const parsed = JSON.parse(request.rawBody)
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
    } catch {
      return {}
    }
  }
  return {}
}

/** Read the `force=1` query flag off the request URL. */
function forceFlagOf(request: ApiRequestLike): boolean {
  try {
    const url = new URL(request.url ?? '', 'http://x')
    return url.searchParams.get('force') === '1'
  } catch {
    return false
  }
}

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

/** The exact routes to register on `ctx.webServer`. */
export function makeCatalogRoutes(deps: CatalogRouteDeps): Array<{
  kind: 'exact'
  path: string
  handler: (request: ApiRequestLike, response: ApiResponseLike) => void | Promise<void>
}> {
  /** Shared GET plumbing: method check → fence → handler (request visible to `run`). */
  const getRoute = (path: string, run: (request: ApiRequestLike) => unknown | Promise<unknown>): {
    kind: 'exact'
    path: string
    handler: (request: ApiRequestLike, response: ApiResponseLike) => Promise<void>
  } => ({
    kind: 'exact',
    path,
    handler: async (request, response) => {
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
        writeJson(response, 200, await run(request))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, { ok: false, code: 'internal', message })
      }
    },
  })

  /** Shared POST plumbing: method check → fence → body parse → handler. */
  const postRoute = (path: string, run: (body: Record<string, unknown>) => unknown | Promise<unknown>): {
    kind: 'exact'
    path: string
    handler: (request: ApiRequestLike, response: ApiResponseLike) => Promise<void>
  } => ({
    kind: 'exact',
    path,
    handler: async (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        response.end('method not allowed')
        return
      }
      if (!deps.fence(request)) {
        writeJson(response, 403, { ok: false, code: 'forbidden' })
        return
      }
      try {
        writeJson(response, 200, await run(bodyOf(request)))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        writeJson(response, 500, { ok: false, code: 'internal', message })
      }
    },
  })

  /** A missing data seam degrades to 501 (the client feature-detects and hides the UI). */
  const notImplemented = (): { ok: false; code: 'not-implemented' } => ({ ok: false, code: 'not-implemented' })

  return [
    getRoute(CATALOG_PATHS.list, () => deps.list()),
    getRoute(CATALOG_PATHS.updates, (request) => (
      deps.checkUpdates === undefined ? notImplemented() : deps.checkUpdates({ force: forceFlagOf(request) })
    )),
    postRoute(CATALOG_PATHS.summaryEstimate, (body) => (
      deps.estimate === undefined
        ? notImplemented()
        : deps.estimate({ repository: typeof body.repository === 'string' ? body.repository : null })
    )),
    postRoute(CATALOG_PATHS.summary, (body) => (
      deps.summarize === undefined
        ? notImplemented()
        : deps.summarize({
            packageName: typeof body.packageName === 'string' ? body.packageName : '',
            repository: typeof body.repository === 'string' ? body.repository : null,
            version: typeof body.version === 'string' ? body.version : null,
          })
    )),
    postRoute(CATALOG_PATHS.update, (body) => (
      deps.updateCommand === undefined
        ? notImplemented()
        : deps.updateCommand({ packages: Array.isArray(body.packages) ? body.packages.filter((value): value is string => typeof value === 'string') : [] })
    )),
  ]
}
