"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { NeighbourhoodProfile } from "../explorer/types";
import { measuredNumber, money } from "../explorer/NeighbourhoodDetailsPanel";
import type { ScreenScore } from "./scoring";
import { readSession, subscribeSession, writeSession } from "./state";
import styles from "./workflow.module.css";
/** What is on screen. `match_scores` is sent to the teacher as shown, so it quotes rather than recomputes. */
export type TeachingContext = { title: string; match_scores?: ScreenScore[]; profiles: NeighbourhoodProfile[] } | null;
type TeacherSource = { title: string; url: string };
/** One question and its answer. Only the page title and its source links are kept, not the whole
 * screen, so the chat stays small enough to save for the tab. */
type TeacherMessage = { id: number; question: string; answer: string; page: string | null; screenSources: TeacherSource[]; sources: TeacherSource[]; usedScreen?: boolean; status: "pending" | "agent" | "fallback" };
/** An earlier question and answer, sent with a new question so the teacher can follow up ("what about 2021?"). */
export type TeacherTurn = { question: string; answer: string; page: string | null };
type TeacherState = { context: TeachingContext; setContext: (value: TeachingContext) => void; openTeacher: () => void; scores: string | null; setScores: (value: string | null) => void; messages: TeacherMessage[]; busy: boolean; ask: (question: string) => void; clearChat: () => void };
const TeacherContext = createContext<TeacherState>({ context: null, setContext: () => {}, openTeacher: () => {}, scores: null, setScores: () => {}, messages: [], busy: false, ask: () => {}, clearChat: () => {} });
const CHAT_KEY = "neighbourhood-explorer-teacher-chat";
const HISTORY_TURNS = 6;
/** The source links for the values on screen, one per source. */
export function screenSources(context: TeachingContext): TeacherSource[] {
  return [...new Map(context?.profiles.flatMap(p => Object.values(p.metrics).flatMap(m => m.source ? [[m.source.url, { title: m.source.title, url: m.source.url }] as const] : [])) ?? []).values()];
}
/** The last few answers the AI model gave, oldest first. Prepared explanations are left out: the model did not write them. */
export function chatHistory(messages: TeacherMessage[]): TeacherTurn[] {
  return messages.filter(m => m.status === "agent").slice(-HISTORY_TURNS).map(m => ({ question: m.question, answer: m.answer, page: m.page }));
}
/** Questions sent from this page load. A question still "pending" in the saved chat but not in here
 * was cut off by a reload, so it will never get an answer and is dropped. */
const asking = new Set<number>();
/** The chat saved for this tab (kept in sessionStorage, so a refresh keeps it and closing the tab clears it). */
function parseChat(raw: string | null): TeacherMessage[] {
  try {
    const saved: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(saved) ? saved.filter((m): m is TeacherMessage => !!m && typeof m === "object" && typeof m.id === "number" && typeof m.question === "string" && typeof m.answer === "string" && (m.status !== "pending" || asking.has(m.id))) : [];
  } catch { return []; }
}
function updateChat(change: (messages: TeacherMessage[]) => TeacherMessage[]) {
  writeSession(CHAT_KEY, JSON.stringify(change(parseChat(readSession(CHAT_KEY)))));
}
export const useTeacher = () => useContext(TeacherContext);
/** Shares the match scores a page shows with the AI teacher, and clears them when the page goes away.
 * Kept as JSON text so an unchanged score does not trigger another update. */
