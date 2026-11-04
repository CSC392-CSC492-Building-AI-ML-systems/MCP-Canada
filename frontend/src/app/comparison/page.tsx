
"use client";

import styles from "./comparison.module.css";

const neighbourhoods = [
  {
    name: "Erindale",
    score: 72,
    rent: "$2,950",
    income: "49%",
    budget: "No",
    work: "11 min",
    school: "15 min",
    schools: "9",
    grocery: "300 m",
    transit: "38",
    parks: "6",
    safety: "72 / 100",
    lifestyle: "75 / 100",
    gaps: "None in sample",
  },
  {
    name: "Cooksville",
    score: 63,
    rent: "$2,650",
    income: "44%",
    budget: "No",
    work: "23 min",
    school: "26 min",
    schools: "7",
    grocery: "650 m",
    transit: "22",
    parks: "10",
    safety: "78 / 100",
    lifestyle: "82 / 100",
    gaps: "None in sample",
  },
  {
    name: "Port Credit",
    score: 53,
    rent: "$2,300",
    income: "38%",
    budget: "Yes",
    work: "31 min",
    school: "37 min",
    schools: "—",
    grocery: "400 m",
    transit: "16",
    parks: "7",
    safety: "—",
    lifestyle: "75 / 100",
    gaps: "School locations; safety",
  },
];

const rows = [
  { label: "Match score", key: "score", best: 0 },
  { label: "Avg 2-bed rent", key: "rent", best: 2 },
  { label: "Share of income", key: "income", best: 2 },
  { label: "Within $2,400 budget", key: "budget", best: 2 },
  { label: "To work by transit", key: "work", best: 0 },
  { label: "To school by transit", key: "school", best: 0 },
  { label: "Schools within 1 km", key: "schools", best: 0 },
  { label: "Nearest grocery", key: "grocery", best: 0 },
  { label: "Transit stops within 1 km", key: "transit", best: 0 },
  { label: "Parks within 1 km", key: "parks", best: 1 },
  { label: "Safety index", key: "safety", best: 1 },
  { label: "Lifestyle match", key: "lifestyle", best: 1 },
  { label: "Data gaps", key: "gaps", best: -1 },
] as const;

function MapCard({ index }: { index: number }) {
  return (
    <div className={`${styles.map} ${styles[`map${index + 1}`]}`}>
      <div className={styles.park} />
      <div className={styles.road} />
      <div className={styles.roadTwo} />
      <div className={styles.blocks}>
        {Array.from({ length: 9 }).map((_, i) => (
          <span key={i} />
        ))}
      </div>
      <span className={styles.pin}>♥</span>
    </div>
  );
}

