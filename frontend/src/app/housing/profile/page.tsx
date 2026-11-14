'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { useRouter } from 'next/navigation';
import { LIFESTYLE_OPTIONS, PROFILE_KEY, RECOMMENDED_KEY, clearProfile, parseProfile, readSession, subscribeSession, writeSession, type SearchProfile } from '@/components/workflow/state';
import styles from '../data/profile.module.css';

const lifestyleOptions = LIFESTYLE_OPTIONS;
const historyOptions = ['Community stories', 'Transport & growth', 'Buildings & heritage'];
const factors = ['Affordability', 'Commute to work', 'School distance', 'Nearby amenities', 'Safety', 'Lifestyle match'];
const modes = ['Transit', 'Walk', 'Bike', 'Drive'];
const samples = [
  { name: 'The Wilsons · newcomer family', income: '96000', rent: '2800', bedrooms: '3', trip: 45, priorities: [0, 2, 7], weights: [5, 4, 5, 3, 4, 4] },
  { name: 'Raya · new graduate', income: '58000', rent: '1750', bedrooms: '1', trip: 35, priorities: [1, 3, 6], weights: [5, 5, 0, 4, 3, 4] },
  { name: 'Lisa · single parent', income: '72000', rent: '2400', bedrooms: '2', trip: 30, priorities: [0, 4, 7], weights: [5, 4, 5, 2, 5, 3] },
];
const money = new Intl.NumberFormat('en-CA', {
  style: 'currency', currency: 'CAD', maximumFractionDigits: 0,
});

