import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import * as data from '../public/assets/js/data.js';

const root=path.resolve(import.meta.dirname,'..');
const read=async file=>JSON.parse(await fs.readFile(path.join(root,'public/data',file),'utf8'));
const order=await read('manufacturer-order.json');
const filterOrder=await read('filter-order.json');
const source=await fs.readFile(path.join(root,'public/assets/js/catalog.js'),'utf8');
// Exercise the actual filter renderer, stopping before network loading and event binding.
const renderer=source.slice(0,source.indexOf('[state.all,state.manufacturerOrder,state.filterOrder]=')).replace(/^import .*;\r?\n/gm,'');
assert(renderer.includes('function renderFilters()'));
for(const kind of ['body','lens']){
  const filterRows={innerHTML:''};
  const context=vm.createContext({...data,document:{body:{dataset:{catalogType:kind}},querySelector:()=>filterRows},order,filterOrder});
  vm.runInContext(renderer,context);
  vm.runInContext(`state.manufacturerOrder=order;state.filterOrder=filterOrder;state.all=[...order].reverse().map((manufacturer,index)=>({id:String(index),manufacturer,type,cameraSystem:'미러리스',sensorFormat:'Full Frame',mount:'Test',lensFormat:'Test'}));renderFilters();`,context);
  const actual=[...filterRows.innerHTML.matchAll(/data-filter-key="manufacturer" data-filter-value="([^"]+)"/g)].map(match=>match[1]);
  const expected=[...new Set(order.map(data.publicManufacturer))];
  assert.deepEqual(actual,expected,`${kind} filter buttons must retain the configured manufacturer order`);
  vm.runInContext(`state.filters.manufacturer=['Sony'];renderFilters();`,context);
  const afterSelection=[...filterRows.innerHTML.matchAll(/data-filter-key="manufacturer" data-filter-value="([^"]+)"/g)].map(match=>match[1]);
  assert.deepEqual(afterSelection,expected,`${kind} re-render must preserve the order`);
}
console.log('Body and lens filter rendering preserves manufacturer order, including after selection.');
