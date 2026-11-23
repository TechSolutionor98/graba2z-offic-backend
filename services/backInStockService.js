import BackInStock from "../models/backInStockModel.js"
import Product from "../models/productModel.js"
import { sendEmail, SITE_URL } from "../utils/emailService.js"

const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")

/**
 * Format currency for email
 */
const formatPrice = (price) => {
  const num = Number(price) || 0
  return `AED ${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Helper to ensure image URLs are absolute for email clients
 */
const toAbsoluteImageUrl = (src) => {
  if (!src) return "https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753105567/admin-logo_ruxcjj.png"
  const s = String(src).trim()
  if (s.startsWith("http://") || s.startsWith("https://")) {
    const publicMedia = (process.env.PUBLIC_MEDIA_URL || process.env.API_BASE_URL || "https://api.grabatoz.ae").replace(/\/+$/, "")
    return s.replace(/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i, publicMedia)
  }
  if (s.startsWith("//")) return `https:${s}`
  const base = (process.env.PUBLIC_MEDIA_URL || process.env.API_BASE_URL || process.env.PUBLIC_BASE_URL || "https://api.grabatoz.ae").replace(/\/+$/, "")
  if (s.startsWith("/")) return `${base}${s}`
  return `${base}/uploads/${s}`
}

/**
 * Send restock alert email to a subscriber
 */
export const sendBackInStockEmail = async ({ subscriber, product }) => {
  try {
    const productName = product?.name || subscriber?.metadata?.productName || "Product"
    const productSlug = product?.slug || subscriber?.metadata?.slug || product?._id
    const productUrl = `${SITE_URL}/product/${encodeURIComponent(productSlug)}`
    const rawImage = product?.image || subscriber?.metadata?.productImage
    const productImage = toAbsoluteImageUrl(rawImage)
    const price = product?.offerPrice > 0 ? product.offerPrice : product?.price || subscriber?.metadata?.productPrice || 0
    const variantText = subscriber.variant || ""
    const customerName = subscriber.name || "Customer"

    const subject = `Back in Stock: ${productName} is Available Now at Graba2z!`
    const currentYear = new Date().getFullYear()

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Back in Stock Alert - Graba2z</title>
  <style>
    body {
      background-color: #e8f7ee;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      margin: 0;
      padding: 0;
      color: #333333;
    }
    .container {
      max-width: 600px;
      margin: 32px auto;
      background-color: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
      border: 1px solid #e0e0e0;
    }
    .header {
      background-color: #ffffff;
      padding: 32px 0 20px 0;
      text-align: center;
      border-bottom: 1px solid #e0e0e0;
    }
    .header a {
      display: inline-block;
    }
    .header img {
      max-height: 55px;
      height: auto;
      display: block;
      margin: 0 auto;
    }
    .content {
      padding: 36px 30px 32px 30px;
      background: #ffffff;
    }
    .status-section {
      background: #E8F5E9;
      border-radius: 16px;
      padding: 32px 24px 28px;
      margin: 0 auto 28px;
      max-width: 520px;
      text-align: center;
    }
    .greeting {
      font-size: 18px;
      font-weight: 700;
      text-align: center;
      margin-bottom: 8px;
      color: #2E7D32;
    }
    .processing-text {
      font-size: 15px;
      text-align: center;
      color: #555555;
      margin-bottom: 6px;
      line-height: 1.5;
    }
    .arabic-text {
      font-size: 13px;
      text-align: center;
      color: #666666;
      direction: rtl;
      margin-bottom: 24px;
      line-height: 1.4;
    }
    .status-card {
      background: transparent;
      padding: 0;
      margin: 0;
      text-align: center;
    }
    .status-icon {
      color: #2E7D32;
      font-size: 44px;
      line-height: 1;
      margin: 0 auto 10px auto;
    }
    .status-label {
      color: #2E7D32;
      margin-top: 4px;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.2px;
    }
    .product-box {
      background-color: #ffffff;
      border: 1px solid #e5e7eb;
      border-radius: 12px;
      padding: 18px 20px;
      margin: 0 auto 24px;
      max-width: 520px;
    }
    .button {
      display: inline-block;
      background-color: #84cc16;
      color: #ffffff !important;
      padding: 14px 34px;
      text-decoration: none;
      border-radius: 28px;
      font-weight: 700;
      font-size: 14px;
      letter-spacing: 0.5px;
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      text-transform: uppercase;
      box-shadow: 0 4px 14px rgba(132, 204, 22, 0.35);
    }
    .footer {
      background-color: #e8f7ee;
      padding: 32px 20px 24px 20px;
      text-align: center;
      font-size: 13px;
      color: #888888;
    }
    .footer .socials {
      margin: 0 0 16px 0;
    }
    .footer .socials a {
      display: inline-block;
      margin: 0 8px;
      text-decoration: none;
    }
    .footer .socials img {
      width: 32px;
      height: 32px;
      vertical-align: middle;
      background: transparent;
      border-radius: 8px;
      box-shadow: none;
    }
    @media (max-width: 600px) {
      .container { border-radius: 0; margin: 0; }
      .content { padding: 24px 16px; }
      .footer { padding: 24px 12px; }
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- Header with Graba2z Logo -->
    <div class="header">
      <a href="${SITE_URL}/" target="_blank">
        <img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753105567/admin-logo_ruxcjj.png" alt="Graba2z Logo" />
      </a>
    </div>

    <!-- Main Content (Irhaas-Style Center UI with Grab Theme) -->
    <div class="content" style="padding: 36px 30px 32px 30px; background: #ffffff; text-align: center;">
      <!-- Title -->
      <h2 style="font-size: 24px; font-weight: 700; color: #111827; margin: 0 0 14px; text-align: center;">
        Good News, It's Back!
      </h2>

      <!-- Greeting & Intro text -->
      <p style="font-size: 15px; color: #374151; margin: 0 0 6px; text-align: center;">
        Hi <strong>${escapeHtml(customerName)}</strong>,
      </p>
      <p style="font-size: 14px; color: #4b5563; line-height: 1.5; margin: 0 0 4px; text-align: center;">
        The item you asked to be notified about is officially back in stock at <strong>Grabatoz</strong>. Secure yours before it sells out again!
      </p>
      <p style="font-size: 13px; color: #6b7280; line-height: 1.4; margin: 0 0 24px; text-align: center; direction: rtl;">
        المنتج الذي طلبت إشعار توفره متاح الآن في متجر <strong>جراباتوز</strong>. سارع بالطلب قبل نفاد الكمية!
      </p>

      <!-- Product Card (Irhaas style centered layout) -->
      <div style="background: #ffffff; border: 1px solid #e5e7eb; border-radius: 16px; padding: 22px 20px; margin: 0 auto 24px; max-width: 440px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.04);">
        <!-- Large centered image container -->
        <div style="background: #f9fafb; border-radius: 12px; padding: 16px; margin-bottom: 16px; text-align: center;">
          <img src="${productImage}" alt="${escapeHtml(productName)}" style="max-width: 100%; max-height: 220px; width: auto; height: auto; object-fit: contain; display: block; margin: 0 auto; border-radius: 8px;" />
        </div>

        <!-- Product Name -->
        <div style="font-size: 16px; font-weight: 700; color: #111827; margin: 0 0 8px; line-height: 1.4;">
          ${escapeHtml(productName)}
        </div>

        <!-- Price -->
        <div style="font-size: 19px; font-weight: 800; color: #84cc16; margin: 0 0 10px;">
          ${formatPrice(price)}
        </div>

        <!-- Variant Badge (if any) -->
        ${
          variantText
            ? `<div style="margin-top: 6px;">
                <span style="display: inline-block; border: 1px solid #d1d5db; background: #ffffff; color: #374151; padding: 4px 14px; border-radius: 6px; font-size: 12px; font-weight: 600;">
                  Option: ${escapeHtml(variantText)}
                </span>
              </div>`
            : ""
        }
      </div>

      <!-- CTA Button -->
      <div style="text-align: center; margin-top: 24px; margin-bottom: 12px;">
        <a href="${productUrl}" target="_blank"
           style="display: inline-block; background-color: #84cc16; color: #ffffff !important; padding: 15px 36px; text-decoration: none; border-radius: 8px; font-weight: 700; font-size: 14px; letter-spacing: 0.5px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; text-transform: uppercase; box-shadow: 0 4px 14px rgba(132, 204, 22, 0.35);">
          SHOP NOW — BEFORE IT SELLS OUT / اطلب الآن
        </a>
      </div>
      <div style="text-align: center; color: #6b7280; font-size: 12px; margin-bottom: 8px;">
        Stock is strictly limited and orders are processed on a first-come, first-served basis.
      </div>
    </div>

    <!-- Footer matching existing Graba2z emails -->
    <div class="footer">
      <div class="socials">
        <a href="https://www.facebook.com/grabatozae/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_1_axvzvv.jpg" alt="Facebook" /></a>
        <a href="https://www.instagram.com/grabatoz/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107124/WhatsApp_Image_2025-07-21_at_7.10.18_AM_xgjv5f.jpg" alt="Instagram" /></a>
        <a href="https://x.com/GrabAtoz" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107545/WhatsApp_Image_2025-07-21_at_7.10.18_AM_2_cwzjg6.png" alt="X" /></a>
        <a href="https://www.linkedin.com/company/grabatozae" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_3_ll6y2i.jpg" alt="LinkedIn" /></a>
      </div>
      <p style="margin: 6px 0;">This email was sent by: <a href="mailto:support@grabatoz.ae" style="color: #2E7D32; text-decoration: none;">support@grabatoz.ae</a></p>
      <p style="margin: 6px 0;">Kindly Do Not Reply to this Email</p>
      <div style="margin-top: 14px; color: #888888; font-size: 12px;">
        &copy; ${currentYear} Graba2z. All rights reserved.<br />
        <span style="font-size: 12px;">If you did not enter this email address when signing up for Graba2z, disregard this message.</span>
      </div>
    </div>
  </div>
</body>
</html>
`

    await sendEmail(subscriber.email, subject, html, "support")
    return { success: true }
  } catch (error) {
    console.error(`[BackInStockService] Failed to send email to ${subscriber.email}:`, error)
    return { success: false, error: error.message }
  }
}

