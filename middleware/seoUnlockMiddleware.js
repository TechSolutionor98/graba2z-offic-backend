import jwt from "jsonwebtoken"

export const SEO_UNLOCK_HEADER = "x-seo-unlock-token"
const SEO_UNLOCK_LEGACY_HEADER = "x-seo-settings-unlock"
export const SEO_UNLOCK_REQUIRED_CODE = "SEO_UNLOCK_REQUIRED"

const SEO_UNLOCK_PASSWORD = process.env.SEO_UNLOCK_PASSWORD || "SEO#SETTINGS#UNLOCK"
const SEO_UNLOCK_TOKEN_TTL = process.env.SEO_UNLOCK_TOKEN_TTL || "8h"

const getSeoUnlockSecret = () => {
  const jwtSecret = process.env.JWT_SECRET || "grabatoz-seo-unlock-secret"
  return `${jwtSecret}:seo_unlock`
}

const isBodyFieldPresent = (body, field) => Object.prototype.hasOwnProperty.call(body || {}, field)

const getTokenFromRequest = (req) => {
  const value = req.headers?.[SEO_UNLOCK_HEADER] || req.headers?.[SEO_UNLOCK_LEGACY_HEADER] || ""
  return String(value || "").trim()
}

export const issueSeoUnlockToken = (userId) => {
  const token = jwt.sign(
    {
      type: "seo_unlock",
      userId: String(userId),
    },
    getSeoUnlockSecret(),
    {
      expiresIn: SEO_UNLOCK_TOKEN_TTL,
    },
  )

  const decoded = jwt.decode(token)
  const expiresAt = decoded?.exp ? new Date(decoded.exp * 1000).toISOString() : null
  const expiresInSeconds = decoded?.exp && decoded?.iat ? Math.max(0, decoded.exp - decoded.iat) : null

  return { token, expiresAt, expiresInSeconds }
}

export const verifySeoUnlockPassword = (password) => String(password || "") === SEO_UNLOCK_PASSWORD

const sendSeoUnlockRequired = (res, message = "SEO settings are locked. Use Unlock Potential first.") =>
  res.status(423).json({
    message,
    code: SEO_UNLOCK_REQUIRED_CODE,
  })

export const requireSeoUnlock = (req, res, next) => {
  const token = getTokenFromRequest(req)
  if (!token) return sendSeoUnlockRequired(res)

  try {
    const payload = jwt.verify(token, getSeoUnlockSecret())
    if (payload?.type !== "seo_unlock" || !payload?.userId) {
      return sendSeoUnlockRequired(res, "Invalid SEO unlock token")
    }

    if (String(payload.userId) !== String(req.user?._id || "")) {
      return sendSeoUnlockRequired(res, "SEO unlock token belongs to a different admin user")
    }

    req.seoUnlocked = true
    req.seoUnlockPayload = payload
    return next()
  } catch (error) {
    return sendSeoUnlockRequired(res, "SEO unlock token expired or invalid")
  }
}

export const requireSeoUnlockIfBodyHas = (fields = []) => (req, res, next) => {
  const shouldRequire = fields.some((field) => isBodyFieldPresent(req.body, field))
  if (!shouldRequire) return next()
  return requireSeoUnlock(req, res, next)
}
