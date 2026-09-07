// Resolving a delivery method against an order.
//
// This is the canonical implementation. `client/src/utils/deliveryCharge.js` mirrors it
// exactly, because the storefront quotes the shipping and the order endpoint charges it --
// if the two ever disagree the card payment fails amount verification outright, which is
// precisely the class of bug that shipped once already.
//
// The amount compared against is always the GOODS SUBTOTAL: items only, before any coupon,
// referral or points discount. A shipping rule is about the size of the basket, not about
// what the shopper managed to knock off it, so a discount can never move somebody into or
// out of free shipping.
//
// A method is described by tiers. Each tier is { minOrderAmount, maxOrderAmount, charge },
// where a null/absent maxOrderAmount means "no upper bound".
//
//   subtotal below every tier's minimum  -> the method cannot be used at all
//   subtotal inside a tier               -> that tier's charge
//   subtotal above every tier's maximum  -> free shipping
//
// That last rule is the point of the maximum: past it, delivery stops being charged.

const toNumber = (value, fallback = 0) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const round2 = (value) => Math.round((toNumber(value, 0) + Number.EPSILON) * 100) / 100

/**
 * The tiers a delivery method actually has.
 *
 * A method configured with `rules` uses them. One without falls back to a single tier
 * built from its own charge and min/max, so every method configured before tiers existed
 * keeps working and gains the same free-above-maximum behaviour.
 */
export function getDeliveryTiers(method) {
  if (!method) return []

  const rules = Array.isArray(method.rules) ? method.rules : []
  const tiers = rules.length
    ? rules
    : [
        {
          minOrderAmount: method.minOrderAmount,
          maxOrderAmount: method.maxOrderAmount,
          charge: method.charge,
        },
      ]

  return tiers
    .map((tier) => {
      const min = Math.max(0, toNumber(tier.minOrderAmount, 0))
      // Treat 0, null, undefined and "" alike: no ceiling. A tier capped at 0 would be
      // unusable, so it is far more likely to mean "not set".
      const rawMax = tier.maxOrderAmount
      const max =
        rawMax === null || rawMax === undefined || rawMax === "" || toNumber(rawMax, 0) <= 0
          ? null
          : toNumber(rawMax, 0)

      return { minOrderAmount: min, maxOrderAmount: max, charge: Math.max(0, toNumber(tier.charge, 0)) }
    })
    .sort((a, b) => a.minOrderAmount - b.minOrderAmount)
}

/**
 * What this delivery method costs for a basket of this size, or why it cannot be used.
 *
 * @param {object} method   a DeliveryCharge document (or plain object)
 * @param {number} subtotal the goods subtotal, in AED, before discounts
 * @returns {{ available: boolean, charge: number, isFree: boolean, reason: string|null,
 *            minRequired: number|null, shortfall: number }}
 */
export function resolveDeliveryCharge(method, subtotal) {
  const goods = Math.max(0, toNumber(subtotal, 0))
  const tiers = getDeliveryTiers(method)

  if (tiers.length === 0) {
    return { available: false, charge: 0, isFree: false, reason: "not_configured", minRequired: null, shortfall: 0 }
  }

  // The cheapest basket this method will accept at all.
  const lowestMin = tiers[0].minOrderAmount

  if (goods < lowestMin) {
    return {
      available: false,
      charge: 0,
      isFree: false,
      reason: "below_minimum",
      minRequired: lowestMin,
      shortfall: round2(lowestMin - goods),
    }
  }

  // The tier the basket falls inside.
  const matching = tiers.find(
    (tier) => goods >= tier.minOrderAmount && (tier.maxOrderAmount === null || goods <= tier.maxOrderAmount),
  )
  if (matching) {
    return {
      available: true,
      charge: round2(matching.charge),
      isFree: matching.charge <= 0,
      reason: null,
      minRequired: lowestMin,
      shortfall: 0,
    }
  }

  // Nothing matched, and the basket is not below the minimum. Every tier is therefore
  // bounded and the basket is either past the highest ceiling, or sitting in a gap the
  // tiers do not cover.
  const highestMax = tiers.reduce((max, tier) => Math.max(max, tier.maxOrderAmount ?? 0), 0)

  if (goods > highestMax) {
    // Past the maximum: delivery is free.
    return { available: true, charge: 0, isFree: true, reason: null, minRequired: lowestMin, shortfall: 0 }
  }

  // In a gap between two tiers. Charge the last tier the basket did qualify for rather
  // than refusing the order over a hole in the configuration.
  const previous = [...tiers].reverse().find((tier) => goods >= tier.minOrderAmount)
  return {
    available: true,
    charge: round2(previous ? previous.charge : 0),
    isFree: previous ? previous.charge <= 0 : true,
    reason: null,
    minRequired: lowestMin,
    shortfall: 0,
  }
}

/**
 * Pick the method to use out of everything configured for the country.
 *
 * `preferredId` is what the shopper chose. It is honoured when it is still usable for this
 * basket; otherwise the cheapest usable method is taken, so a basket is never refused
 * because of a stale selection while a valid option exists.
 */
export function selectDeliveryMethod(methods, subtotal, preferredId = null) {
  const list = Array.isArray(methods) ? methods : []
  const resolved = list.map((method) => ({ method, ...resolveDeliveryCharge(method, subtotal) }))

  if (preferredId) {
    const preferred = resolved.find((entry) => String(entry.method._id) === String(preferredId))
    if (preferred?.available) return preferred
  }

  const usable = resolved.filter((entry) => entry.available).sort((a, b) => a.charge - b.charge)
  if (usable.length > 0) return usable[0]

  // Nothing is usable. Report the smallest gap, so the shopper is told the lowest bar they
  // could actually clear rather than the highest.
  const blocked = resolved
    .filter((entry) => entry.reason === "below_minimum")
    .sort((a, b) => a.minRequired - b.minRequired)

  if (blocked.length > 0) return blocked[0]

  return {
    method: null,
    available: false,
    charge: 0,
    isFree: false,
    reason: list.length === 0 ? "none_configured" : "not_configured",
    minRequired: null,
    shortfall: 0,
  }
}

/** The sentence a shopper is shown when home delivery cannot be used. */
export function describeDeliveryBlock(result, formatAmount = (n) => `AED ${Number(n).toFixed(2)}`) {
  if (!result || result.available) return ""

  if (result.reason === "below_minimum") {
    return `Orders under ${formatAmount(result.minRequired)} cannot be delivered. Add ${formatAmount(
      result.shortfall,
    )} more to your cart, or choose store pickup.`
  }

  return "Delivery is not available for this order. Please choose store pickup or contact support."
}

export default { getDeliveryTiers, resolveDeliveryCharge, selectDeliveryMethod, describeDeliveryBlock }
