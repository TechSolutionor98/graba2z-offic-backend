const STATIC_PAGE_DEFINITIONS = [
  { pageKey: "privacy-policy", pageName: "Privacy Policy", routePath: "/privacy-policy" },
  { pageKey: "disclaimer-policy", pageName: "Disclaimer Policy", routePath: "/disclaimer-policy" },
  { pageKey: "terms-conditions", pageName: "Terms & Conditions", routePath: "/terms-conditions" },
  { pageKey: "refund-return", pageName: "Refund & Return", routePath: "/refund-return" },
  { pageKey: "cookies-policy", pageName: "Cookies Policy", routePath: "/cookies-policy" },
  { pageKey: "track-order", pageName: "Track Order", routePath: "/track-order" },
  { pageKey: "voucher-terms", pageName: "Voucher Terms", routePath: "/voucher-terms" },
  { pageKey: "delivery-terms", pageName: "Delivery Terms", routePath: "/delivery-terms" },
]

const STATIC_PAGE_BY_KEY = new Map(STATIC_PAGE_DEFINITIONS.map((page) => [page.pageKey, page]))
const STATIC_PAGE_BY_PATH = new Map(STATIC_PAGE_DEFINITIONS.map((page) => [page.routePath, page]))

const normalizeSlashes = (value) => value.replace(/\\+/g, "/").replace(/\/+/g, "/")

export const normalizeStaticPagePath = (inputPath) => {
  let rawPath = typeof inputPath === "string" ? inputPath.trim() : ""

  if (!rawPath) return "/"

  try {
    if (rawPath.startsWith("http://") || rawPath.startsWith("https://")) {
      rawPath = new URL(rawPath).pathname || "/"
    }
  } catch {
    // Keep best-effort string path parsing
  }

  rawPath = rawPath.split("?")[0].split("#")[0]
  rawPath = normalizeSlashes(rawPath)

  if (!rawPath.startsWith("/")) rawPath = `/${rawPath}`

  // Strip locale prefixes (/ae-en or /ae-ar)
  rawPath = rawPath.replace(/^\/ae-(?:en|ar)(?=\/|$)/i, "")

  if (!rawPath) return "/"
  if (rawPath !== "/" && rawPath.endsWith("/")) {
    rawPath = rawPath.slice(0, -1)
  }

  return rawPath || "/"
}

export const resolveStaticPageByPath = (inputPath) => {
  const normalizedPath = normalizeStaticPagePath(inputPath)
  return STATIC_PAGE_BY_PATH.get(normalizedPath) || null
}

export { STATIC_PAGE_DEFINITIONS, STATIC_PAGE_BY_KEY, STATIC_PAGE_BY_PATH }
