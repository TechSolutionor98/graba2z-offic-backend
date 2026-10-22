import express from "express";
import EmailTemplate from "../models/emailTemplateModel.js";
import asyncHandler from "express-async-handler";
import { protect, admin } from "../middleware/authMiddleware.js";
import { sendEmail } from "../utils/emailService.js";
import dns from "dns/promises";
import net from "net";

const router = express.Router();

// Reading a template is open -- the admin newsletter screen and the template
// list both fetch without a token. Writing one is not: these endpoints accepted
// anonymous POST, PUT, PATCH and DELETE, so anyone who knew the URL could add,
// rewrite or delete the emails this shop sends its customers.
const adminOnly = [protect, admin];

// Get all templates
router.get("/", asyncHandler(async (req, res) => {
  const templates = await EmailTemplate.find().sort({ createdAt: -1 });
  res.json(templates);
}));

// Get templates by type
router.get("/type/:type", asyncHandler(async (req, res) => {
  const templates = await EmailTemplate.find({ type: req.params.type });
  res.json(templates);
}));

// Get template by id
router.get("/:id", asyncHandler(async (req, res) => {
  const template = await EmailTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ message: "Not found" });
  res.json(template);
}));

// Create template
router.post("/", ...adminOnly, asyncHandler(async (req, res) => {
  const { name, type, subject, html, isDefault, isDraft, blocks, settings } = req.body;
  // Said here in plain words rather than left to the database, whose own message
  // means nothing to the person who just pressed Save. A draft is exempt -- see
  // the model. A subject is not checked at all: a template no longer carries
  // one, because the campaign that sends it decides what the subject says.
  if (!isDraft) {
    if (!String(name || "").trim()) {
      res.status(400);
      throw new Error("Give the template a name before saving it.");
    }
    if (!String(html || "").trim()) {
      res.status(400);
      throw new Error("The template is empty. Add some content before saving it.");
    }
  }

  if (isDefault) {
    // Unset previous default for this type
    await EmailTemplate.updateMany({ type, isDefault: true }, { $set: { isDefault: false } });
  }
  const template = await EmailTemplate.create({ name, type, subject, html, isDefault, isDraft, blocks, settings });
  res.status(201).json(template);
}));

/**
 * Is this address one the server should be fetching on a stranger's behalf?
 *
 * Fetching a URL the browser supplies turns the server into a proxy that sits
 * inside the network. Without this check, "import from URL" would happily read
 * http://127.0.0.1:5000/api/..., a database admin page, or a cloud provider's
 * metadata endpoint at 169.254.169.254 -- all of which the browser itself could
 * never reach. Every hostname is resolved and every resulting address checked.
 */
const isPrivateAddress = (ip) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true; // cloud metadata
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    return false;
  }
  const lower = String(ip).toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique local
  if (lower.startsWith("fe80")) return true; // link local
  // An IPv4 address wearing an IPv6 hat.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  return false;
};

const assertFetchable = async (raw) => {
  let url;
  try {
    url = new URL(String(raw).trim());
  } catch {
    throw new Error("That does not look like a web address.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Only http and https addresses can be imported.");
  }
  const resolved = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (resolved.length === 0) throw new Error("That address could not be found.");
  if (resolved.some((entry) => isPrivateAddress(entry.address))) {
    throw new Error("That address is on a private network and cannot be imported.");
  }
  return url;
};

// @desc    Read an email template from a public web address
// @route   POST /api/email-templates/import-url
// @access  Private/Admin
router.post("/import-url", ...adminOnly, asyncHandler(async (req, res) => {
  const url = await assertFetchable(req.body.url);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    // Redirects are not followed: each hop would need checking again, and a
    // public address redirecting to an internal one is the standard way around
    // exactly the check above.
    const response = await fetch(url, { signal: controller.signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      return res.status(400).json({ message: "That address redirects elsewhere. Use the address it points at." });
    }
    if (!response.ok) {
      return res.status(400).json({ message: `That address answered ${response.status}.` });
    }
    const html = await response.text();
    if (html.length > 2 * 1024 * 1024) {
      return res.status(413).json({ message: "That page is too large to import." });
    }
    res.json({ html });
  } catch (error) {
    res.status(400).json({
      message: error.name === "AbortError" ? "That address took too long to answer." : "That address could not be read.",
    });
  } finally {
    clearTimeout(timeout);
  }
}));

