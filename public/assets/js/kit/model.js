export const STORAGE_KEY = 'matchcamera.kit.v1';
export const CATEGORIES = {body:'바디',lens:'렌즈',battery:'배터리',memory:'메모리 카드',tripod:'삼각대',head:'삼각대 헤드',plate:'플레이트',flash:'플래시',adapter:'마운트 어댑터',other:'기타 장비'};
const DEFAULT_TASKS = ['배터리 충전과 여분 배터리 확인','메모리 카드의 여유 용량과 백업 확인','바디·렌즈 및 캡 챙기기','삼각대·헤드·플레이트 체결 확인','렌즈 클리너·천 챙기기','촬영지 출입·운영 시간 확인','날씨와 이동 경로 확인'];
const MAX_ITEMS = 200, MAX_TASKS = 200;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const allowed = (value,keys) => plain(value) && Object.keys(value).every(key=>keys.includes(key));
const text = (value,max=200) => typeof value === 'string' && value.trim().length>0 && value.length<=max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);
const validWeight = value => value === null || (typeof value === 'number' && Number.isFinite(value) && value>0 && value<=1_000_000);
function validImage(value){
  if(value===null)return true;
  if(typeof value!=='string'||!/^\/assets\/images\/[a-zA-Z0-9_./%()-]+$/.test(value))return false;
  try{const decoded=decodeURIComponent(value);return !decoded.includes('..')&&!/[\\?#]/.test(decoded);}catch{return false;}
}
export const newId = () => globalThis.crypto.randomUUID();
export function emptyKit(now=new Date().toISOString()) {
  return {schema:'matchcamera-kit',version:1,items:[],tasks:DEFAULT_TASKS.map((value,index)=>({id:`default-${index}`,text:value,done:false})),updatedAt:now};
}
export function validateKit(value) {
  if(!allowed(value,['schema','version','items','tasks','updatedAt']) || value.schema!=='matchcamera-kit' || value.version!==1
    || !Array.isArray(value.items) || value.items.length>MAX_ITEMS || !Array.isArray(value.tasks) || value.tasks.length>MAX_TASKS
    || typeof value.updatedAt!=='string' || !Number.isFinite(Date.parse(value.updatedAt))) throw new Error('지원하는 매치카메라 장비 백업 파일이 아닙니다.');
  const ids=new Set();
  for(const item of value.items){
    if(!allowed(item,['id','source','catalogId','category','name','quantity','weightG','packed','imageSrc'])
      || !validId(item.id) || ids.has(item.id) || !['catalog','manual'].includes(item.source) || !Object.hasOwn(CATEGORIES,item.category)
      || !text(item.name) || !Number.isInteger(item.quantity) || item.quantity<1 || item.quantity>99 || !validWeight(item.weightG)
      || typeof item.packed!=='boolean' || !validImage(item.imageSrc)
      || !(item.catalogId===null || text(item.catalogId,300))
      || (item.source==='catalog' && !text(item.catalogId,300))
      || (item.source==='manual' && (item.catalogId!==null || item.imageSrc!==null))) throw new Error('장비 항목의 이름·수량·무게·이미지 형식을 확인해 주세요.');
    ids.add(item.id);
  }
  const taskIds=new Set();
  for(const task of value.tasks){
    if(!allowed(task,['id','text','done']) || !validId(task.id) || taskIds.has(task.id) || !text(task.text) || typeof task.done!=='boolean') throw new Error('촬영 준비 항목의 형식이 올바르지 않습니다.');
    taskIds.add(task.id);
  }
  return structuredClone(value);
}
export function parseBackup(raw) {
  if(typeof raw!=='string' || raw.length>512_000) throw new Error('백업 파일은 500KB 이하만 불러올 수 있습니다.');
  let value;try{value=JSON.parse(raw);}catch{throw new Error('JSON 백업 파일을 확인해 주세요.');}
  return validateKit(value);
}
export function encodeBackup(kit){return JSON.stringify(validateKit(kit),null,2);}
export function knownWeight(items) {
  let weightG=0,missing=0,pieces=0,packed=0;
  for(const item of items){
    pieces+=item.quantity;
    if(item.packed)packed+=item.quantity;
    if(item.weightG===null)missing+=item.quantity;else weightG+=item.weightG*item.quantity;
  }
  return {weightG,missing,pieces,packed};
}
export function catalogWeight(item) {
  for(const candidate of [item?.weightG,item?.specs?.['무게(g)']]){
    if(candidate!==null && candidate!==undefined && String(candidate).trim()!=='' && Number.isFinite(Number(candidate)) && Number(candidate)>0)return Math.round(Number(candidate)*1000)/1000;
  }
  return Number.isFinite(item?.weightKg)&&item.weightKg>0?Math.round(item.weightKg*1_000_000)/1000:null;
}
export function catalogEntry(product,category,id=newId()) {
  if(product?.active===false || product?.enabled===false || product?.visibility==='hidden' || !Object.hasOwn(CATEGORIES,category))throw new Error('추가할 수 없는 제품입니다.');
  const candidate={id,source:'catalog',catalogId:product.id,category,name:product.officialName||product.model||product.id,quantity:1,weightG:catalogWeight(product),packed:false,imageSrc:product.imageSrc||null};
  return validateKit({...emptyKit(),items:[candidate]}).items[0];
}
function csvCell(value){
  let string=String(value??'');
  // Spreadsheet programs can execute formulas even when a CSV cell is quoted.
  if(/^[\s\uFEFF]*[=+@-]/u.test(string))string="'"+string;
  return '"'+string.replaceAll('"','""')+'"';
}
export function equipmentCsv(kit){
  const valid=validateKit(kit);
  const rows=[['장비명','분류','수량','개당 무게(g)','합계 무게(g)','챙김','입력 방식'],...valid.items.map(item=>[item.name,CATEGORIES[item.category],item.quantity,item.weightG??'',item.weightG===null?'':Math.round(item.weightG*item.quantity*1000)/1000,item.packed?'예':'아니오',item.source==='manual'?'직접 입력':'제품 DB'])];
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n');
}
