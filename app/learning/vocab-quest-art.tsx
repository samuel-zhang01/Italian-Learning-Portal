import type { CSSProperties } from "react";

export type QuestIconName = "spark" | "book" | "target" | "flame" | "trophy" | "heart" | "bolt" | "check" | "arrow" | "leaf" | "star" | "sound" | "close" | "tiles" | "refresh" | "coffee" | "home" | "chat" | "compass";
export function QuestIcon({ name, size = 24 }: { name: QuestIconName; size?: number }) {
  const paths = {
    spark: <><path d="m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7Z"/><path d="m20 2 .7 1.3L22 4l-1.3.7L20 6l-.7-1.3L18 4l1.3-.7Z"/></>,
    book: <><path d="M12 6v15M3 4c4-1 6 0 9 2 3-2 5-3 9-2v15c-4-1-6 0-9 2-3-2-5-3-9-2Z"/><path d="M6 9h3m-3 4h3m6-4h3m-3 4h3"/></>,
    target: <><circle cx="11" cy="13" r="8"/><circle cx="11" cy="13" r="4"/><path d="m11 13 9-10m-4 0h4v4"/></>,
    flame: <path d="M13 2c1 5-3 5-2 9 2-1 3-3 3-4 5 4 6 8 3 12-3 4-9 4-12 0-3-5 0-9 4-13 0 3 1 4 2 4-1-4 2-5 2-8Z"/>,
    trophy: <><path d="M7 3h10v7a5 5 0 0 1-10 0Zm5 12v6m-4 0h8M7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4"/></>,
    heart: <path d="M12 21 3.6 12.5a5.6 5.6 0 0 1 8.4-7.4 5.6 5.6 0 0 1 8.4 7.4Z"/>,
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-8Z"/>,
    check: <path d="m5 12 4.5 4.5L20 6"/>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    leaf: <><path d="M20 3C9 2 2 9 6 16s14 4 14-13Z"/><path d="m3 21 12-12"/></>,
    star: <path d="m12 2 3 6.5 7 .9-5.2 4.9 1.3 7L12 18l-6.1 3.3 1.3-7L2 9.4l7-.9Z"/>,
    sound: <><path d="M3 9h4l5-4v14l-5-4H3Z"/><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    tiles: <><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><path d="M14 18h7m-3.5-3.5v7"/></>,
    refresh: <><path d="M20 8A8.5 8.5 0 1 0 21 15M20 3v6h-6"/></>,
    coffee: <><path d="M4 8h13v7a6.5 6.5 0 0 1-13 0Zm13 1h2a3 3 0 0 1 0 6h-2M3 22h16M7 2v2m5-2v2"/></>,
    home: <><path d="m2 11 10-8 10 8M5 10v11h14V10M10 21v-7h4v7"/></>,
    chat: <><path d="M21 11a9 9 0 0 1-9 9H4l-3 3V11a10 10 0 0 1 20 0Z"/><path d="M6 8h9m-9 4h6"/></>,
    compass: <><circle cx="12" cy="12" r="10"/><path d="m16.5 7.5-3 6-6 3 3-6Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

export function WordBuddy({ happy = false }: { happy?: boolean }) {
  return <svg className={"vq-buddy" + (happy ? " is-happy" : "")} viewBox="0 0 210 210" fill="none" aria-hidden="true">
    <ellipse cx="107" cy="193" rx="66" ry="10" fill="#1D5840" opacity=".12"/>
    <path d="m74 178-9 13m73-13 9 13" stroke="#24533F" strokeWidth="8" strokeLinecap="round"/>
    <path d="M112 37C104 9 124 6 143 10c0 23-9 33-31 27Z" fill="#4C9860" stroke="#24533F" strokeWidth="3"/>
    <path d="m115 33 15-13" stroke="#24533F" strokeWidth="3" strokeLinecap="round"/>
    <path d="M103 38C78 16 53 28 57 47c19 9 36 7 46-9Z" fill="#89BD6F" stroke="#24533F" strokeWidth="3"/>
    <path d="M108 33c-5-10-11-15-17-18" stroke="#24533F" strokeWidth="5" strokeLinecap="round"/>
    <path d="M105 42C57 40 29 66 34 109c-2 39 22 72 65 75 40 4 75-21 80-60 12-40-15-79-60-79l-14-3Z" fill="#FFD15B" stroke="#24533F" strokeWidth="3.5"/>
    <path d="M45 81c8-18 23-25 37-26" stroke="#FFF1BB" strokeWidth="8" strokeLinecap="round"/>
    <path d="m35 121-18-3m159-4 18-8" stroke="#24533F" strokeWidth="7" strokeLinecap="round"/>
    {happy ? <><path d="M67 96q8-13 16 0m39 0q8-13 16 0" stroke="#24533F" strokeWidth="5" strokeLinecap="round"/><path d="M90 111q17 20 31-2" fill="#24533F"/></> : <><ellipse cx="76" cy="97" rx="5" ry="7" fill="#24533F"/><ellipse cx="129" cy="97" rx="5" ry="7" fill="#24533F"/><path d="M92 111q12 13 24-2" stroke="#24533F" strokeWidth="4" strokeLinecap="round"/></>}
    <ellipse cx="61" cy="109" rx="9" ry="5" fill="#F19063" opacity=".65"/><ellipse cx="144" cy="108" rx="9" ry="5" fill="#F19063" opacity=".65"/>
    <rect x="63" y="135" width="83" height="35" rx="10" fill="#FFFEF9" stroke="#24533F" strokeWidth="2.5" transform="rotate(-5 63 135)"/>
    <path d="m79 157 6-14 6 14m-10-5h8m11 3c-6 0-5-9 1-9h4v10m0-5h-4" stroke="#24533F" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="m184 44 2.5 7 7 2.5-7 2.5-2.5 7-2.5-7-7-2.5 7-2.5Z" fill="#9264C7"/>
    <circle cx="26" cy="62" r="5" fill="#E58E73"/>
    <path d="m183 151 2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill="#4C9860"/>
  </svg>;
}

export function GoalRing({ value, label, caption }: { value: number; label: string; caption: string }) {
  return <div className="vq-goal-ring" style={{ "--goal-progress": Math.max(0, Math.min(1, value)) } as CSSProperties}>
    <svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="51"/><circle cx="60" cy="60" r="51" className="vq-goal-ring-fill" pathLength="1" strokeDasharray={Math.max(0, Math.min(1, value)) + " 1"} /></svg>
    <span><strong>{label}</strong><small>{caption}</small></span>
  </div>;
}

export function topicArt(id: string): { icon: QuestIconName; tone: number } {
  const icon = /food|cafe|restaurant|drink|supermarket|kitchen/.test(id) ? "coffee"
    : /travel|direction|transport|city|hotel|place/.test(id) ? "compass"
    : /home|house|room/.test(id) ? "home"
    : /body|health|feeling/.test(id) ? "heart"
    : /nature|garden|weather/.test(id) ? "leaf"
    : /verb|past|present/.test(id) ? "bolt"
    : /phrase|question|conversation|survival/.test(id) ? "chat" : "book";
  return { icon, tone: [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6 };
}
