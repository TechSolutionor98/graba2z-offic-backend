/**
 * Campaign sending.
 *
 * Three things here are deliberate and should not be loosened:
 *
 *  1. One person gets one email. Somebody who is a registered user, a
 *     newsletter subscriber and a bulk-purchase enquiry is one human being, and
 *     three copies of the same offer reads as spam to them and to Gmail.
 *  2. The unsubscribe list is checked again immediately before each send, not
 *     only when the audience was gathered. A campaign to several thousand
 *     people takes a while; opting out has to work during it.
 *  3. Sending is paced. A loop firing a few thousand messages at a shared
 *     mailbox provider is how a domain gets rate-limited or blocked, which
 *     costs far more than the campaign was worth.
 */

import crypto from "crypto";
import mongoose from "mongoose";

import User from "../models/userModel.js";
import NewsletterSubscriber from "../models/newsletterSubscriberModel.js";
import RequestCallback from "../models/requestCallbackModel.js";
import BulkPurchase from "../models/bulkPurchaseModel.js";
import EmailCampaign from "../models/emailCampaignModel.js";
import CampaignRecipient from "../models/campaignRecipientModel.js";
import EmailSuppression from "../models/emailSuppressionModel.js";
import { sendEmail } from "../utils/emailService.js";

export const SOURCE_LABELS = {
  users: "Users",
  newsletter: "Newsletter Subscribers",
  callbacks: "Request Callbacks",
  bulk: "Bulk Purchase",
};

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/** Lowercased and trimmed, so one person is one key however they typed it. */
export const normalizeEmail = (value) => String(value || "").trim().toLowerCase();

/**
 * Deliberately permissive: this rejects what cannot be an address at all, and
 * leaves the rest to the mail server. A stricter pattern here would silently
 * drop real customers, which is worse than one bounce.
 */
export const isValidEmail = (value) => {
  const email = normalizeEmail(value);
  if (!email || email.length > 254) return false;
  if (/\s/.test(email)) return false;
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;
  const domain = email.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
};

// ---------------------------------------------------------------------------
// Unsubscribe links
// ---------------------------------------------------------------------------

const secret = () => process.env.JWT_SECRET || "campaign-unsubscribe";

/**
 * A signed token rather than the bare address, so that following a link from
 * one person's email cannot unsubscribe somebody else by editing the URL.
 */
export const unsubscribeToken = (email, campaignId = "") => {
  const payload = `${normalizeEmail(email)}|${campaignId || ""}`;
  const body = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url").slice(0, 32);
  return `${body}.${sig}`;
};

export const verifyUnsubscribeToken = (token) => {
  const raw = String(token || "");
  const dot = raw.lastIndexOf(".");
  if (dot < 1) return null;

  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url").slice(0, 32);

  // Timing-safe: the comparison must not reveal how much of a guessed
  // signature was correct.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const [email, campaignId] = Buffer.from(body, "base64url").toString("utf8").split("|");
    if (!isValidEmail(email)) return null;
    return { email: normalizeEmail(email), campaignId: campaignId || null };
  } catch {
    return null;
  }
};

/**
 * Where the unsubscribe link in an email points.
 *
 * It must be the API host. This route is served by this server, not by the
 * storefront: a link built against the shop's own address lands in the React
 * app, which matches no route for it, pushes the locale prefix onto the path
 * and renders an empty page -- so the person clicks Unsubscribe, sees nothing
 * happen, and is never actually unsubscribed.
 *
 * That is exactly what happened when the environment variables below were
 * unset and this fell back to the storefront, so there is no storefront
 * fallback any more.
 */
export const unsubscribeUrl = (email, campaignId) => {
  // The shop's own site: the reader lands on a page that looks like us, with
  // the header and footer they know, and can carry on shopping from it.
  const origin = (process.env.PUBLIC_SITE_URL || "https://www.grabatoz.ae").replace(/\/+$/, "");
  return `${origin}/unsubscribe/${unsubscribeToken(email, campaignId)}`;
};

