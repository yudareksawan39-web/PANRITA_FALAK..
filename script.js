(() => {
"use strict";

const CFG = window.FALAK_CONFIG || {};
const KAABA = CFG.KAABA || {lat:21.422487,lon:39.826206};
const DEFAULT = CFG.DEFAULT_LOCATION || {name:"Kota Parepare, Sulawesi Selatan",lat:-4.0189,lon:119.6238,elevation:50,timezone:8};

const state = {
  page:"home",
  location:{...DEFAULT},
  selectedDate:new Date(),
  currentMonth:new Date(),
  sensorHeading:null,
  compassActive:false,
  map:null,
  markers:{},
  mapReady:false,
  qiblaLine:null,
  userMarker:null,
  kaabaMarker:null,
  cameraStream:null,
  gpsAccuracy:null,
  settings:{
    method:"auto", fajr:20, isha:18, asrFactor:1, timezone:8
  }
};

// Lokasi tersimpan agar seluruh modul memakai satu acuan koordinat.
try { const saved=JSON.parse(localStorage.getItem("panritaFalakLocation")||"null"); if(saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lon)){ state.location={...state.location,...saved}; } } catch(e){}
const $ = (s,root=document)=>root.querySelector(s);
const $$ = (s,root=document)=>[...root.querySelectorAll(s)];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rad=d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
const norm360=d=>((d%360)+360)%360;
const pad=n=>String(Math.round(n)).padStart(2,"0");

function formatDate(d, opts={dateStyle:"long"}) {
  return new Intl.DateTimeFormat("id-ID",{...opts,timeZone:"Asia/Makassar"}).format(d);
}
function formatTime(h) {
  if (!Number.isFinite(h)) return "Tidak terdefinisi";
  // Bulatkan ke menit terdekat, lalu normalkan jika pembulatan melewati tengah malam.
  let totalMinutes = Math.round((((h % 24) + 24) % 24) * 60);
  totalMinutes = ((totalMinutes % 1440) + 1440) % 1440;
  return `${pad(Math.floor(totalMinutes / 60))}:${pad(totalMinutes % 60)}`;
}
function d2r(x){return x*Math.PI/180}
function r2d(x){return x*180/Math.PI}

function qiblaBearing(lat,lon){
  const phi1=d2r(lat), phi2=d2r(KAABA.lat), dl=d2r(KAABA.lon-lon);
  return norm360(r2d(Math.atan2(Math.sin(dl), Math.cos(phi1)*Math.tan(phi2)-Math.sin(phi1)*Math.cos(dl))));
}
function distanceKm(lat1,lon1,lat2=KAABA.lat,lon2=KAABA.lon){
  const R=6371.0088, p1=d2r(lat1),p2=d2r(lat2),dp=d2r(lat2-lat1),dl=d2r(lon2-lon1);
  const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
function cardinal(b){
  const dirs=["Utara","Timur Laut","Timur","Tenggara","Selatan","Barat Daya","Barat","Barat Laut"];
  return dirs[Math.round(norm360(b)/45)%8];
}

function dayOfYear(date){
  const start=new Date(Date.UTC(date.getUTCFullYear(),0,0));
  return Math.floor((date-start)/86400000);
}
/* NOAA-style solar position approximation. Accuracy is normally within roughly a fraction
   of a degree for the Sun's geometric position; local prayer times remain method-dependent. */
function solarPosition(date, lat, lon, timezone){
  const utcMs=date.getTime();
  const jd=utcMs/86400000+2440587.5;
  const T=(jd-2451545)/36525;
  const L=norm360(280.46646+T*(36000.76983+T*0.0003032));
  const M=norm360(357.52911+T*(35999.05029-0.0001537*T));
  const e=0.016708634-T*(0.000042037+0.0000001267*T);
  const C=(1.914602-T*(0.004817+0.000014*T))*Math.sin(d2r(M))
    +(0.019993-0.000101*T)*Math.sin(d2r(2*M))
    +0.000289*Math.sin(d2r(3*M));
  const trueLong=L+C;
  const omega=125.04-1934.136*T;
  const lambda=trueLong-0.00569-0.00478*Math.sin(d2r(omega));
  const obliq=23+(26+(21.448-T*(46.815+T*(0.00059-T*0.001813)))/60)/60;
  const obliqCorr=obliq+0.00256*Math.cos(d2r(omega));
  const decl=r2d(Math.asin(Math.sin(d2r(obliqCorr))*Math.sin(d2r(lambda))));
  const y=Math.tan(d2r(obliqCorr/2))**2;
  const eqTime=4*r2d(y*Math.sin(2*d2r(L))-2*e*Math.sin(d2r(M))+4*e*y*Math.sin(d2r(M))*Math.cos(2*d2r(L))-0.5*y*y*Math.sin(4*d2r(L))-1.25*e*e*Math.sin(2*d2r(M)));
  const localMinutes=date.getHours()*60+date.getMinutes()+date.getSeconds()/60;
  const solarMinutes=localMinutes+eqTime+4*lon-60*timezone;
  const tst=((solarMinutes%1440)+1440)%1440;
  const ha=tst/4-180;
  const latr=d2r(lat), decr=d2r(decl);
  const altitude=r2d(Math.asin(Math.sin(latr)*Math.sin(decr)+Math.cos(latr)*Math.cos(decr)*Math.cos(d2r(ha))));
  let az=r2d(Math.atan2(Math.sin(d2r(ha)),Math.cos(d2r(ha))*Math.sin(latr)-Math.tan(decr)*Math.cos(latr)))+180;
  az=norm360(az);
  return {decl,eqTime,altitude,azimuth:az,solarMinutes,ha};
}

function julianDay(y,m,d){ if(m<=2){y--;m+=12} return Math.floor(365.25*(y+4716))+Math.floor(30.6001*(m+1))+d-1524.5; }

function sunEventHour(date, lat, lon, tz, angle, rising, asrFactor){
  // Search in local solar-time hours using iterative solar altitude.
  const y=date.getFullYear(),m=date.getMonth()+1,d=date.getDate();
  const noon = 12 - lon/15 - solarNoonCorrection(date, lon, tz);
  if(angle==="transit") return noon;
  if(angle==="asr"){
    // shadow factor = 1 or 2. Altitude formula: atan(1/(factor+tan(|lat-dec|)))
    const testDate=new Date(y,m-1,d,12);
    const sp=solarPosition(testDate,lat,lon,tz);
    const alt=r2d(Math.atan(1/(asrFactor+Math.tan(Math.abs(d2r(lat-sp.decl))))));
    return solveAltitude(date,lat,lon,tz,alt,rising,noon);
  }
  return solveAltitude(date,lat,lon,tz,angle,rising,noon);
}
function solarNoonCorrection(date,lon,tz){
  const noonDate=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12,0,0);
  const sp=solarPosition(noonDate,0,lon,tz);
  return sp.eqTime/60;
}
function solveAltitude(date,lat,lon,tz,alt,rising,noon){
  let lo=rising?0:noon, hi=rising?noon:24;
  for(let i=0;i<35;i++){
    const mid=(lo+hi)/2;
    const dt=new Date(date.getFullYear(),date.getMonth(),date.getDate(),0,mid*60,0);
    const a=solarPosition(dt,lat,lon,tz).altitude;
    if(rising ? a> -Math.abs(alt) : a> -Math.abs(alt)) {
      if(rising) hi=mid; else lo=mid;
    } else {
      if(rising) lo=mid; else hi=mid;
    }
  }
  return (lo+hi)/2;
}
function hourAngleForAltitude(lat,dec,alt){
  const x=(Math.sin(d2r(alt))-Math.sin(d2r(lat))*Math.sin(d2r(dec)))/(Math.cos(d2r(lat))*Math.cos(d2r(dec)));
  if(x>1||x<-1)return null;
  return r2d(Math.acos(clamp(x,-1,1)));
}
function prayerTimes(date,loc=settingsLocation()){
  const lat=loc.lat,lon=loc.lon,tz=state.settings.timezone;
  const d=new Date(date.getFullYear(),date.getMonth(),date.getDate(),12);
  const noon=solarNoonCorrection(d,lon,tz);
  const sp=solarPosition(d,lat,lon,tz);
  // Compute solar noon more robustly: local clock 12 - lon/15 - eqtime/60 + tz.
  const solarNoon=12 - sp.eqTime/60 - lon/15 + tz;
  const hSunrise=hourAngleForAltitude(lat,sp.decl,-0.833);
  const angles=effectivePrayerAngles();
  const hFajr=hourAngleForAltitude(lat,sp.decl,-angles.fajr);
  const hIsha=hourAngleForAltitude(lat,sp.decl,-angles.isha);
  const sunrise=hSunrise==null?NaN:solarNoon-hSunrise/15;
  const sunset=hSunrise==null?NaN:solarNoon+hSunrise/15;
  const fajr=hFajr==null?NaN:solarNoon-hFajr/15;
  // Umm al-Qura uses a fixed interval after sunset (90 minutes; Ramadan exception is not auto-detected).
  const isha=effectivePrayerMethod()==="umm" ? (Number.isFinite(sunset)?sunset+1.5:NaN) : (hIsha==null?NaN:solarNoon+hIsha/15);
  const asrAlt=r2d(Math.atan(1/(state.settings.asrFactor+Math.tan(Math.abs(d2r(lat-sp.decl))))));
  const hAsr=hourAngleForAltitude(lat,sp.decl,asrAlt);
  const asr=hAsr==null?NaN:solarNoon+hAsr/15;
  return {imsak:fajr-10/60,fajr,sunrise,zuhur:solarNoon,asr,sunset: sunset,maghrib:sunset,isha};
}
function settingsLocation(){return state.location}
// Mode otomatis memakai acuan Kemenag RI untuk koordinat Indonesia. Di luar Indonesia,
// gunakan sudut Muslim World League sebagai fallback umum; pengguna tetap dapat memilih metode manual.
function effectivePrayerMethod(){
  if(state.settings.method!=="auto") return state.settings.method;
  const {lat,lon}=state.location;
  const inIndonesia=lat>=-11.5 && lat<=6.5 && lon>=94 && lon<=141.5;
  return inIndonesia?"kemenag":"mw";
}
function effectivePrayerAngles(){
  if(state.settings.method!=="auto") return {fajr:state.settings.fajr,isha:state.settings.isha};
  const method=effectivePrayerMethod();
  return method==="kemenag"?{fajr:20,isha:18}:{fajr:18,isha:17};
}

function getLocationName(lat,lon){
  if(Math.abs(lat+4.0189)<.2 && Math.abs(lon-119.6238)<.2)return DEFAULT.name;
  return `Lokasi ${lat.toFixed(4)}°, ${lon.toFixed(4)}°`;
}
function setLocation(lat,lon,elevation=50,name=getLocationName(lat,lon)){
  state.location={...state.location,lat:Number(lat),lon:Number(lon),elevation:Number(elevation)||0,name};
  try{localStorage.setItem("panritaFalakLocation",JSON.stringify(state.location));}catch(e){}
  if($("#locationNameInput")) $("#locationNameInput").value=name;
  $("#latInput").value=state.location.lat; $("#lonInput").value=state.location.lon; $("#elevInput").value=state.location.elevation;
  updateAll();
  if(state.page==="calc"){const active=$(".formula-tab.active");if(active)renderFormula(active.dataset.formula)}
  if(state.mapReady) updateMap();
  updateGoogleEarthLink();
  if($("#page-theodolite")) updateTeodolite();
}
function chooseLocationIndonesia(){
  let modal=document.getElementById("locationPickerModal");
  if(!modal){
    modal=document.createElement("div"); modal.id="locationPickerModal"; modal.className="location-picker-backdrop";
    modal.innerHTML=`<div class="location-picker card" role="dialog" aria-modal="true" aria-labelledby="locationPickerTitle"><div class="picker-head"><div><small>LOKASI PANRITA FALAK</small><h3 id="locationPickerTitle">Pilih lokasi di Indonesia</h3></div><button type="button" class="picker-close" aria-label="Tutup">✕</button></div><p>Pilih provinsi terlebih dahulu, kemudian pilih kota atau kabupaten. Nama dan koordinat lokasi akan diperbarui setelah lokasi dipilih.</p><div class="location-selects"><label>Provinsi<select id="locationProvinceSelect"><option value="">Memuat daftar provinsi…</option></select></label><label>Kota/Kabupaten<select id="locationCitySelect" disabled><option value="">Pilih provinsi terlebih dahulu</option></select></label></div><div id="locationSearchStatus" role="status" aria-live="polite"></div><div id="locationSearchResults"></div><small class="picker-foot">Koneksi internet diperlukan untuk memuat wilayah dan menemukan koordinat lokasi. GPS tetap tersedia melalui tombol “Lokasi saat ini”.</small></div>`;
    document.body.appendChild(modal);
    const province=modal.querySelector("#locationProvinceSelect"), city=modal.querySelector("#locationCitySelect"), status=modal.querySelector("#locationSearchStatus"), results=modal.querySelector("#locationSearchResults");
    modal.querySelector(".picker-close").addEventListener("click",()=>modal.remove());
    modal.addEventListener("click",e=>{if(e.target===modal)modal.remove()});
    const getJson=async url=>{const res=await fetch(url,{headers:{"Accept":"application/json"}});if(!res.ok)throw new Error("Layanan data wilayah tidak merespons.");return res.json()};
    (async()=>{try{status.textContent="Memuat daftar provinsi Indonesia…";const data=await getJson("https://www.emsifa.com/api-wilayah-indonesia/api/provinces.json");province.replaceChildren(new Option("Pilih provinsi",""));data.sort((a,b)=>a.name.localeCompare(b.name,"id")).forEach(item=>province.add(new Option(item.name,item.id)));status.textContent="Pilih provinsi, lalu kota/kabupaten.";}catch(err){province.replaceChildren(new Option("Daftar provinsi gagal dimuat",""));status.textContent="Tidak dapat memuat daftar wilayah. Periksa koneksi internet lalu tutup dan buka kembali pilihan lokasi."}})();
    province.addEventListener("change",async()=>{city.disabled=true;city.replaceChildren(new Option("Memuat kota/kabupaten…",""));results.replaceChildren();if(!province.value){city.replaceChildren(new Option("Pilih provinsi terlebih dahulu",""));status.textContent="Pilih provinsi terlebih dahulu.";return}try{status.textContent="Memuat kota/kabupaten…";const data=await getJson(`https://www.emsifa.com/api-wilayah-indonesia/api/regencies/${encodeURIComponent(province.value)}.json`);city.replaceChildren(new Option("Pilih kota/kabupaten",""));data.sort((a,b)=>a.name.localeCompare(b.name,"id")).forEach(item=>city.add(new Option(item.name,item.name)));city.disabled=false;status.textContent=`Provinsi ${province.options[province.selectedIndex].text} dipilih. Sekarang pilih kota/kabupaten.`;}catch(err){city.replaceChildren(new Option("Gagal memuat kota/kabupaten",""));status.textContent="Daftar kota/kabupaten gagal dimuat. Periksa koneksi internet."}});
    city.addEventListener("change",async()=>{const cityName=city.value, provinceName=province.options[province.selectedIndex]?.text;if(!cityName||!provinceName)return;status.textContent=`Mencari koordinat ${cityName}, ${provinceName}…`;results.replaceChildren();try{const query=`${cityName}, ${provinceName}, Indonesia`;const url="https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=id&addressdetails=1&limit=5&q="+encodeURIComponent(query);const res=await fetch(url,{headers:{"Accept-Language":"id"}});if(!res.ok)throw new Error("Geocoding gagal");const data=await res.json();let item=data.find(x=>x.address?.state===provinceName)||data[0];if(!item){status.textContent="Koordinat lokasi belum ditemukan. Pilih kota/kabupaten lain atau gunakan GPS.";return}const b=document.createElement("button");b.type="button";b.className="location-result";const title=document.createElement("strong"), detail=document.createElement("small");title.textContent=`${cityName}, ${provinceName}`;detail.textContent=`Koordinat: ${Number(item.lat).toFixed(5)}, ${Number(item.lon).toFixed(5)} • Tekan untuk menggunakan lokasi ini`;b.append(title,detail);b.addEventListener("click",()=>{const lat=Number(item.lat),lon=Number(item.lon);if(!Number.isFinite(lat)||!Number.isFinite(lon)){status.textContent="Koordinat tidak valid. Silakan coba lagi.";return}const name=`${cityName}, ${provinceName}`;const tz=lon<115?7:(lon<132?8:9);setLocation(lat,lon,state.location.elevation,name);state.settings.timezone=tz;if($("#timezoneSelect"))$("#timezoneSelect").value=String(tz);saveSettings();modal.remove();alert("Lokasi diperbarui: "+name+". Perhitungan yang bergantung pada lokasi telah diperbarui.")});results.appendChild(b);status.textContent="Pastikan nama lokasi benar, lalu tekan hasil di bawah untuk menerapkan lokasi.";}catch(err){status.textContent="Koordinat gagal dicari. Periksa koneksi internet lalu pilih kota/kabupaten kembali."}});
  }
  document.body.appendChild(modal); modal.querySelector("#locationProvinceSelect")?.focus();
}
function requestLocation(){
  if(!navigator.geolocation){alert("Browser ini tidak mendukung GPS.");return}
  navigator.geolocation.getCurrentPosition(pos=>{
    state.gpsAccuracy=Number.isFinite(pos.coords.accuracy)?pos.coords.accuracy:null;
    setLocation(pos.coords.latitude,pos.coords.longitude,pos.coords.altitude||state.location.elevation);
    updateTeodolite();
  },err=>alert("GPS tidak dapat digunakan: "+err.message),{enableHighAccuracy:true,timeout:15000,maximumAge:30000});
}

function navigate(page){
  if(state.page==="theodolite" && page!=="theodolite") stopTheodoliteCamera();
  state.page=page;
  $$(".page").forEach(p=>p.classList.toggle("active",p.id===`page-${page}`));
  $$(".nav-item[data-page]").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  $("#sidebar").classList.remove("open");
  if(page==="map"){initEmbeddedMap();setTimeout(()=>state.map?.invalidateSize?.(),180)}
  if(page==="theodolite") updateTeodolite();
  if(page==="monthly") renderMonthly();
  if(page==="prayer") renderPrayer();
  if(page==="calc") renderFormula("qibla");
  window.scrollTo({top:0,behavior:"smooth"});
}
function updateAll(){
  const b=qiblaBearing(state.location.lat,state.location.lon);
  const dist=distanceKm(state.location.lat,state.location.lon);
  const loc=state.location.name;
  ["homeLocation","qiblaLocation","sunLocation","rashdulLocation"].forEach(id=>{const e=$("#"+id);if(e)e.textContent=loc});
  ["homeCoords","qiblaCoords"].forEach(id=>{const e=$("#"+id);if(e)e.textContent=`Lat ${state.location.lat.toFixed(4)}° • Lon ${state.location.lon.toFixed(4)}°`});
  $("#homeQibla").textContent=b.toFixed(1)+"°"; $("#homeQiblaDir").textContent=cardinal(b);
  $("#qiblaBearing").textContent=b.toFixed(1)+"°"; $("#qiblaDirection").textContent=cardinal(b);
  $("#qiblaAzimuth").textContent=b.toFixed(1)+"°"; $("#qiblaCardinal").textContent=cardinal(b);
  $("#mapBearing").textContent=b.toFixed(1)+"°"; $("#mapDirection").textContent=cardinal(b);
  $("#mapDistance").textContent=dist.toFixed(1)+" km"; $("#distanceMakkah").textContent=dist.toFixed(1)+" km";
  $("#mapCoords").textContent=`${state.location.lat.toFixed(4)}, ${state.location.lon.toFixed(4)}`;
  const next=nextPrayerData(new Date()); $("#nextPrayer").textContent=next.name; $("#nextPrayerTime").textContent=formatTime(next.time);
  updateSun();
  renderRashdul();
  updateCompassVisual();
  updateMapIfReady();
}
function nextPrayerData(date){
  const t=prayerTimes(date);
  const names=[["Subuh",t.fajr],["Zuhur",t.zuhur],["Asar",t.asr],["Maghrib",t.maghrib],["Isya",t.isha]];
  const now=date.getHours()+date.getMinutes()/60;
  let x=names.find(a=>Number.isFinite(a[1])&&a[1]>now);
  return x?{name:x[0],time:x[1]}:{name:"Subuh",time:t.fajr};
}
function updateSun(){
  const now=new Date(), sp=solarPosition(now,state.location.lat,state.location.lon,state.settings.timezone);
  $("#homeSunAzimuth").textContent=sp.azimuth.toFixed(1)+"°"; $("#homeSunAltitude").textContent="Alt "+sp.altitude.toFixed(1)+"°";
  $("#sunAzimuth").textContent=sp.azimuth.toFixed(1)+"°"; $("#sunAltitude").textContent=sp.altitude.toFixed(1)+"°"; $("#sunDirection").textContent=cardinal(sp.azimuth);
  $("#sunZawal").textContent=formatTime(prayerTimes(now).zuhur); $("#sunTransit").textContent=formatTime(prayerTimes(now).zuhur);
  $("#sunDate").textContent=formatDate(now);
  // Place the Sun according to its computed altitude, not azimuth alone.
  const x=clamp(50+(sp.azimuth-180)/3.6,8,92);
  const y=clamp(78-((sp.altitude+5)/85)*68,10,82);
  const dot=$("#sunDot"); if(dot){dot.style.left=x+"%";dot.style.top=y+"%";dot.style.opacity=sp.altitude>-1?"1":"0";}
  const scene=$("#sunScene"),label=$("#sunSceneLabel"),detail=$("#sunSceneDetail");
  if(scene){
    scene.classList.remove("scene-day","scene-dawn","scene-sunset","scene-night");
    const localHour=now.getHours()+now.getMinutes()/60;
    let phase,title,desc;
    if(sp.altitude>=8){phase="scene-day";title="Langit siang";desc="Matahari di atas horizon · ketinggian "+sp.altitude.toFixed(1)+"°";}
    else if(sp.altitude>=-6){phase=(localHour<11.5?"scene-dawn":"scene-sunset");title=phase==="scene-dawn"?"Langit fajar / pagi":"Langit senja";desc="Cahaya senja astronomis · ketinggian Matahari "+sp.altitude.toFixed(1)+"°";}
    else{phase="scene-night";title="Langit malam";desc="Matahari di bawah horizon · ketinggian "+sp.altitude.toFixed(1)+"°";}
    scene.classList.add(phase);if(label)label.textContent=title;if(detail)detail.textContent=desc;
    scene.setAttribute("aria-label",title+" berdasarkan perhitungan posisi Matahari");
  }
}
function updateClock(){const n=new Date();$("#liveClock").textContent=new Intl.DateTimeFormat("id-ID",{hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(n);updateSun()}
function updateCompassVisual(){
  const b=qiblaBearing(state.location.lat,state.location.lon);
  const heading=Number.isFinite(state.sensorHeading) ? state.sensorHeading : null;
  const angle=heading===null ? b : norm360(b-heading);
  const needle=$("#qiblaNeedle");
  const mini=$("#miniArrow");
  if(needle) needle.style.transform=`rotate(${angle}deg)`;
  if(mini) mini.style.transform=`rotate(${angle}deg)`;
}

// =====================================================
// KOMPAS STABIL — SATU SUMBER SENSOR AKTIF DALAM SATU WAKTU
// =====================================================
let compassHandler=null;
let compassEventName=null;
let compassFallbackTimer=null;
let lastRawHeading=null;

function shortestAngleDelta(from,to){
  return ((to-from+540)%360)-180;
}

function smoothCompassHeading(raw){
  raw=norm360(raw);
  if(!Number.isFinite(state.sensorHeading)) return raw;
  const delta=shortestAngleDelta(state.sensorHeading,raw);
  // Smoothing circular: tidak meloncat saat melewati 359° -> 0°.
  return norm360(state.sensorHeading + delta*0.18);
}

function stopCompassListener(){
  if(compassHandler && compassEventName){
    window.removeEventListener(compassEventName,compassHandler,true);
  }
  compassHandler=null;
  compassEventName=null;
  if(compassFallbackTimer){clearTimeout(compassFallbackTimer);compassFallbackTimer=null;}
}

function readHeading(event){
  // iPhone/iPad Safari: gunakan heading kompas yang sudah dikoreksi perangkat.
  if(typeof event.webkitCompassHeading === "number" && Number.isFinite(event.webkitCompassHeading)){
    return norm360(event.webkitCompassHeading);
  }

  if(typeof event.alpha !== "number" || !Number.isFinite(event.alpha)) return null;

  // Untuk sensor absolut, alpha dihitung sebagai sudut searah jarum jam
  // dari utara pada implementasi yang digunakan aplikasi ini.
  return norm360(360-event.alpha);
}

function handleOrientation(event){
  const raw=readHeading(event);
  if(raw===null) return;

  lastRawHeading=raw;
  state.sensorHeading=smoothCompassHeading(raw);
  state.compassActive=true;

  const status=$("#sensorStatus");
  const headingEl=$("#sensorHeading");
  const textEl=$("#sensorText");
  if(status) status.textContent="Sensor aktif";
  if(headingEl) headingEl.textContent=state.sensorHeading.toFixed(1)+"°";
  if(textEl) textEl.textContent="Utara sensor terbaca. Arahkan bagian atas perangkat.";

  // HANYA jarum kiblat yang bergerak mengikuti heading HP.
  // Lingkaran kompas tidak diputar lagi sehingga heading tidak diterapkan dua kali.
  updateCompassVisual();
  updateTeodolite();
}

async function activateCompass(){
  if(state.compassActive && compassHandler) return;

  stopCompassListener();
  state.sensorHeading=null;
  lastRawHeading=null;

  try{
    if(typeof DeviceOrientationEvent === "undefined"){
      alert("Perangkat/browser ini tidak menyediakan sensor orientasi.");
      return;
    }

    if(typeof DeviceOrientationEvent.requestPermission === "function"){
      const permission=await DeviceOrientationEvent.requestPermission();
      if(permission!=="granted"){
        const status=$("#sensorStatus");
        if(status) status.textContent="Izin sensor ditolak";
        alert("Izin sensor kompas ditolak.");
        return;
      }
    }

    // Pilih SATU sumber utama. Jangan memasang absolute + normal bersamaan.
    if("ondeviceorientationabsolute" in window){
      compassEventName="deviceorientationabsolute";
    }else{
      compassEventName="deviceorientation";
    }

    compassHandler=handleOrientation;
    window.addEventListener(compassEventName,compassHandler,true);

    // Jika browser tidak mengirim absolute event, baru fallback sekali ke sensor biasa.
    compassFallbackTimer=setTimeout(()=>{
      if(!Number.isFinite(state.sensorHeading) && compassEventName==="deviceorientationabsolute"){
        stopCompassListener();
        compassEventName="deviceorientation";
        compassHandler=handleOrientation;
        window.addEventListener(compassEventName,compassHandler,true);
      }
    },1800);

    const status=$("#sensorStatus");
    const textEl=$("#sensorText");
    if(status) status.textContent="Mengaktifkan sensor…";
    if(textEl) textEl.textContent="Membaca arah perangkat…";
  }catch(error){
    console.error("COMPASS ERROR:",error);
    const status=$("#sensorStatus");
    if(status) status.textContent="Sensor tidak tersedia";
    alert("Sensor kompas tidak dapat diaktifkan.");
  }
}

function openGoogleEarth(){
  const lat=Number(state.location.lat);
  const lon=Number(state.location.lon);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)){
    alert("Lokasi belum tersedia.");
    return;
  }
  const url=`https://earth.google.com/web/search/${lat},${lon}`;
  const opened=window.open(url,"_blank","noopener,noreferrer");
  // Android WebView wrappers sometimes do not support target=_blank; fall back to same-window navigation.
  if(!opened) window.location.href=url;
}

function initEmbeddedMap(){
  const container=$("#map");
  if(!container)return;
  if(!window.L){
    $("#mapNotice").style.display="block";
    $("#mapNotice").textContent="Pustaka peta belum termuat. Periksa koneksi internet lalu tekan Perbarui Peta.";
    return;
  }
  if(state.mapReady){updateMap();state.map.invalidateSize();return;}
  const center=[state.location.lat,state.location.lon];
  state.map=L.map(container,{zoomControl:true,scrollWheelZoom:true,gestureHandling:true}).setView(center,13);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
    maxZoom:19,
    attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>'
  }).addTo(state.map);
  state.userMarker=L.marker(center).addTo(state.map).bindPopup("Lokasi pengamat");
  state.kaabaMarker=L.marker([KAABA.lat,KAABA.lon]).addTo(state.map).bindPopup("Ka'bah, Makkah");
  state.qiblaLine=L.polyline([center,[KAABA.lat,KAABA.lon]],{color:"#c49a36",weight:3,opacity:.9,dashArray:"8 8"}).addTo(state.map);
  state.mapReady=true;
  const notice=$("#mapNotice");if(notice){notice.style.display="block";notice.textContent="Peta OpenStreetMap aktif. © OpenStreetMap contributors. Peta daring memerlukan internet.";}
  updateMap();
}
function destinationPoint(lat,lon,bearingDeg,distanceKmValue){
  const R=6371.0088, d=distanceKmValue/R, br=d2r(bearingDeg), p1=d2r(lat), l1=d2r(lon);
  const p2=Math.asin(Math.sin(p1)*Math.cos(d)+Math.cos(p1)*Math.sin(d)*Math.cos(br));
  const l2=l1+Math.atan2(Math.sin(br)*Math.sin(d)*Math.cos(p1),Math.cos(d)-Math.sin(p1)*Math.sin(p2));
  return [r2d(p2),((r2d(l2)+540)%360)-180];
}
function updateMap(){
  if(!state.mapReady||!state.map||!window.L)return;
  const user=[state.location.lat,state.location.lon];
  state.userMarker?.setLatLng(user);
  state.kaabaMarker?.setLatLng([KAABA.lat,KAABA.lon]);
  state.map.panTo(user,{animate:false});
  // Local 30-km bearing ray keeps the qibla direction visible at useful local zoom.
  const endpoint=destinationPoint(state.location.lat,state.location.lon,qiblaBearing(state.location.lat,state.location.lon),30);
  state.qiblaLine?.setLatLngs([user,endpoint]);
  state.userMarker?.bindPopup(`Lokasi pengamat<br>${state.location.lat.toFixed(6)}, ${state.location.lon.toFixed(6)}`);
  const notice=$("#mapNotice");if(notice)notice.style.display="block";
}
function updateMapIfReady(){if(state.mapReady)updateMap()}

