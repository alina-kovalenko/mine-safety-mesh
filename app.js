/* Smart Helmet 5.0 — browser web app. No backend required. */
const NODE_POS = {1:[110,335],2:[282,335],3:[447,335],4:[612,335],5:[777,335],6:[950,335]};
const ZONE_POS = {A:[282,543],B:[447,543],C:[612,543],D:[777,543],E:[447,142],F:[777,142]};
const ZONE_GATE = {A:2,B:3,C:4,D:5,E:3,F:5};
const ZONE_ADJ = {A:['B','E'],B:['A','C','E'],C:['B','D','F'],D:['C','F'],E:['A','B','C'],F:['C','D','E']};
const MAIN_EDGES = [ ['1','2'], ['2','3'], ['3','4'], ['4','5'], ['5','6'], ['2','A'], ['3','B'], ['4','C'], ['5','D'], ['3','E'], ['5','F'] ];
const RESERVE_EDGES = [ ['2','4'], ['3','5'], ['4','6'], ['2','5'], ['3','6'] ];
const ZONES = ['A','B','C','D','E','F'];
const HELMETS = ['HM-A104','HM-B210','HM-C305','HM-D118','HM-E441','HM-F087'];
const DANGER_LIMITS = {
  CH4_ppm:{warn:5.0,danger:7.0,label:'CH₄ / метан',unit:'ppm',avoid:'усилить вентиляцию, проверить источник метана, ограничить работы в зоне'},
  H2S_ppm:{warn:0.04,danger:0.07,label:'H₂S',unit:'ppm',avoid:'проверить газоанализатор, включить аварийную вентиляцию, вывести персонал'},
  CO_ppm:{warn:7.0,danger:12.0,label:'CO',unit:'ppm',avoid:'проверить признаки горения/технику, усилить проветривание, включить оповещение'},
  VOC_ppm:{warn:360,danger:520,label:'VOC',unit:'ppm',avoid:'локализовать источник испарений, усилить обмен воздуха'},
  Temp_C:{warn:45,danger:55,label:'температура',unit:'°C',avoid:'проверить оборудование и кабели, снизить нагрузку, усилить охлаждение'},
  Impact_N:{warn:3.2,danger:5.0,label:'удар/impact',unit:'N',avoid:'проверить крепления и риск обрушения, остановить работу техники'},
  Accel_Z_g:{warn:1.35,danger:1.75,label:'вибрация',unit:'g',avoid:'снизить нагрузку оборудования, проверить крепления и конвейер'}
};
const SEVERITY = {'безопасно':0,'потенциально опасно':1,'опасно':2};
const SEVERITY_LABEL = ['безопасно','потенциально опасно','опасно'];
const SAMPLE_SECONDS = 20;
let simTimer = null, speed = 1000, tick = 0, scenario = 'predictive';
let dataFeed = null, usingUploadedFeed = false;
let offlineTrunks = new Set();
let forcedDangerZone = null;
let history = Object.fromEntries(ZONES.map(z=>[z,[]]));
let readings = {};
let nodeState = {};
let forecasts = {};
let routes = {};
let logRows = [];
let miners = [
  {id:'HM-A104',zone:'A',dx:-22,dy:-18},{id:'HM-B210',zone:'B',dx:24,dy:-28},{id:'HM-C305',zone:'C',dx:-25,dy:-24},{id:'HM-D118',zone:'D',dx:18,dy:-18},
  {id:'HM-E441',zone:'E',dx:-24,dy:22},{id:'HM-F087',zone:'F',dx:23,dy:21},{id:'HM-771',zone:'C',dx:28,dy:22},{id:'HM-889',zone:'E',dx:20,dy:-16}
];

function $(id){return document.getElementById(id)}
function fmt(v,d=2){return Number.isFinite(Number(v)) ? Number(v).toFixed(d) : '—'}
function nowTime(){return new Date().toLocaleTimeString('ru-RU',{hour12:false})}
function safeClass(s){return s==='опасно'?'danger':s==='потенциально опасно'?'warning':'safe'}
function log(msg,type='info'){
  logRows.push({time:nowTime(),msg,type}); if(logRows.length>160) logRows.shift(); renderLog();
}