/**
 * The address for the List-Unsubscribe header.
 *
 * This one has to stay on the API. Gmail and Outlook POST to it themselves,
 * with no browser and no Javascript, so it cannot be a page in the shop's
 * single-page app -- there would be nothing there to answer them.
 */
export const oneClickUnsubscribeUrl = (email, campaignId) => {
  const configured = String(process.env.SERVER_PUBLIC_URL || process.env.API_URL || "").trim();
  const origin = (configured || "https://api.grabatoz.ae").replace(/\/+$/, "");
  return `${origin}/api/campaigns/unsubscribe/${unsubscribeToken(email, campaignId)}`;
};

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

const sourceReaders = {
  users: async ({ onlyVerifiedUsers, excludeAdmins }) => {
    const query = {};
    if (onlyVerifiedUsers) query.isEmailVerified = true;
    // Staff accounts are not an audience. Sending the shop's own promotions to
    // the people running the shop makes every campaign's numbers a lie.
    if (excludeAdmins !== false) query.isAdmin = { $ne: true };
    return User.find(query).select("name email").lean();
  },
  newsletter: async () => NewsletterSubscriber.find({}).select("email").lean(),
  callbacks: async () =>
    // Marked spam by staff means exactly that; it is not an audience.
    RequestCallback.find({ status: { $ne: "spam" } }).select("name email").lean(),
  bulk: async () => BulkPurchase.find({ status: { $ne: "spam" } }).select("name email").lean(),
};

/**
 * Everyone in the chosen lists, once each, before any filtering.
 *
 * Order matters: sources are read in the order given, and the first list an
 * address appears in is recorded as where it came from. That is only a label --
 * what matters is that later lists cannot add a second copy.
 *
 * Kept separate from collectAudience because the screen that lets somebody tick
 * individual addresses has to show the ones that would otherwise be dropped,
 * marked as dropped, rather than leaving a person wondering why a customer they
 * know about is missing from the list.
 */
const gather = async (sources = [], options = {}) => {
  const chosen = (Array.isArray(sources) ? sources : []).filter((s) => sourceReaders[s]);

  const seen = new Map();
  const counts = {};
  let invalid = 0;

  for (const source of chosen) {
    let rows = [];
    try {
      rows = await sourceReaders[source](options);
    } catch (err) {
      // One unreadable list must not cost the whole campaign its audience.
      console.error(`[campaign] could not read ${source}:`, err.message);
    }
    counts[source] = 0;

    for (const row of rows) {
      const email = normalizeEmail(row.email);
      if (!isValidEmail(email)) {
        invalid += 1;
        continue;
      }
      counts[source] += 1;
      if (seen.has(email)) continue;
      seen.set(email, { email, name: String(row.name || "").trim(), source });
    }
  }

  // One query rather than one per address: an audience of several thousand
  // would otherwise mean several thousand round trips before a single send.
  const addresses = [...seen.keys()];
  const blockedRows = addresses.length
    ? await EmailSuppression.find({ email: { $in: addresses } }).select("email").lean()
    : [];
  const blocked = new Set(blockedRows.map((row) => normalizeEmail(row.email)));

  return { seen, counts, invalid, blocked };
};

/**
 * True when this campaign sends to hand-picked addresses rather than to
 * everyone in the lists. An empty picked list in "pick" mode means nobody --
 * never everybody, which would be the dangerous way to read it.
 */
const isPickMode = (options = {}) => options.mode === "pick";

const pickedSet = (options = {}) =>
  new Set((Array.isArray(options.picked) ? options.picked : []).map(normalizeEmail));

/**
 * Who will actually be emailed: in the chosen lists, not opted out, and -- when
 * addresses were ticked by hand -- among those.
 *
 * @returns {Promise<{recipients: Array, counts: Object, suppressed: number, invalid: number}>}
 */
export const collectAudience = async (sources = [], options = {}) => {
  const { seen, counts, invalid, blocked } = await gather(sources, options);

  for (const email of blocked) seen.delete(email);

  // Applied after the lists are read, so an address ticked by hand and later
  // removed from every list -- or unsubscribed since -- cannot be emailed by
  // virtue of still sitting in the stored picked list.
  if (isPickMode(options)) {
    const picked = pickedSet(options);
    for (const email of [...seen.keys()]) {
      if (!picked.has(email)) seen.delete(email);
    }
  }

  return {
    recipients: [...seen.values()],
    counts,
    suppressed: blocked.size,
    invalid,
  };
};