function signedAngleDifference(a,b){return ((a-b+540)%360)-180}
function updateTeodolite(){
  const q=qiblaBearing(state.location.lat,state.location.lon);
  const sp=solarPosition(new Date(),state.location.lat,state.location.lon,state.settings.timezone);
  const put=(id,value)=>{const el=$("#"+id);if(el)el.textContent=value};
  put("tdQibla",q.toFixed(2)+"°");put("tdQiblaDir",cardinal(q));
  put("tdHeading",Number.isFinite(state.sensorHeading)?state.sensorHeading.toFixed(1)+"°":"--°");
  put("tdHeadingNote",Number.isFinite(state.sensorHeading)?"Sensor aktif; kalibrasi diperlukan":"Belum terbaca");
  put("tdSunAzimuth",sp.azimuth.toFixed(2)+"°");put("tdSunAltitude","Ketinggian "+sp.altitude.toFixed(2)+"°");
  put("tdGpsAccuracy",Number.isFinite(state.gpsAccuracy)?Math.round(state.gpsAccuracy)+" m":"Belum diambil");
  put("tdCoordinates",`${state.location.lat.toFixed(6)}, ${state.location.lon.toFixed(6)}`);
  const station=$("#tdStationElevation");if(station && document.activeElement!==station && !station.dataset.userEdited)station.value=Number(state.location.elevation||0).toFixed(1);
  calculateTheodolite();
}
function calculateTheodolite(){
  const q=qiblaBearing(state.location.lat,state.location.lon);
  const azInput=$("#tdMeasuredAzimuth"),vInput=$("#tdVerticalAngle"),sInput=$("#tdSlopeDistance"),hiInput=$("#tdInstrumentHeight"),htInput=$("#tdTargetHeight"),eInput=$("#tdStationElevation");
  if(!azInput||!vInput||!sInput||!hiInput||!htInput||!eInput)return;
  let az=Number(azInput.value);if(azInput.value.trim()===""||!Number.isFinite(az))az=Number.isFinite(state.sensorHeading)?state.sensorHeading:q;
  const v=Number(vInput.value),S=Number(sInput.value),hi=Number(hiInput.value),ht=Number(htInput.value),elev=Number(eInput.value);
  const valid=[az,v,S,hi,ht,elev].every(Number.isFinite)&&S>=0&&Math.abs(v)<90&&hi>=0&&ht>=0;
  const put=(id,value)=>{const el=$("#"+id);if(el)el.textContent=value};
  if(!valid){put("tdAzimuthError","Data tidak valid");put("tdHorizontalDistance","-- m");put("tdVerticalComponent","-- m");put("tdHeightDifference","-- m");put("tdTargetElevation","-- mdpl");put("tdSunQiblaDifference","--°");return;}
  az=((az%360)+360)%360;
  const vr=d2r(v),horizontal=S*Math.cos(vr),vertical=S*Math.sin(vr),heightDiff=vertical+hi-ht,targetElev=elev+heightDiff;
  const azError=signedAngleDifference(az,q),sp=solarPosition(new Date(),state.location.lat,state.location.lon,state.settings.timezone),sunDiff=signedAngleDifference(sp.azimuth,q);
  const f=n=>Number(n).toFixed(3);
  put("tdAzimuthError",f(azError)+"°");put("tdHorizontalDistance",f(horizontal)+" m");put("tdVerticalComponent",f(vertical)+" m");put("tdHeightDifference",f(heightDiff)+" m");put("tdTargetElevation",f(targetElev)+" mdpl");put("tdSunQiblaDifference",f(sunDiff)+"°");
  const steps=$("#tdCalculationSteps");if(steps)steps.innerHTML=`
    <div class="calculation-step"><b>1. Nilai yang diketahui</b><p>Lintang pengamat φ = ${state.location.lat.toFixed(6)}°; bujur λ = ${state.location.lon.toFixed(6)}°; azimut bidikan A = ${f(az)}°; sudut vertikal v = ${f(v)}°; jarak miring S = ${f(S)} m; tinggi alat hᵢ = ${f(hi)} m; tinggi target hₜ = ${f(ht)} m; elevasi stasiun = ${f(elev)} mdpl.</p></div>
    <div class="calculation-step"><b>2. Azimut kiblat dan selisih bidikan</b><div class="formula formula-small">Aq = atan2(sin Δλ, cos φ · tan φK − sin φ · cos Δλ)</div><p>Azimut kiblat Aq = ${q.toFixed(4)}° (${cardinal(q)}).</p><div class="formula formula-small">ΔA = ((A − Aq + 540) mod 360) − 180</div><p>ΔA = ${f(az)}° − ${q.toFixed(4)}° (dinormalisasi) = <b>${f(azError)}°</b>. Nilai absolut yang kecil berarti bidikan mendekati azimut kiblat.</p></div>
    <div class="calculation-step"><b>3. Jarak horizontal</b><div class="formula formula-small">Dₕ = S × cos(v)</div><p>Dₕ = ${f(S)} × cos(${f(v)}°) = <b>${f(horizontal)} m</b>.</p></div>
    <div class="calculation-step"><b>4. Komponen beda tinggi dari garis bidik</b><div class="formula formula-small">Δh₀ = S × sin(v)</div><p>Δh₀ = ${f(S)} × sin(${f(v)}°) = <b>${f(vertical)} m</b>.</p></div>
    <div class="calculation-step"><b>5. Koreksi tinggi alat dan target</b><div class="formula formula-small">Δh = S sin(v) + hᵢ − hₜ</div><p>Δh = ${f(vertical)} + ${f(hi)} − ${f(ht)} = <b>${f(heightDiff)} m</b>.</p><div class="formula formula-small">Elevasi target = elevasi stasiun + Δh</div><p>= ${f(elev)} + (${f(heightDiff)}) = <b>${f(targetElev)} mdpl</b>.</p></div>
    <div class="calculation-step"><b>6. Perbandingan azimut Matahari dan kiblat</b><p>Azimut Matahari saat ini = ${sp.azimuth.toFixed(4)}°; tinggi Matahari = ${sp.altitude.toFixed(4)}°.</p><div class="formula formula-small">ΔA☉ = selisih sudut terkecil (A☉, Aq)</div><p>Selisih azimut Matahari terhadap kiblat = <b>${f(sunDiff)}°</b>. Ini perbandingan arah horizontal, bukan bukti waktu rashdul kiblat.</p></div>
    <p class="coordinate-note">Catatan: sudut vertikal dianggap positif ke atas dan negatif ke bawah; S adalah jarak miring. Bila alat Anda menampilkan sudut zenit, konversikan v = 90° − sudut zenit sebelum memasukkannya. Rumus elevasi ini adalah pendekatan geometris dan tidak mengoreksi refraksi, kelengkungan Bumi, atau kesalahan kolimasi.</p>`;
}
function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function localDateTimeValue(date=new Date()){
  const pad2=n=>String(n).padStart(2,"0");
  return `${date.getFullYear()}-${pad2(date.getMonth()+1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
function simulateSunPosition(){
  const dateValue=$("#solarSimulationDate")?.value;
  const zone=Number($("#solarSimulationTimezone")?.value);
  const note=$("#simSunNote");
  if(!dateValue||!Number.isFinite(zone)){if(note)note.textContent="Masukkan tanggal, waktu, dan zona waktu yang valid.";return;}
  const parts=dateValue.split("T"),dparts=(parts[0]||"").split("-").map(Number),tparts=(parts[1]||"").split(":").map(Number);
  if(dparts.length!==3||tparts.length<2||dparts.some(v=>!Number.isFinite(v))||tparts.some(v=>!Number.isFinite(v))){if(note)note.textContent="Format tanggal/waktu tidak valid.";return;}
  // Create a local-clock Date so solarPosition uses the entered wall-clock time; timezone is passed separately.
  const date=new Date(dparts[0],dparts[1]-1,dparts[2],tparts[0],tparts[1],0,0);
  if(Number.isNaN(date.getTime())){if(note)note.textContent="Tanggal/waktu tidak dapat dibaca.";return;}
  const sp=solarPosition(date,state.location.lat,state.location.lon,zone);
  const put=(id,val)=>{const el=$("#"+id);if(el)el.textContent=val;};
  put("simSunAz",sp.azimuth.toFixed(3)+"°");put("simSunAlt",sp.altitude.toFixed(3)+"°");put("simSunDecl",sp.decl.toFixed(3)+"°");
  put("simSunState",sp.altitude>0?"Di atas horizon":sp.altitude<0?"Di bawah horizon":"Di horizon");
  if(note)note.textContent=`Lokasi ${state.location.lat.toFixed(5)}°, ${state.location.lon.toFixed(5)}°; waktu lokal yang dimasukkan menggunakan UTC${zone>=0?"+":""}${zone}. Hasil merupakan prediksi geometris, bukan pembacaan sensor.`;
}
function getObservationRecords(){
  try{const parsed=JSON.parse(localStorage.getItem("panritaFalakObservations")||"[]");return Array.isArray(parsed)?parsed:[]}catch{return []}
}
function renderObservationRecords(){
  const box=$("#observationList");if(!box)return;
  const rows=getObservationRecords();
  if(!rows.length){box.innerHTML='<p class="hint">Belum ada catatan observasi tersimpan.</p>';return;}
  box.innerHTML=rows.slice().reverse().map((r,i)=>`<article class="observation-item"><div><b>${escapeHtml(r.name||"Observasi")}</b><small>${escapeHtml(r.date||"")} · ${escapeHtml(r.location||"")}</small></div><p>Azimut bidikan: ${escapeHtml(r.azimuth)}° · Azimut kiblat: ${escapeHtml(r.qibla)}° · Selisih: ${escapeHtml(r.azimuthError)}°</p><p>GPS: ${escapeHtml(r.coords||"")}${r.gpsAccuracy==null?"":` · akurasi yang dilaporkan GPS: ±${escapeHtml(r.gpsAccuracy)} m`}</p>${r.referenceAzimuth==null?"":`<p>Azimut pembanding fisik: ${escapeHtml(r.referenceAzimuth)}° · selisih terhadap input aplikasi: ${escapeHtml(r.referenceDifference)}°</p>`}<small>${escapeHtml(r.notes||"Tanpa catatan tambahan")}</small></article>`).join("");
}
function saveObservation(){
  calculateTheodolite();
  const azRaw=$("#tdMeasuredAzimuth")?.value.trim();
  const az=azRaw===""?state.sensorHeading:Number(azRaw);
  const q=qiblaBearing(state.location.lat,state.location.lon);
  if(!Number.isFinite(az)||!Number.isFinite(Number($("#tdVerticalAngle")?.value))||!Number.isFinite(Number($("#tdSlopeDistance")?.value))){alert("Lengkapi azimut, sudut vertikal, dan jarak yang valid sebelum menyimpan.");return;}
  const referenceRaw=$("#referenceAzimuth")?.value.trim();
  const reference=referenceRaw===""?null:Number(referenceRaw);
  if(reference!==null&&(!Number.isFinite(reference)||reference<0||reference>360)){alert("Azimut pembanding harus berada pada rentang 0–360°.");return;}
  const azNorm=norm360(az),refDiff=reference===null?null:Number(signedAngleDifference(azNorm,norm360(reference)).toFixed(3));
  const record={
    date:new Date().toLocaleString("id-ID"),name:$("#observationName")?.value.trim()||"Observasi Teodolit Falak",
    location:state.location.name||"Lokasi pengamat",coords:`${state.location.lat.toFixed(6)}, ${state.location.lon.toFixed(6)}`,
    latitude:state.location.lat,longitude:state.location.lon,gpsAccuracy:Number.isFinite(state.gpsAccuracy)?Math.round(state.gpsAccuracy*10)/10:null,
    azimuth:Number(azNorm.toFixed(3)),qibla:Number(q.toFixed(3)),azimuthError:Number(signedAngleDifference(azNorm,q).toFixed(3)),
    verticalAngle:Number($("#tdVerticalAngle").value),slopeDistance:Number($("#tdSlopeDistance").value),instrumentHeight:Number($("#tdInstrumentHeight").value),targetHeight:Number($("#tdTargetHeight").value),stationElevation:Number($("#tdStationElevation").value),
    horizontalDistance:Number((Number($("#tdSlopeDistance").value)*Math.cos(d2r(Number($("#tdVerticalAngle").value)))).toFixed(3)),
    verticalComponent:Number((Number($("#tdSlopeDistance").value)*Math.sin(d2r(Number($("#tdVerticalAngle").value)))).toFixed(3)),
    referenceAzimuth:reference,referenceDifference:refDiff,
    instrumentPrecisionArcsec:Math.max(0,Number($("#instrumentPrecisionArcsec")?.value||0)),
    notes:$("#observationNotes")?.value.trim()||""
  };
  const records=getObservationRecords();records.push(record);
  try{localStorage.setItem("panritaFalakObservations",JSON.stringify(records.slice(-100)));}
  catch(err){alert("Catatan tidak dapat disimpan di penyimpanan perangkat. Periksa izin/ruang penyimpanan browser.");return;}
  const validation=$("#observationValidation");
  if(validation)validation.textContent=reference===null?"Observasi tersimpan. Masukkan azimut pembanding fisik untuk menghitung selisih validasi.":`Observasi tersimpan. Selisih azimut aplikasi terhadap pembanding yang dimasukkan: ${Math.abs(refDiff).toFixed(3)}°. Ini bukan jaminan akurasi; pastikan metode dan acuan pengukuran sebanding.`;
  renderObservationRecords();
}
function exportObservationReport(){
  const rows=getObservationRecords();
  if(!rows.length){alert("Belum ada observasi tersimpan. Simpan minimal satu pengamatan terlebih dahulu.");return;}
  const body=rows.map((r,i)=>`<section><h2>Observasi ${i+1}: ${escapeHtml(r.name)}</h2><p><b>Tanggal:</b> ${escapeHtml(r.date)}<br><b>Lokasi:</b> ${escapeHtml(r.location)}<br><b>Koordinat:</b> ${escapeHtml(r.coords)}<br><b>Akurasi GPS yang dilaporkan:</b> ${r.gpsAccuracy==null?"Tidak tersedia":"±"+escapeHtml(r.gpsAccuracy)+" m"}</p><table><tbody><tr><th>Azimut bidikan</th><td>${escapeHtml(r.azimuth)}°</td></tr><tr><th>Azimut kiblat hasil hitung</th><td>${escapeHtml(r.qibla)}°</td></tr><tr><th>Selisih terhadap kiblat</th><td>${escapeHtml(r.azimuthError)}°</td></tr><tr><th>Sudut vertikal</th><td>${escapeHtml(r.verticalAngle)}°</td></tr><tr><th>Jarak miring</th><td>${escapeHtml(r.slopeDistance)} m</td></tr><tr><th>Jarak horizontal</th><td>${escapeHtml(r.horizontalDistance)} m</td></tr><tr><th>Komponen vertikal</th><td>${escapeHtml(r.verticalComponent)} m</td></tr><tr><th>Tinggi alat / target</th><td>${escapeHtml(r.instrumentHeight)} m / ${escapeHtml(r.targetHeight)} m</td></tr><tr><th>Elevasi stasiun</th><td>${escapeHtml(r.stationElevation)} mdpl</td></tr><tr><th>Spesifikasi ketelitian sudut alat</th><td>${escapeHtml(r.instrumentPrecisionArcsec)} detik busur (${(Number(r.instrumentPrecisionArcsec)/3600).toFixed(5)}°)</td></tr>${r.referenceAzimuth==null?"":`<tr><th>Azimut pembanding fisik</th><td>${escapeHtml(r.referenceAzimuth)}°</td></tr><tr><th>Selisih dengan pembanding</th><td>${escapeHtml(r.referenceDifference)}°</td></tr>`}<tr><th>Catatan</th><td>${escapeHtml(r.notes||"—")}</td></tr></tbody></table></section>`).join("");
  const html=`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Laporan Observasi Panrita Falak</title><style>body{font:12pt Arial,sans-serif;line-height:1.5;color:#17212f;max-width:900px;margin:30px auto;padding:0 20px}h1{font-size:22pt}h2{font-size:15pt;margin-top:25px}table{border-collapse:collapse;width:100%;margin:12px 0 24px}th,td{border:1px solid #aab4c0;padding:8px;text-align:left;vertical-align:top}th{width:38%;background:#f1f4f7}section{break-inside:avoid}.note{padding:12px;background:#fff7e6;border:1px solid #e8cf8b}@media print{body{margin:0;max-width:none}.no-print{display:none}}</style></head><body><div class="no-print"><button onclick="window.print()">Cetak / Simpan sebagai PDF</button><p>Gunakan perintah Cetak lalu pilih “Simpan sebagai PDF” jika tersedia.</p></div><h1>Laporan Observasi Panrita Falak</h1><p>Jumlah catatan: ${rows.length}. Laporan dibuat pada ${escapeHtml(new Date().toLocaleString("id-ID"))}.</p><p class="note"><b>Catatan metodologis:</b> laporan ini merangkum input dan hasil hitung aplikasi, bukan sertifikat kalibrasi. Validitas hasil bergantung pada instrumen, prosedur, lokasi, waktu, dan pengulangan pengukuran. Selisih terhadap pembanding hanya bermakna bila kedua pengukuran memakai acuan dan definisi sudut yang sebanding.</p>${body}</body></html>`;
  const blob=new Blob([html],{type:"text/html;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=`laporan-observasi-panrita-falak-${new Date().toISOString().slice(0,10)}.html`;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function clearObservations(){
  const rows=getObservationRecords();if(!rows.length){renderObservationRecords();return;}
  if(!confirm("Hapus semua catatan observasi yang tersimpan pada perangkat ini?"))return;
  localStorage.removeItem("panritaFalakObservations");renderObservationRecords();const v=$("#observationValidation");if(v)v.textContent="Semua catatan observasi lokal telah dihapus.";
}
function updateGoogleEarthLink(){
  const btn=$('[data-action="google-earth"]');if(btn){btn.title=`Buka koordinat ${state.location.lat.toFixed(5)}, ${state.location.lon.toFixed(5)} di Google Earth`;}
}

async function startTheodoliteCamera(){
  const video=$("#theodoliteVideo"),placeholder=$("#cameraPlaceholder"),status=$("#cameraStatus");
  if(!navigator.mediaDevices?.getUserMedia){if(status)status.textContent="Kamera tidak tersedia di konteks ini. Gunakan APK/WebView dengan izin kamera atau jalankan melalui HTTPS.";return;}
  try{
    if(state.cameraStream)state.cameraStream.getTracks().forEach(t=>t.stop());
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}},audio:false});
    state.cameraStream=stream;video.srcObject=stream;video.classList.add("is-live");placeholder.style.display="none";
    await video.play().catch(()=>{});if(status)status.textContent="Kamera aktif (belakang jika tersedia)";
  }catch(err){if(status)status.textContent="Kamera gagal: "+(err.name==="NotAllowedError"?"izin ditolak":"periksa izin kamera dan pengaturan APK");console.warn("Kamera Teodolit Falak:",err);}
}
function stopTheodoliteCamera(){if(state.cameraStream)state.cameraStream.getTracks().forEach(t=>t.stop());state.cameraStream=null;const v=$("#theodoliteVideo"),p=$("#cameraPlaceholder");if(v){v.pause();v.srcObject=null;v.classList.remove("is-live")}if(p)p.style.display="grid";const s=$("#cameraStatus");if(s)s.textContent="Kamera dimatikan"}