function buildSvg(){
  const edgeLayer=$('edgeLayer'), reserveLayer=$('reserveLayer'), trunkLayer=$('trunkLayer'), zoneLayer=$('zoneLayer');
  edgeLayer.innerHTML=''; reserveLayer.innerHTML=''; trunkLayer.innerHTML=''; zoneLayer.innerHTML='';
  const pos = id => NODE_POS[id] || ZONE_POS[id];
  MAIN_EDGES.forEach(e=>{
    const [a,b]=e, p1=pos(a), p2=pos(b);
    edgeLayer.insertAdjacentHTML('beforeend',`<line class="edge" id="edge-${a}-${b}" data-a="${a}" data-b="${b}" x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}"/>`);
  });
  RESERVE_EDGES.forEach(e=>{
    const [a,b]=e,p1=pos(a),p2=pos(b);
    reserveLayer.insertAdjacentHTML('beforeend',`<line class="reserveEdge standby" id="reserve-${a}-${b}" data-a="${a}" data-b="${b}" x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}"/>`);
  });
  Object.entries(NODE_POS).forEach(([id,p])=>{
    trunkLayer.insertAdjacentHTML('beforeend',`<g class="trunkWrap" id="trunk-${id}"><circle class="trunkNode" cx="${p[0]}" cy="${p[1]}" r="18"/><text class="trunkText" x="${p[0]}" y="${p[1]}">${id}</text></g>`);
  });
  Object.entries(ZONE_POS).forEach(([id,p])=>{
    zoneLayer.insertAdjacentHTML('beforeend',`<g class="zoneNode safe" id="zone-${id}" data-zone="${id}" transform="translate(${p[0]},${p[1]})">
      <circle class="neighborHalo" r="38"></circle><circle class="forecastRing" r="31"></circle><circle class="zoneCircle" r="24"></circle><text class="zoneLabel" x="0" y="1">${id}</text>
      <circle class="sensor-mini" cx="-31" cy="-34" r="8"></circle>
    </g>`);
  });
  document.querySelectorAll('.zoneNode').forEach(el=>{
    el.addEventListener('mouseenter', zoneMouseEnter); el.addEventListener('mousemove', zoneMouseMove); el.addEventListener('mouseleave', ()=> $('tooltip').classList.remove('show'));
  });
}

function zoneMouseEnter(e){ showTooltip(e.currentTarget.dataset.zone,e); }
function zoneMouseMove(e){ moveTooltip(e); }
function moveTooltip(e){
  const t=$('tooltip');
  const margin=12;
  const w=t.offsetWidth || 420;
  const h=t.offsetHeight || 260;
  let left=e.clientX+18;
  let top=e.clientY-18;
  if(left+w+margin>window.innerWidth) left=e.clientX-w-18;
  if(left<margin) left=margin;
  if(top+h+margin>window.innerHeight) top=window.innerHeight-h-margin;
  if(top<margin) top=margin;
  t.style.left=left+'px';
  t.style.top=top+'px';
}
function showTooltip(zone,e){
  const rd=readings[zone]||{}, st=nodeState[zone]||{}, fc=forecasts[zone];
  const causes = (st.reasons||[]).slice(0,4).map(x=>`<p>• ${x}</p>`).join('') || '<p>Показатели в пределах нормы.</p>';
  const pred = fc && fc.etaMin<999 ? `<p><strong>AI прогноз:</strong> danger возможен через ${fmt(fc.etaMin,1)} мин. Причина: ${fc.reason}.</p><p><strong>Как избежать:</strong> ${fc.action}</p>` : '<p><strong>AI прогноз:</strong> в ближайшие 15 минут критический рост не ожидается.</p>';
  $('tooltip').innerHTML = `<h3>Забой ${zone} <span class="tag ${safeClass(st.status||'безопасно')}">${st.status||'безопасно'}</span></h3>
    ${causes}${pred}
    <div class="metrics"><span>CH₄: ${fmt(rd.CH4_ppm)} ppm</span><span>CO: ${fmt(rd.CO_ppm)} ppm</span><span>H₂S: ${fmt(rd.H2S_ppm,4)} ppm</span><span>Temp: ${fmt(rd.Temp_C)} °C</span><span>VOC: ${fmt(rd.VOC_ppm,0)} ppm</span><span>Impact: ${fmt(rd.Impact_N)} N</span></div>`;
  $('tooltip').classList.add('show'); moveTooltip(e);
}

