"use client";

import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {findBoundary, loadBoundaries} from '@/lib/boundaries';
import {MAPBOX_TOKEN, newSessionToken, placeHref, retrievePlace, suggestPlaces, type Suggestion} from '@/lib/mapbox';
import {loadWorkspaceData} from '../explorer/data';
import styles from './home.module.css';

type Place = {id:string;name:string};
const previewYears=[1850,1920,1950,1980,2026];
const MIN_ADDRESS_QUERY=3;

function CampusIllustration({zoom}:{zoom:number}) {
  return <svg className={styles.campusArt} viewBox="0 0 720 460" role="img" aria-label="Illustrative isometric campus, not an actual geographic or historical map">
    <defs><pattern id="campus-grid" width="38" height="38" patternUnits="userSpaceOnUse"><path d="M 38 0 L 0 0 0 38" fill="none" stroke="#c9d2bd" strokeWidth=".7"/></pattern><filter id="campus-shadow" x="-30%" y="-30%" width="160%" height="180%"><feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#65774c" floodOpacity=".15"/></filter></defs>
    <g transform={`translate(360 240) scale(${zoom}) translate(-360 -240)`}>
      <ellipse cx="364" cy="350" rx="268" ry="54" fill="#cbd5bd" opacity=".5"/>
      <path d="M76 258 342 104 655 281 389 435Z" fill="#cbd7bc" stroke="#aaba98"/>
      <path d="M76 244 342 90 655 267 389 421Z" fill="#dde5d0" stroke="#bccba9" filter="url(#campus-shadow)"/>
      <path d="M76 244 342 90 655 267 389 421Z" fill="url(#campus-grid)" opacity=".5"/>
      <path d="M146 282 405 132 437 150 178 301Z" fill="#faf9ed"/>
      <path d="M244 151 558 328 532 343 218 166Z" fill="#faf9ed"/>
      <path d="M287 363 536 220 550 228 301 372Z" fill="#f1efdf"/>
      <g stroke="#788b68" strokeWidth="1">
        <path d="M252 219 345 166 434 216 341 270Z" fill="#bdcaa9"/><path d="M252 219 341 270 341 315 252 264Z" fill="#98ad84"/><path d="M341 270 434 216 434 261 341 315Z" fill="#738f63"/>
        <path d="M271 208 345 166 414 205 340 248Z" fill="#dce3ce"/><path d="M340 248 414 205 414 217 340 260Z" fill="#a0b48b"/>
        <path d="M434 294 488 263 547 296 493 328Z" fill="#dbe1ca"/><path d="M434 294 493 328 493 362 434 328Z" fill="#a7b996"/><path d="M493 328 547 296 547 330 493 362Z" fill="#819b71"/>
        <path d="M186 249 233 222 274 245 227 273Z" fill="#e7e6d2"/><path d="M186 249 227 273 227 303 186 279Z" fill="#b7c4a3"/><path d="M227 273 274 245 274 275 227 303Z" fill="#8da57b"/>
        <path d="M386 156 430 130 475 155 431 181Z" fill="#dde1cc"/><path d="M386 156 431 181 431 213 386 188Z" fill="#a3b88e"/><path d="M431 181 475 155 475 187 431 213Z" fill="#789366"/>
      </g>
      <g stroke="#e5edda" strokeWidth="3" opacity=".85"><path d="M268 240 268 258 M283 248 283 266 M299 257 299 275 M315 266 315 283 M355 281 355 298 M372 271 372 288 M388 262 388 279 M405 252 405 270 M450 313 450 326 M465 322 465 335 M508 328 508 343 M525 318 525 333"/></g>
      {[[158,228],[191,201],[221,177],[293,123],[333,345],[365,363],[586,272],[562,254],[515,214],[535,363],[384,113],[141,251]].map(([x,y],i)=><g key={i}><path d={`M${x} ${y}v22`} stroke="#71845e" strokeWidth="3"/><ellipse cx={x} cy={y} rx="13" ry="17" fill={i%3===0?'#8ca47a':'#a6bc91'} stroke="#879f73" strokeWidth=".8"/></g>)}
      <g transform="translate(350 131)"><path d="M0 0C-15-16-25-28-25-42a25 25 0 1 1 50 0C25-28 15-16 0 0Z" fill="#295738"/><circle cy="-42" r="8" fill="#f4f4e9"/><ellipse cy="8" rx="13" ry="5" fill="#6d845c" opacity=".28"/></g>
    </g>
  </svg>;
}

export function HomePage() {
  const [year,setYear]=useState(2026);
  const [zoom,setZoom]=useState(1);
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
      <div className={styles.previewColumn}><div className={styles.previewCard}><div className={styles.previewHeader}><div><span className={styles.previewDot}/>UTM campus, Mississauga</div><span className={styles.previewBadge}>3D preview</span></div><CampusIllustration zoom={zoom}/><span className={styles.mapLabel}>3D Map Explorer</span><div className={styles.zoomControls}><button aria-label="Zoom in on illustrative preview" disabled={zoom>=1.3} onClick={()=>setZoom(z=>Math.min(1.3,Number((z+.1).toFixed(1))))}>+</button><button aria-label="Zoom out on illustrative preview" disabled={zoom<=.8} onClick={()=>setZoom(z=>Math.max(.8,Number((z-.1).toFixed(1))))}>−</button></div><div className={styles.mapCaption}>Illustrative campus preview · not geographic or historical imagery</div></div>
        <div className={styles.previewTimeline}><div><p className={styles.kicker}>MOVE THROUGH TIME</p><span>{year}</span></div><div className={styles.previewYears} role="group" aria-label="Illustrative timeline">{previewYears.map(y=><button key={y} aria-pressed={year===y} onClick={()=>setYear(y)}><span/>{y}</button>)}</div><p>The preview stays illustrative. Available Census years appear in the explorer.</p></div>
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