function renderPrayer(){
  const d=state.selectedDate,t=prayerTimes(d);
  $("#selectedDate").textContent=formatDate(d); $("#prayerDateLabel").textContent=formatDate(d,{dateStyle:"full"});
  $("#prayerMethodLabel").textContent=state.settings.method==="auto"?`Otomatis berdasarkan lokasi (${effectivePrayerMethod()==="kemenag"?"Kemenag RI":"Muslim World League"})`:$("#methodSelect").selectedOptions[0].textContent;
  $("#prayerZoneLabel").textContent=timezoneLabel();
  const rows=[["Imsak",t.imsak,"☾"],["Subuh",t.fajr,"☾"],["Terbit",t.sunrise,"☀"],["Zuhur",t.zuhur,"◉"],["Asar",t.asr,"◒"],["Maghrib",t.maghrib,"◐"],["Isya",t.isha,"☾"]];
  const next=nextPrayerData(d);
  $("#prayerGrid").innerHTML=rows.map(([name,time,icon])=>`<div class="prayer-item card ${next.name===name?"next":""}"><div class="picon">${icon}</div><div><small>${name}</small><strong>${formatTime(time)}</strong></div></div>`).join("");
}
function timezoneLabel(){return state.settings.timezone===7?"WIB (UTC+7)":state.settings.timezone===9?"WIT (UTC+9)":state.settings.timezone===8?"WITA (UTC+8)":"UTC"}
function renderMonthly(){
  const y=state.currentMonth.getFullYear(),m=state.currentMonth.getMonth();
  $("#monthLabel").textContent=new Intl.DateTimeFormat("id-ID",{month:"long",year:"numeric"}).format(state.currentMonth);
  const days=new Date(y,m+1,0).getDate(),today=new Date();
  let html="";
  for(let day=1;day<=days;day++){
    const d=new Date(y,m,day),t=prayerTimes(d),isToday=d.toDateString()===today.toDateString();
    html+=`<tr class="${isToday?"today":""}"><td>${day} ${new Intl.DateTimeFormat("id-ID",{weekday:"short"}).format(d)}</td><td>${formatTime(t.fajr)}</td><td>${formatTime(t.sunrise)}</td><td>${formatTime(t.zuhur)}</td><td>${formatTime(t.asr)}</td><td>${formatTime(t.maghrib)}</td><td>${formatTime(t.isha)}</td></tr>`;
  }
  $("#monthlyBody").innerHTML=html;
}
function rashdulForDate(d){
  const q=qiblaBearing(state.location.lat,state.location.lon);let best=null;
  // Scan the local civil day; a coarse scan is used for discovery only, not official timing.
  for(let minute=0;minute<1440;minute+=2){
    const dt=new Date(d.getFullYear(),d.getMonth(),d.getDate(),0,minute);
    const sp=solarPosition(dt,state.location.lat,state.location.lon,state.settings.timezone);
    const diff=Math.abs(((sp.azimuth-q+540)%360)-180);
    if(sp.altitude>0&&(!best||diff<best.diff))best={minute,diff,altitude:sp.altitude,azimuth:sp.azimuth};
  }
  return {q,best,valid:!!best&&best.diff<2.5};
}
function renderRashdulCalendar(){
  const picker=$('#rashdulDatePicker');if(picker&&state.selectedDate)picker.value=`${state.selectedDate.getFullYear()}-${String(state.selectedDate.getMonth()+1).padStart(2,'0')}-${String(state.selectedDate.getDate()).padStart(2,'0')}`;
  const selected=state.selectedDate||new Date(),y=selected.getFullYear(),m=selected.getMonth();
  const label=$('#rashdulMonthLabel');if(label)label.textContent=new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric'}).format(new Date(y,m,1));
  const grid=$('#rashdulCalendarGrid');if(grid){const first=new Date(y,m,1),offset=(first.getDay()+6)%7,days=new Date(y,m+1,0).getDate(),today=new Date();let html=['Sen','Sel','Rab','Kam','Jum','Sab','Min'].map(x=>`<div class="rashdul-weekday">${x}</div>`).join('');for(let i=0;i<offset;i++)html+='<div class="rashdul-day empty"></div>';for(let day=1;day<=days;day++){const d=new Date(y,m,day),isSel=d.toDateString()===selected.toDateString(),isToday=d.toDateString()===today.toDateString();const early=rashdulForDate(d);const hasEvent=!!early.valid;html+=`<button class="rashdul-day ${isSel?'selected':''} ${isToday?'today':''} ${hasEvent?'has-rashdul':''}" data-rashdul-day="${day}" aria-label="Pilih ${day}${hasEvent?', perkiraan Rashdul Kiblat':''}">${day}</button>`}grid.innerHTML=html;grid.querySelectorAll('[data-rashdul-day]').forEach(b=>b.addEventListener('click',()=>{state.selectedDate=new Date(y,m,Number(b.dataset.rashdulDay));renderRashdul()}));}
  const list=$('#rashdulUpcomingList');if(list){let found=[],d=new Date();d.setHours(0,0,0,0);for(let i=0;i<120&&found.length<4;i++){const test=new Date(d);test.setDate(d.getDate()+i);const r=rashdulForDate(test);if(r.valid)found.push({date:test,result:r})}list.innerHTML=found.length?found.map(x=>`<button class="rashdul-upcoming-item" data-rashdul-date="${x.date.toISOString().slice(0,10)}"><span>${new Intl.DateTimeFormat('id-ID',{weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(x.date)}</span><b>${formatTime(x.result.best.minute/60)} ${state.settings.timezone===7?'WIB':state.settings.timezone===9?'WIT':'WITA'}</b></button>`).join(''):'<p>Belum ditemukan tanggal yang memenuhi ambang pencarian dalam 120 hari.</p>';list.querySelectorAll('[data-rashdul-date]').forEach(b=>b.addEventListener('click',()=>{const [yy,mm,dd]=b.dataset.rashdulDate.split('-').map(Number);state.selectedDate=new Date(yy,mm-1,dd);renderRashdul()}));}
}
function renderRashdul(){
  const d=state.selectedDate;$('#rashdulDate').textContent=formatDate(d);const {q,best,valid}=rashdulForDate(d);
  const zone=state.settings.timezone===7?'WIB':state.settings.timezone===9?'WIT':'WITA';
  $('#rashdulTime').textContent=valid?`${formatTime(best.minute/60)} ${zone}`:'Tidak ditemukan waktu yang memenuhi ambang pencarian';
  $('#rashdulExplanation').textContent=`Azimut kiblat lokasi: ${q.toFixed(3)}°. Pencarian membandingkan azimut Matahari dengan azimut kiblat saat Matahari di atas horizon. ${valid?`Selisih azimut terkecil pada hasil pencarian ${best.diff.toFixed(2)}°; tinggi Matahari ${best.altitude.toFixed(2)}°.`:'Pada tanggal ini tidak ditemukan hasil yang memenuhi ambang selisih 2,5°.'} Waktu merupakan perkiraan awal dan perlu diverifikasi.`;
  renderRashdulCalendar();
}