function relu(arr){return arr.map(x=>Math.max(0,x))}
function matVec(W,x,b){return W.map((row,i)=>row.reduce((s,w,j)=>s+w*x[j],b[i]||0))}
function softmax(a){const m=Math.max(...a), ex=a.map(x=>Math.exp(x-m)), s=ex.reduce((p,c)=>p+c,0); return ex.map(x=>x/s)}
function mlpPredict(row){
  const bundle=window.MINE_MODEL_BUNDLE; if(!bundle) return {label:'безопасно',prob:0,raw:{}};
  const x=[];
  bundle.numericFeatures.forEach((f,i)=>x.push(((Number(row[f])||0)-bundle.scalerMean[i])/(bundle.scalerScale[i]||1)));
  const helmet=row.Helmet_ID || 'HM-A104';
  bundle.helmetCategories.forEach(c=>x.push(helmet===c?1:0));
  let h1=relu(matVec(bundle.weights['model.0.weight'],x,bundle.weights['model.0.bias']));
  let h2=relu(matVec(bundle.weights['model.3.weight'],h1,bundle.weights['model.3.bias']));
  let out=matVec(bundle.weights['model.6.weight'],h2,bundle.weights['model.6.bias']);
  let p=softmax(out); let idx=p.indexOf(Math.max(...p));
  return {label:bundle.classes[idx],prob:p[idx],raw:Object.fromEntries(bundle.classes.map((c,i)=>[c,p[i]]))};
}

function ruleRisk(row){
  let max=0, reasons=[], score=0;
  for(const [k,lim] of Object.entries(DANGER_LIMITS)){
    const v=Number(row[k]); if(!Number.isFinite(v)) continue;
    if(v>=lim.danger){ max=2; reasons.push(`${lim.label} превышает danger-порог: ${fmt(v,k.includes('H2S')?4:2)} ${lim.unit}`); score=Math.max(score,1); }
    else if(v>=lim.warn){ max=Math.max(max,1); reasons.push(`${lim.label} приближается к danger: ${fmt(v,k.includes('H2S')?4:2)} ${lim.unit}`); score=Math.max(score,.55); }
    else score=Math.max(score, Math.min(.49, (v/(lim.danger||1))*.45));
  }
  return {severity:max,status:SEVERITY_LABEL[max],reasons,score};
}

function classify(row){
  const rule=ruleRisk(row); const nn=mlpPredict(row);
  let nnSeverity=SEVERITY[nn.label] ?? 0;
  // Use neural output, but keep hard safety thresholds dominant.
  let severity = Math.max(rule.severity, nn.prob>0.58 ? nnSeverity : 0);
  let reasons=[...rule.reasons];
  if(nn.prob>0.58 && nnSeverity>rule.severity) reasons.push(`MLP-модель оценила состояние как «${nn.label}» с уверенностью ${fmt(nn.prob*100,0)}%`);
  return {status:SEVERITY_LABEL[severity], severity, confidence:Math.max(rule.score, nn.prob||0), reasons, nn};
}

function slope(values){
  if(values.length<4) return 0;
  const n=values.length, xs=values.map((_,i)=>i), mx=(n-1)/2, my=values.reduce((a,b)=>a+b,0)/n;
  let num=0,den=0; for(let i=0;i<n;i++){num+=(xs[i]-mx)*(values[i]-my); den+=(xs[i]-mx)*(xs[i]-mx)}
  return den?num/den:0;
}
function forecastZone(zone){
  const hist=history[zone].slice(-12); const current=readings[zone];
  if(!current || hist.length<5) return {zone,etaMin:999,probability:0,reason:'недостаточно данных',action:'продолжить мониторинг',metrics:[]};
  let best={etaMin:999,probability:0,reason:'стабильно',action:'продолжить мониторинг',metrics:[]};
  for(const [k,lim] of Object.entries(DANGER_LIMITS)){
    const vals=hist.map(r=>Number(r[k])).filter(Number.isFinite); if(vals.length<5) continue;
    const sl=slope(vals); const cur=Number(current[k]); if(!Number.isFinite(cur)) continue;
    let etaTicks=9999;
    if(cur>=lim.danger) etaTicks=0;
    else if(sl>0) etaTicks=(lim.danger-cur)/sl;
    const etaMin=etaTicks*SAMPLE_SECONDS/60;
    if(etaMin>=0 && etaMin<best.etaMin && etaMin<45){
      const p=Math.max(0,Math.min(0.98,1-etaMin/45));
      best={zone,etaMin,probability:p,reason:`${lim.label} растёт (${sl>0?'+':''}${fmt(sl,k==='H2S_ppm'?5:3)} ${lim.unit}/шаг), текущее значение ${fmt(cur,k==='H2S_ppm'?4:2)} ${lim.unit}`,action:lim.avoid,metrics:[k]};
    }
  }
  return best;
}

