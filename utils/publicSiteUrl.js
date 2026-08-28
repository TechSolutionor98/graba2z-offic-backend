/**
 * The one place that knows the public storefront address.
 *
 * Clients (mobile app, integrations) only ever get the API host handed to them,
 * so if they build customer-facing links themselves they end up sharing
 * https://api.grabatoz.ae, which is not a page anyone can open. Anything that
 * produces a shareable link must build it here instead.
 */

const DEFAULT_SITE_ORIGIN = "https://www.grabatoz.ae"

// An API/admin host is never a customer-facing address.
const NON_PUBLIC_HOST_PATTERN = /^(api|admin|staging|dev)\./i

const normalizeOrigin = (value) => {
  const raw = String(value || "").trim()
  if (!raw) return ""

  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`)
    if (NON_PUBLIC_HOST_PATTERN.test(url.hostname)) return ""
    return `${url.protocol}//${url.host}`
  } catch {
    return ""
  }
}

/**
 * Public storefront origin, e.g. "https://www.grabatoz.ae".
 * Configurable through PUBLIC_SITE_URL or FRONTEND_URL; an API or admin host is
 * rejected so a misconfigured env var can never leak into a shared link.
 */
export const getSiteOrigin = () =>
  normalizeOrigin(process.env.PUBLIC_SITE_URL) ||
  normalizeOrigin(process.env.FRONTEND_URL) ||
  DEFAULT_SITE_ORIGIN

/**
 * Canonical, openable product page URL.
 *
 * @param {string} slugOrId product slug, falling back to its id
 * @param {string} lang "en" or "ar"
 * @returns {string} e.g. https://www.grabatoz.ae/ae-en/product/my-product
 */
export const buildProductUrl = (slugOrId, lang = "en") => {
  const slug = String(slugOrId || "").trim()
  if (!slug) return ""

  const localePrefix = String(lang).toLowerCase() === "ar" ? "ae-ar" : "ae-en"
  return `${getSiteOrigin()}/${localePrefix}/product/${encodeURIComponent(slug)}`
}

/**
 * True when a URL points at the public storefront, so a client-supplied link
 * can be checked before it is stored or shown to staff.
 *
 * @param {string} value
 */
export const isPublicSiteUrl = (value) => {
  const raw = String(value || "").trim()
  if (!raw) return false

  try {
    const url = new URL(raw)
    if (!/^https?:$/.test(url.protocol)) return false
    return !NON_PUBLIC_HOST_PATTERN.test(url.hostname)
  } catch {
    return false
  }
}

export default { getSiteOrigin, buildProductUrl, isPublicSiteUrl }
