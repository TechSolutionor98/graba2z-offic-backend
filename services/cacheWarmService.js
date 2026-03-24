import fetch from "node-fetch"

const DEFAULT_TIMEOUT_MS = Number(process.env.CACHE_WARM_TIMEOUT_MS || 15000)
const DEFAULT_PER_CATEGORY_PRODUCT_LIMIT = Number(process.env.CACHE_WARM_PER_CATEGORY_PRODUCT_LIMIT || 12)
const DEFAULT_PRODUCT_LIST_LIMIT = Number(process.env.CACHE_WARM_PRODUCT_LIMIT || 120)
const DEFAULT_PRODUCT_SAMPLE_SIZE = Number(process.env.CACHE_WARM_SAMPLE_SIZE || 12)
const DEFAULT_BANNER_POSITIONS = ["hero", "promotional", "mobile"]

const normalizeBaseUrl = (baseUrl) => String(baseUrl || "").replace(/\/+$/, "")
const toPositiveInt = (value, fallbackValue) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallbackValue
}

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

const buildProductsMainPath = (warmAllProducts, productListLimit) => {
  if (warmAllProducts) return "/api/products"
  const normalizedLimit = toPositiveInt(productListLimit, DEFAULT_PRODUCT_LIST_LIMIT)
  return `/api/products?limit=${normalizedLimit}`
}

const baseWarmRequests = ({ warmAllProducts, productListLimit }) => [
  { id: "homepage", label: "Homepage payload", method: "GET", path: "/api/homepage" },
  { id: "products-main", label: warmAllProducts ? "Products (all)" : "Products (shop cache)", method: "GET", path: buildProductsMainPath(warmAllProducts, productListLimit) },
  { id: "products-paginated", label: "Products page 1", method: "GET", path: "/api/products/paginated?page=1&limit=20" },
  { id: "products-featured", label: "Featured products", method: "GET", path: "/api/products?featured=true&limit=40" },
  { id: "settings", label: "Settings", method: "GET", path: "/api/settings" },
  { id: "categories", label: "Categories", method: "GET", path: "/api/categories" },
  { id: "category-slider", label: "Category slider", method: "GET", path: "/api/categories/slider" },
  { id: "category-tree", label: "Category tree", method: "GET", path: "/api/categories/tree" },
  { id: "subcategories-all", label: "Subcategories (all)", method: "GET", path: "/api/subcategories" },
  { id: "brands", label: "Brands", method: "GET", path: "/api/brands" },
  { id: "home-sections", label: "Home sections", method: "GET", path: "/api/home-sections" },
  { id: "home-sections-active", label: "Active home sections", method: "GET", path: "/api/home-sections/active" },
  { id: "banners-all", label: "Banners", method: "GET", path: "/api/banners" },
  { id: "banners-active", label: "Banners active=true", method: "GET", path: "/api/banners?active=true" },
  { id: "buyer-protection-list", label: "Buyer protection list", method: "GET", path: "/api/buyer-protection" },
]

const collectCategoryFanoutRequests = (categoriesResponse, options = {}) => {
  const {
    includeSubcategoriesByCategory = true,
    includeProductsByCategory = true,
    perCategoryProductLimit = DEFAULT_PER_CATEGORY_PRODUCT_LIMIT,
  } = options

  const categories = Array.isArray(categoriesResponse?.data) ? categoriesResponse.data : []
  const productLimit = toPositiveInt(perCategoryProductLimit, DEFAULT_PER_CATEGORY_PRODUCT_LIMIT)
  const requests = []

  for (const category of categories) {
    const categoryId = category?._id
    if (!categoryId) continue
    const categoryName = category.name || category.slug || categoryId

    if (includeSubcategoriesByCategory) {
      requests.push({
        id: `subcategories-by-category-${categoryId}`,
        label: `Subcategories by category (${categoryName})`,
        method: "GET",
        path: `/api/subcategories?category=${categoryId}`,
      })
    }

    if (includeProductsByCategory) {
      requests.push({
        id: `products-by-category-${categoryId}`,
        label: `Products by category (${categoryName})`,
        method: "GET",
        path: `/api/products?category=${categoryId}&limit=${productLimit}`,
      })
    }
  }

  return requests
}

const collectBannerPositionRequests = (positions = DEFAULT_BANNER_POSITIONS) => {
  const uniquePositions = Array.from(
    new Set(
      (Array.isArray(positions) ? positions : DEFAULT_BANNER_POSITIONS)
        .map((position) => String(position || "").trim())
        .filter(Boolean),
    ),
  )

  return uniquePositions.map((position) => ({
    id: `banners-position-${position}`,
    label: `Banners position=${position}`,
    method: "GET",
    path: `/api/banners?active=true&position=${encodeURIComponent(position)}`,
  }))
}