function generateReading(zone,t,mode='predictive'){
  const i=ZONES.indexOf(zone); const helmet=HELMETS[i];
  const wave=Math.sin(t/12+i)*0.12; let row={tick:t,node_id:zone,Helmet_ID:helmet,Temp_C:35+Math.sin(t/18+i)*1.1,Humidity_Percent:47+Math.cos(t/20+i)*5,CH4_ppm:2.6+wave, H2S_ppm:0.018+Math.abs(Math.sin(t/15+i))*0.006, CO_ppm:3.6+Math.cos(t/15+i)*0.4, VOC_ppm:190+Math.sin(t/11+i)*22, Pressure_hPa:1013+Math.sin(t/16+i), Mud_Level_cm:14+Math.cos(t/17+i)*1.5, Mud_Viscosity_Index:7+Math.sin(t/22+i)*.45, Mud_Salinity_uS_cm:950+Math.cos(t/21+i)*30, Accel_Z_g:1+Math.sin(t/10+i)*.04, Light_lux:24+Math.sin(t/8+i)*6, Impact_N:1+Math.abs(Math.cos(t/13+i))*.5, Fluid_Level_cm:12+Math.sin(t/9+i)*1.0, node_online:1};
  if(mode==='predictive' && zone==='C' && t>35){ row.CH4_ppm+=(t-35)*0.05; row.CO_ppm+=(t-35)*0.035; row.Temp_C+=(t-35)*0.04; }
  if(mode==='predictive' && zone==='D' && t>70){ row.CH4_ppm+=(t-70)*0.025; row.CO_ppm+=(t-70)*0.025; }
  if(mode==='emergency' && zone==='E' && t>22){ row.CH4_ppm+=Math.min(8,(t-22)*0.18); row.H2S_ppm+=Math.min(.09,(t-22)*0.0017); row.CO_ppm+=Math.min(16,(t-22)*0.22); row.Temp_C+=Math.min(25,(t-22)*0.26); row.VOC_ppm+=Math.min(650,(t-22)*9); }
  if(mode==='emergency' && zone==='B' && t>55){ row.Impact_N+=(t-55)*0.08; row.Accel_Z_g+=(t-55)*0.007; }
  if(forcedDangerZone===zone){ row.CH4_ppm+=7.5; row.CO_ppm+=14; row.H2S_ppm+=0.08; }
  Object.keys(row).forEach(k=>{if(typeof row[k]==='number') row[k]=Number(row[k].toFixed(k==='H2S_ppm'?5:3))});
  return row;
}

function parseCSV(text){
  const lines=text.trim().split(/\r?\n/).filter(Boolean); if(lines.length<2) return [];
  const headers=lines[0].split(',').map(h=>h.trim().replace(/^"|"$/g,''));
  return lines.slice(1).map((line,idx)=>{
    const vals=[]; let cur='',q=false;
    for(const ch of line){ if(ch==='"'){q=!q} else if(ch===','&&!q){vals.push(cur); cur=''} else cur+=ch } vals.push(cur);
    let r={}; headers.forEach((h,i)=>{const v=(vals[i]??'').trim().replace(/^"|"$/g,''); const num=Number(v); r[h]=v!=='' && Number.isFinite(num)?num:v;});
    if(!r.tick) r.tick=idx;
    if(!r.node_id){ const hid=String(r.Helmet_ID||HELMETS[idx%HELMETS.length]); r.node_id=ZONES[Math.abs(hashCode(hid))%ZONES.length]; }
    if(r.node_online===undefined) r.node_online=1;
    return r;
  });
}
function hashCode(s){let h=0; for(let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i)|0; return h}

