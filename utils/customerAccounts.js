import crypto from "crypto"
import User from "../models/userModel.js"

// Give every customer raised on the Create Order/Quotation screen a real
// account.
//
// Without one the customer exists only inside that one document: the next
// quotation for the same person cannot find them, their address has to be
// retyped, and nothing they have bought is linked together. Creating the
// account at the moment the document is raised is what makes the user search
// on that screen work at all.
//
// Never destructive. An existing account keeps every detail it already has --
// only blanks are filled in, so an admin typing a shorthand name into a
// quotation cannot rename a real customer.

// Ambiguous characters are left out. This gets read off a screen and typed
// back in by someone who did not choose it.
const PASSWORD_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789"

export const generateTempPassword = (length = 10) => {
  const bytes = crypto.randomBytes(length)
  let password = ""
  for (let i = 0; i < length; i += 1) password += PASSWORD_ALPHABET[bytes[i] % PASSWORD_ALPHABET.length]
  return password
}

const normalizeEmail = (email) => String(email || "").trim().toLowerCase()

const buildAddress = (shipping = {}) => ({
  street: shipping.address || "",
  city: shipping.city || "",
  state: shipping.state || "",
  zipCode: shipping.zipCode || "",
  country: shipping.country || "UAE",
})

/**
 * Find the customer's account by email, or create one.
 *
 * @param {Object} params
 * @param {Object} params.shipping  Name, email, phone and address as typed on the document
 * @param {string} [params.createdBy]  The admin raising the document
 * @returns {Promise<{user: Object, created: boolean, tempPassword: string|null}|null>}
 *          null when there is no email to key an account on
 */
export const ensureCustomerAccount = async ({ shipping = {}, createdBy } = {}) => {
  const email = normalizeEmail(shipping.email)
  const name = String(shipping.name || "").trim()

  // An account is keyed on the email address. Without one there is nothing to
  // find the customer by later, so there is no point creating a record.
  if (!email || !name) return null

  const existing = await User.findOne({ email })

  if (existing) {
    // Fill the gaps, change nothing that is already set.
    let touched = false
    if (!existing.phone && shipping.phone) {
      existing.phone = shipping.phone
      touched = true
    }
    if (!existing.address?.street && shipping.address) {
      existing.address = buildAddress(shipping)
      touched = true
    }
    if (touched) await existing.save()

    return { user: existing, created: false, tempPassword: null }
  }

  const tempPassword = generateTempPassword()

  const user = new User({
    name,
    email,
    password: tempPassword, // hashed by the model's pre-save hook
    phone: shipping.phone || "",
    address: buildAddress(shipping),
    // Saved as a delivery address too, so it is offered at checkout rather
    // than only sitting on the profile.
    ...(shipping.address
      ? {
          addresses: [
            {
              name,
              phone: shipping.phone || "",
              email,
              address: shipping.address,
              city: shipping.city || "",
              state: shipping.state || "",
              zipCode: shipping.zipCode || "",
              country: shipping.country || "UAE",
              isDefault: true,
            },
          ],
        }
      : {}),
    // The admin took these details from the customer directly, and login
    // refuses an unverified address -- an account that cannot be signed into is
    // no use to anyone.
    isEmailVerified: true,
    // They did not choose this password, so they are asked to replace it the
    // first time they sign in.
    mustChangePassword: true,
    createdBy: createdBy || undefined,
  })

  await user.save()

  return { user, created: true, tempPassword }
}