/**
 * Notify all pending subscribers for a product that came back in stock
 * Can be triggered automatically by inventory/product changes or manually by admin
 */
export const notifyBackInStockSubscribers = async (productId, options = {}) => {
  try {
    if (!productId) return { success: false, message: "Product ID required" }

    const product = await Product.findById(productId)
    if (!product) return { success: false, message: "Product not found" }

    // Check if product is in stock
    const isMainInStock = product.stockStatus === "In Stock" || (Number(product.countInStock) > 0 && product.stockStatus !== "Out of Stock")

    // Find all unnotified subscribers
    const subscribers = await BackInStock.find({
      product: productId,
      notified: false,
    })

    if (!subscribers.length) {
      return { success: true, count: 0, message: "No pending subscribers found" }
    }

    console.log(`[BackInStockService] Processing ${subscribers.length} pending subscribers for product: ${product.name}`)

    let sentCount = 0

    for (const sub of subscribers) {
      let isEligible = isMainInStock

      // If subscriber asked for a specific Color variation
      if (sub.selectedColor && Array.isArray(product.colorVariations) && product.colorVariations.length > 0) {
        const matchingColor = product.colorVariations.find(
          (c) => c.color && c.color.toLowerCase() === sub.selectedColor.toLowerCase(),
        )
        if (matchingColor) {
          isEligible = Number(matchingColor.countInStock) > 0
        }
      }

      // If subscriber asked for a specific DOS variation
      if (sub.selectedDos && Array.isArray(product.dosVariations) && product.dosVariations.length > 0) {
        const matchingDos = product.dosVariations.find(
          (d) => d.dosType && d.dosType.toLowerCase() === sub.selectedDos.toLowerCase(),
        )
        if (matchingDos) {
          isEligible = Number(matchingDos.countInStock) > 0
        }
      }

      // If admin triggered manually, ignore stock check
      if (options.force) {
        isEligible = true
      }

      if (isEligible) {
        const emailResult = await sendBackInStockEmail({ subscriber: sub, product })
        if (emailResult.success) {
          sub.notified = true
          sub.notifiedAt = new Date()
          await sub.save()
          sentCount++
        }
      }
    }

    console.log(`[BackInStockService] Successfully notified ${sentCount} subscribers for product ${product._id}`)
    return { success: true, count: sentCount, total: subscribers.length }
  } catch (error) {
    console.error("[BackInStockService] Error in notifyBackInStockSubscribers:", error)
    return { success: false, error: error.message }
  }
}

