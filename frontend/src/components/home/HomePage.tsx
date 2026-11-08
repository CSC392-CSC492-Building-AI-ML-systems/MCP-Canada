"use client";

import dynamic from 'next/dynamic';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {findBoundary, loadBoundaries} from '@/lib/boundaries';
import {MAPBOX_TOKEN, newSessionToken, placeHref, retrievePlace, suggestPlaces, type Suggestion} from '@/lib/mapbox';
import {loadWorkspaceData} from '../explorer/data';
import styles from './home.module.css';

// Client-only and split out, so mapbox-gl isn't part of the landing page's first load.
const LandingMapPreview=dynamic(()=>import('./LandingMapPreview'),{ssr:false,loading:()=><div className={styles.previewCard}/>});

type Place = {id:string;name:string};
const MIN_ADDRESS_QUERY=3;

export function HomePage() {
  const [query,setQuery]=useState('');
  const [places,setPlaces]=useState<Place[]>([]);
  const [searchState,setSearchState]=useState<'idle'|'loading'|'ready'|'error'>('idle');
  const [showResults,setShowResults]=useState(false);
  const [searchMessage,setSearchMessage]=useState('');
  const [found,setFound]=useState<{query:string;items:Suggestion[];failed?:boolean}|null>(null);
  const sessionRef=useRef<string|null>(null);
  const router=useRouter();
  const needle=query.trim().toLowerCase();
  const matching=places.filter(p=>p.name.toLowerCase().includes(needle)).slice(0,5);
  const searchesAddresses=!!MAPBOX_TOKEN&&needle.length>=MIN_ADDRESS_QUERY;
  const addressResult=searchesAddresses&&found?.query===needle?found:null;
  const addresses=addressResult?.items??[];
  const addressesPending=searchesAddresses&&!addressResult;
  useEffect(()=>{
    if(!MAPBOX_TOKEN||needle.length<MIN_ADDRESS_QUERY)return;
    const controller=new AbortController();
    const timer=setTimeout(()=>{
      sessionRef.current??=newSessionToken();
      suggestPlaces(needle,sessionRef.current,controller.signal)
        .then(items=>setFound({query:needle,items}))
        .catch(()=>{if(!controller.signal.aborted)setFound({query:needle,items:[],failed:true});});
    },250);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[needle]);
  async function chooseAddress(suggestion:Suggestion) {
    setSearchMessage('Opening that location…');
    try {
      sessionRef.current??=newSessionToken();
      const place=await retrievePlace(suggestion.mapboxId,sessionRef.current);
      const boundaries=await loadBoundaries('toronto-158');
      router.push(placeHref(place,findBoundary(boundaries,place.coordinates)?.properties.geography_id));
    }catch {setSearchMessage('Could not open that location. Try again or choose another result.');}
    finally {sessionRef.current=null;}
  }
  async function prepareSearch() {
    setShowResults(true);
    if(searchState==='ready'||searchState==='loading')return;
    setSearchState('loading');
    try {
      const data=await loadWorkspaceData();
      setPlaces(data.boundary_sets.find(s=>s.id==='toronto-158')?.neighbourhoods??[]);
      setSearchState('ready');
    }catch {setSearchState('error');}
  }
  function search(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();setShowResults(true);
    void prepareSearch();
    if(!needle){setSearchMessage('Enter a Toronto neighbourhood, street or building to search.');return;}
    if(matching[0]){router.push(`/housing/?neighbourhood=${encodeURIComponent(matching[0].id)}`);return;}
    if(addresses[0]){void chooseAddress(addresses[0]);return;}
    setSearchMessage(addressesPending?'Still searching. Choose a result below.':'');
  }
  return <div className={styles.home}>
    <header className={styles.header}><Link href="/" className={styles.brand} aria-label="Neighbourhood Explorer home"><span className={styles.brandIcon} aria-hidden="true">N</span><span>NEIGHBOURHOOD <span>/ EXPLORER</span></span></Link><nav aria-label="Main navigation"><Link href="/housing/">3D Map Explorer <span aria-hidden="true">↗</span></Link><a href="#about">About</a></nav></header>
    <main className={styles.main}>
      <section className={styles.hero} aria-labelledby="home-title"><div className={styles.heroCopy}><p className={styles.kicker}><span/>YOUR NEIGHBOURHOOD, THROUGH TIME</p><h1 id="home-title">Explore history<br/>on a <span>3D map.</span></h1><p className={styles.description}>Look around a neighbourhood in 3D. Move the timeline to see what changed, and inspect historical data beside the map.</p><Link className={styles.primary} href="/housing/">Open 3D Map Explorer <span aria-hidden="true">→</span></Link>
        <div className={styles.searchArea}><label htmlFor="place-search">Or search a neighbourhood, street, or building</label><form onSubmit={search} className={styles.searchForm} role="search"><span aria-hidden="true">⌕</span><input id="place-search" autoComplete="off" type="search" placeholder="Where would you like to explore?" value={query} onFocus={()=>void prepareSearch()} onChange={e=>{setQuery(e.target.value);setShowResults(true);setSearchMessage('');}} onKeyDown={e=>{if(e.key==='Escape')setShowResults(false);}} aria-describedby="search-scope"/><button type="submit" aria-label="Search places">→</button></form>
          <p id="search-scope" className={styles.searchScope}>{MAPBOX_TOKEN?'Search Toronto neighbourhoods, streets and buildings.':'Toronto neighbourhood search is available.'}</p>
          {showResults&&<div className={styles.searchResults} aria-label="Place search results"><div className={styles.searchResultsTop}><strong>Toronto places</strong><button type="button" aria-label="Close search results" onClick={()=>setShowResults(false)}>×</button></div>{searchState==='loading'?<p role="status">Finding neighbourhoods…</p>:searchState==='error'?<p role="status">Search is unavailable right now. You can still <Link href="/housing/">open the explorer</Link>.</p>:needle===''?<p>Start typing a neighbourhood, street or building, such as Annex or 100 Queen St W.</p>:<>
            {matching.length>0&&<><p className={styles.resultsLabel}>Neighbourhoods</p><ul>{matching.map(p=><li key={p.id}><Link href={`/housing/?neighbourhood=${encodeURIComponent(p.id)}`}>{p.name}<span aria-hidden="true">↗</span></Link></li>)}</ul></>}
            {addresses.length>0&&<><p className={styles.resultsLabel}>Streets, buildings and places</p><ul>{addresses.map(a=><li key={a.mapboxId}><button type="button" onClick={()=>void chooseAddress(a)}><span>{a.name}{a.detail&&<small>{a.detail}</small>}</span><span aria-hidden="true">↗</span></button></li>)}</ul></>}
            {addressesPending&&<p role="status">Searching streets and buildings…</p>}
            {addressResult?.failed&&<p role="status">Street and building search is unavailable right now.</p>}
            {!matching.length&&!addresses.length&&!addressesPending&&!addressResult?.failed&&<p>No matching place in Toronto.</p>}
          </>}{searchMessage&&<p role="status">{searchMessage}</p>}</div>}
        </div>
        <div className={styles.searchExamples}><span>TRY A PLACE</span>{['UTM campus','Davis Building','Instructional Centre'].map(place=><button type="button" key={place} onClick={()=>{setQuery(place);void prepareSearch();}}>{place} <span aria-hidden="true">↗</span></button>)}</div>
      </div>
      <div className={styles.previewColumn}><LandingMapPreview/>
      </div></section>
      <section id="about" className={styles.howItWorks} aria-labelledby="about-title"><div className={styles.sectionIntro}><p className={styles.kicker}>A DIFFERENT WAY TO EXPLORE</p><h2 id="about-title">Browse in 3D <span>·</span> Scrub the timeline <span>·</span> See data change</h2></div><div className={styles.steps}>{[
        ['01','Browse the map','Pan, rotate and zoom. Select any area or building to explore its history.','map'],
        ['02','Move through time','Scroll the timeline to reveal how places changed across different periods.','time'],
        ['03','See the evidence','Read the selected place’s data changes, records and sources beside the map.','data'],
      ].map(([number,title,copy,icon])=><article key={number}><div className={styles.stepTop}><span>{number}</span><span className={styles.stepIcon} aria-hidden="true">{icon==='map'?'⌖':icon==='time'?'↔':'▤'}</span></div><h3>{title}</h3><p>{copy}</p></article>)}</div><p className={styles.buildNote}>The explorer is being built in stages. Housing data and Census periods are available now; the interactive map and historical imagery are coming next.</p></section>
      <section className={styles.discover} aria-labelledby="discover-title"><div className={styles.discoverHeading}><p className={styles.kicker}>DISCOVER A PLACE THAT FITS YOU</p><h2 id="discover-title">Find your neighbourhood<br/>through history.</h2><p>Tell us what matters to you. Discover neighbourhoods that match your interests, needs, and the stories you want to explore.</p></div><div className={styles.discoveryCards}>{[
        ['01 / YOUR PRIORITIES','For your everyday needs','Find places that fit how you live, learn, and explore.','priorities'],
        ['02 / HISTORY & STORIES','For your curiosity','Discover communities through the people, buildings, and events that shaped them.','stories'],
        ['03 / PERSONALIZED MATCHES','Made for you','Combine your preferences with local history to uncover places worth exploring.','matches'],
      ].map(([kicker,title,copy,art])=><article key={kicker}><div className={`${styles.cardArt} ${styles[art]}`} aria-hidden="true"><span/><span/><span/></div><p className={styles.cardKicker}>{kicker}</p><h3>{title}</h3><p>{copy}</p><Link href="/housing/#budget-title">Explore matches <span aria-hidden="true">→</span></Link></article>)}</div><div className={styles.recommendationsCta}><Link className={styles.primary} href="/housing/data/">Get neighbourhood recommendations <span aria-hidden="true">→</span></Link><p>Personalized matching is coming soon. Start with the housing explorer and your budget.</p></div></section>
    </main><footer className={styles.footer}><span>NEIGHBOURHOOD / EXPLORER</span><p>Explore places. Ask questions. Follow the evidence.</p><a href="#home-title">Back to top ↑</a></footer>
  </div>;
}
