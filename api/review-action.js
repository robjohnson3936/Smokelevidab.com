// GET  /api/review-action?id=..&t=..   -> page showing the pending review with Approve / Delete buttons
// POST /api/review-action (id, t, do)  -> approve (publish) or delete the review
// A GET never changes anything, so email link scanners can't approve reviews by accident.
import crypto from "node:crypto";
import { findOne, readJson, saveJson, del } from "../lib/reviews-store.js";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page(res, status, title, inner) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.status(status).send(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;background:#0a0908;color:#fdf9f2;font:16px/1.6 system-ui,sans-serif;padding:32px 16px}
main{max-width:560px;margin:0 auto;display:grid;gap:16px}h1{font-weight:500;color:#eed9a8;margin:0}
.card{border:1px solid rgba(212,178,115,.35);padding:20px;background:#141210;display:grid;gap:10px}
.stars{color:#d4b273;letter-spacing:2px}img{max-width:100%;height:auto}
form{display:flex;gap:10px;flex-wrap:wrap}button{font:600 14px system-ui;padding:12px 20px;cursor:pointer;border:1px solid #d4b273}
.ok{background:#d4b273;color:#120d07}.no{background:transparent;color:#fdf9f2}a{color:#eed9a8}</style></head>
<body><main>${inner}</main></body></html>`);
}

async function loadPending(id, token) {
  if (!/^[0-9a-f-]{36}$/.test(id || "") || !/^[0-9a-f]{48}$/.test(token || "")) return null;
  const blob = await findOne(`reviews/pending/${id}`);
  if (!blob) return null;
  const data = await readJson(blob);
  const a = Buffer.from(String(data.token)), b = Buffer.from(token);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return { blob, data };
}

export default async function handler(req, res) {
  const src = req.method === "POST" ? (req.body || {}) : (req.query || {});
  const id = String(src.id || ""), token = String(src.t || "");
  const found = await loadPending(id, token).catch(() => null);
  if (!found) return page(res, 404, "Review not found", `<h1>Review not found</h1><p>This review was already approved or deleted, or the link is incomplete.</p>`);
  const { blob, data } = found;

  if (req.method === "GET") {
    return page(res, 200, "Approve review", `<h1>Approve this review?</h1>
      <div class="card"><div><strong>${esc(data.name)}</strong> <span class="stars">${"★".repeat(data.rating)}${"☆".repeat(5 - data.rating)}</span></div>
      <p>${esc(data.text).replace(/\n/g, "<br>")}</p>${data.photo ? `<img src="${esc(data.photo)}" alt="Review photo">` : ""}</div>
      <form method="post" action="/api/review-action">
        <input type="hidden" name="id" value="${esc(id)}"><input type="hidden" name="t" value="${esc(token)}">
        <button class="ok" name="do" value="approve">Approve and publish</button>
        <button class="no" name="do" value="delete">Delete</button>
      </form>`);
  }

  if (req.method !== "POST") return page(res, 405, "Not allowed", "<h1>Not allowed</h1>");

  if (src.do === "approve") {
    const { token: _t, ...pub } = data;
    await saveJson(`reviews/approved/${data.id}.json`, pub);
    await del(blob.url);
    return page(res, 200, "Review published", `<h1>Review published</h1><p>It now shows on your site (allow up to a minute).</p><p><a href="/#reviews">View reviews</a></p>`);
  }
  if (src.do === "delete") {
    await del([blob.url, ...(data.photo ? [data.photo] : [])]);
    return page(res, 200, "Review deleted", `<h1>Review deleted</h1><p>It won't appear on your site.</p>`);
  }
  return page(res, 400, "Choose an action", "<h1>Choose Approve or Delete.</h1>");
}
