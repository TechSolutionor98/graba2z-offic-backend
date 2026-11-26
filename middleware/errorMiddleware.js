const notFound = (req, res, next) => {
  const error = new Error(`Not Found - ${req.originalUrl}`)
  res.status(404)
  next(error)
}

// Headers that carry credentials. These were being written to disk in full on
// every error, which meant session cookies and bearer tokens sat in plain text
// in the pm2 logs -- readable by anything that can read a file on the box, and
// by anyone the logs are ever shared with. A token in a log is a live token.
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-seo-unlock-token",
  "x-seo-settings-unlock",
])

const safeHeaders = (headers) => {
  const out = {}
  for (const [key, value] of Object.entries(headers || {})) {
    out[key] = SENSITIVE_HEADERS.has(key.toLowerCase()) ? "[redacted]" : value
  }
  return out
}

const errorHandler = (err, req, res, next) => {
  const statusCode = res.statusCode === 200 ? 500 : res.statusCode
  res.status(statusCode)

  // A 404 is not an error worth twenty lines.
  //
  // Most of them are search engines and social crawlers asking for addresses
  // that stopped existing when a product slug changed -- hundreds a day, every
  // day, each one previously writing a full stack trace and a complete header
  // dump. That is how a log directory quietly fills a disk, and a full disk
  // takes the site down without the application ever logging a reason.
  //
  // One line keeps what is actually useful: which address was asked for, so a
  // pattern of dead links is still visible in the log.
  if (statusCode === 404) {
    console.warn(`404 ${req.method} ${req.originalUrl}`)
    return res.json({ message: err.message, stack: null })
  }

  console.error("--- ERROR HANDLER LOG ---")
  console.error("Message:", err.message)
  console.error("Stack:", err.stack)
  console.error("Request Path:", req.originalUrl)
  console.error("Request Method:", req.method)
  console.error("Request Body:", req.body)
  console.error("Request Headers:", safeHeaders(req.headers))
  console.error("------------------------")

  res.json({
    message: err.message,
    stack: process.env.NODE_ENV === "production" ? null : err.stack,
  })
}

export { notFound, errorHandler }
