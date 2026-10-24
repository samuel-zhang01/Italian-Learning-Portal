/** Inert study-source sanitizer shared by rendered and static importers. */
// Runs only against a study page below role=main. Answer values are never read.
export function sanitizeStudyPage(element, observedBase) {
  const sourceDocument = element.ownerDocument;
  const base = observedBase || sourceDocument.baseURI;
  const cloned = element.cloneNode(true);
  const sourceMedia = [...element.querySelectorAll("img,audio,video,source,track")];
  const clonedMedia = [...cloned.querySelectorAll("img,audio,video,source,track")];
  const sourceVideos = [...element.querySelectorAll("video")];
  const resources = [];
  const playerSetups = { players: 0, invalidJSON: 0, sourceEntries: 0, trackEntries: 0, placeholders: 0, unclassified: 0, diagnostics: [] };
  const editorPlayers = { players: 0, missingVideoURI: 0, captionTracks: 0 };
  const editorAudios = { players: 0, missingAudioURI: 0 };
  const absolute = (value) => {
    try { const url = new URL(value, base); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; }
    catch { return null; }
  };
  sourceMedia.forEach((source, index) => {
    const copy = clonedMedia[index];
    if (!copy) return;
    const value = source.currentSrc || source.getAttribute("src") || source.getAttribute("data-src");
    const url = value && absolute(value);
    if (url) {
      const key = `resource-${resources.length}`;
      const item = { key, url, tag: source.tagName.toLowerCase(), player: sourceVideos.indexOf(source.closest("video")) };
      if (source.tagName === "TRACK") {
        item.kind = source.getAttribute("kind") || "subtitles";
        item.srclang = source.getAttribute("srclang") || "";
        item.label = (source.getAttribute("label") || "").slice(0, 100);
      }
      resources.push(item); copy.setAttribute("src", `urn:parliamo-media:${key}:end`);
    }
    else copy.removeAttribute("src");
    if (source.tagName === "VIDEO" && source.getAttribute("poster")) {
      const poster = absolute(source.getAttribute("poster"));
      if (poster) { const key = `resource-${resources.length}`; resources.push({ key, url: poster, tag: "img" }); copy.setAttribute("poster", `urn:parliamo-media:${key}:end`); }
    }
  });
  const literalMediaURI = (value, extension) => {
    if (typeof value !== "string" || value.length > 8192) return null;
    const literal = value.trim();
    if (!literal || /[<>"\r\n\t]/.test(literal) || !extension.test(literal) || /\s/.test(literal) && !/^(?:https:\/\/|\/|\.\.?\/)/i.test(literal)) return null;
    return absolute(literal);
  };
  const editorImages = [...element.querySelectorAll("img.class_video.player.video")];
  const copiedEditorImages = [...cloned.querySelectorAll("img.class_video.player.video")];
  editorImages.forEach((source, index) => {
    const copy = copiedEditorImages[index];
    if (!copy) return;
    editorPlayers.players++;
    sourceVideos.push(source);
    const player = sourceVideos.indexOf(source);
    const sourceContainer = source.closest(".bck-video-container2") || source.closest(".bck-video-player") || source.parentElement;
    const copiedContainer = copy.closest(".bck-video-container2") || copy.closest(".bck-video-player") || copy.parentElement;
    const video = sourceDocument.createElement("video");
    const url = literalMediaURI(source.getAttribute("alt"), /\.(?:mp4|webm|ogv|m4v|mov)(?:[?#]|$)/i);
    if (url) { const key = `resource-${resources.length}`; resources.push({ key, url, tag: "video", player }); video.setAttribute("src", `urn:parliamo-media:${key}:end`); }
    else editorPlayers.missingVideoURI++;
    const explicitPoster = source.closest(".bck-video-player")?.getAttribute("data-video-poster");
    const poster = explicitPoster && absolute(explicitPoster);
    if (poster) { const key = `resource-${resources.length}`; resources.push({ key, url: poster, tag: "img", player }); video.setAttribute("poster", `urn:parliamo-media:${key}:end`); }
    else if (copy.getAttribute("src")?.startsWith("urn:parliamo-media:")) video.setAttribute("poster", copy.getAttribute("src"));
    for (const caption of sourceContainer?.querySelectorAll(".bck-video-srt") || []) {
      const candidates = [...caption.querySelectorAll("a.bck-video-srt-label[href]")].map((node) => node.getAttribute("href"));
      candidates.push(caption.getAttribute("href"), caption.getAttribute("data-srt-file"));
      const url = candidates.map((value) => literalMediaURI(value, /\.(?:vtt|srt)(?:[?#]|$)/i)).find(Boolean);
      if (!url || resources.some((item) => item.player === player && item.tag === "track" && item.url === url)) continue;
      const key = `resource-${resources.length}`;
      const kind = ["captions", "subtitles", "descriptions", "chapters", "metadata"].includes(caption.getAttribute("data-srt-kind")) ? caption.getAttribute("data-srt-kind") : "subtitles";
      const label = (caption.getAttribute("data-srt-label") || "").slice(0, 100).replace(/[\x00-\x1f]/g, "");
      resources.push({ key, url, tag: "track", player, kind, label, srclang: "" });
      const track = sourceDocument.createElement("track");
      track.setAttribute("src", `urn:parliamo-media:${key}:end`); track.setAttribute("kind", kind);
      if (label) track.setAttribute("label", label);
      video.append(track); editorPlayers.captionTracks++;
    }
    copy.replaceWith(video);
    // These are source-editor media wrappers, not learner response regions.
    // Caption metadata has already been copied; no editable values are read.
    for (const wrapper of [copiedContainer, video.closest(".bck-video-player")]) wrapper?.removeAttribute("contenteditable");
    copiedContainer?.querySelectorAll(".bck-video-srt").forEach((node) => node.remove());
  });
  const editorAudioSpans = [...element.querySelectorAll("span.class_sonido.bck-audio-icon-container")];
  const copiedAudioSpans = [...cloned.querySelectorAll("span.class_sonido.bck-audio-icon-container")];
  editorAudioSpans.forEach((source, index) => {
    if (!copiedAudioSpans[index]) return;
    editorAudios.players++;
    const url = [source.getAttribute("src"), source.getAttribute("alt")].map((value) => literalMediaURI(value, /\.(?:mp3|m4a|ogg|wav|aac|opus)(?:[?#]|$)/i)).find(Boolean);
    const audio = sourceDocument.createElement("audio");
    if (url) { const key = `resource-${resources.length}`; resources.push({ key, url, tag: "audio" }); audio.setAttribute("src", `urn:parliamo-media:${key}:end`); }
    else editorAudios.missingAudioURI++;
    audio.textContent = "Source audio";
    copiedAudioSpans[index].replaceWith(audio);
  });
  const setups = [...element.querySelectorAll("video[data-setup],audio[data-setup],div[data-setup]")].slice(0, 50);
  const copiedSetups = [...cloned.querySelectorAll("video[data-setup],audio[data-setup],div[data-setup]")].slice(0, 50);
  setups.forEach((node, index) => {
    playerSetups.players++;
    const flagUnknownPlaceholder = () => { if (!node.matches("video,audio") && !node.querySelector("video,audio,img.class_video.player.video")) sourceVideos.push(node); };
    const raw = node.getAttribute("data-setup") || "";
    let setup;
    try { if (raw.length > 100_000) throw new Error(); setup = JSON.parse(raw); }
    catch { playerSetups.invalidJSON++; flagUnknownPlaceholder(); return; }
    if (!setup || typeof setup !== "object" || Array.isArray(setup)) { playerSetups.invalidJSON++; flagUnknownPlaceholder(); return; }
    playerSetups.diagnostics.push({ tag: node.tagName.toLowerCase(), classes: (node.getAttribute("class") || "").split(/\s+/).filter((name) => /^[a-z0-9_-]{1,60}$/i.test(name)).slice(0, 12), keys: Object.keys(setup).slice(0, 30).map((key) => /^[a-z_][a-z0-9_-]{0,59}$/i.test(key) ? key : "(other)") });
    let sourcePlayer = node.matches("video,audio") ? node : node.querySelector("video,audio,img.class_video.player.video");
    let copy = copiedSetups[index]?.matches("video,audio") ? copiedSetups[index] : copiedSetups[index]?.querySelector("video,audio");
    if (!sourcePlayer && copiedSetups[index]) {
      const sources = Array.isArray(setup.sources) ? setup.sources.slice(0, 20) : [];
      const tracks = Array.isArray(setup.tracks) ? setup.tracks.slice(0, 20) : [];
      const isVideo = sources.some((item) => typeof item?.src === "string" && (/^video\//i.test(item.type || "") || /\.(?:mp4|webm|ogv|m4v)(?:[?#]|$)/i.test(item.src))) || tracks.some((item) => typeof item?.src === "string" && /\.vtt(?:[?#]|$)/i.test(item.src));
      const isAudio = sources.some((item) => typeof item?.src === "string" && (/^audio\//i.test(item.type || "") || /\.(?:mp3|ogg|wav|m4a|aac)(?:[?#]|$)/i.test(item.src)));
      if (!isVideo && !isAudio) {
        // Unrecognized player setup must keep a rendered-transcript gap.
        // Classifying it as complete would silently discard dynamic content.
        playerSetups.unclassified++; sourceVideos.push(node); return;
      }
      sourcePlayer = node;
      if (isVideo) sourceVideos.push(node);
      copy = sourceDocument.createElement(isVideo ? "video" : "audio");
      copiedSetups[index].append(copy);
      playerSetups.placeholders++;
    }
    if (!sourcePlayer || !copy) return;
    const player = sourceVideos.indexOf(sourcePlayer);
    // Only literal source/track metadata is read. No player configuration,
    // callback, account field or script is evaluated or retained.
    for (const item of Array.isArray(setup.sources) ? setup.sources.slice(0, 20) : []) {
      const url = typeof item?.src === "string" && absolute(item.src);
      if (!url || resources.some((entry) => entry.url === url && entry.player === player && ["source", "video", "audio"].includes(entry.tag))) continue;
      const key = `resource-${resources.length}`;
      resources.push({ key, url, tag: "source", player });
      const source = sourceDocument.createElement("source");
      source.setAttribute("src", `urn:parliamo-media:${key}:end`);
      if (typeof item.type === "string" && /^(?:video|audio)\/[a-z0-9.+-]+$/i.test(item.type)) source.setAttribute("type", item.type);
      copy.append(source); playerSetups.sourceEntries++;
    }
    for (const item of Array.isArray(setup.tracks) ? setup.tracks.slice(0, 20) : []) {
      const url = typeof item?.src === "string" && absolute(item.src);
      if (!url || resources.some((entry) => entry.url === url && entry.player === player && entry.tag === "track")) continue;
      const key = `resource-${resources.length}`;
      const kind = ["subtitles", "captions", "descriptions", "chapters", "metadata"].includes(item.kind) ? item.kind : "subtitles";
      const srclang = typeof item.srclang === "string" && /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(item.srclang) ? item.srclang : "";
      const label = typeof item.label === "string" ? item.label.slice(0, 100).replace(/[\x00-\x1f]/g, "") : "";
      resources.push({ key, url, tag: "track", player, kind, srclang, label });
      const track = sourceDocument.createElement("track");
      track.setAttribute("src", `urn:parliamo-media:${key}:end`);
      track.setAttribute("kind", kind);
      if (srclang) track.setAttribute("srclang", srclang);
      if (label) track.setAttribute("label", label);
      copy.append(track); playerSetups.trackEntries++;
    }
  });
  const audioControls = [...element.querySelectorAll("a.js-audio-player,button.js-audio-player")];
  const copiedAudioControls = [...cloned.querySelectorAll("a.js-audio-player,button.js-audio-player")];
  audioControls.forEach((source, index) => {
    // Extract only the literal study-media path from the reader's own playback
    // control. Never execute or retain its callback or other data attributes.
    const callback = source.getAttribute("onclick") || "";
    const value = callback.match(/(?:https:\/\/|\/useruploads\/)[^'"\s<>]+?\.(?:mp3|m4a|ogg|wav|aac)(?:\?[^'"\s<>]*)?/i)?.[0];
    const url = value && absolute(value);
    if (!url || !copiedAudioControls[index]) return;
    const key = `resource-${resources.length}`;
    resources.push({ key, url, tag: "audio" });
    const audio = sourceDocument.createElement("audio");
    audio.setAttribute("src", `urn:parliamo-media:${key}:end`);
    audio.textContent = "Source audio";
    copiedAudioControls[index].replaceWith(audio);
  });
  const attachments = [...element.querySelectorAll("a.bck-file-attach[href]")];
  const copiedAttachments = [...cloned.querySelectorAll("a.bck-file-attach[href]")];
  attachments.forEach((source, index) => {
    const url = absolute(source.getAttribute("href"));
    if (!url || !/\.pdf(?:[?#]|$)/i.test(url) || !copiedAttachments[index]) return;
    const key = `resource-${resources.length}`;
    resources.push({ key, url, tag: "attachment" });
    copiedAttachments[index].setAttribute("href", `urn:parliamo-media:${key}:end`);
  });
  const links = [...cloned.querySelectorAll("a[href],iframe[src]")].map((node) => absolute(node.getAttribute("href") || node.getAttribute("src"))).filter(Boolean);
  cloned.querySelectorAll("script,style,link,meta,base,iframe,object,embed,noscript,[role=status],[role=alert],[aria-live],.feedback,.attempt,.attempts,.score,.scores,.validation-result,.user-answer,.student-answer,[data-user-answer],[class*=feedback-],[class*=-feedback]").forEach((node) => node.remove());
  cloned.querySelectorAll("button").forEach((node) => {
    if (node.matches('[role="option"],.choice,.option,[data-option]') || node.closest('.choices,.options,[role="listbox"]')) {
      const sourceChoice = sourceDocument.createElement("span");
      sourceChoice.append(...node.childNodes); node.replaceWith(sourceChoice);
    } else node.remove();
  });
  const comments = sourceDocument.createTreeWalker(cloned, NodeFilter.SHOW_COMMENT);
  const commentNodes = [];
  while (comments.nextNode()) commentNodes.push(comments.currentNode);
  commentNodes.forEach((node) => node.remove());
  const slots = { text: 0, choices: 0, select: 0, editable: 0 };
  cloned.querySelectorAll("input,textarea,select,[contenteditable]").forEach((node) => {
    const replacement = sourceDocument.createElement("span");
    if (node.tagName === "SELECT") {
      slots.select++;
      // Option text is source material; selected/value properties are not read.
      replacement.textContent = `[blank selection; options: ${[...node.querySelectorAll("option")].map((item) => item.textContent).join(" | ")}]`;
    } else {
      const type = node.tagName === "INPUT" ? (node.getAttribute("type") || "text").toLowerCase() : "text";
      if (["checkbox", "radio"].includes(type)) { slots.choices++; replacement.textContent = "[unselected choice]"; }
      else if (node.hasAttribute("contenteditable")) { slots.editable++; replacement.textContent = "[blank response]"; }
      else { slots.text++; replacement.textContent = "[blank response]"; }
    }
    node.replaceWith(replacement);
  });
  const questions = [...cloned.querySelectorAll("fieldset,.question,.exercise,[data-question-id],[class*=exercise-],[class*=question-]")].slice(0, 300).map((node, index) => ({ ordinal: index + 1, text: (node.textContent || "").replace(/\s+/g, " ").trim(), blankSlots: (node.textContent.match(/\[blank response\]|\[blank selection/g) || []).length })).filter((item) => item.text);
  const allowed = new Set("DIV SECTION ARTICLE MAIN HEADER FOOTER H1 H2 H3 H4 H5 H6 P SPAN STRONG B EM I U S SMALL SUB SUP BR HR UL OL LI DL DT DD TABLE THEAD TBODY TFOOT TR TH TD CAPTION COLGROUP COL FIGURE FIGCAPTION BLOCKQUOTE Q PRE CODE LABEL FIELDSET LEGEND A IMG AUDIO VIDEO SOURCE TRACK".split(" "));
  [...cloned.querySelectorAll("*")].reverse().forEach((node) => {
    if (!allowed.has(node.tagName)) { node.replaceWith(...node.childNodes); return; }
    const keep = node.tagName === "A" && node.getAttribute("href")?.startsWith("urn:parliamo-media:") ? new Set(["href"])
      : node.tagName === "IMG" ? new Set(["src", "alt", "width", "height"])
      : node.tagName === "TRACK" ? new Set(["src", "kind", "srclang", "label"])
      : ["AUDIO", "VIDEO", "SOURCE"].includes(node.tagName) ? new Set(["src", "poster", "type"])
        : ["TD", "TH"].includes(node.tagName) ? new Set(["colspan", "rowspan"]) : new Set();
    for (const attribute of [...node.attributes]) if (!keep.has(attribute.name.toLowerCase())) node.removeAttribute(attribute.name);
    if (["AUDIO", "VIDEO"].includes(node.tagName)) { node.setAttribute("controls", ""); node.setAttribute("preload", "none"); }
  });
  const text = (cloned.textContent || "").replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim();
  const html = cloned.innerHTML;
  const retainedResources = resources.filter((item) => html.includes(`urn:parliamo-media:${item.key}:end`));
  const videos = sourceVideos.map((_, index) => ({ index, observedVideoSources: retainedResources.filter((item) => item.player === index && ["video", "source"].includes(item.tag)).length, observedCaptionTracks: retainedResources.filter((item) => item.player === index && item.tag === "track" && ["captions", "subtitles"].includes(item.kind)).length }));
  return { html, text, resources: retainedResources, links, questions, slots, videos, playerSetups, editorPlayers, editorAudios };
}