export function useTeacherScores(scores: ScreenScore[] | null) {
  const { setScores } = useTeacher();
  const key = scores?.length ? JSON.stringify(scores) : null;
  useEffect(() => { setScores(key); return () => setScores(null); }, [key, setScores]);
}
/** The context sent with a question: match scores first, so they are not cut off by long profiles. */
export function withScores(context: TeachingContext, scores: string | null): TeachingContext {
  return context && scores ? { title: context.title, match_scores: JSON.parse(scores) as ScreenScore[], profiles: context.profiles } : context;
}
export function TeacherProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<TeachingContext>(null);
  const [scores, setScores] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  // One chat for the whole app. It is kept above every page, so changing pages keeps it.
  const raw = useSyncExternalStore(subscribeSession, () => readSession(CHAT_KEY), () => null);
  const messages = useMemo(() => parseChat(raw), [raw]);
  const busy = messages.some(m => m.status === "pending");
  /** Asks about the page open right now. The answer stays with its question even if the student moves to another page while it loads. */
  async function ask(value: string) {
    const asked = value.trim();
    if (!asked || busy) return;
    const sent = withScores(context, scores);
    const history = chatHistory(messages);
    const id = Date.now();
    asking.add(id);
    updateChat(previous => [...previous, { id, question: asked, answer: "Looking up the published data…", page: sent?.title ?? null, screenSources: screenSources(sent), sources: [], status: "pending" as const }].slice(-20));
    let update: Partial<TeacherMessage>;
    try { update = { ...await askAgent(asked, sent, history), status: "agent" }; }
    catch { update = { answer: explainEvidence(asked, sent), status: "fallback" }; }
    updateChat(previous => previous.map(m => m.id === id ? { ...m, ...update } : m));
    asking.delete(id);
  }
  const clearChat = useCallback(() => writeSession(CHAT_KEY, "[]"), []);
  const pathname = usePathname();
  const openTeacher = useCallback(() => setOpen(true), []);
  const isMap = ["/housing", "/housing/saved", "/housing/recommended", "/housing/across-time"].includes(pathname?.replace(/\/$/, "") ?? "");
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !panel.current?.open) panel.current?.showModal();
    if (!open && panel.current?.open) panel.current?.close();
  }, [open]);
  return <TeacherContext.Provider value={{ context, setContext, openTeacher, scores, setScores, messages, busy, ask, clearChat }}>{children}
    {!pathname?.startsWith("/housing/compare") && !(isMap && context) && <button type="button" className={styles.teacherLauncher} onClick={openTeacher}>✦ Ask the AI teacher</button>}
    <dialog ref={panel} className={styles.teacherDialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-label="Your history teacher"><TeacherPanel onClose={() => setOpen(false)} /></dialog>
  </TeacherContext.Provider>;
}
export function explainEvidence(question: string, context: TeachingContext): string {
  const profiles = context?.profiles ?? [];
  if (/commute|school|safety|amenit|lifestyle|gap|missing|unavailable/i.test(question)) return "Commute and school travel times appear in the comparison when your profile has a work or school address. They are present-day times from a central point in each neighbourhood: transit uses the published TTC weekday schedule, and walking, cycling and driving use Mapbox routes. Safety, place counts within 1 km and lifestyle scores are shown in the comparison where data exists. Missing factors are excluded, not estimated.";
  if (/history|historic|change|time|evidence/i.test(question)) return "The map uses present-day imagery. Census years describe published measurements, not historical photographs. Keep one boundary set across time: Historical 140 has 2001–2016; Current 158 has 2021. Earlier average gross rent and later median shelter cost differ in definition, so a percentage change between them would be misleading. No historical cause is established without dated records.";
  if (/recommend|score|rank|tradeoff|match/i.test(question)) {
    const scores = context?.match_scores ?? [];
    const named = scores.filter(s => question.toLowerCase().includes(s.neighbourhood.toLowerCase()));
    if (scores.length) return (named.length ? named : scores).map(s => `${s.neighbourhood}: match score ${s.match_score ?? "unavailable"} / 100, based on ${s.based_on}. ${s.why.join(" ")}`).join("\n\n");
    return "Each neighbourhood gets a match score from 0 to 100 from your profile: affordability (rent against your budget and income), trips to your work and school addresses, nearby amenities, safety and your lifestyle priorities, each weighted the way you set them. Factors without data are left out and the others share their weight; nothing is counted as zero. Recommendations are your five best-matching neighbourhoods by this score. Complete your profile to see a score.";
  }
  if (profiles.length) return profiles.map(p => {
    const n = measuredNumber(p.metrics.cost);
    return `${p.geography.name}: ${p.year} Census renter shelter cost ${n === null ? "unavailable" : `${money(n)} per month`}. Household-income reference year: ${p.metrics.income.reference_year ?? "unavailable"}. Dollar amounts are nominal, not current asking rents. A dash means unavailable, never zero.`;
  }).join("\n\n");
  return "Start by opening the map and selecting a neighbourhood, or compare saved places. I can explain the loaded Census values, their years, missing data and comparison limits. This source guide uses prepared explanations; an AI model is not connected yet.";
}
/** Ask the backend agent (Django /api/teacher/ask/). Throws if it is unavailable, so the caller can fall back. */
export async function askAgent(question: string, context: TeachingContext, history: TeacherTurn[] = [], timeoutMs = 60000): Promise<{ answer: string; sources: TeacherSource[]; usedScreen: boolean }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch("/api/teacher/ask/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context, history }), signal: abort.signal });
    if (!response.ok) throw new Error(`AI teacher returned ${response.status}`);
    const data = await response.json() as { answer?: string; sources?: { tool?: string; api?: string; url?: string }[]; tool_calls?: { tool?: string }[] };
    if (!data.answer) throw new Error("AI teacher returned no answer");
    const sources = (data.sources ?? []).filter(s => s.url).map(s => ({ title: s.api || s.tool || "Source", url: s.url as string }));
    // The on-screen sources are listed only when the teacher actually read the screen values.
    const usedScreen = (data.tool_calls ?? []).some(c => c.tool === "get_screen_values");
    return { answer: data.answer.replace(/\*\*(.+?)\*\*/g, "$1"), sources, usedScreen };
  } finally { clearTimeout(timer); }
}
export function TeacherPanel({ onClose }: { onClose?: () => void }) {
  const { context, messages, busy, ask: askTeacher, clearChat } = useTeacher();
  const [question, setQuestion] = useState("");
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages]);
  function ask(value: string) {
    if (!value.trim() || busy) return;
    setQuestion("");
    askTeacher(value);
  }
  return <aside className={styles.teacher} aria-labelledby={onClose ? "teacher-dialog-title" : "teacher-title"}>
    <header><h2 id={onClose ? "teacher-dialog-title" : "teacher-title"}>✦ Your history teacher</h2>{messages.length > 0 && <button type="button" className={styles.clearChat} onClick={clearChat} disabled={busy}>Clear chat</button>}{onClose && <button type="button" onClick={onClose} aria-label="Close teacher">×</button>}</header>
    <p className={styles.caption}>{context?.title ?? "Learn from the evidence"}</p>
    <p className={styles.teacherNotice}>AI teacher · quotes published data only, never estimates</p>
    <div className={styles.teacherLog} ref={log} role="log" aria-live="polite"><div className={styles.answer}>Let’s read the data together. Ask about Census periods, missing information, housing benchmarks or recommendation tradeoffs.</div>{messages.map(message => <div key={message.id}><p className={styles.question}>{message.question}{message.page && <span className={styles.askedOn}>Asked on: {message.page}</span>}</p><div className={styles.answer} aria-busy={message.status === "pending"}><p>{message.answer}</p>{message.status === "fallback" && <p className={styles.teacherNotice}>The AI teacher is unavailable, so this is a prepared explanation.</p>}{message.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}{(message.status === "fallback" || message.usedScreen) && message.screenSources.filter(source => !message.sources.some(s => s.url === source.url)).map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div></div>)}</div>
    <form className={styles.teacherForm} onSubmit={event => { event.preventDefault(); ask(question); }}>
      <div className={styles.prompts}>{["Explain these Census values", "How do data gaps affect comparisons?", "What historical evidence should I look for?"].map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>
      <label className={styles.srOnly} htmlFor={onClose ? "teacher-dialog-question" : "teacher-question"}>Ask about the data</label><textarea id={onClose ? "teacher-dialog-question" : "teacher-question"} maxLength={1000} rows={2} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about the data…" required /><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Thinking…" : "Send"}</button>
    </form>
  </aside>;
}
