import {loadProducts} from './data.js';
const $=s=>document.querySelector(s);
try{const p=await loadProducts();const bodies=p.filter(x=>x.type==='바디'),lenses=p.filter(x=>x.type==='렌즈');$('#productCount').textContent=p.length.toLocaleString();$('#bodyCount').textContent=bodies.length.toLocaleString();$('#lensCount').textContent=lenses.length.toLocaleString();const brands=new Set(p.map(x=>x.manufacturer==='Olympus'?'OM SYSTEM / Olympus':x.manufacturer));$('#brandCount').textContent=brands.size.toLocaleString();}catch(e){console.error(e)}
