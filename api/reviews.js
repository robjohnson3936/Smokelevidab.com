// GET  /api/reviews  -> approved reviews, newest first
// POST /api/reviews  -> new review (optional JPEG photo as a data URL), held for approval and emailed to the owner
import crypto from "node:crypto";
import { clean, list, listApproved, readJson, saveJson, savePhoto, MAX_PHOTO_BYTES } from "../lib/reviews-store.js";

const OWNER_EMAIL = process.env.OWNER_EMAIL;
const RESEND_API_KEY = process.env.RESEND_API_KEY;

function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `https://${host}`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function notifyOwner(req, review, token) {
  if (!OWNER_EMAIL || !RESEND_API_KEY) return;
  const link = `${siteUrl(req)}/api/review-action?id=${review.id}&t=${token}`;
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const html = `
    <h2>New LEVIDAB review waiting for approval</h2>
    <p><strong>${esc(review.name)}</strong> · ${stars}</p>
    <p>${esc(review.text).replace(/\n/g, "<br>")}</p>
    ${review.photo ? `<p><img src="${esc(review.photo)}" alt="Review photo" style="max-width:320px"></p>` : ""}
    <p><a href="${esc(link)}">Review it and approve or delete</a></p>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.FROM_EMAIL || "LEVIDAB Reviews <onboarding@resend.dev>",
      to: [OWNER_EMAIL],
      subject: `New ${review.rating}-star review from ${review.name}`,
      html,
    }),
  }).catch(() => {});
}

export default async function handler(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "GET") {
    try {
      const blobs = await listApproved();
      const reviews = (await Promise.all(blobs.map((b) => readJson(b).catch(() => null))))
        .filter(Boolean)
        .map(({ name, rating, text, photo, date }) => ({ name, rating, text, photo, date }))
        .sort((a, b) => (a.date < b.date ? 1 : -1));
      res.setHeader("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
      return res.status(200).json({ reviews });
    } catch (e) {
      return res.status(500).json({ error: "Reviews are unavailable right now." });
    }
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const body = typeof req.body === "object" && req.body ? req.body : {};
  if (body.website) return res.status(200).json({ ok: true }); // honeypot: pretend success

  const name = clean(body.name, 40);
  const text = clean(body.text, 1000);
  const rating = Number(body.rating);
  if (!name || text.length < 10 || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: "Please add your name, a star rating and at least a sentence about LEVIDAB." });
  }
  const linkCount = (text.match(/https?:\/\/|www\./gi) || []).length;
  if (linkCount > 0) return res.status(400).json({ error: "Please leave links out of your review." });

  // Keep spam floods from filling storage.
  const { blobs: waiting } = await list({ prefix: "reviews/pending/", limit: 101 });
  if (waiting.length > 100) return res.status(429).json({ error: "We're catching up on reviews. Please try again later." });

  const id = crypto.randomUUID();
  const token = crypto.randomBytes(24).toString("hex");
  let photo = null;

  if (body.photo) {
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.photo));
    if (!m) return res.status(400).json({ error: "Photos must be JPEG images." });
    const bytes = Buffer.from(m[1], "base64");
    const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (!isJpeg || bytes.length > MAX_PHOTO_BYTES) return res.status(400).json({ error: "That photo couldn't be used. Please try a smaller JPEG." });
    photo = (await savePhoto(id, bytes)).url;
  }

  const review = { id, name, rating, text, photo, date: new Date().toISOString() };
  await saveJson(`reviews/pending/${id}.json`, { ...review, token });
  await notifyOwner(req, review, token);
  return res.status(200).json({ ok: true });
}
