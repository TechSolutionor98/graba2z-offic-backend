import nodemailer from "nodemailer"

// Create transporters for order and support emails
const orderTransporter = nodemailer.createTransport({
  host: process.env.ORDER_EMAIL_HOST,
  port: Number(process.env.ORDER_EMAIL_PORT),
  secure: process.env.ORDER_EMAIL_SECURE === "true",
  auth: {
    user: process.env.ORDER_EMAIL_USER,
    pass: process.env.ORDER_EMAIL_PASS,
  },
})

const supportTransporter = nodemailer.createTransport({
  host: process.env.SUPPORT_EMAIL_HOST,
  port: Number(process.env.SUPPORT_EMAIL_PORT),
  secure: process.env.SUPPORT_EMAIL_SECURE === "true",
  auth: {
    user: process.env.SUPPORT_EMAIL_USER,
    pass: process.env.SUPPORT_EMAIL_PASS,
  },
})

// Helper to select transporter and from address
const getMailConfig = (type) => {
  if (type === "order") {
    return {
      transporter: orderTransporter,
      from: `Graba2z Orders <${process.env.ORDER_EMAIL_USER}>`,
    }
  } else {
    return {
      transporter: supportTransporter,
      from: `Graba2z Support <${process.env.SUPPORT_EMAIL_USER}>`,
    }
  }
}