const collectBuyerProtectionWarmRequests = (productsResponse, productSampleSize) => {
  const products = Array.isArray(productsResponse?.data) ? productsResponse.data : []
  const sampleSize = toPositiveInt(productSampleSize, DEFAULT_PRODUCT_SAMPLE_SIZE)
  const sampled = products
    .filter((product) => product?._id)
    .slice(0, sampleSize)

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

const executeRequests = async ({
  phase,
  requests,
  baseUrl,
  timeoutMs,
  emitProgress,
  onResponse,
  sink,
}) => {
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index]

    emitProgress({
      phase,
      step: "start",
      index: index + 1,
      total: requests.length,
      label: request.label,
      path: request.path,
    })

    const response = await makeRequest(baseUrl, request, timeoutMs)
    const result = {
      id: request.id || null,
      label: request.label,
      ...response,
    }

    emitProgress({
      phase,
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

    sink.push(result)
    if (typeof onResponse === "function") {
      onResponse(request, result)
    }
  }
}

export const warmServerCache = async (options = {}) => {
  const {
    baseUrl,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    warmAllProducts = String(process.env.CACHE_WARM_ALL_PRODUCTS || "true") !== "false",
    productListLimit = DEFAULT_PRODUCT_LIST_LIMIT,
    productSampleSize = DEFAULT_PRODUCT_SAMPLE_SIZE,
    includeCategoryFanout = String(process.env.CACHE_WARM_CATEGORY_FANOUT || "true") !== "false",
    includeProductsByCategory = true,
    includeSubcategoriesByCategory = true,
    perCategoryProductLimit = DEFAULT_PER_CATEGORY_PRODUCT_LIMIT,
    includeBannerPositions = true,
    bannerPositions = DEFAULT_BANNER_POSITIONS,
    includeBuyerProtection = true,
    verifyHits = false,
    verifyBuyerProtection = true,
    onProgress = null,
  } = options

  const normalizedBaseUrl = normalizeBaseUrl(baseUrl)
  if (!normalizedBaseUrl) {
    throw new Error("A valid baseUrl is required for cache warmup")
  }

  const results = []
  const baseRequests = baseWarmRequests({ warmAllProducts, productListLimit })
  const fanoutRequests = []
  const buyerProtectionRequests = []
  let productsResponse = null
  let categoriesResponse = null
  const emitProgress = typeof onProgress === "function" ? onProgress : () => {}

  await executeRequests({
    phase: "warm",
    requests: baseRequests,
    baseUrl: normalizedBaseUrl,
    timeoutMs,
    emitProgress,
    sink: results,
    onResponse: (request, response) => {
      if (request.id === "products-main") {
        productsResponse = response
      }
      if (request.id === "categories") {
        categoriesResponse = response
      }
    },
  })

  if (includeCategoryFanout && categoriesResponse?.ok) {
    fanoutRequests.push(
      ...collectCategoryFanoutRequests(categoriesResponse, {
        includeSubcategoriesByCategory,
        includeProductsByCategory,
        perCategoryProductLimit,
      }),
    )
  }

  if (includeBannerPositions) {
    fanoutRequests.push(...collectBannerPositionRequests(bannerPositions))
  }

  if (fanoutRequests.length > 0) {
    await executeRequests({
      phase: "fanout",
      requests: fanoutRequests,
      baseUrl: normalizedBaseUrl,
      timeoutMs,
      emitProgress,
      sink: results,
    })
  }

  if (includeBuyerProtection && productsResponse?.ok) {
    buyerProtectionRequests.push(...collectBuyerProtectionWarmRequests(productsResponse, productSampleSize))
  }

  if (buyerProtectionRequests.length > 0) {
    await executeRequests({
      phase: "buyer-protection",
      requests: buyerProtectionRequests,
      baseUrl: normalizedBaseUrl,
      timeoutMs,
      emitProgress,
      sink: results,
    })
  }

  let verification = null
  if (verifyHits) {
    const verificationResults = []
    const verifyRequests = [...baseRequests, ...fanoutRequests]
    if (verifyBuyerProtection) {
      verifyRequests.push(...buyerProtectionRequests)
    }

    await executeRequests({
      phase: "verify",
      requests: verifyRequests,
      baseUrl: normalizedBaseUrl,
      timeoutMs,
      emitProgress,
      sink: verificationResults,
    })

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
