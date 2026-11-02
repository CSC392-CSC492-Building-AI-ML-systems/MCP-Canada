import test from 'node:test';
import assert from 'node:assert/strict';
import {findBoundary} from '../src/lib/boundaries.ts';
const square=(x0,y0,x1,y1)=>[[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
const feature=(id,geometry)=>({type:'Feature',geometry,properties:{geography_id:id,code:id,name:id}});
const boundaries={type:'FeatureCollection',features:[
 feature('donut',{type:'Polygon',coordinates:[square(0,0,10,10),square(4,4,6,6)]}),
 feature('islands',{type:'MultiPolygon',coordinates:[[square(20,0,21,1)],[square(25,5,26,6)]]}),
]};
test('finds the neighbourhood containing a point',()=>{
 assert.equal(findBoundary(boundaries,[1,1]).properties.geography_id,'donut');
 assert.equal(findBoundary(boundaries,[25.5,5.5]).properties.geography_id,'islands');
});
test('a point in a hole or outside every boundary matches nothing',()=>{
 assert.equal(findBoundary(boundaries,[5,5]),undefined);
 assert.equal(findBoundary(boundaries,[15,5]),undefined);
});