function rowsForTick(){
  if(dataFeed && dataFeed.length){
    const maxTick=Math.max(...dataFeed.map(r=>Number(r.tick)||0));
    const curTick=tick%(maxTick+1);
    let rows=dataFeed.filter(r=>(Number(r.tick)||0)===curTick);
    if(!rows.length) rows=dataFeed.slice((tick*ZONES.length)%dataFeed.length,(tick*ZONES.length)%dataFeed.length+ZONES.length);
    // normalize to one reading per zone
    const by={}; rows.forEach(r=>by[String(r.node_id||'A').replace('Zone_','').replace('Забой ','').trim().slice(-1)] = r);
    return ZONES.map(z=> by[z] ? {...by[z],node_id:z} : generateReading(z,tick,scenario));
  }
  return ZONES.map(z=>generateReading(z,tick,scenario));
}

function updateSimulation(){
  const rows=rowsForTick(); readings={}; nodeState={}; forecasts={};
  for(const row of rows){ const z=String(row.node_id||'A').replace('Zone_','').replace('Забой ','').trim().slice(-1); if(!ZONES.includes(z)) continue; readings[z]=row; history[z].push(row); if(history[z].length>80) history[z].shift(); }
  for(const z of ZONES){ nodeState[z]=classify(readings[z]||generateReading(z,tick,scenario)); forecasts[z]=forecastZone(z); }
  // communication loss from feed: node_online=0 means the zone sensor link is lost.
  for(const z of ZONES){ if(Number(readings[z]?.node_online)===0){ nodeState[z].status='опасно'; nodeState[z].severity=2; nodeState[z].offline=true; nodeState[z].reasons.unshift('Потеря связи с датчиком/Smart Helmet node_online=0'); }}
  applyNeighborPropagation();
  computeMeshRoutes();
  renderAll();
  tick++;
}

function applyNeighborPropagation(){
  for(const z of ZONES){
    const dangerous = nodeState[z].severity===2 || (forecasts[z]&&forecasts[z].etaMin<10);
    if(dangerous){
      for(const n of ZONE_ADJ[z]||[]){
        if(nodeState[n].severity<2){
          nodeState[n].status='потенциально опасно'; nodeState[n].severity=1; nodeState[n].neighborCause=z;
          nodeState[n].reasons = nodeState[n].reasons||[];
          nodeState[n].reasons.unshift(`Соседний забой ${z} в danger/AI-predicted зоне: повышаем уровень до warning`);
        }
      }
    }
  }
  // trunk offline affects zones connected to adjacent gateways
  offlineTrunks.forEach(id=>{
    const affected=ZONES.filter(z=>Math.abs(ZONE_GATE[z]-Number(id))<=1);
    affected.forEach(z=>{ if(nodeState[z].severity<2){ nodeState[z].status='потенциально опасно'; nodeState[z].severity=1; nodeState[z].reasons.unshift(`Рядом отказ mesh-узла ${id}: зона переведена в warning`); }});
  });
}

function buildGraph(includeReserve=true){
  const g={}; const add=(a,b)=>{g[a]=g[a]||[];g[b]=g[b]||[]; if(!offlineTrunks.has(a)&&!offlineTrunks.has(b)){g[a].push(b);g[b].push(a)}};
  MAIN_EDGES.filter(e=>!/[A-F]/.test(e[0])&&!/[A-F]/.test(e[1])).forEach(([a,b])=>add(a,b));
  if(includeReserve) RESERVE_EDGES.forEach(([a,b])=>add(a,b));
  return g;
}
function bfsPath(start,target,g){
  if(offlineTrunks.has(start)||offlineTrunks.has(target)) return null;
  const q=[start], prev={[start]:null};
  while(q.length){const v=q.shift(); if(v===target) break; for(const n of (g[v]||[])){if(prev[n]===undefined){prev[n]=v;q.push(n)}}}
  if(prev[target]===undefined) return null; let path=[], cur=target; while(cur){path.push(cur); cur=prev[cur]} return path.reverse();
}
function computeMeshRoutes(){
  const g=buildGraph(true); routes={};
  for(const z of ZONES){
    const gate=String(ZONE_GATE[z]); const path=bfsPath('1',gate,g); const branchOnline=Number(readings[z]?.node_online)!==0;
    routes[z]={path,online:!!path && branchOnline,branchOnline};
    if(!routes[z].online){ nodeState[z].status='опасно'; nodeState[z].severity=2; nodeState[z].offline=true; nodeState[z].reasons.unshift('Нет доступного mesh-маршрута до диспетчерского узла'); }
  }
}