function formatUtcOffset(offsetHours){
  if(!Number.isFinite(offsetHours)) return "--";
  const sign=offsetHours>=0?"+":"-", a=Math.abs(offsetHours), h=Math.floor(a), m=Math.round((a-h)*60);
  return `UTC${sign}${String(h).padStart(2,"0")}${m?":"+String(m).padStart(2,"0"):""}`;
}
function timezoneOffsetHours(timeZone,date=new Date()){
  try{
    const parts=new Intl.DateTimeFormat("en-US",{timeZone,hour12:false,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit"}).formatToParts(date);
    const o=Object.fromEntries(parts.filter(x=>x.type!=="literal").map(x=>[x.type,x.value]));
    const asUTC=Date.UTC(Number(o.year),Number(o.month)-1,Number(o.day),Number(o.hour)%24,Number(o.minute),Number(o.second));
    return (asUTC-date.getTime())/3600000;
  }catch(e){ return NaN; }
}
function calculatorData(r){
  const tz=Number.isFinite(r.timezoneOffset)?r.timezoneOffset:8;
  const now=new Date();
  const sp=solarPosition(now,r.lat,r.lon,tz);
  const q=qiblaBearing(r.lat,r.lon);
  const dist=distanceKm(r.lat,r.lon);
  const noonDate=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);
  const noonSp=solarPosition(noonDate,r.lat,r.lon,tz);
  const hRise=hourAngleForAltitude(r.lat,noonSp.decl,-0.833);
  const angles=effectivePrayerAngles();
  const hFajr=hourAngleForAltitude(r.lat,noonSp.decl,-angles.fajr);
  const hIsha=hourAngleForAltitude(r.lat,noonSp.decl,-angles.isha);
  const solarNoon=12-noonSp.eqTime/60-r.lon/15+tz;
  const sunrise=hRise==null?NaN:solarNoon-hRise/15;
  const sunset=hRise==null?NaN:solarNoon+hRise/15;
  const fajr=hFajr==null?NaN:solarNoon-hFajr/15;
  // Umm al-Qura uses a fixed interval after sunset (90 minutes; Ramadan exception is not auto-detected).
  const isha=effectivePrayerMethod()==="umm" ? (Number.isFinite(sunset)?sunset+1.5:NaN) : (hIsha==null?NaN:solarNoon+hIsha/15);
  const asrAlt=r2d(Math.atan(1/(1+Math.tan(Math.abs(d2r(r.lat-noonSp.decl))))));
  const hAsr=hourAngleForAltitude(r.lat,noonSp.decl,asrAlt);
  const asr=hAsr==null?NaN:solarNoon+hAsr/15;
  return {q,dist,sp,sunrise,sunset,fajr,solarNoon,asr,isha,tz};
}
function renderCoordinateResult(r,statusText="Koordinat berhasil dihitung."){
  const resultName=$("#coordinateResultName"),latOut=$("#coordinateLat"),lonOut=$("#coordinateLon");
  const tzOut=$("#coordinateTimezone"),qOut=$("#coordinateQibla"),distOut=$("#coordinateDistance"),sunAzOut=$("#coordinateSunAzimuth"),sunAltOut=$("#coordinateSunAltitude");
  const fajrOut=$("#coordinateFajr"),sunriseOut=$("#coordinateSunrise"),noonOut=$("#coordinateNoon"),asrOut=$("#coordinateAsr"),sunsetOut=$("#coordinateSunset"),ishaOut=$("#coordinateIsha");
  const data=calculatorData(r);
  window.__falakCoordinateResult=r;
  if(resultName)resultName.textContent=r.name||"Lokasi";
  if(latOut)latOut.textContent=`${r.lat.toFixed(6)}°`;
  if(lonOut)lonOut.textContent=`${r.lon.toFixed(6)}°`;
  if(tzOut)tzOut.textContent=`${r.timezone||"--"} (${formatUtcOffset(data.tz)})`;
  if(qOut)qOut.textContent=`${data.q.toFixed(2)}° • ${cardinal(data.q)}`;
  if(distOut)distOut.textContent=`${data.dist.toFixed(1)} km`;
  if(sunAzOut)sunAzOut.textContent=`${data.sp.azimuth.toFixed(1)}°`;
  if(sunAltOut)sunAltOut.textContent=`${data.sp.altitude.toFixed(1)}°`;
  if(fajrOut)fajrOut.textContent=formatTime(data.fajr);
  if(sunriseOut)sunriseOut.textContent=formatTime(data.sunrise);
  if(noonOut)noonOut.textContent=formatTime(data.solarNoon);
  if(asrOut)asrOut.textContent=formatTime(data.asr);
  if(sunsetOut)sunsetOut.textContent=formatTime(data.sunset);
  if(ishaOut)ishaOut.textContent=formatTime(data.isha);
  const status=$("#coordinateStatus"); if(status)status.textContent=statusText;
  const useBtn=$("#useCoordinateLocation"),earthBtn=$("#coordinateEarth");
  if(useBtn)useBtn.disabled=false; if(earthBtn)earthBtn.disabled=false;
}
function calculateManualCoordinates(){
  const lat=Number($("#manualLatitude")?.value),lon=Number($("#manualLongitude")?.value);
  const name=($("#manualLocationName")?.value||"Lokasi Koordinat").trim();
  if(!Number.isFinite(lat)||lat<-90||lat>90||!Number.isFinite(lon)||lon<-180||lon>180){
    const status=$("#coordinateStatus"); if(status)status.textContent="Latitude harus −90 s.d. 90 dan longitude −180 s.d. 180."; return;
  }
  renderCoordinateResult({name,lat,lon,timezone:"Zona waktu dari koordinat manual belum ditentukan",timezoneOffset:state.settings.timezone});
}
async function searchCityCoordinates(){
  const input=$("#coordinateCityInput"),status=$("#coordinateStatus");
  const useBtn=$("#useCoordinateLocation"),earthBtn=$("#coordinateEarth");
  if(!input||!status)return;
  const query=input.value.trim();
  if(!query){status.textContent="Masukkan nama kota atau wilayah terlebih dahulu.";return;}
  status.textContent="Mencari koordinat…"; if(useBtn)useBtn.disabled=true; if(earthBtn)earthBtn.disabled=true;
  try{
    const url=`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=id&format=json`;
    const response=await fetch(url); if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(!Array.isArray(data.results)||!data.results.length){status.textContent="Koordinat tidak ditemukan. Coba nama kota yang lebih lengkap.";return;}
    const place=data.results[0],lat=Number(place.latitude),lon=Number(place.longitude);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)){status.textContent="Data koordinat dari layanan pencarian tidak valid.";return;}
    const placeName=[place.name,place.admin1,place.country].filter(Boolean).join(", ");
    const timezone=place.timezone||"";
    const timezoneOffset=timezoneOffsetHours(timezone,new Date());
    renderCoordinateResult({name:placeName||query,lat,lon,timezone,timezoneOffset},"Koordinat ditemukan. Semua kalkulasi di bawah diperbarui untuk lokasi ini.");
  }catch(error){console.error("COORDINATE SEARCH ERROR:",error);status.textContent="Pencarian gagal. Pastikan internet aktif lalu coba lagi.";}
}
function useCoordinateLocation(){
  const r=window.__falakCoordinateResult; if(!r)return;
  setLocation(r.lat,r.lon,state.location.elevation,r.name); $("#locationNameInput").value=r.name; alert(`Lokasi diubah ke ${r.name}.`);
}
function openCoordinateEarth(){
  const r=window.__falakCoordinateResult; if(!r)return;
  window.open(`https://earth.google.com/web/search/${r.lat},${r.lon}`,"_blank","noopener,noreferrer");
}
function renderCoordinateCalculator(c){
  c.innerHTML=`
    <div class="coordinate-calculator">
      <h3>Kalkulator Koordinat & Hisab Kota</h3>
      <p>Masukkan nama kota untuk mencari lintang dan bujur, lalu lihat hasil hisab utama lokasi tersebut.</p>
      <div class="coordinate-form">
        <label><span>Nama Kota / Wilayah</span><input id="coordinateCityInput" type="text" placeholder="Contoh: Makassar" autocomplete="off"></label>
        <button class="primary-btn" id="searchCoordinates" type="button">Cari Kota</button>
      </div>
      <div class="coordinate-section-title">Atau masukkan koordinat secara manual</div>
      <div class="coordinate-input-grid">
        <label><span>Nama Lokasi</span><input id="manualLocationName" type="text" placeholder="Contoh: Bulukumba"></label>
        <label><span>Latitude / Lintang</span><input id="manualLatitude" type="number" step="0.000001" min="-90" max="90" placeholder="-5.55"></label>
        <label><span>Longitude / Bujur</span><input id="manualLongitude" type="number" step="0.000001" min="-180" max="180" placeholder="120.19"></label>
        <div style="display:flex;align-items:end"><button class="secondary-btn" id="calculateManualCoordinates" type="button">Hitung Koordinat</button></div>
      </div>
      <div class="coordinate-status" id="coordinateStatus">Pencarian kota menggunakan layanan geocoding Open-Meteo.</div>
      <div class="card" style="margin:0;">
        <p class="coordinate-name" id="coordinateResultName">Belum ada lokasi yang dihitung.</p>
        <div class="coordinate-result">
          <div class="coordinate-value"><small>Latitude / Lintang</small><b id="coordinateLat">--</b></div>
          <div class="coordinate-value"><small>Longitude / Bujur</small><b id="coordinateLon">--</b></div>
        </div>
      </div>
      <div class="coordinate-metrics">
        <div class="coordinate-metric"><small>Zona Waktu</small><b id="coordinateTimezone">--</b></div>
        <div class="coordinate-metric"><small>Azimut Kiblat</small><b id="coordinateQibla">--</b></div>
        <div class="coordinate-metric"><small>Jarak ke Ka'bah</small><b id="coordinateDistance">--</b></div>
        <div class="coordinate-metric"><small>Azimut Matahari</small><b id="coordinateSunAzimuth">--</b></div>
        <div class="coordinate-metric"><small>Altitude Matahari</small><b id="coordinateSunAltitude">--</b></div>
      </div>
      <div class="coordinate-section-title">Perkiraan waktu matahari & salat hari ini</div>
      <p class="coordinate-note">Subuh/Isya menggunakan sudut 18° dan Asar menggunakan faktor Syafi'i (1×). Hasil ini untuk kalkulasi aplikasi, bukan pengganti jadwal resmi setempat.</p>
      <div class="coordinate-metrics">
        <div class="coordinate-metric"><small>Subuh</small><b id="coordinateFajr">--:--</b></div>
        <div class="coordinate-metric"><small>Terbit</small><b id="coordinateSunrise">--:--</b></div>
        <div class="coordinate-metric"><small>Zuhur / Transit</small><b id="coordinateNoon">--:--</b></div>
        <div class="coordinate-metric"><small>Asar</small><b id="coordinateAsr">--:--</b></div>
        <div class="coordinate-metric"><small>Terbenam</small><b id="coordinateSunset">--:--</b></div>
        <div class="coordinate-metric"><small>Isya</small><b id="coordinateIsha">--:--</b></div>
      </div>
      <div class="coordinate-actions">
        <button class="secondary-btn" id="useCoordinateLocation" type="button" disabled>Gunakan Lokasi Ini</button>
        <button class="secondary-btn" id="coordinateEarth" type="button" disabled>Buka di Google Earth</button>
      </div>
    </div>`;
  $("#searchCoordinates")?.addEventListener("click",searchCityCoordinates);
  $("#coordinateCityInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")searchCityCoordinates()});
  $("#calculateManualCoordinates")?.addEventListener("click",calculateManualCoordinates);
  $("#useCoordinateLocation")?.addEventListener("click",useCoordinateLocation);
  $("#coordinateEarth")?.addEventListener("click",openCoordinateEarth);
}

