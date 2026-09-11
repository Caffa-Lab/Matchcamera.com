export const SUPPORT_BRANDS=['Manfrotto','Gitzo','Leofoto','Benro','SIRUI','Peak Design','SmallRig','SLIK','Velbon','Vanguard','Sachtler','PhotoClam'];
export const SUPPORT_KINDS={'tripod-legs':'다리 단품','tripod-kit':'헤드 포함 세트'};
export const HEAD_TYPES={'ball-head':'볼헤드','fluid-head':'영상용 유체 헤드','pan-tilt-head':'팬·틸트 헤드','gimbal-head':'짐벌 헤드'};
const result=(level,label,reason)=>({level,label,reason});
const unknown=reason=>result('unknown','확인 필요',reason);
export function equipmentWeightKg(item){
  for(const [value,scale] of [[item?.weightG,.001],[item?.weightKg,1]]){
    if(value===null||value===undefined||String(value).trim()==='')continue;
    const number=Number(value);if(Number.isFinite(number)&&number>0)return number*scale;
  }
  return null;
}
export function equipmentPayloadKg({body,lenses=[],flash,plate,head}){
  if(!body)return null;
  const selected=[body,...lenses,flash,plate,head].filter(Boolean);
  if(selected.some(item=>equipmentWeightKg(item)===null))return null;
  return equipmentWeightKg(body)+Math.max(0,...lenses.map(equipmentWeightKg))+[flash,plate,head].filter(Boolean).reduce((sum,item)=>sum+equipmentWeightKg(item),0);
}
export function supportSort(rows){return [...rows].sort((a,b)=>(SUPPORT_BRANDS.indexOf(a.manufacturer)<0?999:SUPPORT_BRANDS.indexOf(a.manufacturer))-(SUPPORT_BRANDS.indexOf(b.manufacturer)<0?999:SUPPORT_BRANDS.indexOf(b.manufacturer))||a.officialName.localeCompare(b.officialName));}
export function normalizeSupportMount(value){
  const s=String(value||'').toLowerCase().trim().replace(/[″”"]/g,'').replace(/\s+/g,'');
  if(/^(3\/8|3\/8-inch|3\/8-16|3\/8-16unc)$/.test(s))return '3/8-16';
  if(/^(1\/4|1\/4-inch|1\/4-20|1\/4-20unc)$/.test(s))return '1/4-20';
  if(/^bowl-(75|100|150)$/.test(s))return s;
  return '';
}
export function tripodHeadCompatibility(tripod,head){
  if(!tripod||!head)return unknown('삼각대와 별도 헤드를 선택하세요. 세트는 기본 포함 헤드를 사용할 수 있습니다.');
  if(tripod.headReplaceable===false)return result('incompatible','헤드 교체 불가','이 모델은 헤드를 분리해 교체하는 구성이 아닙니다.');
  const base=normalizeSupportMount(head.tripodMount);
  if(tripod.headAdapter&&base&&tripod.headAdapter.mounts.includes(base))return result('conditional','전용 어댑터 필요',`${tripod.headAdapter.name}를 별도로 장착해야 합니다. 기본 헤드를 제거하고 설치 규격·간섭을 확인하세요.`);
  const mounts=(tripod.headMounts||[tripod.headMount]).map(normalizeSupportMount).filter(Boolean);
  if(!base||!mounts.length)return unknown('다리 상단과 헤드 하단의 체결 규격을 공식 자료에서 확인해야 합니다. 브랜드만으로 판정하지 않습니다.');
  if(mounts.includes(base))return result('compatible','체결 규격 일치',`${base.startsWith('bowl-')?base.replace('bowl-','')+'mm 볼':base+' 나사'} 규격이 일치합니다. 고정 장치·접촉면 간섭과 허용 하중은 별도로 확인하세요.${tripod.kind==='tripod-kit'?' 세트 포함 헤드를 교체하는 조합이며 별도 헤드 비용이 추가됩니다.':''}`);
  if(mounts.some(x=>x.startsWith('bowl-'))||base.startsWith('bowl-'))return result('conditional','볼·평면 변환 확인','볼 지름 또는 볼/평면 구조가 다릅니다. 제조사가 지원하는 볼 어댑터·평면 베이스가 필요하며 직접 연결할 수 없습니다.');
  return result('conditional','나사 변환 어댑터 필요',`다리 ${mounts.join(' / ')}와 헤드 ${base}가 다릅니다. 나사 암수 방향에 맞는 어댑터와 체결 깊이를 확인하세요.`);
}
export function supportHead(tripod,head){return head||tripod?.includedHead||null;}
export function plateHeadCompatibility(plate,head){
  if(!plate||!head)return unknown('플레이트와 헤드(또는 헤드 포함 세트)를 선택하세요.');
  const names=[plate.id,plate.modelCode,plate.officialName].filter(Boolean);
  if(head.includedPlate&&names.includes(head.includedPlate))return result('compatible','지정 플레이트','제조사가 이 헤드에 지정한 플레이트입니다.');
  const standard=String(plate.standard||'').trim().toLowerCase();
  const accepted=(head.plateStandards||[head.plateStandard]).filter(Boolean).map(x=>x.toLowerCase());
  if(!standard||!accepted.length)return unknown('플레이트와 클램프의 규격 정보가 부족합니다.');
  if(accepted.includes(standard))return result('conditional','클램프 결합 확인',`${plate.standard} 계열입니다. 특히 Arca 계열은 폭·안전핀·레버 클램프의 공차 차이가 있어 실제 고정 여부를 확인해야 합니다.`);
  return result('incompatible','플레이트 규격 불일치',`${plate.standard} 플레이트와 ${accepted.join(' / ')} 클램프는 직접 호환으로 확인되지 않았습니다.`);
}