function renderAll(){ renderMap(); renderPanels(); drawChart(); }
function renderMap(){
  // edges
  document.querySelectorAll('.edge').forEach(el=>{
    const a=el.dataset.a,b=el.dataset.b; let failed=false;
    if(offlineTrunks.has(a)||offlineTrunks.has(b)) failed=true;
    if(/[A-F]/.test(a)||/[A-F]/.test(b)){ const z=(/[A-F]/.test(a)?a:b); if(Number(readings[z]?.node_online)===0) failed=true; }
    el.classList.toggle('failed',failed);
  });
  document.querySelectorAll('.reserveEdge').forEach(el=>{el.classList.remove('active'); el.classList.add('standby')});
  const used=new Set(); Object.values(routes).forEach(r=>{if(r.path) for(let i=0;i<r.path.length-1;i++){const a=r.path[i],b=r.path[i+1]; const key=[a,b].sort().join('-'); if(RESERVE_EDGES.map(e=>e.slice().sort().join('-')).includes(key)) used.add(key)}});
  for(const key of used){ const [a,b]=key.split('-'); const el=$(`reserve-${a}-${b}`)||$(`reserve-${b}-${a}`); if(el){el.classList.add('active');el.classList.remove('standby')}}
  Object.keys(NODE_POS).forEach(id=>{ const el=$(`trunk-${id}`).querySelector('circle'); el.classList.toggle('offline',offlineTrunks.has(id)); });
  for(const z of ZONES){
    const el=$(`zone-${z}`), st=nodeState[z]||{status:'безопасно',severity:0};
    el.classList.remove('safe','warning','danger','offline','predicted');
    el.classList.add(st.offline?'offline':safeClass(st.status));
    if(forecasts[z] && forecasts[z].etaMin<15) el.classList.add('predicted');
  }
  renderMiners();
}
function renderMiners(){
  const layer=$('minerLayer'); layer.innerHTML=''; let lost=0;
  miners.forEach((m,idx)=>{
    const p=ZONE_POS[m.zone]; const st=nodeState[m.zone]||{}; const route=routes[m.zone]||{};
    const x=p[0]+m.dx+Math.sin((tick+idx)/5)*5, y=p[1]+m.dy+Math.cos((tick+idx)/7)*4;
    const isLost=st.offline || !route.online || (scenario==='emergency' && m.zone==='E' && tick>55);
    const warn=st.severity===1;
    if(isLost) lost++;
    layer.insertAdjacentHTML('beforeend',`<g><circle class="minerDot ${isLost?'lost':warn?'warning':''}" cx="${x}" cy="${y}" r="9"><title>${m.id} — ${isLost?'связь потеряна':warn?'рядом риск':'online'} — забой ${m.zone}</title></circle><text x="${x+12}" y="${y-10}" fill="#8fa9bf" font-size="11" font-weight="700">${m.id.split('-')[1]}</text></g>`);
  });
  $('kpiMiners').textContent=`${miners.length-lost}/${miners.length}`;
}
function renderPanels(){
  const onlineCount = Object.keys(NODE_POS).filter(n=>!offlineTrunks.has(n)).length + ZONES.filter(z=>routes[z]?.online).length;
  $('kpiOnline').textContent=`${onlineCount}/12`;
  $('kpiCritical').textContent=ZONES.filter(z=>nodeState[z]?.severity===2).length;
  $('kpiPredicted').textContent=ZONES.filter(z=>forecasts[z]?.etaMin<15).length;
  renderForecastPanel(); renderZoneStatus(); renderMeshPanel(); renderHelmetPanel();
}
function renderForecastPanel(){
  const list=ZONES.map(z=>forecasts[z]).filter(f=>f && f.etaMin<45).sort((a,b)=>a.etaMin-b.etaMin).slice(0,4);
  if(!list.length){$('forecastPanel').innerHTML='<div class="forecast-card"><h3>Стабильно</h3><p>Недостаточно данных для прогноза или тренд безопасный.</p></div>'; return;}
  $('forecastPanel').innerHTML=list.map(f=>{
    const danger=f.etaMin<7, warn=f.etaMin<15;
    return `<div class="forecast-card ${danger?'danger':warn?'warning':''}"><h3>Забой ${f.zone}: риск через ${f.etaMin<999?fmt(f.etaMin,1)+' мин':'—'}</h3><p><strong>Вероятность:</strong> ${fmt(f.probability*100,0)}%</p><p><strong>Почему:</strong> ${f.reason}</p><p><strong>Как избежать:</strong> ${f.action}</p></div>`;
  }).join('');
}
function renderZoneStatus(){
  $('zoneStatus').innerHTML=ZONES.map(z=>{
    const st=nodeState[z]||{status:'безопасно',severity:0}, rd=readings[z]||{}; const cls=safeClass(st.status); const pct=Math.min(100,Math.round((st.confidence||0.1)*100));
    return `<div class="zone-row ${cls}"><div class="zone-row-head"><strong>Забой ${z}</strong><span class="badge ${cls}">${st.status}</span></div><div class="bar"><i style="width:${Math.max(8,pct)}%"></i></div><small>CH₄ ${fmt(rd.CH4_ppm)} ppm • CO ${fmt(rd.CO_ppm)} ppm • Temp ${fmt(rd.Temp_C)}°C</small></div>`;
  }).join('');
}
function renderMeshPanel(){
  $('meshPanel').innerHTML=ZONES.map(z=>{
    const r=routes[z]||{}; const path=r.path?r.path.join(' → '):'нет маршрута';
    const reserveUsed=r.path && r.path.some((n,i)=> i && RESERVE_EDGES.map(e=>e.slice().sort().join('-')).includes([r.path[i-1],n].sort().join('-')) );
    return `<div class="mesh-item"><div><strong>Забой ${z}</strong><div class="route">${path}${reserveUsed?' • mesh-обход активен':''}</div></div><span class="${r.online?'statusOnline':'statusOffline'}">${r.online?'online':'offline'}</span></div>`;
  }).join('');
}
function renderHelmetPanel(){
  $('helmetPanel').innerHTML=miners.map(m=>{
    const st=nodeState[m.zone]||{}, r=routes[m.zone]||{}; const lost=st.offline || !r.online || (scenario==='emergency' && m.zone==='E' && tick>55);
    return `<div class="helmet-item"><div><strong>${m.id}</strong><div class="route">забой ${m.zone}</div></div><span class="${lost?'statusOffline':'statusOnline'}">${lost?'lost':'online'}</span></div>`;
  }).join('');
}
function renderLog(){
  $('eventLog').innerHTML=logRows.map(r=>`<div class="event ${r.type}"><small>${r.time}</small>${r.msg}</div>`).join('');
}

