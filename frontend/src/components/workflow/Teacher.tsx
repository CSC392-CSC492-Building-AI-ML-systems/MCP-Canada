"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { NeighbourhoodProfile } from "../explorer/types";
import { measuredNumber, money } from "../explorer/NeighbourhoodDetailsPanel";
import styles from "./workflow.module.css";
export type TeachingContext = { title: string; profiles: NeighbourhoodProfile[] } | null;
const TeacherContext = createContext<{ context: TeachingContext; setContext: (value: TeachingContext) => void; openTeacher: () => void }>({ context: null, setContext: () => {}, openTeacher: () => {} });
export const useTeacher = () => useContext(TeacherContext);
export function TeacherProvider({ children }: { children: ReactNode }) {
  const [context, setContext] = useState<TeachingContext>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const openTeacher = useCallback(() => setOpen(true), []);
  const isMap = ["/housing", "/housing/saved", "/housing/recommended", "/housing/across-time"].includes(pathname?.replace(/\/$/, "") ?? "");
  const panel = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !panel.current?.open) panel.current?.showModal();
    if (!open && panel.current?.open) panel.current?.close();
  }, [open]);
  return <TeacherContext.Provider value={{ context, setContext, openTeacher }}>{children}
    {!pathname?.startsWith("/housing/compare") && !(isMap && context) && <button type="button" className={styles.teacherLauncher} onClick={openTeacher}>✦ Ask the AI teacher</button>}
    <dialog ref={panel} className={styles.teacherDialog} onCancel={() => setOpen(false)} onClose={() => setOpen(false)} aria-label="Your history teacher"><TeacherPanel onClose={() => setOpen(false)} /></dialog>
  </TeacherContext.Provider>;
}
export function explainEvidence(question: string, context: TeachingContext): string {
  const profiles = context?.profiles ?? [];
  if (/commute|school|safety|amenit|lifestyle|bedroom|gap|missing|unavailable/i.test(question)) return "Commute times, safety, amenity distances, bedroom-specific rents and lifestyle scores are not connected. Those factors are excluded, not estimated. Your saved preferences do not make those measurements available.";
  if (/history|historic|change|time|evidence/i.test(question)) return "The map uses present-day imagery. Census years describe published measurements, not historical photographs. Keep one boundary set across time: Historical 140 has 2001–2016; Current 158 has 2021. Earlier average gross rent and later median shelter cost differ in definition, so a percentage change between them would be misleading. No historical cause is established without dated records.";
  if (/recommend|score|rank|tradeoff/i.test(question)) return "The current starting points are filtered to your rent budget and ordered by the lowest published 2021 renter shelter cost; if none fit, the lowest available benchmarks are shown above budget. They are budget illustrations, not current listings or an overall neighbourhood fit score. Commute, lifestyle, bedrooms and safety do not affect the order because those datasets are unavailable. Review the missing factors before choosing a place.";
  if (profiles.length) return profiles.map(p => {
    const n = measuredNumber(p.metrics.cost);
    return `${p.geography.name}: ${p.year} Census renter shelter cost ${n === null ? "unavailable" : `${money(n)} per month`}. Household-income reference year: ${p.metrics.income.reference_year ?? "unavailable"}. Dollar amounts are nominal, not current asking rents. A dash means unavailable, never zero.`;
  }).join("\n\n");
  return "Start by opening the map and selecting a neighbourhood, or compare saved places. I can explain the loaded Census values, their years, missing data and comparison limits. This source guide uses prepared explanations; an AI model is not connected yet.";
}
export function TeacherPanel({ onClose }: { onClose?: () => void }) {
  const { context } = useTeacher();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<{ question: string; answer: string; context: TeachingContext }[]>([]);
  const log = useRef<HTMLDivElement>(null);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [messages]);
  function ask(value: string) {
    if (!value.trim()) return;
    setMessages(previous => [...previous, { question: value.trim(), answer: explainEvidence(value, context), context }].slice(-20));
    setQuestion("");
  }
  return <aside className={styles.teacher} aria-labelledby={onClose ? "teacher-dialog-title" : "teacher-title"}>
    <header><h2 id={onClose ? "teacher-dialog-title" : "teacher-title"}>✦ Your history teacher</h2>{onClose && <button type="button" onClick={onClose} aria-label="Close teacher">×</button>}</header>
    <p className={styles.caption}>{context?.title ?? "Learn from the evidence"}</p>
    <p className={styles.teacherNotice}>Source guide · AI model not connected</p>
    <div className={styles.teacherLog} ref={log} role="log" aria-live="polite"><div className={styles.answer}>Let’s read the data together. Ask about Census periods, missing information, housing benchmarks or recommendation tradeoffs.</div>{messages.map((message, index) => <div key={index}><p className={styles.question}>{message.question}</p><div className={styles.answer}><p>{message.answer}</p>{[...new Map(message.context?.profiles.flatMap(p => Object.values(p.metrics).flatMap(m => m.source ? [[m.source.id, m.source] as const] : [])) ?? []).values()].map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a>)}</div></div>)}</div>
    <form className={styles.teacherForm} onSubmit={event => { event.preventDefault(); ask(question); }}>
      <div className={styles.prompts}>{["Explain these Census values", "How do data gaps affect comparisons?", "What historical evidence should I look for?"].map(prompt => <button type="button" key={prompt} onClick={() => ask(prompt)}>{prompt}</button>)}</div>
      <label className={styles.srOnly} htmlFor={onClose ? "teacher-dialog-question" : "teacher-question"}>Ask about the data</label><textarea id={onClose ? "teacher-dialog-question" : "teacher-question"} maxLength={1000} rows={2} value={question} onChange={event => setQuestion(event.target.value)} placeholder="Ask about the data…" required /><button type="submit" className={styles.primary}>Send</button>
    </form>
  </aside>;
}
