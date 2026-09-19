import crypto from "crypto"
import axios from "axios"

// Report a confirmed purchase to Meta from the server.
//
// The browser pixel already reports it, but roughly a third of those events
// never arrive -- ad blockers remove connect.facebook.net, and Safari's tracking
// prevention expires the cookies it relies on. This channel goes directly from
// our server to Meta's Graph API, so it cannot be blocked.
//
// Both events carry the same `event_id` (the order id, also sent as `eventID`
// by pushMetaPurchase in the browser), which is how Meta de-duplicates them: an
// order reported by both channels is counted once, and an order the browser
// lost is still counted. Without matching ids the same sale counts twice, so
// the id must stay the order id on both sides.
//
// Nothing here is allowed to fail an order. Every entry point swallows its own
// errors and logs them.

const GRAPH_VERSION = "v21.0"

const config = () => ({
  pixelId: String(process.env.META_PIXEL_ID || "").trim(),
  accessToken: String(process.env.META_CAPI_ACCESS_TOKEN || "").trim(),
  // Set only while checking the setup in Events Manager -> Test Events. A test
  // event is not counted as a conversion, so this must be empty in production.
  testEventCode: String(process.env.META_TEST_EVENT_CODE || "").trim(),
})

/** Meta requires every personal detail SHA-256 hashed, and normalized first. */
const hash = (value) => {
  const normalized = String(value ?? "").trim().toLowerCase()
  if (!normalized) return undefined
  return crypto.createHash("sha256").update(normalized).digest("hex")
}

// Digits only, with the country code. A UAE number saved as "050 123 4567" has
// to become "971501234567" or Meta cannot match it to an account.
const hashPhone = (value, countryName) => {
  let digits = String(value ?? "").replace(/\D/g, "")
  if (!digits) return undefined

  const isUae = /uae|emirates/i.test(String(countryName || ""))
  if (digits.startsWith("00")) digits = digits.slice(2)
  if (isUae && digits.startsWith("0")) digits = `971${digits.slice(1)}`

  return digits.length < 8 ? undefined : hash(digits)
}

// Meta wants a two-letter country code. Orders store the country by name.
const COUNTRY_CODES = {
  "united arab emirates": "ae",
  uae: "ae",
  "saudi arabia": "sa",
  ksa: "sa",
  qatar: "qa",
  kuwait: "kw",
  bahrain: "bh",
  oman: "om",
}

const hashCountry = (name) => {
  const key = String(name || "").trim().toLowerCase()
  if (!key) return undefined
  if (key.length === 2) return hash(key)
  return COUNTRY_CODES[key] ? hash(COUNTRY_CODES[key]) : undefined
}

const splitName = (fullName) => {
  const parts = String(fullName || "").trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return {}
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : undefined }
}

/**
 * The customer, hashed. A delivery keeps them on shippingAddress and a
 * collection on pickupDetails, so both are read -- the same reason
 * orderCustomerName exists on the client.
 */
const buildUserData = (order) => {
  const contact = order?.deliveryType === "pickup" ? order?.pickupDetails : order?.shippingAddress
  const address = order?.shippingAddress || {}
  const attribution = order?.metaAttribution || {}

  const email = contact?.email || order?.user?.email || ""
  const userId = order?.user?._id || order?.user
  const phone = contact?.phone || ""
  const { first, last } = splitName(contact?.name || order?.user?.name)

  const userData = {
    em: hash(email),
    ph: hashPhone(phone, address.country),
    fn: hash(first),
    ln: hash(last),
    ct: hash(address.city),
    st: hash(address.state),
    zp: hash(address.zipCode),
    country: hashCountry(address.country),
    // A signed-in shopper is the strongest match signal there is, and it is the
    // one identifier that survives every cookie restriction.
    // `user` is an id on a raw order and a document once populated; both work.
    external_id: userId ? hash(String(userId)) : undefined,
    // The pixel's own cookies, captured in the browser at checkout. They are
    // what ties this server event to the same person's browsing session.
    fbp: attribution.fbp || undefined,
    fbc: attribution.fbc || undefined,
    client_ip_address: attribution.ip || undefined,
    client_user_agent: attribution.userAgent || undefined,
  }

  return Object.fromEntries(Object.entries(userData).filter(([, value]) => value))
}

