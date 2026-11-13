'use client';

import Link from 'next/link';
import { useState } from 'react';
import styles from './profile.module.css';

const lifestyleOptions = [
  'Family-friendly', 'Transit access', 'Parks & green space', 'Restaurants & nightlife',
  'Quiet & residential', 'Cultural community', 'Walkable errands', 'Good school access',
];
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

export default function Home() {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [topic, setTopic] = useState<DataTopic>("rent");
  const [geographyId, setGeographyId] = useState("");
  const [indicatorId, setIndicatorId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [annualIncome, setAnnualIncome] = useState("");
  const [rentSharePercent, setRentSharePercent] = useState("30");
  const [observationResult, setObservationResult] =
    useState<ObservationResult | null>(null);
  const [observationError, setObservationError] =
    useState<ObservationError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    getJson<Catalog>("/api/catalog/", controller.signal)
      .then((data) => {
        setCatalog(data);
        const selection = defaultHousingSelection(data);
        setGeographyId(selection.geography?.id ?? "");
        setIndicatorId(selection.indicator?.id ?? "");
        setSourceId(selection.source?.id ?? "");
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCatalogError(
            error instanceof Error ? error.message : "Could not load housing data.",
          );
        }
      });

    return () => controller.abort();
  }, []);

  const selectedGeography = catalog?.geographies.find(
    (geography) => geography.id === geographyId,
  );
  const indicators = useMemo(
    () =>
      catalog
        ? indicatorsForGeography(
            indicatorsForTopic(catalog, topic),
            selectedGeography,
          )
        : [],
    [catalog, selectedGeography, topic],
  );
  const selectedIndicator = indicators.find(
    (indicator) => indicator.id === indicatorId,
  );
  const availableSources = catalog
    ? sourcesForSelection(catalog, selectedGeography, selectedIndicator)
    : [];

  const selectionKey = `${geographyId}:${indicatorId}:${sourceId}`;

  useEffect(() => {
    if (!geographyId || !indicatorId || !sourceId) return;

    const controller = new AbortController();
    const query = new URLSearchParams({
      geography_id: geographyId,
      indicator_id: indicatorId,
      source_id: sourceId,
    });

    getJson<{ observations: Observation[] }>(
      `/api/observations/?${query.toString()}`,
      controller.signal,
    )
      .then((data) => {
        setObservationResult({
          key: `${geographyId}:${indicatorId}:${sourceId}`,
          rows: data.observations,
        });
        setObservationError(null);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setObservationError({
            key: `${geographyId}:${indicatorId}:${sourceId}`,
            message:
              error instanceof Error ? error.message : "Could not load housing records.",
          });
        }
      });

    return () => controller.abort();
  }, [geographyId, indicatorId, sourceId]);

  const observations =
    observationResult?.key === selectionKey ? observationResult.rows : null;
  const currentError =
    observationError?.key === selectionKey ? observationError.message : null;
  const loadingObservations =
    Boolean(geographyId && indicatorId && sourceId) &&
    observations === null &&
    currentError === null;

  const selectedSource = availableSources.find(
    (source) => source.id === sourceId,
  );

  const rentShareValue = Number(rentSharePercent);
  const hasValidRentShare =
    rentSharePercent.trim() !== "" &&
    Number.isFinite(rentShareValue) &&
    rentShareValue >= 0 &&
    rentShareValue <= 100;
  const monthlyRentBudget = calculateMonthlyRentBudget(
    annualIncome,
    rentSharePercent,
  );
    useEffect(() => {
    localStorage.setItem(
      "mcp-canada-budget-preferences",
      JSON.stringify({
        before_tax_income: annualIncome.trim()
          ? Number(annualIncome) / 12
          : null,
        monthly_rent: monthlyRentBudget,
      })
    );

    window.dispatchEvent(new Event("budget-preferences-change"));
  }, [annualIncome, monthlyRentBudget]);

  const chartRows = (observations ?? []).filter(
    (row) => row.status === "observed" && row.value !== null,
  );
  const chartMaximum = Math.max(
    1,
    ...chartRows.map((row) => Math.abs(Number(row.value))),
  );

  return (
    <div className={styles.page}>
      <nav className={styles.nav} aria-label="Profile navigation">
        <Link href="/" className={styles.brand}>NEIGHBOURHOOD / EXPLORER</Link>
        <span className={styles.current} aria-current="step">1 Your profile</span>
        <Link href="/housing/">2 Explore map</Link>
        <span aria-disabled="true" title="Comparison is available from saved places in the explorer">3 Compare</span>
      </nav>
      <main className={styles.main}>
        <header className={styles.intro}>
          <p className={styles.eyebrow}>YOUR PROFILE · STEP 1 OF 3</p>
          <h1>Tell us what you need from a neighbourhood</h1>
          <p>Share your budget, commute and priorities. You don’t need to know any neighbourhood names.</p>
        </header>

        <form onChange={() => { setSample(''); setSubmitted(false); }} onSubmit={event => { event.preventDefault(); setSubmitted(true); }}>
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
                <p>Use an approximate income or leave it blank. Your entries stay in this form while it’s open.</p>
              </div>
            </section>
          </div>

          <section className={styles.actions} aria-labelledby="profile-actions">
            <div><h2 id="profile-actions">Ready to explore places that fit you?</h2>
              <p>This preview collects your preferences. Personalized matching is still in development.</p></div>
            <button type="submit">Find my neighbourhoods →</button>
          </section>
          <div className={styles.result} aria-live="polite">
            {submitted && <p>Your profile is ready to preview. <Link href="/housing/">Explore neighbourhoods on the map →</Link></p>}
          </div>
        </form>
      </main>
    </div>
  );
}