// Email templates
const getEmailTemplate = (type, data) => {
  const baseStyle = `
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body { 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif; 
        line-height: 1.6; 
        color: #333; 
        background-color: #f5f5f5; 
        margin: 0; 
        padding: 20px;
      }
      .email-container { 
        max-width: 600px; 
        margin: 0 auto; 
        background-color: #ffffff; 
        border-radius: 8px;
        overflow: hidden;
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }
      .header { 
        background-color: #ffffff; 
        padding: 30px 20px 20px; 
        text-align: center; 
        border-bottom: 1px solid #eee;
      }
      .logo { 
        max-width: 200px; 
        height: auto; 
        margin-bottom: 20px;
      }
      .order-icon {
        width: 80px;
        height: 80px;
        background-color: #2c3e50;
        border-radius: 50%;
        margin: 20px auto;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 30px;
      }
      .content { 
        padding: 30px 20px; 
        background-color: #ffffff;
      }
      .order-number {
        font-size: 24px;
        font-weight: bold;
        color: #333;
        text-align: center;
        margin-bottom: 20px;
      }
      .greeting {
        font-size: 18px;
        text-align: center;
        margin-bottom: 10px;
        color: #333;
      }
      .processing-text {
        font-size: 16px;
        text-align: center;
        color: #666;
        margin-bottom: 30px;
      }
      .action-buttons {
        text-align: center;
        margin: 30px 0;
      }
      .button {
        display: inline-block;
        background-color: #8BC34A;
        color: white;
        padding: 15px 30px;
        text-decoration: none;
        border-radius: 25px;
        font-weight: bold;
        font-size: 14px;
        margin: 5px 10px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      .button:hover {
        background-color: #7CB342;
      }
      .product-section {
        margin: 30px 0;
        padding: 20px;
        background-color: #f9f9f9;
        border-radius: 8px;
      }
      .product-item {
        display: flex;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 20px;
        border-bottom: 1px solid #eee;
      }
      .product-item:last-child {
        border-bottom: none;
        margin-bottom: 0;
        padding-bottom: 0;
      }
      .product-image {
        width: 80px;
        height: 80px;
        object-fit: cover;
        border-radius: 8px;
        margin-right: 15px;
        background-color: #f0f0f0;
      }
      .product-details {
        flex: 1;
      }
      .product-name {
        font-weight: bold;
        font-size: 16px;
        color: #333;
        margin-bottom: 5px;
        line-height: 1.4;
      }
      .product-quantity {
        color: #666;
        font-size: 14px;
        margin-bottom: 5px;
      }
      .product-price {
        font-weight: bold;
        color: #8BC34A;
        font-size: 16px;
      }
      .order-summary {
        background-color: #f9f9f9;
        padding: 20px;
        border-radius: 8px;
        margin: 20px 0;
      }
      .summary-row {
        display: flex;
        justify-content: space-between;
        margin-bottom: 10px;
        font-size: 16px;
      }
      .summary-row.total {
        font-weight: bold;
        font-size: 18px;
        color: #333;
        border-top: 1px solid #ddd;
        padding-top: 10px;
        margin-top: 15px;
      }
      .vat-note {
        font-size: 14px;
        color: #666;
        text-align: right;
        margin-top: 5px;
      }
      .info-section {
        margin: 20px 0;
      }
      .info-title {
        font-weight: bold;
        font-size: 18px;
        color: #333;
        margin-bottom: 15px;
      }
      .info-content {
        background-color: #f9f9f9;
        padding: 15px;
        border-radius: 8px;
        font-size: 14px;
        line-height: 1.6;
      }
      .address-section {
        display: flex;
        gap: 20px;
        margin: 20px 0;
      }
      .address-block {
        flex: 1;
      }
      .footer {
        background-color: #8BC34A;
        color: white;
        padding: 30px 20px;
        text-align: center;
      }
      .footer h3 {
        margin-bottom: 20px;
        font-size: 20px;
      }
      .social-icons {
        margin: 20px 0;
      }
      .social-icon {
        display: inline-block;
        width: 40px;
        height: 40px;
        background-color: white;
        border-radius: 50%;
        margin: 0 10px;
        line-height: 40px;
        text-decoration: none;
        color: #8BC34A;
        font-weight: bold;
      }
      .contact-info {
        margin-top: 20px;
        font-size: 14px;
      }
      .contact-info a {
        color: white;
        text-decoration: underline;
      }
      @media (max-width: 600px) {
        .email-container { margin: 0; border-radius: 0; }
        .content { padding: 20px 15px; }
        .address-section { flex-direction: column; }
        .product-item { flex-direction: column; text-align: center; }
        .product-image { margin: 0 auto 15px; }
        .button { display: block; margin: 10px 0; }
      }
    </style>
  `

  switch (type) {
    case "emailVerification":
      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>Email Verification</title>
          <style>
            body {
              background-color: #e8f7ee;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 0;
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
              background-color: #fff;
              padding: 32px 0 16px 0;
              text-align: center;
              border-bottom: 1px solid #e0e0e0;
            }
            .header a {
              display: inline-block;
            }
            .header img {
              max-height: 60px;
            }
            .content {
              padding: 40px 30px 32px 30px;
              text-align: center;
            }
            .content h2 {
              color: #222;
              font-size: 1.5rem;
              margin-bottom: 0.5em;
            }
            .content p {
              color: #444;
              font-size: 1.1rem;
              margin: 0.5em 0 1.5em 0;
            }
            .code-box {
              background: #f4f4f4;
              border-radius: 10px;
              margin: 32px auto 24px auto;
              padding: 24px 0;
              font-size: 2.2rem;
              font-weight: bold;
              color: #1abc7b;
              letter-spacing: 10px;
              max-width: 320px;
            }
            .copy-btn {
              display: inline-block;
              background: #1abc7b;
              color: #fff;
              font-weight: 600;
              padding: 16px 40px;
              border-radius: 8px;
              text-decoration: none;
              font-size: 1.1rem;
              margin: 24px 0 0 0;
              transition: background 0.2s;
              cursor: pointer;
            }
            .copy-btn:hover {
              background: #159c65;
            }
            .footer {
              background-color: #e8f7ee;
              padding: 32px 20px 20px 20px;
              text-align: center;
              font-size: 13px;
              color: #888;
            }
            .footer .socials {
              margin: 18px 0 10px 0;
            }
            .footer .socials a {
              display: inline-block;
              margin: 0 10px;
              text-decoration: none;
            }
            .footer .socials img {
              width: 32px;
              height: 32px;
              vertical-align: middle;
              border-radius: 50%;
              background: #fff;
              box-shadow: 0 2px 8px rgba(0,0,0,0.04);
              transition: box-shadow 0.2s;
            }
            .footer .socials img:hover {
              box-shadow: 0 4px 16px rgba(26,188,123,0.15);
            }
            @media (max-width: 600px) {
              .container { border-radius: 0; margin: 0; }
              .content { padding: 24px 8px 24px 8px; }
              .footer { padding: 24px 4px 12px 4px; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <a href="https://www.graba2z.ae/" target="_blank">
                <img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753105567/admin-logo_ruxcjj.png" alt="Graba2z Logo" />
              </a>
            </div>
            <div class="content">
              <h2>Email Verification</h2>
              <p>Hi <b>${data.name || "User"}</b>,<br />
              Thank you for registering with Graba2z. Please verify your email address by entering the verification code below:</p>
              <div class="code-box">${data.code || "000000"}</div>
              <p style="margin: 16px 0 0 0; color: #1abc7b; font-weight: bold;">
                Copy the code above and paste it on the website to verify your email.
              </p>
              <p style="margin-top: 2em; color: #888; font-size: 1em;">This code will expire in 10 minutes.<br />If you didn't create an account with us, please ignore this email.</p>
            </div>
            <div class="footer">
              <div class="socials">
                <a href="https://www.facebook.com/grabatozae/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_1_axvzvv.jpg" alt="Facebook" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.instagram.com/grabatoz/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107124/WhatsApp_Image_2025-07-21_at_7.10.18_AM_xgjv5f.jpg" alt="Instagram" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://x.com/GrabAtoz" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107545/WhatsApp_Image_2025-07-21_at_7.10.18_AM_2_cwzjg6.png" alt="X" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.linkedin.com/company/grabatozae" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_3_ll6y2i.jpg" alt="LinkedIn" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
              </div>
              <p>This email was sent by: support@grabatoz.ae</p>
              <br/>
              <p>Kindly Do Not Reply to this Email</p>
              <br/>
              <div style="margin-top: 10px; color: #888;">
                &copy; 2025 Graba2z. All rights reserved.<br />
                <span style="font-size:12px;">If you did not enter this email address when signing up for Graba2z, disregard this message.</span>
              </div>
            </div>
          </div>
        </body>
        </html>
      `

    case "orderConfirmation":
      const orderItems = Array.isArray(data.orderItems) ? data.orderItems : []
      const orderItemsHtml = orderItems
        .map(
          (item) => `
        <div class="product-item">
          <img src="${item.product?.image || item.image || "/placeholder.svg?height=80&width=80"}" alt="${item.product?.name || item.name || "Product"}" class="product-image" />
          <div class="product-details">
            <div class="product-name">${item.product?.name || item.name || "Product"}</div>
            <div class="product-quantity">Quantity: ${item.quantity || 1}</div>
            <div class="product-price">${(item.price || 0).toFixed(2)}AED</div>
          </div>
        </div>
      `,
        )
        .join("")

      const subtotal = data.itemsPrice || 0
      const shipping = data.shippingPrice || 0
      const total = data.totalPrice || 0
      const vatAmount = (total * 0.05).toFixed(2) // Assuming 5% VAT

      // Get customer info based on delivery type
      const customerName = data.shippingAddress?.name || data.pickupDetails?.name || data.customerName || "Customer"
      const customerEmail = data.shippingAddress?.email || data.pickupDetails?.email || data.customerEmail || ""
      const customerPhone = data.shippingAddress?.phone || data.pickupDetails?.phone || ""

      const billingAddress = data.shippingAddress || data.pickupDetails || {}
      const shippingAddress = data.deliveryType === "pickup" ? data.pickupDetails : data.shippingAddress

      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>Order Confirmation</title>
          <style>
            body {
              background-color: #e8f7ee;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 0;
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
              background-color: #fff;
              padding: 32px 0 16px 0;
              text-align: center;
              border-bottom: 1px solid #e0e0e0;
            }
            .header a {
              display: inline-block;
            }
            .header img {
              max-height: 60px;
            }
            .order-icon {
              width: 80px;
              height: 80px;
              background-color: #2c3e50;
              border-radius: 50%;
              margin: 20px auto 0 auto;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 30px;
            }
            .content {
              padding: 40px 30px 32px 30px;
              background: #fff;
            }
            .order-number {
              font-size: 24px;
              font-weight: bold;
              color: #333;
              text-align: center;
              margin-bottom: 20px;
            }
            .greeting {
              font-size: 18px;
              text-align: center;
              margin-bottom: 10px;
              color: #333;
            }
            .processing-text {
              font-size: 16px;
              text-align: center;
              color: #666;
              margin-bottom: 30px;
            }
            .action-buttons {
              text-align: center;
              margin: 30px 0;
            }
            .button {
              display: inline-block;
              background-color: #8BC34A;
              color: white;
              padding: 15px 30px;
              text-decoration: none;
              border-radius: 25px;
              font-weight: bold;
              font-size: 14px;
              margin: 5px 10px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .button:hover {
              background-color: #7CB342;
            }
            .product-section {
              margin: 30px 0;
              padding: 20px;
              background-color: #f9f9f9;
              border-radius: 8px;
            }
            .product-item {
              display: flex;
              align-items: center;
              margin-bottom: 20px;
              padding-bottom: 20px;
              border-bottom: 1px solid #eee;
            }
            .product-item:last-child {
              border-bottom: none;
              margin-bottom: 0;
              padding-bottom: 0;
            }
            .product-image {
              width: 80px;
              height: 80px;
              object-fit: cover;
              border-radius: 8px;
              margin-right: 15px;
              background-color: #f0f0f0;
            }
            .product-details {
              flex: 1;
            }
            .product-name {
              font-weight: bold;
              font-size: 16px;
              color: #333;
              margin-bottom: 5px;
              line-height: 1.4;
            }
            .product-quantity {
              color: #666;
              font-size: 14px;
              margin-bottom: 5px;
            }
            .product-price {
              font-weight: bold;
              color: #8BC34A;
              font-size: 16px;
            }
            .order-summary {
              background-color: #f9f9f9;
              padding: 20px;
              border-radius: 8px;
              margin: 20px 0;
            }
            .summary-row {
              display: flex;
              justify-content: space-between;
              margin-bottom: 10px;
              font-size: 16px;
            }
            .summary-row.total {
              font-weight: bold;
              font-size: 18px;
              color: #333;
              border-top: 1px solid #ddd;
              padding-top: 10px;
              margin-top: 15px;
            }
            .vat-note {
              font-size: 14px;
              color: #666;
              text-align: right;
              margin-top: 5px;
            }
            .info-section {
              margin: 20px 0;
            }
            .info-title {
              font-weight: bold;
              font-size: 18px;
              color: #333;
              margin-bottom: 15px;
            }
            .info-content {
              background-color: #f9f9f9;
              padding: 15px;
              border-radius: 8px;
              font-size: 14px;
              line-height: 1.6;
            }
            .address-section {
              display: flex;
              gap: 20px;
              margin: 20px 0;
            }
            .address-block {
              flex: 1;
            }
            .footer {
              background-color: #e8f7ee;
              padding: 32px 20px 20px 20px;
              text-align: center;
              font-size: 13px;
              color: #888;
            }
            .footer .socials {
              margin: 18px 0 10px 0;
            }
            .footer .socials a {
              display: inline-block;
              margin: 0 10px;
              text-decoration: none;
            }
            .footer .socials img {
              width: 32px;
              height: 32px;
              vertical-align: middle;
              border-radius: 50%;
              background: #fff;
              box-shadow: 0 2px 8px rgba(0,0,0,0.04);
              transition: box-shadow 0.2s;
            }
            .footer .socials img:hover {
              box-shadow: 0 4px 16px rgba(26,188,123,0.15);
            }
            @media (max-width: 600px) {
              .container { border-radius: 0; margin: 0; }
              .content { padding: 24px 8px 24px 8px; }
              .footer { padding: 24px 4px 12px 4px; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <a href="https://www.graba2z.ae/" target="_blank">
                <img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753105567/admin-logo_ruxcjj.png" alt="Graba2z Logo" />
              </a>
              <div class="order-icon">🛒</div>
            </div>
            <div class="content">
              <div class="order-number">Order #${data.orderNumber || data._id?.toString().slice(-6) || "N/A"}</div>
              <div class="greeting">Hi ${customerName}, Thank you for your purchase.</div>
              <div class="processing-text">We are processing your order.</div>
              <div class="action-buttons">
                <a href="${process.env.FRONTEND_URL || "https://graba2z.ae"}" class="button">Visit Website</a>
                <a href="${process.env.FRONTEND_URL || "https://graba2z.ae"}/track-order" class="button">Track Your Order</a>
              </div>
              ${
                orderItems.length > 0
                  ? `
              <div class="product-section">
                ${orderItemsHtml}
              </div>
              `
                  : ""
              }
              <div class="info-section">
                <div class="info-title">Payment Method</div>
                <div class="info-content">${data.paymentMethod || "Cash on delivery"}</div>
              </div>
              <div class="info-section">
                <div class="info-title">Shipment Method</div>
                <div class="info-content">${data.deliveryType === "pickup" ? "Store Pickup" : "Home Delivery"}</div>
              </div>
              ${
                data.customerNotes
                  ? `
              <div class="info-section">
                <div class="info-title">Note</div>
                <div class="info-content">${data.customerNotes}</div>
              </div>
              `
                  : ""
              }
              <div class="order-summary">
                <div class="summary-row">
                  <span>Subtotal</span>
                  <span>${subtotal.toFixed(2)}AED</span>
                </div>
                <div class="summary-row">
                  <span>Shipping</span>
                  <span>${shipping.toFixed(2)}AED</span>
                </div>
                <div class="summary-row total">
                  <span>Total</span>
                  <span>${total.toFixed(2)}AED</span>
                </div>
                <div class="vat-note">(includes ${vatAmount}AED VAT)</div>
              </div>
              <div class="address-section">
                <div class="address-block">
                  <div class="info-title">Billing Address</div>
                  <div class="info-content">
                    ${billingAddress.name || customerName}<br>
                    ${billingAddress.address || "N/A"}<br>
                    ${billingAddress.city || "N/A"}<br>
                    ${billingAddress.phone || customerPhone}<br>
                    ${billingAddress.email || customerEmail}
                  </div>
                </div>
                <div class="address-block">
                  <div class="info-title">${data.deliveryType === "pickup" ? "Pickup Location" : "Shipping Address"}</div>
                  <div class="info-content">
                    ${shippingAddress?.name || customerName}<br>
                    ${shippingAddress?.address || shippingAddress?.location || "N/A"}<br>
                    ${shippingAddress?.city || "N/A"}<br>
                    ${shippingAddress?.phone || customerPhone}
                  </div>
                </div>
              </div>
            </div>
            <div class="footer">
              <div class="socials">
                <a href="https://www.facebook.com/grabatozae/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_1_axvzvv.jpg" alt="Facebook" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.instagram.com/grabatoz/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107124/WhatsApp_Image_2025-07-21_at_7.10.18_AM_xgjv5f.jpg" alt="Instagram" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://x.com/GrabAtoz" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107545/WhatsApp_Image_2025-07-21_at_7.10.18_AM_2_cwzjg6.png" alt="X" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.linkedin.com/company/grabatozae" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_3_ll6y2i.jpg" alt="LinkedIn" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
              </div>
              <p>This email was sent by: order@grabatoz.ae</p>
              <br/>
              <p>Kindly Do Not Reply to this Email</p>
              <br/>
              <div style="margin-top: 10px; color: #888;">
                &copy; 2025 Graba2z. All rights reserved.<br />
                <span style="font-size:12px;">If you did not enter this email address when signing up for Graba2z, disregard this message.</span>
              </div>
            </div>
          </div>
        </body>
        </html>
      `

    case "orderStatusUpdate":
      // Status icon and label for current status only
      const statusSteps = [
        { key: "Processing", label: "Processing", icon: "⚙️" },
        { key: "Confirmed", label: "Confirmed", icon: "✅" },
        { key: "Shipped", label: "Shipped", icon: "📦" },
        { key: "Out for Delivery", label: "Out for Delivery", icon: "🚚" },
        { key: "Delivered", label: "Delivered", icon: "🎉" },
        { key: "Cancelled", label: "Cancelled", icon: "❌" },
      ]
      const getCurrentStep = (status) => {
        if (!status) return statusSteps[0]
        const normalized = status.trim().toLowerCase()
        if (normalized === "processing") return statusSteps[0]
        if (normalized === "confirmed") return statusSteps[1]
        if (normalized === "shipped") return statusSteps[2]
        if (normalized === "out for delivery") return statusSteps[3]
        if (normalized === "delivered") return statusSteps[4]
        if (normalized === "cancelled") return statusSteps[5]
        return statusSteps[0]
      }
      const currentStep = getCurrentStep(data.status)
      // Order summary table (scoped variables)
      const statusOrderItems = Array.isArray(data.orderItems) ? data.orderItems : []
      const statusOrderItemsHtml = statusOrderItems
        .map((item) => {
          // Truncate product name to two lines (max 80 chars)
          let name = item.product?.name || item.name || "Product"
          if (name.length > 80) name = name.slice(0, 77) + "..."
          return `
          <tr style="border-bottom:1px solid #eee;">
            <td style="padding:10px 0;"><img src="${item.product?.image || item.image || "/placeholder.svg?height=80&width=80"}" alt="${name}" style="width:48px;height:48px;border-radius:8px;object-fit:cover;background:#f0f0f0;" /></td>
            <td style="padding:10px 0 10px 12px;font-size:15px;color:#222;max-width:220px;line-height:1.3;">${name}</td>
            <td style="padding:10px 0;font-size:15px;color:#333;">AED ${(item.price || 0).toFixed(2)}</td>
            <td style="padding:10px 0;font-size:15px;color:#333;">${item.quantity || 1}</td>
          </tr>
        `
        })
        .join("")
      const statusSubtotal = data.itemsPrice || 0
      const statusShipping = data.shippingPrice || 0
      const statusTotal = data.totalPrice || 0
      const statusVatAmount = (statusTotal * 0.05).toFixed(2)
      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>Order Status Update</title>
          <style>
            body { background-color: #e8f7ee; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 32px auto; background-color: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,0.08); border: 1px solid #e0e0e0; }
            .action-buttons {
              text-align: center;
              margin: 30px 0;
            }
            .button {
              display: inline-block;
              background-color: #8BC34A;
              color: white;
              padding: 15px 30px;
              text-decoration: none;
              border-radius: 25px;
              font-weight: bold;
              font-size: 14px;
              margin: 5px 10px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }
            .header { background-color: #fff; padding: 32px 0 16px 0; text-align: center; border-bottom: 1px solid #e0e0e0; }
            .header a { display: inline-block; }
            .header img { max-height: 60px; }
            .order-icon { width: 80px; height: 80px; background-color: #2c3e50; border-radius: 50%; margin: 20px auto 0 auto; display: flex; align-items: center; justify-content: center; color: white; font-size: 30px; }
            .content { padding: 40px 30px 32px 30px; background: #fff; }
            .order-number { font-size: 24px; font-weight: bold; color: #333; text-align: center; margin-bottom: 20px; }
            .greeting { font-size: 18px; text-align: center; margin-bottom: 10px; color: #333; }
            .processing-text { font-size: 16px; text-align: center; color: #666; margin-bottom: 30px; }
            .status-badge { display: flex; align-items: center; justify-content: center; margin: 24px 0 24px 0; }
            .status-icon { width: 54px; height: 54px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 32px; font-weight: bold; background: #8BC34A; color: #fff; margin-right: 16px; box-shadow: 0 2px 8px #8BC34A33; }
            .status-label { font-size: 20px; font-weight: bold; color: #689f38; letter-spacing: 0.2px; }
            .order-summary-table { width: 100%; border-collapse: collapse; margin: 30px 0 10px 0; }
            .order-summary-table th { background: #f9f9f9; color: #333; font-size: 15px; font-weight: 600; padding: 10px 0; border-bottom: 2px solid #e0e0e0; }
            .order-summary-table td { text-align: center; }
            .order-summary-totals { width: 100%; margin-top: 10px; }
            .order-summary-totals td { font-size: 15px; padding: 6px 0; color: #333; }
            .order-summary-totals .total { font-weight: bold; font-size: 17px; color: #689f38; }
            .order-summary-totals .vat { font-size: 13px; color: #888; text-align: right; }
            .footer { background-color: #e8f7ee; padding: 32px 20px 20px 20px; text-align: center; font-size: 13px; color: #888; }
            .footer .socials { margin: 18px 0 10px 0; }
            .footer .socials a { display: inline-block; margin: 0 10px; text-decoration: none; }
            .footer .socials img { width: 32px; height: 32px; vertical-align: middle; border-radius: 50%; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.04); transition: box-shadow 0.2s; }
            .footer .socials img:hover { box-shadow: 0 4px 16px rgba(26,188,123,0.15); }
            @media (max-width: 600px) { .container { border-radius: 0; margin: 0; } .content { padding: 24px 8px 24px 8px; } .footer { padding: 24px 4px 12px 4px; } }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <a href="https://www.graba2z.ae/" target="_blank">
                <img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753105567/admin-logo_ruxcjj.png" alt="Graba2z Logo" />
              </a>
            </div>
            <div class="content">
              <div class="order-number">Order #${data.orderNumber || data._id?.toString().slice(-6) || "N/A"}</div>
              <div class="greeting">Hello ${data.customerName || "Customer"}!</div>
              <div class="processing-text">Your order status has been updated.</div>
              <div class="status-badge">
                <div class="status-icon">${currentStep.icon}</div>
                <span class="status-label">${currentStep.label}</span>
              </div>
              <table class="order-summary-table">
                <tr>
                  <th>Image</th>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Qty</th>
                </tr>
                ${statusOrderItemsHtml}
              </table>
              <table class="order-summary-totals">
                <tr><td style="text-align:right;">Subtotal:</td><td style="text-align:right;">AED ${statusSubtotal.toFixed(2)}</td></tr>
                <tr><td style="text-align:right;">Shipping:</td><td style="text-align:right;">AED ${statusShipping.toFixed(2)}</td></tr>
                <tr class="total"><td style="text-align:right;">Total:</td><td style="text-align:right;">AED ${statusTotal.toFixed(2)}</td></tr>
                <tr><td colspan="2" class="vat">(includes ${statusVatAmount} AED VAT)</td></tr>
              </table>
              <div class="action-buttons">
                <a href="${process.env.FRONTEND_URL || "https://graba2z.ae"}/track-order" class="button">Track Your Order</a>
              </div>
            </div>
            <div class="footer">
              <div class="socials">
                <a href="https://www.facebook.com/grabatozae/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_1_axvzvv.jpg" alt="Facebook" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.instagram.com/grabatoz/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107124/WhatsApp_Image_2025-07-21_at_7.10.18_AM_xgjv5f.jpg" alt="Instagram" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://x.com/GrabAtoz" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107545/WhatsApp_Image_2025-07-21_at_7.10.18_AM_2_cwzjg6.png" alt="X" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.linkedin.com/company/grabatozae" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_3_ll6y2i.jpg" alt="LinkedIn" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
              </div>
              <p>This email was sent by: order@grabatoz.ae</p>
              <br/>
              <p>Kindly Do Not Reply to this Email</p>
              <br/>
              <div style="margin-top: 10px; color: #888;">
                &copy; 2025 Graba2z. All rights reserved.<br />
                <span style="font-size:12px;">If you did not enter this email address when signing up for Graba2z, disregard this message.</span>
              </div>
            </div>
          </div>
        </body>
        </html>
      `

    case "reviewVerification":
      return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
          <title>Review Verification</title>
          <style>
            body {
              background-color: #e8f7ee;
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              margin: 0;
              padding: 0;
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
              background-color: #fff;
              padding: 32px 0 16px 0;
              text-align: center;
              border-bottom: 1px solid #e0e0e0;
            }
            .header a {
              display: inline-block;
            }
            .header img {
              max-height: 60px;
            }
            .content {
              padding: 40px 30px 32px 30px;
              text-align: center;
            }
            .content h2 {
              color: #222;
              font-size: 1.5rem;
              margin-bottom: 0.5em;
            }
            .content p {
              color: #444;
              font-size: 1.1rem;
              margin: 0.5em 0 1.5em 0;
            }
            .code-box {
              background: #f4f4f4;
              border-radius: 10px;
              margin: 32px auto 24px auto;
              padding: 24px 0;
              font-size: 2.2rem;
              font-weight: bold;
              color: #1abc7b;
              letter-spacing: 10px;
              max-width: 320px;
            }
            .product-info {
              background: #f9f9f9;
              border-radius: 8px;
              padding: 20px;
              margin: 20px 0;
              text-align: left;
            }
            .footer {
              background-color: #e8f7ee;
              padding: 32px 20px 20px 20px;
              text-align: center;
              font-size: 13px;
              color: #888;
            }
            .footer .socials {
              margin: 18px 0 10px 0;
            }
            .footer .socials a {
              display: inline-block;
              margin: 0 10px;
              text-decoration: none;
            }
            .footer .socials img {
              width: 32px;
              height: 32px;
              vertical-align: middle;
              border-radius: 50%;
              background: #fff;
              box-shadow: 0 2px 8px rgba(0,0,0,0.04);
              transition: box-shadow 0.2s;
            }
            .footer .socials img:hover {
              box-shadow: 0 4px 16px rgba(26,188,123,0.15);
            }
            @media (max-width: 600px) {
              .container { border-radius: 0; margin: 0; }
              .content { padding: 24px 8px 24px 8px; }
              .footer { padding: 24px 4px 12px 4px; }
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <a href="https://www.graba2z.ae/" target="_blank">
                <img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753105567/admin-logo_ruxcjj.png" alt="Graba2z Logo" />
              </a>
            </div>
            <div class="content">
              <h2>Verify Your Review</h2>
              <p>Hi <b>${data.name || "Customer"}</b>,<br />
              Thank you for taking the time to review our product. Please verify your email address by entering the verification code below:</p>
              <div class="code-box">${data.code || "000000"}</div>
              <div class="product-info">
                <strong>Product:</strong> ${data.productName || "Product"}<br />
                <strong>Your Rating:</strong> ${data.rating || 5}/5 stars<br />
                <strong>Your Review:</strong> "${data.comment || "No comment"}"
              </div>
              <p style="margin: 16px 0 0 0; color: #1abc7b; font-weight: bold;">
                Copy the code above and paste it on the website to verify and publish your review.
              </p>
              <p style="margin-top: 2em; color: #888; font-size: 1em;">This code will expire in 10 minutes.<br />If you didn't submit this review, please ignore this email.</p>
            </div>
            <div class="footer">
              <div class="socials">
                <a href="https://www.facebook.com/grabatozae/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_1_axvzvv.jpg" alt="Facebook" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.instagram.com/grabatoz/" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107124/WhatsApp_Image_2025-07-21_at_7.10.18_AM_xgjv5f.jpg" alt="Instagram" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://x.com/GrabAtoz" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107545/WhatsApp_Image_2025-07-21_at_7.10.18_AM_2_cwzjg6.png" alt="X" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
                <a href="https://www.linkedin.com/company/grabatozae" target="_blank"><img src="https://res.cloudinary.com/dyfhsu5v6/image/upload/v1753107123/WhatsApp_Image_2025-07-21_at_7.10.18_AM_3_ll6y2i.jpg" alt="LinkedIn" style="width:32px;height:32px;margin:0 10px;vertical-align:middle;background:transparent;border-radius:8px;box-shadow:none;" /></a>
              </div>
              <p>This email was sent by: support@grabatoz.ae</p>
              <br/>
              <p>Kindly Do Not Reply to this Email</p>
              <br/>
              <div style="margin-top: 10px; color: #888;">
                &copy; 2025 Graba2z. All rights reserved.<br />
                <span style="font-size:12px;">If you did not submit this review, disregard this message.</span>
              </div>
            </div>
          </div>
        </body>
        </html>
      `

    default:
      return `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Graba2z</title>
          ${baseStyle}
        </head>
        <body>
          <div class="email-container">
            <div class="header">
              <img src="https://graba2z.ae/logo.png" alt="Graba2z" class="logo" />
            </div>
            <div class="content">
              <p>Thank you for choosing Graba2z!</p>
            </div>
            <div class="footer">
              <h3>Get in Touch</h3>
              <div class="social-icons">
                <a href="https://facebook.com/graba2z" class="social-icon">f</a>
                <a href="https://twitter.com/graba2z" class="social-icon">t</a>
                <a href="https://instagram.com/graba2z" class="social-icon">@</a>
                <a href="https://linkedin.com/company/graba2z" class="social-icon">in</a>
              </div>
              <div class="contact-info">
                <p><strong>This email was sent by:</strong><br>
                <a href="mailto:order@grabatoz.ae">order@grabatoz.ae</a></p>
                <p><strong>For any questions please send an email to:</strong><br>
                <a href="mailto:support@grabatoz.ae">support@grabatoz.ae</a></p>
              </div>
            </div>
          </div>
        </body>
        </html>
      `
  }
}

// Generic send email function with sender type
const sendEmail = async (to, subject, html, senderType = "support") => {
  try {
    const { transporter, from } = getMailConfig(senderType)
    if (senderType === "support") {
      console.log("[DEBUG] SUPPORT_EMAIL_USER:", process.env.SUPPORT_EMAIL_USER)
    }
    const mailOptions = {
      from,
      to,
      subject,
      html,
    }
    const result = await transporter.sendMail(mailOptions)
    console.log(`Email sent successfully from ${from}:`, result.messageId)
    return { success: true, messageId: result.messageId }
  } catch (error) {
    console.error("Failed to send email:", error)
    throw new Error(`Email sending failed: ${error.message}`)
  }
}

// Send verification email
export const sendVerificationEmail = async (email, name, code) => {
  try {
    const html = getEmailTemplate("emailVerification", { name, code })
    await sendEmail(email, "Verify Your Email - Graba2z", html, "support")
    return { success: true }
  } catch (error) {
    console.error("Failed to send verification email:", error)
    throw error
  }
}

// Send order placed email
export const sendOrderPlacedEmail = async (order) => {
  try {
    const orderNumber = order._id.toString().slice(-6)
    const customerName = order.shippingAddress?.name || order.pickupDetails?.name || "Customer"
    const customerEmail = order.shippingAddress?.email || order.pickupDetails?.email || order.user?.email

    if (!customerEmail) {
      console.error("No customer email found for order:", order._id)
      return { success: false, error: "No customer email" }
    }

    const html = getEmailTemplate("orderConfirmation", {
      ...order.toObject(),
      orderNumber,
      customerName,
      customerEmail,
    })

    await sendEmail(customerEmail, `Order Confirmation #${orderNumber} - Graba2z`, html, "order")
    return { success: true }
  } catch (error) {
    console.error("Failed to send order placed email:", error)
    throw error
  }
}

// Send order status update email
export const sendOrderStatusUpdateEmail = async (order) => {
  try {
    const orderNumber = order._id.toString().slice(-6)
    const customerName = order.shippingAddress?.name || order.pickupDetails?.name || order.user?.name || "Customer"
    const customerEmail = order.shippingAddress?.email || order.pickupDetails?.email || order.user?.email

    if (!customerEmail) {
      console.error("No customer email found for order:", order._id)
      return { success: false, error: "No customer email" }
    }

    const html = getEmailTemplate("orderStatusUpdate", {
      ...order.toObject(),
      orderNumber,
      customerName,
    })

    const statusMessages = {
      processing: "Order is Being Processed",
      confirmed: "Order Confirmed",
      shipped: "Order Shipped",
      delivered: "Order Delivered",
      cancelled: "Order Cancelled",
    }

    const subject = `${statusMessages[order.status] || "Order Update"} #${orderNumber} - Graba2z`
    await sendEmail(customerEmail, subject, html, "order")
    return { success: true }
  } catch (error) {
    console.error("Failed to send order status update email:", error)
    throw error
  }
}

// Send review verification email
export const sendReviewVerificationEmail = async (email, name, code, productName, rating, comment) => {
  try {
    const html = getEmailTemplate("reviewVerification", { name, code, productName, rating, comment })
    await sendEmail(email, "Verify Your Product Review - Graba2z", html, "support")
    return { success: true }
  } catch (error) {
    console.error("Failed to send review verification email:", error)
    throw error
  }
}

// Backward compatibility exports
export const sendOrderNotification = sendOrderStatusUpdateEmail
export const sendTrackingUpdateEmail = sendOrderStatusUpdateEmail

export const sendNewsletterConfirmation = async (email, preferences) => {
  const html = `
    <div>
      <h2>Thank you for subscribing to our newsletter!</h2>
      <p>Your preferences: <b>${(preferences || []).join(", ")}</b></p>
      <p>You will now receive updates according to your selected preferences.</p>
      <p style="color: #888; font-size: 13px; margin-top: 24px;">This is an automated message. Please do not reply.</p>
    </div>
  `
  await sendEmail(email, "Newsletter Subscription Confirmed - Graba2z", html, "support")
}

export const sendResetPasswordEmail = async (email, name, resetLink) => {
  try {
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; background: #fff; border-radius: 8px; box-shadow: 0 2px 8px #eee; padding: 32px;">
        <h2 style="color: #2c3e50;">Reset Your Password</h2>
        <p>Hi ${name || "User"},</p>
        <p>We received a request to reset your password. Click the button below to set a new password. This link is valid for 60 minutes.</p>
        <a href="${resetLink}" style="display: inline-block; margin: 24px 0; padding: 12px 24px; background: #84cc16; color: #fff; border-radius: 4px; text-decoration: none; font-weight: bold;">Reset Password</a>
        <p>If you did not request this, you can safely ignore this email.</p>
        <p style="color: #888; font-size: 12px; margin-top: 32px;">&copy; ${new Date().getFullYear()} Graba2z</p>
      </div>
    `
    await sendEmail(email, "Reset Your Password - Graba2z", html, "support")
    return { success: true }
  } catch (error) {
    console.error("Failed to send reset password email:", error)
    throw error
  }
}

export { sendEmail }

export default {
  sendVerificationEmail,
  sendOrderPlacedEmail,
  sendOrderStatusUpdateEmail,
  sendOrderNotification,
  sendTrackingUpdateEmail,
  sendNewsletterConfirmation,
  sendReviewVerificationEmail,
}