function drawChart(){
  const c=$('chart'), ctx=c.getContext('2d'), w=c.width,h=c.height; ctx.clearRect(0,0,w,h); ctx.fillStyle='#0d1620'; ctx.fillRect(0,0,w,h);
  const max=10, pad=36; ctx.strokeStyle='rgba(180,210,240,.14)'; ctx.lineWidth=1; ctx.font='13px Segoe UI'; ctx.fillStyle='#8ca0b3';
  for(let i=0;i<=5;i++){const y=pad+(h-pad*2)*i/5; ctx.beginPath();ctx.moveTo(pad,y);ctx.lineTo(w-pad,y);ctx.stroke(); ctx.fillText(`${Math.round(max-(max*i/5))}`,8,y+4)}
  const colors={C:'#55e6ff',E:'#bb71ff',D:'#ffc247'}; const zones=['C','E','D'];
  zones.forEach(z=>{ const arr=history[z].slice(-70); if(arr.length<2)return; ctx.strokeStyle=colors[z]; ctx.lineWidth=3; ctx.beginPath(); arr.forEach((r,i)=>{const x=pad+(w-pad*2)*i/69; const val=Math.min(max,Number(r.CH4_ppm)||0); const y=h-pad-(h-pad*2)*val/max; if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y)}); ctx.stroke(); ctx.fillStyle=colors[z]; ctx.fillText(`Забой ${z}`, w-pad-250+zones.indexOf(z)*80, 22); });
  // danger threshold
  ctx.strokeStyle='rgba(255,79,95,.55)'; ctx.setLineDash([8,8]); const y=h-pad-(h-pad*2)*DANGER_LIMITS.CH4_ppm.danger/max; ctx.beginPath(); ctx.moveTo(pad,y); ctx.lineTo(w-pad,y); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle='#ff8d9a'; ctx.fillText('danger CH₄', pad+8, y-8);
}