const buildCustomData = (order) => {
  const contents = (order?.orderItems || [])
    .map((item) => {
      const productId = item?.product?._id || item?.product
      if (!productId) return null
      return {
        id: String(productId),
        quantity: Number(item.quantity) || 1,
        item_price: Number(item.price) || 0,
      }
    })
    .filter(Boolean)

  return {
    value: Number(order?.totalPrice) || 0,
    currency: order?.currency || "AED",
    content_type: "product",
    content_ids: contents.map((entry) => entry.id),
    contents,
    num_items: contents.reduce((count, entry) => count + entry.quantity, 0),
    order_id: String(order?._id || ""),
  }
}

/**
 * Send the Purchase event for a confirmed order.
 *
 * Safe to call from every path that can confirm an order -- COD at creation,
 * and each gateway's verify and webhook routes, which both fire for the same
 * payment. The first call marks the order and the rest return immediately, so
 * a retried webhook cannot report the sale twice.
 *
 * @param {Object} order    A saved order document
 * @param {Object} [options]
 * @param {import("mongoose").Model} [options.Order]  Model used to record the send
 * @returns {Promise<boolean>} true when Meta accepted the event
 */
export const sendMetaPurchase = async (order, { Order } = {}) => {
  try {
    const { pixelId, accessToken, testEventCode } = config()
    if (!pixelId || !accessToken) return false
    if (!order?._id) return false
    if (order.metaPurchaseSentAt) return false

    const value = Number(order.totalPrice) || 0
    if (!(value > 0)) {
      // Meta rejects a value of zero, and a run of them is what makes an
      // account look like it reports the same price on every sale.
      console.warn(`[META CAPI] Purchase not sent for ${order._id}: no order value`)
      return false
    }

    // Claim the send before calling out. Two webhooks arriving together would
    // otherwise both find the flag unset and report the same sale twice.
    if (Order) {
      const claim = await Order.updateOne(
        { _id: order._id, metaPurchaseSentAt: { $in: [null, undefined] } },
        { $set: { metaPurchaseSentAt: new Date() } },
      )
      if (claim.modifiedCount === 0) return false
    }

    const attribution = order.metaAttribution || {}
    const eventTime = Math.floor(new Date(order.paidAt || order.createdAt || Date.now()).getTime() / 1000)

    const payload = {
      data: [
        {
          event_name: "Purchase",
          event_time: eventTime,
          // The order id, matching the browser pixel's eventID exactly.
          event_id: String(order._id),
          action_source: "website",
          event_source_url: attribution.sourceUrl || undefined,
          user_data: buildUserData(order),
          custom_data: buildCustomData(order),
        },
      ],
      ...(testEventCode ? { test_event_code: testEventCode } : {}),
    }

    const { data } = await axios.post(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events`,
      payload,
      { params: { access_token: accessToken }, timeout: 8000 },
    )

    console.log(
      `[META CAPI] Purchase sent for ${order._id}: ${value} ${payload.data[0].custom_data.currency}, received ${data?.events_received ?? "?"}`,
    )
    return true
  } catch (error) {
    // Release the claim so a later webhook can try again, then carry on -- the
    // order is confirmed whether or not Meta heard about it.
    if (Order && order?._id) {
      await Order.updateOne({ _id: order._id }, { $unset: { metaPurchaseSentAt: "" } }).catch(() => {})
    }
    console.error("[META CAPI] Purchase failed:", error?.response?.data?.error?.message || error.message)
    return false
  }
}

/**
 * The browser details Meta needs, read off the incoming request.
 *
 * The cookies travel in the order payload rather than as real cookies, because
 * the shop is on grabatoz.ae and the API on api.grabatoz.ae -- a cross-origin
 * request does not carry them.
 */
export const readMetaAttribution = (req, body = {}) => {
  const sent = body?.metaAttribution || {}

  return {
    fbp: sent.fbp || undefined,
    fbc: sent.fbc || undefined,
    sourceUrl: sent.sourceUrl || undefined,
    userAgent: req?.headers?.["user-agent"] || undefined,
    // Behind a proxy, req.ip is the proxy. The first forwarded address is the
    // customer.
    ip:
      String(req?.headers?.["x-forwarded-for"] || "").split(",")[0].trim() ||
      req?.socket?.remoteAddress ||
      undefined,
  }
}