function renderFormula(type){
  const c=$("#formulaContent");
  if(!c) return;
  const lat=Number(state.location.lat), lon=Number(state.location.lon), tz=Number(state.settings.timezone);
  const currentDate=new Date(state.selectedDate || new Date());
  const n=(v,d=4)=>Number.isFinite(v)?v.toFixed(d):"—";
  const r=(v)=>`${n(v,4)}°`;
  const section=(title,body)=>`<section class="formula-detail"><h4>${title}</h4>${body}</section>`;
  const known=(rows)=>`<div class="known-values"><h4>${transliterateForScript("Nilai yang diketahui")}</h4><div class="known-grid">${rows.map(([label,value])=>`<div class="known-item"><small>${label}</small><b>${value}</b></div>`).join("")}</div></div>`;
  const note=currentLanguage==="en";

  if(type==="qibla"){
    const p=rad(lat), pk=rad(KAABA.lat), dlDeg=KAABA.lon-lon, dl=rad(dlDeg);
    const numerator=Math.sin(dl);
    const denominator=Math.cos(p)*Math.tan(pk)-Math.sin(p)*Math.cos(dl);
    const atanRaw=deg(Math.atan2(numerator,denominator));
    const bearing=qiblaBearing(lat,lon);
    const rows=[
      ["Lintang lokasi (φ)",r(lat)],
      ["Bujur lokasi (λ)",r(lon)],
      ["Lintang Ka'bah (φK)",r(KAABA.lat)],
      ["Bujur Ka'bah (λK)",r(KAABA.lon)],
      ["Selisih bujur (Δλ = λK − λ)",r(dlDeg)],
      ["Lintang lokasi dalam radian",n(p,8)+" rad"],
      ["Lintang Ka'bah dalam radian",n(pk,8)+" rad"],
      ["Selisih bujur dalam radian",n(dl,8)+" rad"],
      ["Pembilang sin(Δλ)",n(numerator,8)],
      ["Penyebut",n(denominator,8)],
      ["Sudut awal atan2",r(atanRaw)]
    ];
    c.innerHTML=`<h3>${t("Rumus Azimut Kiblat")}</h3>
      <div class="formula">A = atan2(sin(Δλ), cos(φ) tan(φK) − sin(φ) cos(Δλ))</div>
      ${known(rows)}
      ${section(t("Substitusi ke rumus"),`<div class="formula formula-small">A = atan2(${n(numerator,8)}, ${n(denominator,8)})</div><p>Sudut awal = <b>${r(atanRaw)}</b>.</p><p>Normalisasi: A = (${n(atanRaw,4)}° + 360°) mod 360° = <b>${r(bearing)}</b>.</p><p>Azimut dihitung searah jarum jam dari utara sejati.</p>`)}
      ${section(t("Hasil perhitungan"),`<div class="result-banner"><small>Azimut arah kiblat untuk ${state.location.name || "lokasi ini"}</small><strong>${r(bearing)}</strong><span>${cardinal(bearing)}</span></div><p class="formula-explain">φ adalah lintang lokasi, λ adalah bujur lokasi, sedangkan φK dan λK adalah koordinat Ka'bah. Pastikan koordinat lokasi benar agar hasil lebih sesuai.</p>`)}
    `;
  }
  if(type==="sun"){
    const d=new Date(currentDate.getFullYear(),currentDate.getMonth(),currentDate.getDate(),12,0,0);
    const sp=solarPosition(d,lat,lon,tz);
    const times=prayerTimes(d,state.location);
    const solarNoon=12-sp.eqTime/60-lon/15+tz;
    const hSunrise=hourAngleForAltitude(lat,sp.decl,-0.833);
    const angles=effectivePrayerAngles();
    const hFajr=hourAngleForAltitude(lat,sp.decl,-angles.fajr);
    const hIsha=hourAngleForAltitude(lat,sp.decl,-angles.isha);
    const asrAltitude=r2d(Math.atan(1/(state.settings.asrFactor+Math.tan(Math.abs(rad(lat-sp.decl))))));
    const hAsr=hourAngleForAltitude(lat,sp.decl,asrAltitude);
    const rows=[
      ["Tanggal",formatDate(d)],
      ["Lintang lokasi (φ)",r(lat)],
      ["Bujur lokasi (λ)",r(lon)],
      ["Zona waktu",`UTC${tz>=0?"+":""}${tz}`],
      ["Deklinasi Matahari (δ)",r(sp.decl)],
      ["Persamaan waktu (E)",`${n(sp.eqTime,2)} menit`],
      ["Sudut Subuh",`−${n(effectivePrayerAngles().fajr,1)}°`],
      [effectivePrayerMethod()==="umm"?"Isya (interval Umm al-Qura)":"Sudut Isya",effectivePrayerMethod()==="umm"?"90 menit setelah Magrib":`−${n(effectivePrayerAngles().isha,1)}°`],
      ["Faktor Asar",`${state.settings.asrFactor} × tinggi benda`]
    ];
    const eventRows=[
      ["Subuh",-state.settings.fajr,hFajr,times.fajr,"−H/15", "sebelum Zuhur"],
      ["Terbit Matahari",-0.833,hSunrise,times.sunrise,"−H/15", "sebelum Zuhur"],
      ["Zuhur",0,0,times.zuhur,"12 − E/60 − λ/15 + zona", "titik kulminasi Matahari"],
      ["Asar",asrAltitude,hAsr,times.asr,"+H/15", "sesudah Zuhur"],
      ["Magrib",-0.833,hSunrise,times.maghrib,"+H/15", "saat Matahari terbenam"],
      ["Isya",effectivePrayerMethod()==="umm"?NaN:-effectivePrayerAngles().isha,effectivePrayerMethod()==="umm"?null:hIsha,times.isha,effectivePrayerMethod()==="umm"?"+90 menit":"+H/15", "sesudah terbenam" ]
    ];
    c.innerHTML=`<h3>${t("Posisi Matahari & Waktu Salat")}</h3>
      <div class="formula">H = arccos((sin(h) − sin(φ) sin(δ)) / (cos(φ) cos(δ)))</div>
      ${known(rows)}
      ${section("Persamaan waktu dan Zuhur",`<div class="formula formula-small">Waktu Zuhur = 12 − E/60 − λ/15 + zona waktu</div><p>= 12 − (${n(sp.eqTime,2)}/60) − (${n(lon,4)}/15) + (${n(tz,0)})</p><p>Waktu Zuhur = <b>${formatTime(solarNoon)} ${tz===8?"WITA":tz===7?"WIB":tz===9?"WIT":"UTC"}</b></p>`)}
      ${section("Langkah perhitungan sudut waktu",`<p>Sudut waktu dihitung dari tinggi Matahari yang ditetapkan untuk setiap peristiwa, dengan deklinasi Matahari (δ) dan lintang lokasi (φ) pada tanggal terpilih.</p><div class="formula formula-small">H = arccos((sin(h) − sin(φ) sin(δ)) / (cos(φ) cos(δ)))</div><div class="calculation-steps">${eventRows.filter(([name])=>name!=="Zuhur").map(([name,alt,h,time,sign,meaning])=>`<div class="calculation-step"><b>${name}</b><div class="formula formula-small">H = arccos((sin(${r(alt)}) − sin(${r(lat)}) sin(${r(sp.decl)})) / (cos(${r(lat)}) cos(${r(sp.decl)})))</div><p>Hasil sudut waktu: <b>${h==null||!Number.isFinite(h)?"tidak terdefinisi":r(h)}</b>. ${meaning}.</p></div>`).join("")}</div>`)}
      ${section("Substitusi untuk mendapatkan waktu",`<p>Persamaan waktu (E) mengoreksi perbedaan antara waktu Matahari sejati dan waktu rata-rata. Bujur (λ) serta zona waktu digunakan untuk memperoleh waktu Zuhur lokal.</p><div class="formula formula-small">Zuhur = 12 − E/60 − λ/15 + zona waktu</div><p>= 12 − ${n(sp.eqTime,2)}/60 − ${n(lon,4)}/15 + ${n(tz,0)} = <b>${formatTime(solarNoon)}</b> (${tz===8?"WITA":tz===7?"WIB":tz===9?"WIT":"UTC"}).</p><p>Untuk Subuh dan Terbit, sudut waktu dikurangkan dari Zuhur; untuk Asar dan Magrib, sudut waktu ditambahkan. Metode Umm al-Qura menggunakan interval 90 menit setelah Magrib (pengecualian Ramadan belum otomatis); metode bersudut menggunakan H/15.</p><div class="calculation-steps">${eventRows.map(([name,alt,h,time,sign,meaning])=>{let formulaText;if(name==="Zuhur")formulaText=`${formatTime(solarNoon)} (waktu kulminasi)`;else if(name==="Isya"&&effectivePrayerMethod()==="umm")formulaText=`${formatTime(times.maghrib)} + 90 menit = ${formatTime(time)}`;else if(h==null||!Number.isFinite(h))formulaText=`${formatTime(time)} (sudut waktu tidak terdefinisi)`;else{const op=(name==="Subuh"||name==="Terbit Matahari")?"−":"+";formulaText=`${formatTime(solarNoon)} ${op} (${n(h,4)}/15) jam = ${formatTime(time)}`;}return `<div class="calculation-step"><b>${name}</b><p>${formulaText}</p><small>Tinggi Matahari: ${Number.isFinite(alt)?r(alt):"—"}; sudut waktu: ${h==null||!Number.isFinite(h)?"—":r(h)}.</small></div>`}).join("")}</div>`)}
      ${section("Hasil akhir waktu salat",`<div class="prayer-calculation-table"><table><thead><tr><th>Peristiwa</th><th>Tinggi Matahari (h)</th><th>Sudut waktu (H)</th><th>Hasil waktu</th></tr></thead><tbody>${eventRows.map(([name,alt,h,time])=>`<tr><td>${name}</td><td>${Number.isFinite(alt)?r(alt):"—"}</td><td>${Number.isFinite(h)?r(h):"—"}</td><td><b>${formatTime(time)}</b></td></tr>`).join("")}</tbody></table></div><p class="formula-explain">Tanggal dan lokasi mengikuti pengaturan aplikasi. Hasil ditampilkan hingga menit terdekat dan dapat berbeda dari jadwal resmi karena metode hisab, sudut Subuh/Isya, faktor Asar, pembulatan, dan parameter setempat.</p>`)}
    `;
  }
  if(type==="distance"){
    const R=6371.0088,p1=rad(lat),p2=rad(KAABA.lat),dp=rad(KAABA.lat-lat),dl=rad(KAABA.lon-lon);
    const a=Math.sin(dp/2)**2+Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
    const dist=distanceKm(lat,lon);
    c.innerHTML=`<h3>${t("Jarak ke Ka'bah")}</h3><div class="formula">a = sin²(Δφ/2) + cos(φ₁) cos(φ₂) sin²(Δλ/2)<br>d = 2R atan2(√a, √(1−a))</div>
      ${known([["Lintang lokasi (φ₁)",r(lat)],["Bujur lokasi (λ₁)",r(lon)],["Lintang Ka'bah (φ₂)",r(KAABA.lat)],["Bujur Ka'bah (λ₂)",r(KAABA.lon)],["Selisih lintang (Δφ)",r(KAABA.lat-lat)],["Selisih bujur (Δλ)",r(KAABA.lon-lon)],["Radius rata-rata Bumi (R)",`${R} km`],["Nilai antara (a)",n(a,10)]])}
      ${section(transliterateForScript("Substitusi ke rumus"),`<div class="formula formula-small">a = sin²(Δφ/2) + cos(φ₁) cos(φ₂) sin²(Δλ/2)</div><p>a = <b>${n(a,10)}</b></p><div class="formula formula-small">d = 2 × ${R} × atan2(√${n(a,10)}, √(1 − ${n(a,10)}))</div><div class="result-banner"><small>Jarak geodesik permukaan Bumi ke Ka'bah</small><strong>${n(dist,2)} km</strong></div><p class="formula-explain">Jarak ini mengikuti lintasan lingkaran besar di permukaan Bumi, bukan jarak jalan.</p>`)}
    `;
  }
  if(type==="coords")renderCoordinateCalculator(c);
}

function saveSettings(){
  state.settings.method=$("#methodSelect").value;
  state.settings.fajr=Number($("#fajrAngle").value)||18;
  state.settings.isha=Number($("#ishaAngle").value)||18;
  state.settings.asrFactor=Number($('input[name="asr"]:checked').value)||1;
  state.settings.timezone=Number($("#timezoneSelect").value)||8;
  state.location.name=$("#locationNameInput").value||getLocationName(state.location.lat,state.location.lon);
  updateAll();renderPrayer();renderMonthly();
  if(state.page==="calc"){const active=$(".formula-tab.active");if(active)renderFormula(active.dataset.formula)}
  localStorage.setItem("falakSettings",JSON.stringify(state.settings));
  localStorage.setItem("falakLocation",JSON.stringify(state.location));
  alert("Pengaturan tersimpan.");
}
function loadSettings(){
  try{
    const s=JSON.parse(localStorage.getItem("falakSettings")||"null"); if(s)state.settings={...state.settings,...s};
    const l=JSON.parse(localStorage.getItem("falakLocation")||"null"); if(l)state.location={...state.location,...l};
  }catch(e){}
  $("#fajrAngle").value=state.settings.fajr;$("#ishaAngle").value=state.settings.isha;$("#timezoneSelect").value=state.settings.timezone;$("#methodSelect").value=state.settings.method;$("#locationNameInput").value=state.location.name;
  if(state.settings.method==="auto"){const a=effectivePrayerAngles();$("#fajrAngle").value=a.fajr;$("#ishaAngle").value=a.isha;}
  if(effectivePrayerMethod()==="umm"){$("#ishaAngle").disabled=true;$("#ishaAngle").title="Umm al-Qura menggunakan interval tetap 90 menit setelah Maghrib (pengecualian Ramadan belum otomatis)."}
  $(`input[name="asr"][value="${state.settings.asrFactor}"]`).checked=true;
  setLocation(state.location.lat,state.location.lon,state.location.elevation,state.location.name);
}
function exportCSV(){
  const y=state.currentMonth.getFullYear(),m=state.currentMonth.getMonth(),days=new Date(y,m+1,0).getDate();
  const rows=[["Tanggal","Subuh","Terbit","Zuhur","Asar","Maghrib","Isya"]];
  for(let day=1;day<=days;day++){const t=prayerTimes(new Date(y,m,day));rows.push([day,formatTime(t.fajr),formatTime(t.sunrise),formatTime(t.zuhur),formatTime(t.asr),formatTime(t.maghrib),formatTime(t.isha)])}
  const csv=rows.map(r=>r.join(",")).join("\n"),blob=new Blob([csv],{type:"text/csv;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download=`jadwal-salat-${y}-${String(m+1).padStart(2,"0")}.csv`;a.click();URL.revokeObjectURL(url);
}


// =====================================================

// TRANSLITERASI TAMBAHAN — Lontara Bugis dan Aksara Jawa.
// Catatan: ini alih aksara otomatis berbasis Latin, bukan penerjemahan bahasa.
// Ejaan khusus dan kata serapan mungkin perlu koreksi manual.
function toLontara(text){
  // Alih aksara Latin -> Lontara (bukan terjemahan bahasa Bugis).
  // Jangan pernah membiarkan huruf Latin yang tidak dikenali tersisa di dalam kata.
  const bases = {
    ngka:"ᨃ", mpa:"ᨇ", nra:"ᨋ", nca:"ᨏ", nga:"ᨂ", nya:"ᨎ",
    ka:"ᨀ", ga:"ᨁ", pa:"ᨄ", ba:"ᨅ", ma:"ᨆ", ta:"ᨈ", da:"ᨉ",
    na:"ᨊ", ca:"ᨌ", ja:"ᨍ", ya:"ᨐ", ra:"ᨑ", la:"ᨒ", wa:"ᨓ",
    sa:"ᨔ", ha:"ᨖ", a:"ᨕ"
  };
  const marks = {i:"ᨗ", u:"ᨘ", e:"ᨙ", é:"ᨙ", o:"ᨚ", ê:"ᨛ"};
  const vowels = "aiueoéê";
  const vowel = v => v === "a" ? "ᨕ" : "ᨕ" + (marks[v] || "");
  function convertWord(word){
    const w=word.toLowerCase(); let out="", i=0;
    while(i<w.length){
      if(vowels.includes(w[i])) { out += vowel(w[i]); i++; continue; }
      let found="";
      for(const n of [4,3,2,1]){
        const candidate=w.slice(i,i+n);
        if(bases[candidate]) { found=candidate; break; }
      }
      if(!found){ i++; continue; }
      const nextIndex=i+found.length;
      // Lontara has no virama. Consonants without a following vowel are omitted
      // instead of being printed as misleading Latin characters.
      if(nextIndex >= w.length || !vowels.includes(w[nextIndex])) {
        const nextVowel=w.slice(nextIndex).search(/[aiueoéê]/);
        if(nextVowel < 0) { i=w.length; continue; }
        // If another consonant occurs before the next vowel, treat the current
        // consonant as a closed-syllable coda and skip it.
        i++;
        continue;
      }
      let glyph=bases[found];
      const v=w[nextIndex];
      if(v!=="a") glyph += marks[v] || "";
      out += glyph;
      i=nextIndex+1;
    }
    return out || word;
  }
  return text.replace(/[A-Za-zÀ-ÿ]+/g, word => {
    // Preserve common technical names/acronyms and Latin-only product names.
    if (/^(GPS|CSV|UTC|WITA|WIB|WIT|ISNA|iPhone|iPad|Google|Earth)$/i.test(word)) return word;
    return convertWord(word);
  });
}

function toJavanese(text){
  const bases = {
    ng:"ꦔ", ny:"ꦚ", dh:"ꦝ", th:"ꦛ", kh:"ꦏ꦳",
    h:"ꦲ", n:"ꦤ", c:"ꦕ", r:"ꦫ", k:"ꦏ", d:"ꦢ",
    t:"ꦠ", s:"ꦱ", w:"ꦮ", l:"ꦭ", p:"ꦥ", j:"ꦗ",
    y:"ꦪ", m:"ꦩ", g:"ꦒ", b:"ꦧ", f:"ꦥ꦳", v:"ꦮ",
    z:"ꦗ", q:"ꦏ", x:"ꦏ꧀ꦱ"
  };
  const sandhangan = {i:"ꦶ", u:"ꦸ", e:"ꦺ", é:"ꦺ", o:"ꦺꦴ", "ê":"ꦼ", a:""};
  return text.replace(/[A-Za-zÀ-ÿ]+/g, word => {
    const lower = word.toLowerCase();
    let out = "", i = 0;
    while(i < lower.length){
      let cons = null;
      for(const n of [2,1]){
        const part = lower.slice(i,i+n);
        if(bases[part]) { cons = part; break; }
      }
      if(!cons){
        const v = lower[i];
        if("aiueoêé".includes(v)) out += (v==="a"?"ꦲ": "ꦲ"+(sandhangan[v]||""));
        else out += lower[i];
        i++; continue;
      }
      out += bases[cons]; i += cons.length;
      if(i < lower.length && "aiueoêé".includes(lower[i])){
        out += sandhangan[lower[i]] || ""; i++;
      } else if(i < lower.length && /[bcdfghjklmnpqrstvwxyz]/.test(lower[i])){
        out += "꧀";
      }
    }
    return out;
  });
}
// Lontara display policy: use explicitly curated Lontara spellings only.
// Automatically converting arbitrary Indonesian text is not a Bugis translation and
// can produce misleading spellings, so unreviewed strings remain readable in Latin.
const LONTARA_UI = {
  "Panrita Falak":"ᨄᨊᨑᨗᨈ ᨄᨒᨀ",
  "Beranda":"ᨅᨑᨊ",
  "Peta":"ᨄᨈ",
  "Pengaturan":"ᨄᨂᨈᨘᨑᨊ",
  "Arah Kiblat":"ᨕᨑ ᨀᨗᨅᨒ",
  "Waktu Salat":"ᨓᨀᨈᨘ ᨔᨒᨈ",
  "Jadwal Bulanan":"ᨍᨉᨓᨒ ᨅᨘᨒᨊ",
  "Posisi Matahari":"ᨄᨚᨔᨗᨔᨗ ᨆᨈᨖᨑᨗ",
  "Rashdul Kiblat":"ᨑᨔᨉᨘᨒ ᨀᨗᨅᨒ",
  "Detail Perhitungan":"ᨉᨙᨈᨒ ᨄᨙᨑᨗᨈᨘᨂᨊ",
  "Rumus Azimut Kiblat":"ᨑᨘᨆᨘᨔ ᨕᨔᨗᨆᨘᨈ ᨀᨗᨅᨒ",
  "Posisi Matahari & Waktu Salat":"ᨄᨚᨔᨗᨔᨗ ᨆᨈᨖᨑᨗ ᨉᨊ ᨓᨀᨈᨘ ᨔᨒᨈ",
  "Jarak ke Ka'bah":"ᨍᨑᨀ ᨀᨕᨅ",
  "Nilai yang diketahui":"ᨊᨗᨒᨕᨗ ᨐᨂ ᨉᨗᨀᨘᨈᨖᨘᨗ",
  "Hasil perhitungan":"ᨖᨔᨗᨒ ᨄᨙᨑᨗᨈᨘᨂᨊ",
  "Substitusi ke rumus":"ᨔᨘᨅᨔᨗᨈᨘᨔᨗ ᨀᨙ ᨑᨘᨆᨘᨔ",
  "Teodolit Falak":"ᨈᨙᨕᨚᨉᨚᨒᨗᨈ ᨄᨒᨀ",
  "Hisab & Rukyat Hilal":"ᨖᨗᨔᨅ ᨉᨊ ᨑᨘᨀᨗᨐᨈ ᨖᨗᨒᨒ",
  "Kamera, sudut, koordinat & hisab":"ᨀᨆᨑ ᨔᨘᨉᨘᨈ ᨀᨚᨕᨚᨑᨉᨗᨊᨈ ᨉᨊ ᨖᨗᨔᨅ",
  "Globe 3D, peta bintang, kamera & pengingat":"ᨁᨒᨚᨅ ᨓᨗᨈᨘ ᨈᨗᨁ ᨉᨗᨆᨙᨊᨔᨗ ᨄᨈ ᨅᨗᨈᨘᨂ ᨀᨆᨑ ᨉᨊ ᨄᨂᨗᨂᨈ",
  "Kamera HP, koordinat pengamat, azimut kiblat, sudut vertikal, jarak, dan hasil hitung.":"ᨀᨆᨑ ᨄᨙᨂᨊ ᨀᨚᨕᨚᨑᨉᨗᨊᨈ ᨄᨂᨆᨈ ᨕᨔᨗᨆᨘᨈ ᨀᨗᨅᨒ ᨔᨘᨉᨘᨈ ᨉᨊ ᨖᨔᨗᨒ ᨖᨗᨈᨘᨂ",
  "Eksplorasi fase Bulan, perkiraan posisi hilal, dan panduan pengamatan.":"ᨄᨙᨂᨒᨚᨑᨔᨗ ᨄᨙᨔ ᨅᨘᨒᨊ ᨄᨙᨑᨀᨗᨑᨕᨊ ᨄᨚᨔᨗᨔᨗ ᨖᨗᨒᨒ ᨉᨊ ᨄᨊᨉᨘᨕᨊ ᨄᨂᨆᨈᨊ",
  "Pemeriksaan kriteria MABIMS":"ᨄᨙᨆᨙᨑᨗᨀᨔᨕᨊ ᨀᨑᨗᨈᨙᨑᨗᨕ MABIMS",
  "Hasil perhitungan teodolit":"ᨖᨔᨗᨒ ᨄᨙᨑᨗᨈᨘᨂᨊ ᨈᨙᨕᨚᨉᨚᨒᨗᨈ",
  "Data pengukuran teodolit":"ᨉᨈ ᨄᨂᨘᨀᨘᨑᨊ ᨈᨙᨕᨚᨉᨚᨒᨗᨈ",
  "Detail Perhitungan":"ᨉᨙᨈᨒ ᨄᨙᨑᨗᨈᨘᨂᨊ",
  "Hisab":"ᨖᨗᨔᨅ",
  "Rukyat":"ᨑᨘᨀᨗᨐᨈ",
  "Kamera Hilal":"ᨀᨆᨑ ᨖᨗᨒᨒ"
};
function transliterateForScript(text){
  if(currentLanguage!=="lontara") return text;
  return LONTARA_UI[text] || text;
}

// FITUR BAHASA — Indonesia, English, Arab Melayu (Jawi)
// Tambahan ini hanya menerjemahkan antarmuka tanpa mengubah fungsi aplikasi.
// =====================================================
const LANGUAGE_TEXT = {"id":{"Panrita Falak":"Panrita Falak","Arah Kiblat":"Arah Kiblat","Waktu Salat":"Waktu Salat","Posisi Matahari":"Posisi Matahari","Beranda":"Beranda","Peta":"Peta","Jadwal Bulanan":"Jadwal Bulanan","Rashdul Kiblat":"Rashdul Kiblat","Pengaturan":"Pengaturan","Detail Perhitungan":"Detail Perhitungan","Informasi & Bantuan":"Informasi & Bantuan","Lokasi Anda":"Lokasi Anda","Gunakan GPS":"Gunakan GPS","Buka Kompas":"Buka Kompas","Salat berikutnya":"Salat berikutnya","Azimut Matahari":"Azimut Matahari","Zona Waktu":"Zona Waktu","Fitur Utama":"Fitur Utama","Kompas sensor & azimut":"Kompas sensor & azimut","Jadwal harian akurat":"Jadwal harian akurat","Kalender waktu salat":"Kalender waktu salat","Azimut & ketinggian":"Azimut & ketinggian","Waktu bayangan kiblat":"Waktu bayangan kiblat","Metode hisab & lokasi":"Metode hisab & lokasi","KOMPAS":"KOMPAS","Sensor belum aktif":"Sensor belum aktif","GPS":"GPS","Azimut Kiblat":"Azimut Kiblat","Arah Mata Angin":"Arah Mata Angin","Aktifkan Kompas":"Aktifkan Kompas","Koordinat Ka'bah (Makkah)":"Koordinat Ka'bah (Makkah)","Jarak ke Ka'bah":"Jarak ke Ka'bah","Deviasi sensor":"Deviasi sensor","Belum membaca sensor.":"Belum membaca sensor.","PETA":"PETA","Peta Arah Kiblat":"Peta Arah Kiblat","Google Earth":"Google Earth","Perbarui":"Perbarui","IBADAH HARIAN":"IBADAH HARIAN","Hari ini":"Hari ini","Hari Ini":"Hari Ini","Metode Perhitungan":"Metode Perhitungan","Catatan":"Catatan","KALENDER":"KALENDER","Jadwal Salat Bulanan":"Jadwal Salat Bulanan","Ekspor CSV":"Ekspor CSV","Subuh":"Subuh","Terbit":"Terbit","Zuhur":"Zuhur","Asar":"Asar","Maghrib":"Maghrib","Isya":"Isya","ASTRONOMI":"ASTRONOMI","Ketinggian Matahari":"Ketinggian Matahari","Waktu Zawal":"Waktu Zawal","Waktu Istiwā'":"Waktu Istiwā'","RASHDUL KIBLAT":"RASHDUL KIBLAT","Tanggal":"Tanggal","Tanggal Berikutnya":"Tanggal Berikutnya","Ka'bah":"Ka'bah","Perkiraan Waktu Rashdul Kiblat":"Perkiraan Waktu Rashdul Kiblat","KONFIGURASI":"KONFIGURASI","Simpan":"Simpan","Latitude":"Latitude","Longitude":"Longitude","Ketinggian (meter)":"Ketinggian (meter)","Ambil GPS":"Ambil GPS","Simpan Lokasi":"Simpan Lokasi","Metode Perhitungan Waktu Salat":"Metode Perhitungan Waktu Salat","Metode Hisab":"Metode Hisab","Metode Asar":"Metode Asar","Subuh (°)":"Subuh (°)","Isya (°)":"Isya (°)","Zona":"Zona","Nama Lokasi":"Nama Lokasi","HISAB":"HISAB","Rumus yang digunakan aplikasi.":"Rumus yang digunakan aplikasi.","Kalkulator Koordinat":"Kalkulator Koordinat","BANTUAN":"BANTUAN","Panduan penggunaan aplikasi.":"Panduan penggunaan aplikasi.","Tentang Aplikasi Ilmu Falak":"Tentang Aplikasi Ilmu Falak","Panduan Penggunaan":"Panduan Penggunaan","Akurasi & Referensi":"Akurasi & Referensi","FAQ":"FAQ","Mulai":"Mulai","Jadwal":"Jadwal","Ilmu Falak":"Ilmu Falak","Umm al-Qura (Makkah)":"Umm al-Qura (Makkah)","Muslim World League":"Muslim World League","Egyptian General Authority":"Egyptian General Authority","University of Islamic Sciences, Karachi":"University of Islamic Sciences, Karachi","ISNA":"ISNA","Kustom":"Kustom","Syafi'i (1 × tinggi benda)":"Syafi'i (1 × tinggi benda)","Hanafi (2 × tinggi benda)":"Hanafi (2 × tinggi benda)","Barat Laut":"Barat Laut","Timur Laut":"Timur Laut","Tenggara":"Tenggara","Selatan":"Selatan","Barat Daya":"Barat Daya","Barat":"Barat","Timur":"Timur","Utara":"Utara","WITA":"WITA","WIB (UTC+7)":"WIB (UTC+7)","WITA (UTC+8)":"WITA (UTC+8)","WIT (UTC+9)":"WIT (UTC+9)","UTC":"UTC","Gunakan sensor orientasi perangkat untuk navigasi langsung.":"Gunakan sensor orientasi perangkat untuk navigasi langsung.","Lokasi pengguna, Ka'bah, dan garis azimut kiblat.":"Lokasi pengguna, Ka'bah, dan garis azimut kiblat.","Perkiraan waktu matahari sejajar dengan arah kiblat.":"Perkiraan waktu matahari sejajar dengan arah kiblat.","Atur lokasi dan parameter hisab.":"Atur lokasi dan parameter hisab."},"en":{"Panrita Falak":"Panrita Falak","Arah Kiblat":"Qibla Direction","Waktu Salat":"Prayer Times","Posisi Matahari":"Sun Position","Beranda":"Home","Peta":"Map","Jadwal Bulanan":"Monthly Schedule","Rashdul Kiblat":"Qibla Rashdul","Pengaturan":"Settings","Detail Perhitungan":"Calculation Details","Informasi & Bantuan":"Information & Help","Lokasi Anda":"Your Location","Gunakan GPS":"Use GPS","Buka Kompas":"Open Compass","Salat berikutnya":"Next Prayer","Azimut Matahari":"Sun Azimuth","Zona Waktu":"Time Zone","Fitur Utama":"Main Features","Kompas sensor & azimut":"Sensor compass & azimuth","Jadwal harian akurat":"Accurate daily schedule","Kalender waktu salat":"Prayer time calendar","Azimut & ketinggian":"Azimuth & altitude","Waktu bayangan kiblat":"Qibla shadow time","Metode hisab & lokasi":"Calculation method & location","KOMPAS":"COMPASS","Sensor belum aktif":"Sensor not active","GPS":"GPS","Azimut Kiblat":"Qibla Azimuth","Arah Mata Angin":"Cardinal Direction","Aktifkan Kompas":"Activate Compass","Koordinat Ka'bah (Makkah)":"Kaaba Coordinates (Makkah)","Jarak ke Ka'bah":"Distance to Kaaba","Deviasi sensor":"Sensor deviation","Belum membaca sensor.":"Sensor has not been read.","PETA":"MAP","Peta Arah Kiblat":"Qibla Direction Map","Google Earth":"Google Earth","Perbarui":"Refresh","IBADAH HARIAN":"DAILY WORSHIP","Hari ini":"Today","Hari Ini":"Today","Metode Perhitungan":"Calculation Method","Catatan":"Note","KALENDER":"CALENDAR","Jadwal Salat Bulanan":"Monthly Prayer Schedule","Ekspor CSV":"Export CSV","Subuh":"Fajr","Terbit":"Sunrise","Zuhur":"Dhuhr","Asar":"Asr","Maghrib":"Maghrib","Isya":"Isha","ASTRONOMI":"ASTRONOMY","Ketinggian Matahari":"Sun Altitude","Waktu Zawal":"Zawal Time","Waktu Istiwā'":"Istiwa' Time","RASHDUL KIBLAT":"QIBLA RASHDUL","Tanggal":"Date","Tanggal Berikutnya":"Next Date","Ka'bah":"Kaaba","Perkiraan Waktu Rashdul Kiblat":"Estimated Qibla Rashdul Time","KONFIGURASI":"CONFIGURATION","Simpan":"Save","Latitude":"Latitude","Longitude":"Longitude","Ketinggian (meter)":"Elevation (meters)","Ambil GPS":"Get GPS","Simpan Lokasi":"Save Location","Metode Perhitungan Waktu Salat":"Prayer Time Calculation Method","Metode Hisab":"Calculation Method","Metode Asar":"Asr Method","Subuh (°)":"Fajr (°)","Isya (°)":"Isha (°)","Zona":"Zone","Nama Lokasi":"Location Name","HISAB":"CALCULATION","Rumus yang digunakan aplikasi.":"Formulas used by the application.","Kalkulator Koordinat":"Coordinate Calculator","BANTUAN":"HELP","Panduan penggunaan aplikasi.":"Application usage guide.","Tentang Aplikasi Ilmu Falak":"About the Falak Application","Panduan Penggunaan":"Usage Guide","Akurasi & Referensi":"Accuracy & References","FAQ":"FAQ","Mulai":"Start","Jadwal":"Schedule","Ilmu Falak":"Islamic Astronomy","Umm al-Qura (Makkah)":"Umm al-Qura (Makkah)","Muslim World League":"Muslim World League","Egyptian General Authority":"Egyptian General Authority","University of Islamic Sciences, Karachi":"University of Islamic Sciences, Karachi","ISNA":"ISNA","Kustom":"Custom","Syafi'i (1 × tinggi benda)":"Shafi'i (1 × object height)","Hanafi (2 × tinggi benda)":"Hanafi (2 × object height)","Barat Laut":"Northwest","Timur Laut":"Northeast","Tenggara":"Southeast","Selatan":"South","Barat Daya":"Southwest","Barat":"West","Timur":"East","Utara":"North","WITA":"WITA","WIB (UTC+7)":"WIB (UTC+7)","WITA (UTC+8)":"WITA (UTC+8)","WIT (UTC+9)":"WIT (UTC+9)","UTC":"UTC","Gunakan sensor orientasi perangkat untuk navigasi langsung.":"Use the device orientation sensor for direct navigation.","Lokasi pengguna, Ka'bah, dan garis azimut kiblat.":"User location, Kaaba, and qibla azimuth line.","Perkiraan waktu matahari sejajar dengan arah kiblat.":"Estimated time when the Sun aligns with the qibla direction.","Atur lokasi dan parameter hisab.":"Configure location and calculation parameters."},"jawi":{"Panrita Falak":"ڤنريتا فلك","Arah Kiblat":"اَره قبلة","Waktu Salat":"وقت صلاة","Posisi Matahari":"ڤوسيزي ماتهاري","Beranda":"برندا","Peta":"ڤيتا","Jadwal Bulanan":"جدوال بولنن","Rashdul Kiblat":"رصد القبلة","Pengaturan":"ڤڠاتورن","Detail Perhitungan":"تفاصيل ڤڠهيرتن","Informasi & Bantuan":"معلومت دان بنتوان","Lokasi Anda":"لوكاسي اندا","Gunakan GPS":"ݢوناكن GPS","Buka Kompas":"بوکا كومڤس","Salat berikutnya":"صلاة بريكوتڽ","Azimut Matahari":"ازيموت ماتهاري","Zona Waktu":"زون وقتو","Fitur Utama":"فيتور اوتام","Kompas sensor & azimut":"كومڤس سنسور دان ازيموت","Jadwal harian akurat":"جدوال هارين يڠ تيڤت","Kalender waktu salat":"كالندر وقت صلاة","Azimut & ketinggian":"ازيموت دان كتيڠݢين","Waktu bayangan kiblat":"وقت بايڠن قبلة","Metode hisab & lokasi":"متود حساب دان لوكاسي","KOMPAS":"كومڤس","Sensor belum aktif":"سنسور بلوم اکتيف","GPS":"GPS","Azimut Kiblat":"ازيموت قبلة","Arah Mata Angin":"اره مات اڠين","Aktifkan Kompas":"اكتيفكن كومڤس","Koordinat Ka'bah (Makkah)":"كوردينات كعبة (مكة)","Jarak ke Ka'bah":"جارق كعبة","Deviasi sensor":"دڤياسي سنسور","Belum membaca sensor.":"بلوم ممباچ سنسور.","PETA":"ڤيتا","Peta Arah Kiblat":"ڤيتا اَره قبلة","Google Earth":"Google Earth","Perbarui":"ڤربهاروي","IBADAH HARIAN":"عبادة هارين","Hari ini":"هاري اين","Hari Ini":"هاري اين","Metode Perhitungan":"متود ڤڠهيرتن","Catatan":"چاتتن","KALENDER":"كالندر","Jadwal Salat Bulanan":"جدوال صلاة بولنن","Ekspor CSV":"ايكسڤور CSV","Subuh":"صبح","Terbit":"تربيت","Zuhur":"ظهر","Asar":"عصر","Maghrib":"مغرب","Isya":"عشاء","ASTRONOMI":"استرونومي","Ketinggian Matahari":"كتيڠݢين ماتهاري","Waktu Zawal":"وقت زوال","Waktu Istiwā'":"وقت استواء","RASHDUL KIBLAT":"رصد القبلة","Tanggal":"تاريخ","Tanggal Berikutnya":"تاريخ بريكوتڽ","Ka'bah":"كعبة","Perkiraan Waktu Rashdul Kiblat":"ڤركيراءن وقتو رصد القبلة","KONFIGURASI":"كونفيݢوراسي","Simpan":"سيمڤن","Latitude":"لاتيتود","Longitude":"لونݢيتود","Ketinggian (meter)":"كتيڠݢين (ميتر)","Ambil GPS":"امبيل GPS","Simpan Lokasi":"سيمڤن لوكاسي","Metode Perhitungan Waktu Salat":"متود ڤڠهيرتن وقت صلاة","Metode Hisab":"متود حساب","Metode Asar":"متود عصر","Subuh (°)":"صبح (°)","Isya (°)":"عشاء (°)","Zona":"زون","Nama Lokasi":"نام لوكاسي","HISAB":"حساب","Rumus yang digunakan aplikasi.":"روموس يڠ دݢوناكن اڤليکاسي.","Kalkulator Koordinat":"كالكوليتر كوردينات","BANTUAN":"بنتوان","Panduan penggunaan aplikasi.":"ڤندوان ڤڠݢوناءن اڤليکاسي.","Tentang Aplikasi Ilmu Falak":"تنتڠ اڤليکاسي علم فلك","Panduan Penggunaan":"ڤندوان ڤڠݢوناءن","Akurasi & Referensi":"اكوراسي دان ريفرنسي","FAQ":"سؤالن لازيم","Mulai":"مولا","Jadwal":"جدوال","Ilmu Falak":"علم فلك","Umm al-Qura (Makkah)":"اُمّ القرى (مكة)","Muslim World League":"Muslim World League","Egyptian General Authority":"Egyptian General Authority","University of Islamic Sciences, Karachi":"University of Islamic Sciences, Karachi","ISNA":"ISNA","Kustom":"كوستم","Syafi'i (1 × tinggi benda)":"شافعي (١ × تيڠݢي بندا)","Hanafi (2 × tinggi benda)":"حنفي (٢ × تيڠݢي بندا)","Barat Laut":"بارات لاوت","Timur Laut":"تيمور لاوت","Tenggara":"تڠݢارا","Selatan":"سلاتن","Barat Daya":"بارات داي","Barat":"بارات","Timur":"تيمور","Utara":"اوتارا","WITA":"WITA","WIB (UTC+7)":"WIB (UTC+7)","WITA (UTC+8)":"WITA (UTC+8)","WIT (UTC+9)":"WIT (UTC+9)","UTC":"UTC","Gunakan sensor orientasi perangkat untuk navigasi langsung.":"ݢوناكن سنسور اورينتاسي ڤرڤرڠكت اونتوق نݢافيݢاسي لڠسوڠ.","Lokasi pengguna, Ka'bah, dan garis azimut kiblat.":"لوكاسي ڤڠݢونا، كعبة، دان ڬاريس ازيموت قبلة.","Perkiraan waktu matahari sejajar dengan arah kiblat.":"ڤركيراءن وقتو ماتهاري سجار دڠن اَره قبلة.","Atur lokasi dan parameter hisab.":"اتور لوكاسي دان ڤارامتر حساب."}};
const EXTRA_TRANSLATIONS={
  "Arah Kiblat • Waktu Salat • Posisi Matahari":["Qibla Direction • Prayer Times • Sun Position","اَره قبلة • وقت صلاة • ڤوسيزي ماتهاري"],
  "BERANDA":["HOME","برندا"],
  "Assalāmu'alaikum":["Assalamu'alaikum","السلام عليكم"],
  "Semoga hari ini penuh keberkahan 💫":["May today be full of blessings 💫","سموݢ هاري اين ڤنوه دڠن بركة 💫"],
  "Gunakan sensor orientasi perangkat untuk navigasi langsung.":["Use the device orientation sensor for direct navigation.","ݢوناكن سنسور اورينتاسي ڤرڤرڠكت اونتوق نݢافيݢاسي لڠسوڠ."],
  "Di iPhone/iPad, izin orientasi harus diberikan oleh pengguna. Kalibrasi perangkat dan jauhkan dari benda bermagnet.":["On iPhone/iPad, orientation permission must be granted. Calibrate the device and keep it away from magnetic objects.","ڤد iPhone/iPad، ايزين اورينتاسي مستي دبريكن. كاليبريسي ڤرڤرڠكت دان جاوهكن درڤد بندا برمڠنيتيك."],
  "Perkiraan waktu matahari sejajar dengan arah kiblat.":["Estimated time when the Sun aligns with the qibla direction.","ڤركيراءن وقتو ماتهاري سجار دڠن اَره قبلة."],
  "Izinkan GPS untuk mengambil lokasi. Untuk kompas, gunakan perangkat yang memiliki sensor orientasi dan berikan izin ketika diminta. Untuk Google Maps, isi API key pada file config.js.":["Allow GPS to get your location. For the compass, use a device with an orientation sensor and grant permission when requested. For Google Maps, enter the API key in config.js.","ايذين GPS اونتوق مڠمبيل لوكاسي. اونتوق كومڤس، ݢوناكن ڤرڤرڠكت يڠ ممڤوڽاي سنسور اورينتاسي دان بريكن ايذين اڤابيلا دمينتا. اونتوق Google Maps، ايسى API key ڤد فايل config.js."],
  "Aplikasi ini dikembangkan oleh mahasiswa dan mahasiswi IAIN Parepare sebagai media pembelajaran dan pendukung penerapan ilmu falak. Aplikasi ini menyediakan berbagai fitur, meliputi perhitungan arah kiblat, waktu salat, posisi Matahari, jadwal salat bulanan, serta Rashdul Kiblat berdasarkan koordinat geografis pengguna.":["This application was developed by IAIN Parepare students as a learning medium and support for applying Islamic astronomy. It provides qibla direction, prayer times, Sun position, monthly prayer schedules, and Qibla Rashdul based on the user's geographic coordinates.","اڤليکاسي اين دكمبڠكن اوليه مهاسيسوا دان مهاسيسوي IAIN ڤاريڤاري سباݢاي ميديا ڤمبلاجرن دان ڤندوكوڠ ڤنراڤن علم فلك. اڤليکاسي اين منيديكن ڤلباݢاي فيتور برداسركن كوردينات ݢيوݢرافي ڤڠݢونا."],
  "Azimut kiblat dihitung secara astronomi menggunakan koordinat Ka'bah. Kompas elektronik tetap dipengaruhi sensor, kalibrasi, lingkungan magnetik, dan kemampuan browser.":["Qibla azimuth is calculated astronomically using the Kaaba coordinates. Electronic compasses are still affected by sensors, calibration, magnetic surroundings, and browser capabilities.","ازيموت قبلة ديهيرت سچارا استرونومي مڠݢوناكن كوردينات كعبة. كومڤس اليكترونيك تتڤ دڤڠاروهي سنسور، كاليبريسي، ڤرسكيترن مڠنيتيك، دان كممڤوان براوزر."],
  "Jika sensor tidak bergerak di laptop, itu normal karena sebagian besar laptop tidak memiliki magnetometer/orientasi. Gunakan ponsel untuk fitur kompas.":["If the sensor does not move on a laptop, that is normal because most laptops do not have a magnetometer/orientation sensor. Use a phone for the compass feature.","جك سنسور تيدق برݢرق ڤد لپتوڤ، ايتو نورمال كران كباڽقن لپتوڤ تيادا مݢنيتوميتر اتاو سنسور اورينتاسي. ݢوناكن تلفون اونتوق فيتور كومڤس."],
  "Rumus Azimut Kiblat":["Qibla Azimuth Formula","روموس ازيموت قبلة"],
  "Posisi Matahari & Waktu Salat":["Sun Position & Prayer Times","ڤوسيزي ماتهاري دان وقت صلاة"],
  "Jarak ke Ka'bah":["Distance to Kaaba","جارق كعبة"],
  "Kalkulator Koordinat & Hisab Kota":["City Coordinate & Calculation Calculator","كالكوليتر كوردينات دان حساب كوتا"],
  "Masukkan nama kota untuk mencari lintang dan bujur, lalu lihat hasil hisab utama lokasi tersebut.":["Enter a city name to find latitude and longitude, then view the main calculations for that location.","ماسوقكن نام كوتا اونتوق منچاري لاتيتود دان لونݢيتود، لالو ليهت حاصل حساب اوتام لوكاسي ترسبوت."],
  "Atau masukkan koordinat secara manual":["Or enter coordinates manually","اتاڤون ماسوقكن كوردينات سچارا مانوال"],
  "Nama Kota / Wilayah":["City / Region Name","نام كوتا / ولايه"],
  "Cari Kota":["Search City","چاري كوتا"],
  "Nama Lokasi":["Location Name","نام لوكاسي"],
  "Hitung Koordinat":["Calculate Coordinates","هيرت كوردينات"],
  "Koordinat berhasil dihitung.":["Coordinates calculated successfully.","كوردينات برجاي دهيرت."],
  "Koordinat ditemukan. Semua kalkulasi di bawah diperbarui untuk lokasi ini.":["Coordinates found. All calculations below were updated for this location.","كوردينات دتموي. سموا حساب دباوه دكمسكن اونتوق لوكاسي اين."],
  "Mencari koordinat…":["Searching coordinates…","مڠچاري كوردينات…"],
  "Pencarian kota menggunakan layanan geocoding Open-Meteo.":["City search uses the Open-Meteo geocoding service.","ڤنچاريان كوتا مڠݢوناكن خدمه جيوكود Open-Meteo."],
  "Zona Waktu":["Time Zone","زون وقتو"],
  "Azimut Matahari":["Sun Azimuth","ازيموت ماتهاري"],
  "Altitude Matahari":["Sun Altitude","كتيڠݢين ماتهاري"],
  "Perkiraan waktu matahari & salat hari ini":["Estimated solar & prayer times today","ڤركيراءن وقتو ماتهاري دان صلاة هاري اين"],
  "Subuh/Isya menggunakan sudut 18° dan Asar menggunakan faktor Syafi'i (1×). Hasil ini untuk kalkulasi aplikasi, bukan pengganti jadwal resmi setempat.":["Fajr/Isha use an 18° angle and Asr uses the Shafi'i factor (1×). These results are for app calculations and are not a replacement for official local schedules.","صبح/عشاء مڠݢوناكن سودوت ١٨° دان عصر مڠݢوناكن فكتور شافعي (١×). حاصل اين اونتوق حساب اڤليکاسي، بوكن ڤڠݢنتي جدوال رسمي تمڤتن."],
  "Gunakan Lokasi Ini":["Use This Location","ݢوناكن لوكاسي اين"],
  "Buka di Google Earth":["Open in Google Earth","فتح في Google Earth"],
  "Teodolit Falak":["Falak Theodolite","الثيودوليت الفلكي"],
  "Hisab & Rukyat Hilal":["Hilal Calculation & Sighting","حساب ورؤية الهلال"],
  "Kamera, sudut, koordinat & hisab":["Camera, angles, coordinates & calculations","الكاميرا والزوايا والإحداثيات والحسابات"],
  "Globe 3D, peta bintang, kamera & pengingat":["3D globe, star map, camera & reminders","كرة أرضية ثلاثية الأبعاد وخريطة النجوم والكاميرا والتنبيهات"],
  "Kamera HP, koordinat pengamat, azimut kiblat, sudut vertikal, jarak, dan hasil hitung.":["Phone camera, observer coordinates, qibla azimuth, vertical angle, distance and calculated results.","كاميرا الهاتف وإحداثيات الراصد وسمت القبلة والزاوية الرأسية والمسافة ونتائج الحساب."],
  "Eksplorasi fase Bulan, perkiraan posisi hilal, dan panduan pengamatan.":["Explore Moon phases, estimated crescent position and observation guidance.","استكشاف أطوار القمر والموضع التقديري للهلال وإرشادات الرصد."],
  "Pemeriksaan kriteria MABIMS":["MABIMS criteria check","فحص معايير مابيمس"],
  "Hasil perhitungan teodolit":["Theodolite calculation results","نتائج حساب الثيودوليت"],
  "Data pengukuran teodolit":["Theodolite measurement data","بيانات قياس الثيودوليت"],
  "Hisab":["Calculation","الحساب"],
  "Rukyat":["Sighting","الرؤية"],
  "Kamera Hilal":["Crescent Camera","كاميرا الهلال"]
};
for(const [k,v] of Object.entries(EXTRA_TRANSLATIONS)){LANGUAGE_TEXT.id[k]=k;LANGUAGE_TEXT.en[k]=v[0];LANGUAGE_TEXT.jawi[k]=v[1]}
LANGUAGE_TEXT.lontara = Object.fromEntries(Object.keys(LANGUAGE_TEXT.id).map(k=>[k,LONTARA_UI[k]||k]));
for(const [k,v] of Object.entries(LONTARA_UI)) LANGUAGE_TEXT.lontara[k]=v;
// Pertahankan kamus Lontara yang dikurasi; jangan menimpa dengan teks Indonesia.
LANGUAGE_TEXT.lontara = Object.fromEntries(Object.keys(LANGUAGE_TEXT.id).map(k=>[k,LONTARA_UI[k]||k]));
for(const [k,v] of Object.entries(LONTARA_UI)) LANGUAGE_TEXT.lontara[k]=v;
let currentLanguage=localStorage.getItem("falakLanguage")||"id";
if(!["id","en","jawi","lontara"].includes(currentLanguage)) currentLanguage="id";
const translationSources=new WeakMap();
const attributeSources=new WeakMap();
function t(key){return (LANGUAGE_TEXT[currentLanguage]&&LANGUAGE_TEXT[currentLanguage][key])||key}
function translateTextNodes(root=document.body){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){const raw=(n.nodeValue||"").trim();if(!raw)continue;if(LANGUAGE_TEXT.id[raw]!==undefined)translationSources.set(n,raw);const key=translationSources.get(n);if(key){const lead=(n.nodeValue.match(/^\s*/)||[""])[0],trail=(n.nodeValue.match(/\s*$/)||[""])[0];const translated=LANGUAGE_TEXT[currentLanguage][key]||key; const displayText=translated;
      // Jangan alihaksarakan kata secara otomatis: hasilnya dapat salah secara linguistik.
      if(n.nodeValue!==lead+displayText+trail)n.nodeValue=lead+displayText+trail;
    }
  }
}
function translateAttributes(root=document.body){root.querySelectorAll("[placeholder],[title],[aria-label]").forEach(el=>["placeholder","title","aria-label"].forEach(a=>{if(!el.hasAttribute(a))return;let m=attributeSources.get(el);if(!m){m={};attributeSources.set(el,m)}const raw=el.getAttribute(a);if(LANGUAGE_TEXT.id[raw]!==undefined)m[a]=raw;const k=m[a];if(k)el.setAttribute(a,currentLanguage==="lontara"?(LONTARA_UI[k]||k):(LANGUAGE_TEXT[currentLanguage][k]||k))}))}
function applyLanguage(){document.documentElement.lang=currentLanguage==="en"?"en":currentLanguage==="jawi"?"ms-Arab":currentLanguage==="lontara"?"bug":"id";document.documentElement.style.fontFamily=currentLanguage==="lontara"?"system-ui, sans-serif":"";const sel=$("#languageSelect");if(sel)sel.value=currentLanguage;translateTextNodes();translateAttributes();if(state.page==="calc"){const a=$(".formula-tab.active");if(a)renderFormula(a.dataset.formula)}updateAll()}
function setLanguage(lang){currentLanguage=LANGUAGE_TEXT[lang]?lang:"id";localStorage.setItem("falakLanguage",currentLanguage);applyLanguage()}
const languageObserver=new MutationObserver(mutations=>{for(const m of mutations){if(m.type==="characterData"){const raw=(m.target.nodeValue||"").trim();if(LANGUAGE_TEXT.id[raw]!==undefined)translationSources.set(m.target,raw)}else if(m.type==="childList"){m.addedNodes.forEach(n=>{if(n.nodeType===Node.TEXT_NODE){const raw=n.nodeValue.trim();if(LANGUAGE_TEXT.id[raw]!==undefined)translationSources.set(n,raw)}})}}translateTextNodes();translateAttributes()});


// Pengingat waktu salat berbasis izin pengguna. Di web, timer tidak menjamin berjalan saat halaman ditutup.
let prayerAlarmTimer=null, lastPrayerAlarmKey="";
const prayerAdhanAudio=new Audio("assets/azan-pengguna.mpeg"); prayerAdhanAudio.preload="auto";
function prayerAlertStatus(msg){const el=document.getElementById("prayerAlertStatus");if(el)el.textContent=msg;}
async function enablePrayerAlerts(){
  if(!("Notification" in window)){prayerAlertStatus("Notifikasi browser tidak tersedia pada mode ini. Pengingat web tidak dapat aktif; diperlukan integrasi notifikasi Android native pada APK.");return;}
  if(!window.isSecureContext && location.hostname!=="localhost"){prayerAlertStatus("Browser hanya mengizinkan notifikasi pada HTTPS/localhost. Buka aplikasi melalui HTTPS atau pasang integrasi notifikasi Android native agar pengingat dapat bekerja di APK.");return;}
  let permission=Notification.permission;
  if(permission==="default") permission=await Notification.requestPermission();
  if(permission!=="granted"){prayerAlertStatus("Izin notifikasi tidak diberikan; pengingat tetap nonaktif.");return;}
  localStorage.setItem("falakPrayerAlerts","true");
  const cb=document.getElementById("prayerAlertsEnabled");if(cb)cb.checked=true;
  prayerAlertStatus("Aktif selama aplikasi berjalan. Jadwal diperiksa setiap 15 detik.");
  if(prayerAlarmTimer)clearInterval(prayerAlarmTimer);
  prayerAlarmTimer=setInterval(checkPrayerAlarm,15000);checkPrayerAlarm();
}
function disablePrayerAlerts(){localStorage.setItem("falakPrayerAlerts","false");if(prayerAlarmTimer)clearInterval(prayerAlarmTimer);prayerAlarmTimer=null;const cb=document.getElementById("prayerAlertsEnabled");if(cb)cb.checked=false;prayerAlertStatus("Pengingat waktu salat dimatikan.");}
function checkPrayerAlarm(){
  if(localStorage.getItem("falakPrayerAlerts")!=="true")return;
  const now=new Date(), times=prayerTimes(now); const entries=[["Subuh",times.fajr],["Zuhur",times.zuhur],["Asar",times.asr],["Maghrib",times.maghrib],["Isya",times.isha]];
  const nowMinutes=now.getHours()*60+now.getMinutes();
  for(const [name,hourValue] of entries){if(!Number.isFinite(hourValue))continue;
    const prayerMinutes=((Math.round(hourValue*60)%1440)+1440)%1440;
    if(nowMinutes===prayerMinutes){const key=name+"-"+now.toDateString();if(key===lastPrayerAlarmKey)continue;lastPrayerAlarmKey=key;
      try{if("Notification" in window && Notification.permission==="granted")new Notification("Panrita Falak • Waktu "+name,{body:"Perkiraan waktu "+name+" telah tiba berdasarkan lokasi dan metode hisab aplikasi."});}catch(e){}
      prayerAdhanAudio.currentTime=0;prayerAdhanAudio.play().then(()=>prayerAlertStatus("Pengingat "+name+" diputar.")).catch(()=>prayerAlertStatus("Notifikasi waktu "+name+" dikirim, tetapi pemutaran audio diblokir perangkat. Buka aplikasi dan uji suara terlebih dahulu."));
    }
  }
}
function testPrayerAdhan(){prayerAdhanAudio.currentTime=0;prayerAdhanAudio.play().then(()=>prayerAlertStatus("Memutar audio azan yang Anda kirim.")).catch(()=>prayerAlertStatus("Audio belum dapat diputar. Coba buka aplikasi melalui localhost/HTTPS lalu tekan Uji suara azan."));}

function bind(){
  $$(".nav-item[data-page]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.page)));
  $$("[data-page-jump]").forEach(b=>b.addEventListener("click",()=>navigate(b.dataset.pageJump)));
  $$('[data-action="start"]').forEach(b=>b.addEventListener("click",()=>{$("#splashScreen").classList.add("hidden");$("#mainShell").classList.remove("hidden");}));
  $$('[data-action="toggle-sidebar"]').forEach(b=>b.addEventListener("click",(event)=>{event.stopPropagation();$("#sidebar").classList.toggle("open")}));
  // Close the mobile navigation when the user taps anywhere outside it.
  document.addEventListener("click",(event)=>{
    const sidebar=$("#sidebar");
    if(!sidebar || !sidebar.classList.contains("open")) return;
    if(event.target.closest("#sidebar") || event.target.closest('[data-action="toggle-sidebar"]')) return;
    sidebar.classList.remove("open");
  });
  const syncThemeButtons=()=>{
    const dark=document.body.classList.contains("dark");
    $$('[data-action="theme"]').forEach(b=>{
      b.textContent=dark?"☀️":"🌙";
      b.setAttribute("aria-label",dark?"Aktifkan mode terang":"Aktifkan mode gelap");
      b.title=dark?"Aktifkan mode terang":"Aktifkan mode gelap";
    });
  };
  $$('[data-action="theme"]').forEach(b=>b.addEventListener("click",()=>{
    document.body.classList.toggle("dark");
    localStorage.setItem("falakDark",document.body.classList.contains("dark"));
    syncThemeButtons();
  }));
  window.syncFalakThemeButtons=syncThemeButtons;
  $("#languageSelect")?.addEventListener("change",e=>setLanguage(e.target.value));
  $$('[data-action="get-location"]').forEach(b=>b.addEventListener("click",requestLocation));
  $$(`[data-action="choose-location"]`).forEach(b=>b.addEventListener("click",chooseLocationIndonesia));
  $$('[data-action="activate-compass"]').forEach(b=>b.addEventListener("click",activateCompass));
  $$('[data-action="refresh-map"]').forEach(b=>b.addEventListener("click",()=>{initEmbeddedMap();if(state.mapReady){updateMap();state.map.invalidateSize();state.map.setView([state.location.lat,state.location.lon],13)}}));
  $$('[data-action="map-center-user"]').forEach(b=>b.addEventListener("click",()=>{if(!state.mapReady)initEmbeddedMap();if(state.mapReady)state.map.setView([state.location.lat,state.location.lon],13)}));
  $$('[data-action="map-show-kaaba"]').forEach(b=>b.addEventListener("click",()=>{if(!state.mapReady)initEmbeddedMap();if(state.mapReady)state.map.fitBounds([[state.location.lat,state.location.lon],[KAABA.lat,KAABA.lon]],{padding:[24,24],maxZoom:5})}));
  $$('[data-action="google-earth"]').forEach(b=>b.addEventListener("click",openGoogleEarth));
  $$('[data-action="simulate-sun"]').forEach(b=>b.addEventListener("click",simulateSunPosition));
  $$('[data-action="use-current-sun-time"]').forEach(b=>b.addEventListener("click",()=>{$("#solarSimulationDate").value=localDateTimeValue();$("#solarSimulationTimezone").value=String(state.settings.timezone);simulateSunPosition()}));
  $$('[data-action="save-observation"]').forEach(b=>b.addEventListener("click",saveObservation));
  $$('[data-action="export-observation-report"]').forEach(b=>b.addEventListener("click",exportObservationReport));
  $$('[data-action="clear-observations"]').forEach(b=>b.addEventListener("click",clearObservations));
  $$('[data-action="camera-start"]').forEach(b=>b.addEventListener("click",startTheodoliteCamera));
  $$('[data-action="camera-stop"]').forEach(b=>b.addEventListener("click",stopTheodoliteCamera));
  $$('[data-action="theodolite-gps"]').forEach(b=>b.addEventListener("click",requestLocation));
  $$('[data-action="theodolite-sensor"]').forEach(b=>b.addEventListener("click",activateCompass));
  $$('[data-action="theodolite-calc"]').forEach(b=>b.addEventListener("click",calculateTheodolite));
  $$('[data-action="theodolite-use-heading"]').forEach(b=>b.addEventListener("click",()=>{if(Number.isFinite(state.sensorHeading)){$("#tdMeasuredAzimuth").value=state.sensorHeading.toFixed(2);calculateTheodolite()}else alert("Aktifkan sensor arah terlebih dahulu, atau masukkan azimut secara manual.")}));
  $$('[data-action="theodolite-use-qibla"]').forEach(b=>b.addEventListener("click",()=>{$("#tdMeasuredAzimuth").value=qiblaBearing(state.location.lat,state.location.lon).toFixed(2);calculateTheodolite()}));
  ["tdMeasuredAzimuth","tdVerticalAngle","tdSlopeDistance","tdInstrumentHeight","tdTargetHeight","tdStationElevation"].forEach(id=>$("#"+id)?.addEventListener("input",()=>{if(id==="tdStationElevation")$("#tdStationElevation").dataset.userEdited="true";calculateTheodolite()}));
  $("#methodSelect")?.addEventListener("change",()=>{
    const presets={auto:[20,18],kemenag:[20,18],umm:[18.5,18],mw:[18,17],egypt:[19.5,17.5],karachi:[18,18],isna:[15,15]};
    const preset=presets[$("#methodSelect").value];
    if(preset){$("#fajrAngle").value=preset[0];$("#ishaAngle").value=preset[1]}
    if($("#methodSelect").value==="auto"){const a=effectivePrayerAngles();$("#fajrAngle").value=a.fajr;$("#ishaAngle").value=a.isha;}
    if($("#methodSelect").value==="umm"){$("#ishaAngle").disabled=true;$("#ishaAngle").title="Umm al-Qura menggunakan interval tetap 90 menit setelah Maghrib (pengecualian Ramadan belum otomatis)."}
    else{$("#ishaAngle").disabled=false;$("#ishaAngle").title=""}
  });
  $$('[data-action="today"]').forEach(b=>b.addEventListener("click",()=>{state.selectedDate=new Date();renderPrayer();renderRashdul()}));
  $('[data-action="date-prev"]').addEventListener("click",()=>{state.selectedDate.setDate(state.selectedDate.getDate()-1);renderPrayer();renderRashdul()});
  $('[data-action="date-next"]').addEventListener("click",()=>{state.selectedDate.setDate(state.selectedDate.getDate()+1);renderPrayer();renderRashdul()});
  $('[data-action="month-prev"]').addEventListener("click",()=>{state.currentMonth.setMonth(state.currentMonth.getMonth()-1);renderMonthly()});
  $('[data-action="month-next"]').addEventListener("click",()=>{state.currentMonth.setMonth(state.currentMonth.getMonth()+1);renderMonthly()});
  $('[data-action="rashdul-next"]').addEventListener("click",()=>{state.selectedDate.setDate(state.selectedDate.getDate()+1);renderRashdul()});
  $('[data-action="rashdul-today"]')?.addEventListener('click',()=>{state.selectedDate=new Date();renderRashdul()});
  $('#rashdulDatePicker')?.addEventListener('change',e=>{if(e.target.value){const [y,m,d]=e.target.value.split('-').map(Number);state.selectedDate=new Date(y,m-1,d);renderRashdul()}});
  $('[data-action="rashdul-month-prev"]')?.addEventListener('click',()=>{state.selectedDate=new Date(state.selectedDate.getFullYear(),state.selectedDate.getMonth()-1,1);renderRashdul()});
  $('[data-action="rashdul-month-next"]')?.addEventListener('click',()=>{state.selectedDate=new Date(state.selectedDate.getFullYear(),state.selectedDate.getMonth()+1,1);renderRashdul()});
  $('[data-action="save-settings"]').addEventListener("click",saveSettings);
  $('[data-action="save-location"]').addEventListener("click",()=>{setLocation(Number($("#latInput").value),Number($("#lonInput").value),Number($("#elevInput").value),$("#locationNameInput").value);saveSettings()});
  $('[data-action="export-csv"]').addEventListener("click",exportCSV);
  $$(".formula-tab").forEach(b=>b.addEventListener("click",()=>{$$(".formula-tab").forEach(x=>x.classList.remove("active"));b.classList.add("active");renderFormula(b.dataset.formula)}));
  $$(".accordion").forEach(b=>b.addEventListener("click",()=>b.classList.toggle("open")));
  $('[data-action="prayer-alert-enable"]')?.addEventListener("click",enablePrayerAlerts);
  $('[data-action="prayer-alert-disable"]')?.addEventListener("click",disablePrayerAlerts);
  $('[data-action="prayer-alert-test"]')?.addEventListener("click",testPrayerAdhan);
  $('#prayerAlertsEnabled')?.addEventListener("change",e=>e.target.checked?enablePrayerAlerts():disablePrayerAlerts());
}

document.addEventListener("DOMContentLoaded",()=>{
  bind();
  languageObserver.observe(document.body,{subtree:true,childList:true,characterData:true});
  if(localStorage.getItem("falakDark")==="true")document.body.classList.add("dark");
  else if(localStorage.getItem("falakDark")==="false")document.body.classList.remove("dark");
  if(window.syncFalakThemeButtons)window.syncFalakThemeButtons();
  loadSettings();
  updateClock();setInterval(updateClock,1000);
  renderPrayer();renderMonthly();renderFormula("qibla");
  updateTeodolite();
  const simDate=$("#solarSimulationDate");if(simDate)simDate.value=localDateTimeValue();
  const simZone=$("#solarSimulationTimezone");if(simZone)simZone.value=String(state.settings.timezone);
  renderObservationRecords();updateGoogleEarthLink();simulateSunPosition();
  applyLanguage();
  const alertsOn=localStorage.getItem("falakPrayerAlerts")==="true";
  const alertCheck=document.getElementById("prayerAlertsEnabled");if(alertCheck)alertCheck.checked=alertsOn;
  if(alertsOn && "Notification" in window && Notification.permission==="granted"){prayerAlarmTimer=setInterval(checkPrayerAlarm,15000);checkPrayerAlarm();prayerAlertStatus("Pengingat aktif selama aplikasi berjalan.");}
});
})();