function start(){ if(simTimer) return; log('Симуляция запущена. AI анализирует текущие значения и прогнозирует риск.', 'good'); simTimer=setInterval(updateSimulation,speed); }
function pause(){ clearInterval(simTimer); simTimer=null; log('Симуляция приостановлена.', 'info'); }
function reset(){ pause(); tick=0; offlineTrunks.clear(); forcedDangerZone=null; dataFeed=null; usingUploadedFeed=false; history=Object.fromEntries(ZONES.map(z=>[z,[]])); readings={}; logRows=[]; scenario='predictive'; buildSvg(); updateSimulation(); log('Состояние сброшено. Включена встроенная симуляция: данные генерируются прямо в браузере, CSV не нужен.', 'good'); }
function setScenario(s){ scenario=s; dataFeed=null; usingUploadedFeed=false; forcedDangerZone=null; history=Object.fromEntries(ZONES.map(z=>[z,[]])); tick=0; log(s==='emergency' ? 'Встроенная симуляция: аварийный сценарий в забое E.' : 'Встроенная симуляция: predictive-сценарий с постепенным ростом риска.', s==='emergency'?'danger':'warn'); updateSimulation(); }
function exportJournal(){
  const header='time,message,type\n'; const csv=header+logRows.map(r=>`"${r.time}","${r.msg.replace(/"/g,'""')}","${r.type}"`).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'})); a.download='mine_ai_mesh_event_log.csv'; a.click(); URL.revokeObjectURL(a.href);
}

function wireControls(){
  $('startBtn').onclick=start; $('pauseBtn').onclick=pause; $('resetBtn').onclick=reset; $('predictiveBtn').onclick=()=>setScenario('predictive'); $('emergencyBtn').onclick=()=>setScenario('emergency');
  $('offline3Btn').onclick=()=>{ offlineTrunks.has('3')?offlineTrunks.delete('3'):offlineTrunks.add('3'); log(`${offlineTrunks.has('3')?'Сбой':'Восстановлен'} mesh-узла 3. Схема перестраивает маршруты.`, offlineTrunks.has('3')?'danger':'good'); updateSimulation(); };
  $('offline4Btn').onclick=()=>{ offlineTrunks.has('4')?offlineTrunks.delete('4'):offlineTrunks.add('4'); log(`${offlineTrunks.has('4')?'Сбой':'Восстановлен'} mesh-узла 4. Соседние зоны переводятся в warning.`, offlineTrunks.has('4')?'danger':'good'); updateSimulation(); };
  $('speed').oninput=e=>{speed=Number(e.target.value); $('speedLabel').textContent=speed+' мс'; if(simTimer){pause();start();}};
  $('exportBtn').onclick=exportJournal;
  $('csvInput').onchange=e=>{ const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=()=>{dataFeed=parseCSV(r.result); usingUploadedFeed=true; tick=0; history=Object.fromEntries(ZONES.map(z=>[z,[]])); log(`Загружен внешний CSV: ${f.name}. Строк: ${dataFeed.length}. Для возврата к демо нажмите «Встроенная симуляция» или «Сброс».`, 'good'); updateSimulation();}; r.readAsText(f,'utf-8'); };
}

buildSvg(); wireControls(); reset();
