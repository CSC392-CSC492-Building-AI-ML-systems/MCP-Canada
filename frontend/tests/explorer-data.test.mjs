import test from 'node:test';
import assert from 'node:assert/strict';
import {loadProfile} from '../src/components/explorer/data.ts';
const source={id:'census-2021-fixture',title:'Synthetic fixture',publisher:'Test',url:'https://example.org',coverage:'Test'};
const catalog={sources:[source],geographies:[{id:'toronto-158-1',name:'Synthetic test area',code:'1',geography_set_id:'toronto-158',geography_set__kind:'neighbourhood',geography_set__version:'158'}],
  indicators:[380,245,378].map(n=>({id:`census-2021-row-${n}`,label:'Fixture',unit:n===378?'percent':'CAD/month',statistic:'median',universe:'Test'}))};
test('uses explicit source and geography; deduplicates history request and preserves zero',async()=>{
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async url=>{calls.push(url);return {ok:true,json:async()=>({observations:[{value:'0',status:'observed',census_year:2021,reference_year:2021,period:'annual',source_locator:'fixture'}]})};};
 try {
  const p=await loadProfile(catalog,'toronto-158-1',2021);
  assert.equal(p.metrics.cost.value,'0');assert.equal(p.history[0].cost.value,'0');assert.equal(calls.length,3);
  for(const url of calls){assert.match(url,/source_id=census-2021-fixture/);assert.match(url,/geography_id=toronto-158-1/);}
 } finally {globalThis.fetch=original;}
});
test('refuses a Census year from another boundary set',async()=>{
 await assert.rejects(loadProfile(catalog,'toronto-158-1',2011),/unavailable/);
});
test('multiple releases remain unavailable instead of silently choosing one',async()=>{
 const p=await loadProfile({...catalog,sources:[source,{...source,id:'census-2021-other'}]},'toronto-158-1',2021);
 assert.equal(p.metrics.cost.value,null);assert.equal(p.metrics.cost.status,'missing');assert.equal(p.metrics.cost.source,null);
});