export default function ComparisonPage() {
  return (
    <div className={styles.dashboard}>
      <main className={styles.main}>
        <p className={styles.eyebrow}>
          COMPARE PLACES · ONE SHARED PERIOD
        </p>

        <h1>Side-by-side comparison</h1>

        <p className={styles.subtitle}>
          Different neighbourhoods, the same time period.
          Compare fit, everyday needs and local context.
        </p>

        <div className={styles.controls}>
          <div className={styles.period}>
            <span>PERIOD FOR ALL LOCATIONS</span>
            <strong>2026 ⌄</strong>
          </div>

          <div className={styles.profile}>
            <span>SAMPLE PROFILE · SAME ASSUMPTIONS FOR EVERY PLACE</span>
            <p>
              2 bedrooms · $2,400 rent budget · $6,000 monthly income ·
              30 min work commute
            </p>
          </div>
        </div>

        <p className={styles.note}>
          Green cells mark the best available value in each row.
          — means missing, never zero. All figures are illustrative.
        </p>

        <section className={styles.comparison}>
          <h2>2026 snapshot</h2>

          <div className={styles.neighbourhoods}>
            {neighbourhoods.map((n, i) => (
              <div className={styles.place} key={n.name}>
                <MapCard index={i} />
                <h3>{n.name}</h3>
                <span>Mississauga · Illustrative</span>
                <small>Map concept · not geographic evidence</small>
              </div>
            ))}
          </div>

          <div className={styles.tableWrap}>
            <table>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <th>{row.label}</th>

                    {neighbourhoods.map((n, i) => {
                      const value = n[row.key];
                      const isBest =
                        row.best === i && value !== "—";

                      return (
                        <td
                          key={n.name}
                          className={isBest ? styles.best : ""}
                        >
                          {value}
                          {row.key === "score" && " / 100"}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <p className={styles.disclaimer}>
          Illustrative comparison data only. Replace sample figures
          with verified neighbourhood data before presenting results.
        </p>
        
        {/* AI-generated neighbourhood recommendations */}
        <section className={styles.recommendations}>
          <h2>Where could you live?</h2>

          <div className={styles.aiBanner}>
            <h3>✦ AI-generated recommendations</h3>
            <p>
              These suggestions use the sample profile and illustrative
              comparison data. They are a starting point and are not yet
              personalized to you.
            </p>
            <p>
              For more personalized recommendations, fill out your profile
              with your budget, work or school destination, everyday needs
              and lifestyle preferences.
            </p>
            <span className={styles.primaryAction}>
              Complete your profile →
            </span>
          </div>

          <div className={styles.recommendationGrid}>
            <article className={styles.recommendationCard}>
              <h3>Best sample overall · Erindale</h3>
              <p>
                Consider Erindale if shorter commutes and transit access
                matter most. It has the highest illustrative match score
                (72/100), but $2,950 rent exceeds the sample budget by $550.
              </p>
            </article>

            <article className={styles.recommendationCard}>
              <h3>For parks & lifestyle · Cooksville</h3>
              <p>
                Consider Cooksville if parks and lifestyle fit are
                priorities. The sample commute is 23 min; $2,650 rent
                exceeds the sample budget by $250.
              </p>
            </article>

            <article className={styles.recommendationCard}>
              <h3>For the sample budget · Port Credit</h3>
              <p>
                Consider Port Credit if the $2,400 rent limit is your
                priority. Sample rent is $2,300, but the 31 min commute
                exceeds the sample limit. School and safety data are missing.
              </p>
            </article>
          </div>
        </section>

        {/* Local historical context */}
        <section className={styles.history}>
          <h2>Local history in context · viewing 2026</h2>

          <p>
            Compare how each neighbourhood's past shaped today's housing,
            transport and community spaces. Historical context stays
            separate from the present-day match score.
          </p>

          <div className={styles.historyGrid}>
            <article>
              <h3>Erindale</h3>
              <p>How did learning spaces shape the surrounding community?</p>
              <span>No dated records linked</span>
            </article>

            <article>
              <h3>Cooksville</h3>
              <p>How did transport connections influence local growth?</p>
              <span>No dated records linked</span>
            </article>

            <article>
              <h3>Port Credit</h3>
              <p>How did waterfront land use shape everyday life?</p>
              <span>No dated records linked</span>
            </article>
          </div>
        </section>

        {/* Data methodology */}
        <section className={styles.method}>
          <h2>Illustrative data & method</h2>

          <p>
            Scores and measurements demonstrate the comparison layout;
            no live datasets are connected. Match scores are sample
            outputs, not calculated from this table. Missing factors
            must be excluded and available weights normalized in the
            connected product.
          </p>

          <p>
            Sources to connect: CMHC · Statistics Canada · OpenStreetMap
            · MiWay / GO Transit · municipal safety records · local
            archives. Use matching geographic coverage and reference
            dates; show the actual vintage where 2026 data is unavailable.
          </p>
        </section>

        {/* Bottom navigation */}
        <div className={styles.bottomActions}>
          <span>← Back to map</span>
          <span>Complete your profile</span>
        </div>

        </main>

      {/* Reserved for teammate's history teacher sidebar */}
      <aside
        className={styles.sidebar}
        aria-label="Reserved sidebar for history teacher feature"
      />
    </div>
  );
}
