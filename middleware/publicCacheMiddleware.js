// Let the edge and the browser keep a copy of the catalogue.
//
// The API already caches these responses in memory, which is why they are
// served quickly -- but with no Cache-Control header Cloudflare marks every one
// DYNAMIC and passes it straight through, so each visitor downloads the whole
// catalogue again from Dubai, and downloads it again on the next page. The
// category tree and subcategory list alone are several megabytes.
//
// Only safe, public, read-only catalogue data goes through here. Anything that
// is per-customer -- carts, orders, profiles, prices resolved for a signed-in
// user -- must never be cached at a shared edge, so an authenticated request is
// left alone and marked private.

const PUBLIC_CACHE = [
  "public",
  // The browser reuses its copy for a minute without asking.
  "max-age=60",
  // Cloudflare keeps it for five, so most visitors never reach our server.
  "s-maxage=300",
  // For an hour after that, a stale copy is served instantly while a fresh one
  // is fetched in the background -- nobody ever waits for the refill.
  "stale-while-revalidate=3600",
].join(", ")

export const publicCache = (req, res, next) => {
  if (req.method !== "GET") return next()

  // A signed-in request may carry details meant for that person only.
  if (req.headers.authorization || req.user) {
    res.set("Cache-Control", "private, no-store")
    return next()
  }

  res.set("Cache-Control", PUBLIC_CACHE)
  // The same URL answers differently by language and encoding.
  res.set("Vary", "Accept-Encoding, Accept-Language")
  next()
}

export default publicCache
