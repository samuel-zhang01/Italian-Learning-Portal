export type ListeningRange = { start: number; end: number };
export function listeningRange(start: number, end: number, duration: number): ListeningRange | null {
  if (![start, end, duration].every(Number.isFinite) || duration <= 0) return null;
  const first = Math.max(0, Math.min(start, duration));
  const last = Math.min(duration, Math.max(0, end));
  return last - first >= 0.25 ? { start: first, end: last } : null;
}
export function repeatListeningAt(time: number, range: ListeningRange | null, repeating: boolean, paused: boolean) {
  return repeating && !paused && range && Number.isFinite(time) && time >= range.end ? range.start : null;
}
export function listeningEndAction(time: number, range: ListeningRange | null, repeating: boolean, active: boolean) {
  if (!active || !range || !Number.isFinite(time) || time < range.end) return null;
  return repeating ? { type: "repeat" as const, time: range.start } : { type: "pause" as const, time: range.end };
}
export function transcriptLines(text: string) {
  const normalized = text.replace(/\r\n?/g, "\n").trim().slice(0, 20_000);
  return normalized ? normalized.split(/\n+|(?<=[.!?])\s+/u).map((line) => line.trim()).filter(Boolean) : [];
}
type AudioFile = Blob & { name: string };
type AudioUrls = { createObjectURL: (file: Blob) => string; revokeObjectURL: (url: string) => void };
export function createLocalAudioStore(urls: AudioUrls = {
  createObjectURL: (file) => URL.createObjectURL(file), revokeObjectURL: (url) => URL.revokeObjectURL(url),
}) {
  let current: { name: string; url: string } | null = null;
  const clear = () => { if (current) urls.revokeObjectURL(current.url); current = null; };
  return {
    snapshot: () => current ? { ...current } : null,
    connect(file: AudioFile) {
      if (!file.size || file.size > 500_000_000 || !(file.type.startsWith("audio/")
        || /\.(?:mp3|m4a|wav|ogg|oga|opus|aac|flac|webm)$/i.test(file.name))) return null;
      let url: string;
      try { url = urls.createObjectURL(file); } catch { return null; }
      clear(); current = { name: file.name, url };
      return { ...current };
    },
    clear,
  };
}
