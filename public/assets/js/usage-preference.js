const input=document.querySelector('#usageOptOut');
const status=document.querySelector('#usagePreferenceStatus');
const key='matchcamera.metricsOptOut';
const browserOptOut=navigator.doNotTrack==='1'||window.doNotTrack==='1'||navigator.globalPrivacyControl===true;
if(input&&status){
  try{input.checked=browserOptOut||['1','true'].includes(localStorage.getItem(key));}
  catch{input.checked=true;input.disabled=true;status.textContent='브라우저 설정 저장소를 사용할 수 없어 기능 이용 횟수를 전송하지 않습니다.';}
  if(browserOptOut){input.checked=true;input.disabled=true;status.textContent='브라우저의 추적 거부 설정에 따라 측정을 끈 상태입니다.';}
  input.addEventListener('change',()=>{
    try{
      if(input.checked)localStorage.setItem(key,'1');else localStorage.removeItem(key);
      status.textContent=input.checked?'이 브라우저에서 앞으로 기능 이용 횟수를 전송하지 않습니다.':'이 브라우저에서 기능 이용 횟수 측정을 허용했습니다.';
    }catch{input.checked=!input.checked;status.textContent='선택을 저장하지 못했습니다. 브라우저의 추적 거부 설정을 사용할 수 있습니다.';}
  });
}