/**
 * Which of the four lists each of these addresses appears on.
 *
 * Asked only about the addresses on one page of the report: checking the whole
 * suppression list would mean reading four collections end to end to render
 * fifty rows.
 *
 * @param {string[]} addresses
 * @returns {Promise<Record<string, string[]>>} address -> source keys
 */
export const listsContaining = async (addresses = []) => {
  const wanted = [...new Set(addresses.map(normalizeEmail).filter(Boolean))];
  const found = {};
  if (!wanted.length) return found;

  const collections = {
    users: User,
    newsletter: NewsletterSubscriber,
    callbacks: RequestCallback,
    bulk: BulkPurchase,
  };

  for (const [key, Model] of Object.entries(collections)) {
    try {
      // Case-insensitive, because these collections store whatever was typed.
      const rows = await Model.find({
        email: { $in: wanted.map((e) => new RegExp(`^${e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")) },
      })
        .select("email")
        .lean();

      for (const row of rows) {
        const email = normalizeEmail(row.email);
        if (!found[email]) found[email] = [];
        if (!found[email].includes(key)) found[email].push(key);
      }
    } catch (err) {
      // One unreadable list must not cost the report the other three.
      console.error(`[campaign] could not check ${key} for the report:`, err.message);
    }
  }

  return found;
};

/** Per-source totals and the real combined figure, for the audience screen. */
export const audienceSummary = async (sources, options) => {
  const { seen, counts, invalid, blocked } = await gather(sources, options);
  const raw = Object.values(counts).reduce((sum, n) => sum + n, 0);

  // Everyone the lists yield, before hand-picking: what "Select all" would mean.
  const available = seen.size - [...blocked].filter((e) => seen.has(e)).length;

  const { recipients } = await collectAudience(sources, options);

  return {
    counts,
    raw,
    available,
    unique: recipients.length,
    // What the person pressing Send actually wants to know: how many fewer
    // emails than the four list sizes added together, and why.
    duplicates: Math.max(0, raw - seen.size),
    suppressed: blocked.size,
    invalid,
    mode: isPickMode(options) ? "pick" : "all",
  };
};

/**
 * The addresses themselves, for the screen that ticks them one by one.
 *
 * Opted-out addresses are returned and flagged rather than hidden: somebody
 * looking for a particular customer needs to be told they unsubscribed, not
 * left to conclude the list is broken. They cannot be ticked.
 */
export const listAudience = async (sources = [], options = {}, { search = "", page = 1, limit = 100 } = {}) => {
  const { seen, blocked } = await gather(sources, options);

  const needle = String(search || "").trim().toLowerCase();
  let rows = [...seen.values()].map((row) => ({
    ...row,
    suppressed: blocked.has(row.email),
  }));

  if (needle) {
    rows = rows.filter(
      (row) => row.email.includes(needle) || row.name.toLowerCase().includes(needle)
    );
  }

  rows.sort((a, b) => a.email.localeCompare(b.email));

  const perPage = Math.min(500, Math.max(1, Number(limit) || 100));
  const current = Math.max(1, Number(page) || 1);
  const start = (current - 1) * perPage;

  return {
    rows: rows.slice(start, start + perPage),
    total: rows.length,
    page: current,
    pages: Math.ceil(rows.length / perPage) || 1,
    // Every address matching the search, so "select all" can mean all of them
    // and not merely the hundred currently on screen.
    allMatching: rows.filter((row) => !row.suppressed).map((row) => row.email),
  };
};

// ---------------------------------------------------------------------------
// Personalising
// ---------------------------------------------------------------------------

const escapeHtml = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/**
 * Fills the merge tokens the builder offers. Values are escaped: a customer
 * called O'Brien &amp; Sons must not be able to close a tag in the markup.
 */
export const personalize = (html, recipient, campaign) => {
  const name = recipient.name || "";
  const values = {
    "{{name}}": escapeHtml(name || "there"),
    "{{first_name}}": escapeHtml(name.split(/\s+/)[0] || "there"),
    "{{email}}": escapeHtml(recipient.email),
    "{{shop_name}}": "GrabAtoZ",
    // Not escaped through escapeHtml's quote rule by accident: it is a URL we
    // generated ourselves and it goes inside an href.
    "{{unsubscribe_url}}": unsubscribeUrl(recipient.email, campaign?._id || ""),
  };

  let out = String(html || "");
  for (const [token, value] of Object.entries(values)) {
    out = out.split(token).join(value);
  }
  return out;
};

/**
 * Marketing email without a way out is both unlawful in most of the places
 * these customers live and a fast route to a spam folder, so one is added when
 * the template has none rather than the send being refused.
 */
export const ensureUnsubscribe = (html, recipient, campaign) => {
  const url = unsubscribeUrl(recipient.email, campaign?._id || "");
  if (/unsubscribe/i.test(html)) return html;

  const footer =
    `<div style="padding:18px 24px;text-align:center;font-family:Arial,sans-serif;` +
    `font-size:12px;line-height:18px;color:#6b7280;">` +
    `You are receiving this because you dealt with GrabAtoZ. ` +
    `<a href="${url}" style="color:#6b7280;text-decoration:underline;">Unsubscribe</a>` +
    `</div>`;

  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : html + footer;
};

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Campaigns already running in this process. Pressing Send twice, or a second
// admin pressing it, must not start a second pass over the same list.
const running = new Set();

export const isRunning = (campaignId) => running.has(String(campaignId));

/**
 * Writes the chosen audience onto the campaign as individual rows.
 *
 * Existing rows are kept: re-gathering an audience for a campaign that already
 * went out partway must not resurrect people who were already emailed. The
 * unique index does the enforcing; this only avoids the pointless writes.
 */
export const prepareRecipients = async (campaign) => {
  const { recipients } = await collectAudience(campaign.audience?.sources || [], {
    onlyVerifiedUsers: campaign.audience?.onlyVerifiedUsers,
    excludeAdmins: campaign.audience?.excludeAdmins,
    mode: campaign.audience?.mode,
    picked: campaign.audience?.picked,
  });

  if (!recipients.length) return 0;

  const rows = recipients.map((r) => ({
    insertOne: {
      document: { campaign: campaign._id, email: r.email, name: r.name, source: r.source, status: "pending" },
    },
  }));

  try {
    // Unordered: a duplicate is an expected outcome here, not a failure, and
    // must not stop the addresses after it from being written.
    await CampaignRecipient.bulkWrite(rows, { ordered: false });
  } catch (err) {
    if (err?.code !== 11000 && !err?.writeErrors?.length) throw err;
  }

  return CampaignRecipient.countDocuments({ campaign: campaign._id });
};

/**
 * Walks the pending recipients, paced, until the list is done or the campaign
 * is paused. Never throws: it is started and left to run, so a thrown error
 * here would be an unhandled rejection and the campaign would simply stop with
 * no record of why.
 */
export const runCampaign = async (campaignId) => {
  const id = String(campaignId);
  if (running.has(id)) return;
  running.add(id);

  try {
    const campaign = await EmailCampaign.findById(id);
    if (!campaign) return;

    const gapMs = Math.max(100, Math.round(60000 / Math.max(1, campaign.throttlePerMinute || 30)));

    for (;;) {
      // Re-read the status each time around rather than trusting the copy we
      // started with: Pause has to take effect during the send, not after it.
      const current = await EmailCampaign.findById(id).select("status html subject sender").lean();
      if (!current || current.status !== "sending") break;

      const recipient = await CampaignRecipient.findOneAndUpdate(
        { campaign: id, status: "pending" },
        { $set: { status: "sending" } },
        { new: true }
      );
      if (!recipient) break;

      // The second suppression check, and the reason this one exists: the
      // audience may have been gathered hours ago.
      const blocked = await EmailSuppression.findOne({ email: recipient.email }).select("_id").lean();
      if (blocked) {
        await CampaignRecipient.updateOne(
          { _id: recipient._id },
          { $set: { status: "skipped", error: "Unsubscribed" } }
        );
        await EmailCampaign.updateOne({ _id: id }, { $inc: { "stats.skipped": 1 } });
        continue;
      }

      let body = personalize(current.html, recipient, { _id: id });
      body = ensureUnsubscribe(body, recipient, { _id: id });
      const subject = personalize(current.subject, recipient, { _id: id });

      try {
        const result = await sendEmail(recipient.email, subject, body, current.sender || "support", {
          // Gmail and Outlook both want a one-click opt-out from bulk senders,
          // and both treat its absence as a spam signal.
          headers: {
            "List-Unsubscribe": `<${oneClickUnsubscribeUrl(recipient.email, id)}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
          log: { source: "Campaign", campaign: id },
        });

        const accepted = Array.isArray(result?.accepted)
          ? result.accepted.some((a) => normalizeEmail(a) === recipient.email)
          : Boolean(result?.success);

        if (accepted) {
          await CampaignRecipient.updateOne(
            { _id: recipient._id },
            { $set: { status: "sent", messageId: result?.messageId || "", sentAt: new Date(), error: "" } }
          );
          await EmailCampaign.updateOne({ _id: id }, { $inc: { "stats.sent": 1 } });
        } else {
          await CampaignRecipient.updateOne(
            { _id: recipient._id },
            { $set: { status: "failed", error: "The mail server did not accept this address." } }
          );
          await EmailCampaign.updateOne({ _id: id }, { $inc: { "stats.failed": 1 } });
        }
      } catch (err) {
        await CampaignRecipient.updateOne(
          { _id: recipient._id },
          { $set: { status: "failed", error: String(err?.message || err).slice(0, 300) } }
        );
        await EmailCampaign.updateOne(
          { _id: id },
          { $inc: { "stats.failed": 1 }, $set: { lastError: String(err?.message || err).slice(0, 300) } }
        );
      }

      await wait(gapMs);
    }

    // Finished only when nothing is left waiting -- a paused campaign still has
    // pending rows and must not be labelled sent.
    const left = await CampaignRecipient.countDocuments({ campaign: id, status: { $in: ["pending", "sending"] } });
    if (left === 0) {
      await EmailCampaign.updateOne({ _id: id }, { $set: { status: "sent", finishedAt: new Date() } });
    }
  } catch (err) {
    console.error("[campaign] run failed:", err);
    await EmailCampaign.updateOne(
      { _id: id },
      { $set: { status: "failed", lastError: String(err?.message || err).slice(0, 300) } }
    ).catch(() => {});
  } finally {
    running.delete(id);
  }
};

/**
 * A row left as "sending" means the process stopped mid-message -- a restart, a
 * crash. Those are put back in the queue on boot so a campaign is not left
 * permanently one person short with no sign of it.
 */
export const recoverInterrupted = async () => {
  if (mongoose.connection.readyState !== 1) return;
  try {
    await CampaignRecipient.updateMany({ status: "sending" }, { $set: { status: "pending" } });
    const stuck = await EmailCampaign.find({ status: "sending" }).select("_id").lean();
    for (const c of stuck) {
      await EmailCampaign.updateOne({ _id: c._id }, { $set: { status: "paused" } });
    }
    if (stuck.length) {
      console.log(`[campaign] ${stuck.length} campaign(s) paused after restart; resume them when ready`);
    }
  } catch (err) {
    console.error("[campaign] recovery failed:", err.message);
  }
};

export default {
  listsContaining,
  collectAudience,
  audienceSummary,
  listAudience,
  prepareRecipients,
  runCampaign,
  personalize,
  ensureUnsubscribe,
  unsubscribeToken,
  verifyUnsubscribeToken,
  unsubscribeUrl,
  oneClickUnsubscribeUrl,
  normalizeEmail,
  isValidEmail,
  recoverInterrupted,
  isRunning,
  SOURCE_LABELS,
};
