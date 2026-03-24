import fetch from "node-fetch"

const DEFAULT_TIMEOUT_MS = Number(process.env.CACHE_WARM_TIMEOUT_MS || 15000)

const normalizeBaseUrl = (baseUrl) => String(baseUrl || "").replace(/\/+$/, "")

const withTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  return { controller, timeout }
}

const makeRequest = async (baseUrl, request, timeoutMs) => {
  const startedAt = Date.now()
  const url = `${baseUrl}${request.path}`
  const { controller, timeout } = withTimeoutSignal(timeoutMs)

  try {
    const response = await fetch(url, {
      method: request.method || "GET",
      headers: request.headers || {},
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: controller.signal,
    })

    const durationMs = Date.now() - startedAt
    const text = await response.text()
    let data = null

    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    }

    return {
      ok: response.ok,
      status: response.status,
      durationMs,
      cache: response.headers.get("x-cache") || null,
      cacheKey: response.headers.get("x-cache-key") || null,
      url,
      data,
    }
  } catch (error) {
    const durationMs = Date.now() - startedAt
    return {
      ok: false,
      status: 0,
      durationMs,
      cache: null,
      cacheKey: null,
      url,
      data: null,
      error: error.name === "AbortError" ? `Request timeout after ${timeoutMs}ms` : error.message,
    }
  } finally {
    clearTimeout(timeout)
  }
}

const baseWarmRequests = (productListLimit) => [
  { label: "Homepage payload", method: "GET", path: "/api/homepage" },
  { label: "Products (shop cache)", method: "GET", path: `/api/products?limit=${productListLimit}` },
  { label: "Products page 1", method: "GET", path: "/api/products/paginated?page=1&limit=20" },
  { label: "Featured products", method: "GET", path: "/api/products?featured=true&limit=40" },
  { label: "Settings", method: "GET", path: "/api/settings" },
  { label: "Categories", method: "GET", path: "/api/categories" },
  { label: "Category slider", method: "GET", path: "/api/categories/slider" },
  { label: "Category tree", method: "GET", path: "/api/categories/tree" },
  { label: "Brands", method: "GET", path: "/api/brands" },
  { label: "Home sections", method: "GET", path: "/api/home-sections" },
  { label: "Active home sections", method: "GET", path: "/api/home-sections/active" },
  { label: "Banners", method: "GET", path: "/api/banners" },
  { label: "Buyer protection list", method: "GET", path: "/api/buyer-protection" },
]

const collectBuyerProtectionWarmRequests = (productsResponse, productSampleSize) => {
  const products = Array.isArray(productsResponse?.data) ? productsResponse.data : []
  const sampled = products
    .filter((product) => product?._id)
    .slice(0, productSampleSize)

  return sampled.map((product) => ({
    label: `Buyer protection by product (${product._id})`,
    method: "POST",
    path: "/api/buyer-protection/for-product",
    headers: { "Content-Type": "application/json" },
    body: {
      productId: product._id,
      productPrice: Number(product.offerPrice || product.price || 0),
    },
  }))
}

const summarizeResults = (results) => {
  const total = results.length
  const ok = results.filter((item) => item.ok).length
  const failed = total - ok
  const avgDurationMs = total > 0
    ? Math.round(results.reduce((sum, item) => sum + item.durationMs, 0) / total)
    : 0
  const cacheHits = results.filter((item) => item.cache === "HIT").length
  const cacheMisses = results.filter((item) => item.cache === "MISS").length

  return {
    total,
    ok,
    failed,
    avgDurationMs,
    cacheHits,
    cacheMisses,
  }
}

export const warmServerCache = async (options = {}) => {
  const {
    baseUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    productListLimit = Number(process.env.CACHE_WARM_PRODUCT_LIMIT || 120),
    productSampleSize = Number(process.env.CACHE_WARM_SAMPLE_SIZE || 12),
    includeBuyerProtection = true,
    verifyHits = false,
    onProgress = null,
  } = options

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  if (!normalizedBaseUrl) {
    throw new Error("A valid baseUrl is required for cache warmup")
  }

  const results = []
  const requests = baseWarmRequests(productListLimit)
  let productsResponse = null
  const emitProgress = typeof onProgress === "function" ? onProgress : () => {}

  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]
    emitProgress({
      phase: "warm",
      step: "start",
      index: index + 1,
      total: requests.length,
      label: request.label,
      path: request.path,
    })
    const response = await makeRequest(normalizedBaseUrl, request, timeoutMs)
    emitProgress({
      phase: "warm",
      step: "done",
      index: index + 1,
      total: requests.length,
      label: request.label,
      path: request.path,
      status: response.status,
      ok: response.ok,
      durationMs: response.durationMs,
      cache: response.cache,
      error: response.error || null,
    })
    results.push({
      label: request.label,
      ...response,
    })

    if (request.path.startsWith("/api/products?limit=")) {
      productsResponse = response
    }
  }

  if (includeBuyerProtection && productsResponse?.ok) {
    const protectionRequests = collectBuyerProtectionWarmRequests(productsResponse, productSampleSize)

    for (let index = 0; index < protectionRequests.length; index += 1) {
      const request = protectionRequests[index]
      emitProgress({
        phase: "buyer-protection",
        step: "start",
        index: index + 1,
        total: protectionRequests.length,
        label: request.label,
        path: request.path,
      })
      const response = await makeRequest(normalizedBaseUrl, request, timeoutMs)
      emitProgress({
        phase: "buyer-protection",
        step: "done",
        index: index + 1,
        total: protectionRequests.length,
        label: request.label,
        path: request.path,
        status: response.status,
        ok: response.ok,
        durationMs: response.durationMs,
        cache: response.cache,
        error: response.error || null,
      })
      results.push({
        label: request.label,
        ...response,
      })
    }
  }

  let verification = null
  if (verifyHits) {
    const verificationResults = []
    for (let index = 0; index < requests.length; index += 1) {
      const request = requests[index]
      emitProgress({
        phase: "verify",
        step: "start",
        index: index + 1,
        total: requests.length,
        label: request.label,
        path: request.path,
      })
      const response = await makeRequest(normalizedBaseUrl, request, timeoutMs)
      emitProgress({
        phase: "verify",
        step: "done",
        index: index + 1,
        total: requests.length,
        label: request.label,
        path: request.path,
        status: response.status,
        ok: response.ok,
        durationMs: response.durationMs,
        cache: response.cache,
        error: response.error || null,
      })
      verificationResults.push({
        label: request.label,
        ...response,
      })
    }
    verification = {
      summary: summarizeResults(verificationResults),
      results: verificationResults,
    }
  }

  return {
    baseUrl: normalizedBaseUrl,
    summary: summarizeResults(results),
    results,
    verification,
    generatedAt: new Date().toISOString(),
  }
}

export default warmServerCache
