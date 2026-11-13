import type { Metadata } from 'next';
import Link from 'next/link';
import styles from './personalize.module.css';

export const metadata: Metadata = { title: 'Personalize your search | Neighbourhood Explorer' };

export default function PersonalizePage() {
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}>NEIGHBOURHOOD / EXPLORER</Link>
        <p className={styles.steps}>PERSONALIZE → EXPLORE → COMPARE</p>
        <Link href="/housing/profile/" className={styles.profile} aria-label="Open your profile">
          {/* eslint-disable-next-line @next/next/no-img-element -- local Figma icon */}
          <img src="/icons/explorer/profile.svg" width={24} height={24} alt="" /></Link>
      </header>
      <main className={styles.main}>
        <p className={styles.kicker}>BEFORE YOU EXPLORE</p>
        <h1>Make your search your own</h1>
        <p className={styles.intro}>
          Set your budget, commute and priorities, or start by exploring Toronto. You can fill out your profile at any time.
        </p>

        <div className={styles.choices}>
          <section className={`${styles.card} ${styles.tailored}`} aria-labelledby="personalize-heading">
            <p className={styles.kicker}>TAILORED TO YOUR NEEDS</p>
            <h2 id="personalize-heading">Personalize my search</h2>
            <p>Tell us what you’d look for in a neighbourhood.</p>
            <ul className={styles.checklist}>
              <li>Budget &amp; bedrooms</li>
              <li>Work or school commute</li>
              <li>Everyday needs &amp; lifestyle</li>
              <li>Your priorities &amp; history interests</li>
            </ul>
            <div className={styles.action}>
              <Link href="/housing/profile/" className={styles.primary}>Fill out my preferences <span aria-hidden="true">→</span></Link>
              <p>Optional questions can be left blank.</p>
            </div>
          </section>

          <section className={styles.card} aria-labelledby="explore-heading">
            <p className={styles.kicker}>START EXPLORING</p>
            <h2 id="explore-heading">Explore near me</h2>
            <p>Skip the profile and browse neighbourhoods and local history on the map.</p>
            <div className={styles.location}>
              <strong>Map preview starts in Toronto</strong>
              <p>Search the map to choose a Toronto neighbourhood, street or building.</p>
            </div>
            <div className={styles.action}>
              <Link href="/housing/" className={styles.secondary}>Skip for now · open the map <span aria-hidden="true">→</span></Link>
            </div>
          </section>
        </div>

        <footer className={styles.footer}>
          <p>Budget-based starting points use published Census data. Other preference factors are shown as unavailable.</p>
          <Link href="/" className={styles.secondary}><span aria-hidden="true">←</span> Back to home</Link>
        </footer>
      </main>
    </div>
  );
}
