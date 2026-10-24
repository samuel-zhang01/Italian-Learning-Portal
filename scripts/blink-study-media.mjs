/** Download only observed study media without retaining authentication or URL queries. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
const limit = 500 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const cleanUrl = (value) => {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[?::1\]?)/i.test(url.hostname)) return null;
    return `${url.origin}${url.pathname}`;
  } catch { return null; }
};

export function createStudyMediaDownloader({ request, readerId, destination, mediaManifest, atomic, privatePath }) {
  const fingerprint = async (file) => digest(await readFile(await privatePath(file)));
  const mediaCache = new Map(mediaManifest.files.map((item) => [item.source, item]));
  let nextRequest = 0;
  const throttle = async () => { const delay = Math.max(0, nextRequest - Date.now()); nextRequest = Math.max(Date.now(), nextRequest) + 180; await pause(delay); };
  const downloadOne = async (resource) => {
    const source = cleanUrl(resource.url);
    if (!source) return { source: null, status: "rejected-url" };
    const previous = mediaCache.get(source);
    if (previous?.status === "downloaded") {
      try { if (await fingerprint(path.join(destination, previous.file)) === previous.sha256) return previous; } catch { /* Retry a missing or altered media file. */ }
    }
    let head, probe, response, completeProbeBody;
    try {
      await throttle();
      head = await request.head(resource.url, { headers: { "Accept-Encoding": "identity" }, timeout: 30000, maxRedirects: 3 });
      let mime = (head.headers()["content-type"] || "").split(";")[0].toLowerCase();
      let bytes = Number(head.headers()["content-length"]), ranged = false;
      if (!head.ok() || !Number.isSafeInteger(bytes) || bytes <= 0) {
        await throttle();
        probe = await request.get(resource.url, { headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" }, timeout: 30000, maxRedirects: 3 });
        if (probe.status() === 206) {
          const extent = /^bytes 0-0\/(\d+)$/.exec(probe.headers()["content-range"] || "");
          if (!extent || (await probe.body()).length !== 1) return { source, status: "invalid-media-range" };
          bytes = Number(extent[1]);
          mime = (probe.headers()["content-type"] || "").split(";")[0].toLowerCase();
          ranged = true;
        } else if (probe.status() === 200 && cleanUrl(probe.url()) && !/(?:login|signin)\b/i.test(new URL(probe.url()).pathname)) {
          const probeMime = (probe.headers()["content-type"] || "").split(";")[0].toLowerCase();
          if (!/html|javascript|json/i.test(probeMime)) {
            const payload = await probe.body();
            if (payload.length > 0 && payload.length <= limit) {
              completeProbeBody = payload;
              bytes = payload.length;
              mime = probeMime;
            }
          }
        }
      }
      if ((!head.ok() && !ranged && !completeProbeBody) || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > limit || /html|javascript|json/i.test(mime)) return { source, status: "unavailable-or-unbounded", mime, declaredBytes: Number.isSafeInteger(bytes) ? bytes : null, headStatus: head.status(), probeStatus: probe?.status() ?? null, requestHasCourse: new URL(resource.url).searchParams.has("idcurso"), requestCourseMatches: new URL(resource.url).searchParams.get("idcurso") === readerId };
      const extension = path.extname(new URL(source).pathname).toLowerCase();
      if (!/^(image|audio|video)\//.test(mime) && !["application/pdf", "text/vtt", "application/x-subrip", "application/srt", "text/srt"].includes(mime) && !(mime === "text/plain" && [".vtt", ".srt"].includes(extension)) && !(mime === "application/octet-stream" && /\.(png|jpe?g|gif|webp|svg|avif|mp3|ogg|wav|m4a|aac|opus|mp4|webm|pdf|vtt|srt)$/.test(extension))) return { source, status: "unsupported-media-type", mime };
      if (!completeProbeBody) {
        await throttle();
        response = await request.get(resource.url, { headers: { "Accept-Encoding": "identity", ...(ranged ? { Range: `bytes=0-${bytes - 1}` } : {}) }, timeout: 120000, maxRedirects: 3 });
        if (!response.ok() || !cleanUrl(response.url()) || /(?:login|signin)\b/i.test(new URL(response.url()).pathname) || /html|javascript|json/i.test(response.headers()["content-type"] || "")) return { source, status: "unavailable-media" };
        if (response.status() === 206 && response.headers()["content-range"] !== `bytes 0-${bytes - 1}/${bytes}`) return { source, status: "invalid-media-range" };
      }
      const body = completeProbeBody || await response.body();
      if (body.length > limit || body.length !== bytes || /^\s*(?:<!doctype html|<html)/i.test(body.subarray(0, 512).toString("utf8"))) return { source, status: "invalid-media-response" };
      const suffix = /\.[a-z0-9]{1,5}$/.test(extension) ? extension : ({ "image/jpeg": ".jpg", "image/png": ".png", "audio/mpeg": ".mp3", "video/mp4": ".mp4" })[mime] || ".bin";
      const file = `media/${digest(source).slice(0, 24)}${suffix}`;
      await atomic(path.join(destination, file), body);
      const item = { source, status: "downloaded", file, mime, bytes: body.length, sha256: digest(body) };
      mediaCache.set(source, item);
      return item;
    } catch (error) { return { source, status: "media-error", error: error.name }; }
    finally { await head?.dispose(); await probe?.dispose(); await response?.dispose(); }
  };
  const download = async (resource) => {
    // Distinct reader contexts can supply the same path with different required
    // course parameters. Retain those observed variants only in this process.
    const variants = [...new Set(resource.variants || [resource.url])].slice(0, 5);
    variants.sort((a, b) => Number(new URL(b).searchParams.get("idcurso") === readerId) - Number(new URL(a).searchParams.get("idcurso") === readerId));
    let result;
    for (const url of variants) {
      result = await downloadOne({ ...resource, url });
      if (result.status === "downloaded") return result;
    }
    return { ...result, observedVariantsTried: variants.length };
  };
  return {
    download,
    files: () => [...mediaCache.values()].sort((a, b) => a.source.localeCompare(b.source)),
    size: () => mediaCache.size,
  };
}