export default function ProfilePage() {
  const raw = useSyncExternalStore(subscribeSession, () => readSession(PROFILE_KEY), () => null);
  return <ProfileForm key={raw ?? "new"} initial={parseProfile(raw)} />;
}
function ProfileForm({ initial }: { initial: SearchProfile | null }) {
  const router = useRouter();
  const [sample, setSample] = useState('');
  const [income, setIncome] = useState(initial?.income ?? '');
  const [rent, setRent] = useState(initial?.rent ?? '');
  const [bedrooms, setBedrooms] = useState(initial?.bedrooms ?? '');
  const [mode, setMode] = useState(initial?.mode ?? 'Transit');
  const [work, setWork] = useState(initial?.work ?? '');
  const [school, setSchool] = useState(initial?.school ?? '');
  const [trip, setTrip] = useState(initial?.trip ?? 30);
  const [priorities, setPriorities] = useState<number[]>(initial?.priorities ?? []);
  const [weights, setWeights] = useState(initial?.weights ?? [3, 3, 3, 3, 3, 3]);
  const [interests, setInterests] = useState<string[]>(initial?.interests ?? []);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [submitted, setSubmitted] = useState(false);
  const monthly = Number(income) / 12;

  function applySample(profile: (typeof samples)[number]) {
    setSample(profile.name);
    setIncome(profile.income);
    setRent(profile.rent);
    setBedrooms(profile.bedrooms);
    setTrip(profile.trip);
    setPriorities(profile.priorities);
    setWeights(profile.weights);
    setWork('');
    setSchool('');
    setMode('Transit');
    setInterests(profile.name.startsWith('Lisa') ? ['Community stories'] : []);
    setNotes('');
  }

  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Profile navigation">
        <Link href="/" className={styles.brand}>NEIGHBOURHOOD / EXPLORER</Link>
        <span className={styles.current} aria-current="step">1 Your profile</span>
        <Link href="/housing/">2 Explore map</Link>
        <Link href="/housing/compare/">3 Compare</Link>
      </nav>
      <main className={styles.main}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>YOUR PROFILE · STEP 1 OF 3</p>
          <h1>Tell us what you need from a neighbourhood</h1>
          <p>Share your budget, commute and priorities. You don’t need to know any neighbourhood names.</p>
        </header>

        <div className={styles.profileTools}><Link href="/housing/personalize/">← Back to choices</Link><button type="button" onClick={() => { clearProfile(); router.refresh(); }}>Clear saved profile</button></div>
        <form onChange={() => { setSample(''); setSubmitted(false); }} onSubmit={event => {
          event.preventDefault();
          const profile: SearchProfile = { version: 1, income, rent, bedrooms, mode, work, school, trip, priorities, weights, interests, notes };
          if (!parseProfile(JSON.stringify(profile))) { setSubmitted(true); return; }
          writeSession(PROFILE_KEY, JSON.stringify(profile));
          writeSession(RECOMMENDED_KEY, "[]");
          router.push("/housing/recommended/");
        }}>
          <div className={styles.samples}>
            <strong>Try a sample profile:</strong>
            {samples.map(profile => (
              <button key={profile.name} type="button" aria-pressed={sample === profile.name}
                onClick={() => { applySample(profile); setSubmitted(false); }}>
                {profile.name}
              </button>
            ))}
          </div>

          <div className={styles.threeColumns}>
            <section className={styles.card} aria-labelledby="profile-budget">
              <h2 id="profile-budget">Budget</h2>
              <p>Enter a monthly rent budget in CAD. Income is optional.</p>
              <label>Annual household income before tax · optional
                <input type="number" min="1" step="any" value={income} placeholder="72,000" onChange={e => setIncome(e.target.value)} />
              </label>
              <div className={styles.pair}>
                <label>Max monthly rent
                  <input type="number" min="1" step="any" required value={rent} placeholder="2,400" onChange={e => setRent(e.target.value)} />
                </label>
                <label>Bedrooms needed
                  <select required value={bedrooms} onChange={e => setBedrooms(e.target.value)}>
                    <option value="">Select</option>
                    <option value="0">Studio</option>
                    <option value="1">1 bedroom</option>
                    <option value="2">2 bedrooms</option>
                    <option value="3">3 bedrooms</option>
                    <option value="4">4+ bedrooms</option>
                  </select>
                </label>
              </div>
              <div className={styles.context} aria-live="polite">
                <strong>Your budget in context</strong>
                {monthly > 0 && Number(rent) > 0
                  ? <p>{money.format(Number(rent))} is {Math.round(Number(rent) / monthly * 100)}% of {money.format(monthly)} monthly before-tax income. The 30% reference point is {money.format(monthly * .3)}/month.</p>
                  : <p>Add income and rent to see how much of your monthly income the rent would use.</p>}
                <small>Use the 30% figure as a general reference alongside your own budget.</small>
              </div>
            </section>

            <section className={styles.card} aria-labelledby="profile-travel">
              <h2 id="profile-travel">Getting around</h2>
              <p>Leave either destination blank if it doesn’t apply.</p>
              <label>Workplace or regular destination · optional
                <input value={work} onChange={e => setWork(e.target.value)} placeholder="Enter an address or place" />
              </label>
              <label>School destination · optional
                <input value={school} onChange={e => setSchool(e.target.value)} placeholder="Enter a school or address" />
              </label>
              <fieldset>
                <legend>How will you usually travel?</legend>
                <div className={styles.chips}>
                  {modes.map(option => <button key={option} type="button" aria-pressed={mode === option}
                    onClick={() => { setMode(option); setSample(''); setSubmitted(false); }}>{option}</button>)}
                </div>
              </fieldset>
              <label>Longest acceptable one-way trip: {trip} min
                <input type="range" min="0" max="120" step="5" value={trip} onChange={e => setTrip(Number(e.target.value))} />
              </label>
              <div className={styles.rangeEnds}><span>0 min</span><span>120 min</span></div>
            </section>

            <section className={styles.card} aria-labelledby="profile-lifestyle">
              <h2 id="profile-lifestyle">Lifestyle priorities</h2>
              <p>Choose up to 3.</p>
              <div className={styles.chips}>
                {lifestyleOptions.map((option, index) => {
                  const selected = priorities.includes(index);
                  return <button key={option} type="button" aria-pressed={selected}
                    disabled={!selected && priorities.length === 3}
                    onClick={() => {
                      setPriorities(selected ? priorities.filter(value => value !== index) : [...priorities, index]);
                      setSample('');
                      setSubmitted(false);
                    }}>{option}</button>;
                })}
              </div>
              <small aria-live="polite">{priorities.length} of 3 selected</small>
            </section>
          </div>

          <div className={styles.twoColumns}>
            <section className={styles.card} aria-labelledby="profile-weights">
              <h2 id="profile-weights">What matters most?</h2>
              <p>Set each factor from 0 (ignore) to 5 (very important).</p>
              <div className={styles.weights}>
                {factors.map((factor, index) => (
                  <label key={factor} className={styles.weight}>
                    <span>{factor}</span>
                    <input type="range" min="0" max="5" value={weights[index]}
                      onChange={e => setWeights(weights.map((value, position) => position === index ? Number(e.target.value) : value))} />
                    <span aria-hidden="true">{weights[index]}</span>
                  </label>
                ))}
              </div>
            </section>

            <section className={styles.card} aria-labelledby="profile-history">
              <h2 id="profile-history">Your history &amp; learning interests</h2>
              <p>Optional. These interests are for local history and learning.</p>
              <div className={styles.chips}>
                {historyOptions.map(option => <button key={option} type="button" aria-pressed={interests.includes(option)}
                  onClick={() => {
                    setInterests(interests.includes(option) ? interests.filter(value => value !== option) : [...interests, option]);
                    setSample('');
                    setSubmitted(false);
                  }}>{option}</button>)}
              </div>
              <label>Anything else we should know? · optional
                <textarea rows={3} value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="I enjoy learning how neighbourhoods changed over time." />
              </label>
              <div className={styles.context}>
                <strong>You’re in control</strong>
                <p>Your entries stay in this browser tab for this session. Income, destinations and notes are not sent to the server. Clear your profile at any time.</p>
              </div>
            </section>
          </div>

          <section className={styles.actions} aria-labelledby="profile-actions">
            <div><h2 id="profile-actions">Ready to explore places that fit you?</h2>
              <p>Find up to five starting points using published 2021 Census housing costs. Commute, bedrooms, lifestyle and history matching are not connected yet; these preferences are saved for later.</p></div>
            <button type="submit">Find my neighbourhoods →</button>
          </section>
          <div className={styles.result} aria-live="polite">
            {submitted && <p role="alert">Check your budget, income and preference values before continuing.</p>}
          </div>
        </form>
      </main>
    </div>
  );
}