// @desc    Send one template to one address, to see how it really lands
// @route   POST /api/email-templates/test-send
// @access  Private/Admin
//
// A preview in an iframe is a browser rendering the markup. What matters is what
// Gmail and Outlook do to it, and the only way to know that is to send one.
router.post("/test-send", ...adminOnly, asyncHandler(async (req, res) => {
  const { to, subject, html } = req.body;

  const address = String(to || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(address)) {
    return res.status(400).json({ message: "Enter a valid email address to send the test to." });
  }
  if (!html || !String(html).trim()) {
    return res.status(400).json({ message: "There is nothing to send yet." });
  }

  // A plain-text alternative. An HTML-only message with a lot of markup and few
  // words is a long-standing spam signal, and some clients show nothing at all
  // without one -- which looks exactly like the email never arriving.
  const text = String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    // A closing tag leaves the newline, the next opening tag leaves a space --
    // so every line would start indented by one.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const result = await sendEmail(address, `[Test] ${subject || "Email template"}`, html, "support", { text });

  // The SMTP server names who it accepted. Saying "sent" when the recipient was
  // rejected is how a test that proves nothing still reports success.
  const accepted = (result.accepted || []).map((entry) => (typeof entry === "string" ? entry : entry?.address));
  if (!accepted.some((entry) => String(entry).toLowerCase() === address.toLowerCase())) {
    return res.status(502).json({
      message: `The mail server did not accept ${address}. ${result.response || ""}`.trim(),
    });
  }

  res.json({
    message: `Accepted by the mail server for ${address}.`,
    detail: `Sent from ${result.from}. Message id ${result.messageId}. If it does not arrive within a few minutes, check that mailbox for a bounce — the message has already left this server.`,
    messageId: result.messageId,
  });
}));

// Update template
router.put("/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const { name, type, subject, html, isDefault, isDraft, blocks, settings } = req.body;
  // Said here in plain words rather than left to the database, whose own message
  // means nothing to the person who just pressed Save. A draft is exempt -- see
  // the model. A subject is not checked at all: a template no longer carries
  // one, because the campaign that sends it decides what the subject says.
  if (!isDraft) {
    if (!String(name || "").trim()) {
      res.status(400);
      throw new Error("Give the template a name before saving it.");
    }
    if (!String(html || "").trim()) {
      res.status(400);
      throw new Error("The template is empty. Add some content before saving it.");
    }
  }

  if (isDefault) {
    await EmailTemplate.updateMany({ type, isDefault: true }, { $set: { isDefault: false } });
  }
  const template = await EmailTemplate.findByIdAndUpdate(
    req.params.id,
    { name, type, subject, html, isDefault, isDraft, blocks, settings },
    { new: true }
  );
  if (!template) return res.status(404).json({ message: "Not found" });
  res.json(template);
}));

// Delete template
router.delete("/:id", ...adminOnly, asyncHandler(async (req, res) => {
  const template = await EmailTemplate.findByIdAndDelete(req.params.id);
  if (!template) return res.status(404).json({ message: "Not found" });
  res.json({ message: "Deleted" });
}));

// Set default template for a type
router.patch("/:id/default", ...adminOnly, asyncHandler(async (req, res) => {
  const template = await EmailTemplate.findById(req.params.id);
  if (!template) return res.status(404).json({ message: "Not found" });
  await EmailTemplate.updateMany({ type: template.type, isDefault: true }, { $set: { isDefault: false } });
  template.isDefault = true;
  await template.save();
  res.json(template);
}));

export default router; 