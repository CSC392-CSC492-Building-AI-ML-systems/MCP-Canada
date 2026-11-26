"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { NeighbourhoodProfile } from "../explorer/types";
import { measuredNumber, money } from "../explorer/NeighbourhoodDetailsPanel";
import type { ScreenScore } from "./scoring";
import styles from "./workflow.module.css";
/** What is on screen. `match_scores` is sent to the teacher as shown, so it quotes rather than recomputes. */
export type TeachingContext = { title: string; match_scores?: ScreenScore[]; profiles: NeighbourhoodProfile[] } | null;
const TeacherContext = createContext<{ context: TeachingContext; setContext: (value: TeachingContext) => void; openTeacher: () => void; scores: string | null; setScores: (value: string | null) => void }>({ context: null, setContext: () => {}, openTeacher: () => {}, scores: null, setScores: () => {} });
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
  const pathname = usePathname();
  const openTeacher = useCallback(() => setOpen(true), []);
  const isMap = ["/housing", "/housing/saved", "/housing/recommended", "/housing/across-time"].includes(pathname?.replace(/\/$/, "") ?? "");
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !panel.current?.open) panel.current?.showModal();
    if (!open && panel.current?.open) panel.current?.close();
  }, [open]);
  return <TeacherContext.Provider value={{ context, setContext, openTeacher, scores, setScores }}>{children}
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
type TeacherSource = { title: string; url: string };
type TeacherMessage = { id: number; question: string; answer: string; context: TeachingContext; sources: TeacherSource[]; usedScreen?: boolean; status: "pending" | "agent" | "fallback" };
/** Ask the backend agent (Django /api/teacher/ask/). Throws if it is unavailable, so the caller can fall back. */
export async function askAgent(question: string, context: TeachingContext, timeoutMs = 60000): Promise<{ answer: string; sources: TeacherSource[]; usedScreen: boolean }> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch("/api/teacher/ask/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question, context }), signal: abort.signal });
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
  const { context: screen, scores } = useTeacher();
  const context = withScores(screen, scores);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<TeacherMessage[]>([]);
  const busy = messages.some(m => m.status === "pending");
  const nextId = useRef(0);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages]);
  async function ask(value: string) {
    const asked = value.trim();
    if (!asked || busy) return;
    nextId.current += 1;
    const id = nextId.current;
    setMessages(previous => [...previous, { id, question: asked, answer: "Looking up the published data…", context, sources: [], status: "pending" as const }].slice(-20));
    setQuestion("");
    let update: Partial<TeacherMessage>;
    try { update = { ...await askAgent(asked, context), status: "agent" }; }
    catch { update = { answer: explainEvidence(asked, context), status: "fallback" }; }
    setMessages(previous => previous.map(m => m.id === id ? { ...m, ...update } : m));
  }
  return <aside className={styles.teacher} aria-labelledby={onClose ? "teacher-dialog-title" : "teacher-title"}>
    <header><h2 id={onClose ? "teacher-dialog-title" : "teacher-title"}>✦ Your history teacher</h2>{onClose && <button type="button" onClick={onClose} aria-label="Close teacher">×</button>}</header>
    <p className={styles.caption}>{context?.title ?? "Learn from the evidence"}</p>
    <p className={styles.teacherNotice}>AI teacher · quotes published data only, never estimates</p>
    <div className={styles.teacherLog} ref={log} role="log" aria-live="polite"><div className={styles.answer}>Let’s read the data together. Ask about Census periods, missing information, housing benchmarks or recommendation tradeoffs.</div>{messages.map(message => <div key={message.id}><p className={styles.question}>{message.question}</p><div className={styles.answer} aria-busy={message.status === "pending"}><p>{message.answer}</p>{message.status === "fallback" && <p className={styles.teacherNotice}>The AI teacher is unavailable, so this is a prepared explanation.</p>}{message.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}{(message.status === "fallback" || message.usedScreen) && [...new Map(message.context?.profiles.flatMap(p => Object.values(p.metrics).flatMap(m => m.source ? [[m.source.id, m.source] as const] : [])) ?? []).values()].map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div></div>)}</div>
    <form className={styles.teacherForm} onSubmit={event => { event.preventDefault(); ask(question); }}>
      <div className={styles.prompts}>{["Explain these Census values", "How do data gaps affect comparisons?", "What historical evidence should I look for?"].map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>
      <label className={styles.srOnly} htmlFor={onClose ? "teacher-dialog-question" : "teacher-question"}>Ask about the data</label><textarea id={onClose ? "teacher-dialog-question" : "teacher-question"} maxLength={1000} rows={2} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about the data…" required /><button type="submit" className={styles.primary} disabled={busy}>{busy ? "Thinking…" : "Send"}</button>
    </form>
  </aside>;
}
