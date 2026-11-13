import Link from "next/link";
import styles from "./workflow.module.css";
export function WorkflowHeader({ compare = false }: { compare?: boolean }) {
  return <header className={styles.header}><Link href="/" className={styles.brand}>NEIGHBOURHOOD / EXPLORER</Link><span className={styles.context}>Toronto · Neighbourhoods</span><nav aria-label="Exploration views"><Link href="/housing/">3D Map explorer</Link><Link href="/housing/compare/" aria-current={compare ? "page" : undefined}>Compare selection</Link><span>WITH A TEACHER</span></nav>
    {/* eslint-disable-next-line @next/next/no-img-element -- fixed-size local Figma icon */}
    <Link href="/housing/profile/" className={styles.profile} aria-label="Open your profile"><img src="/icons/explorer/profile.svg" width={24} height={24} alt="" /></Link>
  </header>;
}
