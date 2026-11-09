// Shared helpers for storing reviews in Vercel Blob.
// Layout: reviews/pending/<id>-<random>.json, reviews/approved/<id>-<random>.json, reviews/photos/<id>-<random>.jpg
import { put, list, del } from "@vercel/blob";

export const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

export function clean(value, max) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F<>]/g, "")
    .trim()
    .slice(0, max);
}

export async function findOne(prefix) {
  const { blobs } = await list({ prefix, limit: 5 });
  return blobs[0] || null;
}

export async function readJson(blob) {
  const r = await fetch(blob.url + "?v=" + Date.now(), { cache: "no-store" });
  if (!r.ok) throw new Error("read failed");
  return r.json();
}

export async function listApproved() {
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: "reviews/approved/", cursor, limit: 1000 });
    out.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && out.length < 2000);
  return out;
}

export async function saveJson(pathname, data) {
  return put(pathname, JSON.stringify(data), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: true,
    cacheControlMaxAge: 60,
  });
}

export async function savePhoto(id, bytes) {
  return put(`reviews/photos/${id}.jpg`, bytes, {
    access: "public",
    contentType: "image/jpeg",
    addRandomSuffix: true,
  });
}

export { del, list };
