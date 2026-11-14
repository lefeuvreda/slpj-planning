/* SLPJ : interface de production GitHub Pages + Supabase. */
(()=>{
'use strict';
const {evaluate,range,minute,clock,formatMinutes,getRow,initialChoice,profileFor,afternoonEndClock} = window.SLPJ_RULES;
const $=id=>document.getElementById(id);
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const frDate=s=>s?new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(`${s}T12:00:00Z`)):'—';
const fullName=x=>x?`${x.last_name} ${x.first_name}`:'—';
const cfg=window.SLPJ_CONFIG||{};
const configured=cfg.SUPABASE_URL?.startsWith('https://')&&!cfg.SUPABASE_URL.includes('REMPLACER')&&cfg.SUPABASE_PUBLISHABLE_KEY&&!cfg.SUPABASE_PUBLISHABLE_KEY.includes('REMPLACER');
const db=configured&&window.supabase?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY):null;
const state={admin:false,tab:'roster',teams:[],employees:[],days:[],recoveries:[],settings:null,revision:null,submissions:[],current:null,choice:null,dirty:false,teamFilter:'all',employeeSearch:''};
let editorMode='',editorId='';
let lastRejectedConstraint='';
const hardCodes=new Set(['limit','break','rest','hours']);
const briefDuration=n=>n%60?formatMinutes(n):`${n/60} h`;
const shortRule={limit:()=>`${briefDuration(currentProfile().maxMinutes)} max.`,break:()=>`pause ${briefDuration(state.settings.break_min_minutes)}`,rest:()=>`repos ${briefDuration(state.settings.rest_min_minutes)}`};
function notice(message,err=false){const t=$('toast');t.textContent=message;t.className='notification'+(err?' err':'');clearTimeout(notice.timer);notice.timer=setTimeout(()=>t.classList.add('hidden'),4200);}
function fail(message){$('app-error').textContent=message;$('app-error').classList.remove('hidden');}
function clearFail(){$('app-error').classList.add('hidden')}
function check({error,data},name){if(error)throw new Error(`${name}: ${error.message}`);return data}
async function callAPI(action,body={}){
 const {data,error}=await db.functions.invoke('planning-api',{body:{action,...body}});
 if(error){let reason=error.message||'Erreur serveur';if(error.context){try{const d=await error.context.json();reason=d.error||reason;if(d.details)reason+='\n'+d.details.map(x=>x.message).join('\n');}catch{}}
  throw new Error(reason);
 }return data;
}
function allowedTeams(){return state.teams.filter(t=>t.active)}
function teamById(id){return state.teams.find(t=>t.id===id)}
function employeeById(id){return state.employees.find(e=>e.id===id)}
function submissionFor(id){return state.submissions.find(x=>x.employee_id===id)}
function configData(){return {settings:state.settings,days:state.days,recoveries:state.recoveries,teams:state.teams}}
function currentProfile(e=state.current){return profileFor(configData(),e)}
async function refresh(){
 const tasks=[
  db.from('teams').select('*').order('name'),
  db.from('employees').select('*').order('last_name'),
  db.from('workdays').select('*').order('date'),
  db.from('recoveries').select('*').order('date'),
  db.from('settings').select('*').eq('id',1).single(),
  db.from('config_revision').select('*').eq('id',1).single(),
  db.from('submissions').select('*').order('updated_at',{ascending:false}),
  db.rpc('is_slpj_admin')
 ];
 const r=await Promise.all(tasks);
 state.teams=check(r[0],'Pôles'); state.employees=check(r[1],'Collaborateurs');
 state.days=check(r[2],'Horaires');state.recoveries=check(r[3],'Récupérations');
 state.settings=check(r[4],'Règles');state.revision=check(r[5],'Version');
 state.submissions=check(r[6],'Fiches');state.admin=!!check(r[7],'Droits');
 if(!state.teams.length&&!state.admin)throw new Error('Aucun pôle accessible. Contactez l’ADMIN pour activer votre compte.');
 $('access-caption').textContent=state.admin?'Administration générale · Marie PARIS':'Espace responsable';
 const {data:{user}}=await db.auth.getUser(); const profile=(window.SLPJ_LOGIN_OPTIONS||[]).find(x=>x.email===user?.email);$('hello').textContent=profile?.name||user?.email||'';
 $('account-label').textContent=state.admin?'ADMIN · Marie PARIS':(state.teams[0]?.name||'Responsable');
 document.querySelectorAll('.admin-only').forEach(x=>x.classList.toggle('hidden',!state.admin));
 if(!state.admin&&!['roster'].includes(state.tab))state.tab='roster';
 if(state.teamFilter!=='all'&&!state.teams.some(t=>t.id===state.teamFilter))state.teamFilter='all';
 render();
}
function render(){
 renderDashboard();
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===state.tab));
 for(const t of ['roster','teams','people','days','recoveries','settings'])$('tab-'+t).classList.toggle('hidden',state.tab!==t);
 renderRoster();if(state.admin){renderTeams();renderPeople();renderDays();renderRecoveries();renderSettings();}
}
async function enter(){try{
 clearFail();await refresh();$('login-panel').classList.add('hidden');$('workspace').classList.remove('hidden');$('planning').classList.add('hidden');
}catch(e){fail(e.message);}}
function authScreen(){
 $('login-panel').classList.remove('hidden');$('workspace').classList.add('hidden');$('planning').classList.add('hidden');$('logout').classList.add('hidden');$('account-label').textContent='Accès par responsable';
 document.querySelectorAll('.admin-only').forEach(x=>x.classList.add('hidden'));
 $('login-password').value='';$('login-status').textContent='Les collaborateurs et les menus de gestion ne sont accessibles qu’après identification.';
 populateManagers();
}
function populateManagers(preselect=''){
 const opts=window.SLPJ_LOGIN_OPTIONS||[];
 $('login-email').innerHTML='<option value="">— Choisir un responsable —</option>'+opts.map(p=>`<option value="${escapeHTML(p.email)}" ${p.enabled===false?'disabled':''}>${escapeHTML(p.name)} · ${escapeHTML(p.admin?'ADMIN / PAG - A':p.team)}${p.enabled===false?' (accès à configurer)':''}</option>`).join('');
 if(preselect)$('login-email').value=preselect;
}
async function loadPublicLogins(){
 try{
  const {data,error}=await db.rpc('slpj_public_logins');
  if(error)throw error;
  window.SLPJ_LOGIN_OPTIONS=(data||[]).map(p=>({id:p.team_id,email:p.email,name:p.full_name,team:p.team_name,admin:p.is_admin,enabled:true}));
  populateManagers();
  if(!data?.length) $('login-status').textContent='Aucun compte activé : exécutez le script de création des comptes (guide installation).';
 }catch(e){$('login-status').textContent='Impossible de charger les responsables : '+e.message;}
}
function renderDashboard(){
 const teams=state.teams.filter(t=>t.active).length;
 const people=state.employees.filter(e=>e.active).length;
 const normal=state.employees.filter(e=>e.active&&!e.special_form).length;
 const special=state.employees.filter(e=>e.active&&e.special_form).length;
 const signed=state.submissions.filter(s=>!!s.locked_at).length;
 const values=[teams,people,normal,special,signed];
 document.querySelectorAll('[data-metric]').forEach((e,i)=>{e.textContent=String(values[i]);});
 $('demo-role-caption').textContent=state.admin?'Vision transversale · Tous les pôles':'Vision limitée · '+(state.teams[0]?.name||'Mon pôle');
}
function renderRoster(){
 const list=$('roster-list');const filter=$('team-filter');
 const s=state.settings;
 const monday=state.days.find(d=>d.active&&d.date==='2026-11-23')||state.days.find(d=>d.active);
 const wednesday=state.days.find(d=>d.active&&d.date==='2026-11-25');
 const wedException=wednesday&&wednesday.afternoon_max!==monday?.afternoon_max;
 if(s&&monday){$('roster-rules').innerHTML=`<b>Règles actives :</b> matin ${escapeHTML(monday.morning_min)}–${escapeHTML(monday.morning_max)} · après-midi ${escapeHTML(monday.afternoon_min)}–${escapeHTML(monday.afternoon_max)}${wedException?' (mercredi jusqu’à '+escapeHTML(wednesday.afternoon_max)+')':''} · pas de ${s.slot_step_minutes} min · pause ${briefDuration(s.break_min_minutes)} · repos ${briefDuration(s.rest_min_minutes)} · plafond standard ${briefDuration(s.max_period_minutes)} · récupération à partir de ${briefDuration(s.recovery_threshold_minutes)} · directeurs et Sophie : ${briefDuration(s.director_max_minutes||3600)} et récupération par paliers.`;}

 filter.innerHTML='<option value="all">Tous les pôles accessibles</option>'+allowedTeams().map(t=>`<option value="${escapeHTML(t.id)}" ${state.teamFilter===t.id?'selected':''}>${escapeHTML(t.name)}</option>`).join('');
 const teams=allowedTeams().filter(t=>state.teamFilter==='all'||t.id===state.teamFilter);
 const search=state.employeeSearch.toLocaleLowerCase('fr').trim();
 let visibleCount=0;
 const blocks=teams.map(team=>{
  const emps=state.employees.filter(e=>e.team_id===team.id&&e.active&&(!search||`${fullName(e)} ${e.job_title}`.toLocaleLowerCase('fr').includes(search))).sort((a,b)=>fullName(a).localeCompare(fullName(b),'fr'));
  visibleCount+=emps.length;
  return `<div class="team-block"><h3>${escapeHTML(team.name)} <small class="subtle">· ${emps.length} personne(s)</small></h3>${emps.length?emps.map(e=>{
   const sub=submissionFor(e.id),special=e.special_form,stale=sub&&Number(sub.revision)!==Number(state.revision.revision);
   const status=(special?'<span class="special-tag">Fiche 60 h · règles spécifiques</span> ':'')+(!sub?'<span class="pill gray">À compléter</span>':stale?'<span class="pill amber">Règles modifiées</span>':sub.locked_at?'<span class="pill">Validée</span>':'<span class="pill amber">Enregistrée</span>')+(sub?.admin_modified_at?' <span class="pill amber">Correction ADMIN</span>':'');
   return `<div class="person-row"><div><strong>${escapeHTML(fullName(e))}</strong><small>${escapeHTML(e.job_title)}</small></div><div>${status}</div><div class="btn-row">${special&&!currentProfile(e).special?'<span class="subtle">Modèle spécifique non fourni</span>':`<button type="button" class="btn btn-primary btn-small" data-open="${escapeHTML(e.id)}">${sub?'Ouvrir la fiche':'Créer la fiche'}</button>${sub&&!stale?`<button type="button" class="btn btn-outline btn-small" data-pdf="${escapeHTML(e.id)}">PDF</button>`:''}${state.admin&&sub?.locked_at?`<button type="button" class="btn btn-outline btn-small" data-admin-unlock="${escapeHTML(e.id)}">Déverrouiller (ADMIN)</button>`:''}`}</div></div>`;
  }).join(''):'<div class="row-empty">Aucun collaborateur actif.</div>'}</div>`;
 });
 $('roster-summary').textContent=`${visibleCount} collaborateur${visibleCount>1?'s':''} affiché${visibleCount>1?'s':''} · ${teams.length} pôle${teams.length>1?'s':''}`;
 list.innerHTML=blocks.join('')||'<div class="row-empty">Aucune équipe accessible.</div>';
 list.querySelectorAll('[data-open]').forEach(b=>b.addEventListener('click',()=>openPerson(b.dataset.open)));
 list.querySelectorAll('[data-pdf]').forEach(b=>b.addEventListener('click',()=>openPDF(b.dataset.pdf)));
 list.querySelectorAll('[data-admin-unlock]').forEach(b=>b.addEventListener('click',()=>adminUnlock(b.dataset.adminUnlock)));
}
function changeTab(name){if(!state.admin&&name!=='roster')return;state.tab=name;render();}
// La page de PDF ne peut pas toujours lire la session locale de index.html,
// particulièrement avec les URL file:// (navigateurs qui isolent chaque fichier).
// Le parent garde la session et transmet UNIQUEMENT le rapport demandé à la
// fenêtre qu'il vient d'ouvrir, via postMessage et un identifiant aléatoire.
const pendingPDFs=new Map();
window.addEventListener('message',async event=>{
 const msg=event.data;
 if(!msg||msg.type!=='slpj-print-ready'||typeof msg.ticket!=='string')return;
 const request=pendingPDFs.get(msg.ticket);
 if(!request||event.source!==request.window||event.origin!==location.origin)return;
 pendingPDFs.delete(msg.ticket);
 try{
  const report=await callAPI('get_report',{
   employee_id:request.employeeId,
   ...(request.draft?{preview:true,selection:request.draft}:{})
  });
  event.source.postMessage({type:'slpj-print-response',ticket:msg.ticket,report},location.origin);
 }catch(error){
  event.source.postMessage({type:'slpj-print-response',ticket:msg.ticket,error:String(error.message||error)},location.origin);
 }
});
function openPDF(id,draft=null){
 // Une ouverture synchrone évite le blocage des pop-ups par le navigateur.
 const ticket=(globalThis.crypto?.randomUUID?.()||`${Date.now()}-${Math.random().toString(36).slice(2)}`);
 const url=`./print.html?employee=${encodeURIComponent(id)}&ticket=${encodeURIComponent(ticket)}`;
 const win=window.open(url,'_blank');
 if(!win){notice('Fenêtre PDF bloquée : autorisez les fenêtres surgissantes pour cette application.',true);return;}
 pendingPDFs.set(ticket,{window:win,employeeId:id,draft:draft?structuredClone(draft):null});
}
// Planning fictif de départ à 39 h pour montrer le seuil de 44 h.
// Les règles de calcul et les plages horaires ne sont pas modifiées.
function newStartingChoice(employee){
 const selected=initialChoice(configData());
 selected.hours=Object.fromEntries(state.days.filter(d=>d.active).map(d=>[d.date,{morningStart:'',morningEnd:'',afternoonStart:'',afternoonEnd:''}]));
 return selected;
}
function openPerson(id){
 const e=employeeById(id);if(!e||(e.special_form&&!currentProfile(e).special))return;
 state.current=e;const sub=submissionFor(id);
 state.choice=sub?structuredClone(sub.selection):newStartingChoice(e);
 state.dirty=false;$('workspace').classList.add('hidden');$('planning').classList.remove('hidden');
 $('person-heading').textContent=fullName(e);$('person-detail').textContent=`${teamById(e.team_id)?.name||''} · ${e.job_title}`;
 renderPlanning();window.scrollTo({top:0,behavior:'smooth'});
}
function locked(){return !!submissionFor(state.current?.id)?.locked_at}
function markChanged(){state.dirty=true;lastRejectedConstraint='';renderPlanning();}
// Comparaison des écarts : permet de CORRIGER une ancienne fiche devenue non conforme
// après modification des règles par l’ADMIN, mais empêche toute aggravation.
function constraintState(choice){
 const cfg=configData(),s=cfg.settings,calc=evaluate(cfg,choice,state.current),profile=currentProfile();
 const problems=calc.errors.filter(x=>hardCodes.has(x.code));
 let deficit=0;
 deficit+=Math.max(0,calc.summary.totalMinutes-(profile.special?profile.maxMinutes:s.max_period_minutes));
 for(const minutes of Object.values(calc.summary.weekly||{}))deficit+=Math.max(0,minutes-(profile.special?profile.maxMinutes:s.max_week_minutes));
 let previous=null;
 for(const r of calc.rows){
  if(r.off)continue;
  const t=getRow(r,choice),intervals=[];
  for(const [start,end] of [['morningStart','morningEnd'],['afternoonStart','afternoonEnd']]){
   const a=minute(t[start]),b=minute(t[end]);if(Number.isFinite(a)&&Number.isFinite(b)&&a!==null&&b!==null&&b>a)intervals.push([a,b]);
  }
  // Les plages autorisées se chevauchent : utiliser les champs matin/après-midi,
  // et non la position des horaires dans la plage, pour mesurer la pause.
  const morningEnd=minute(t.morningEnd),afternoonStart=minute(t.afternoonStart);
  if(Number.isFinite(morningEnd)&&morningEnd!==null &&
     Number.isFinite(afternoonStart)&&afternoonStart!==null)
    deficit+=Math.max(0,s.break_min_minutes-(afternoonStart-morningEnd));
  if(r.eventMinutes){const a=minute(s.event_start);if(Number.isFinite(a))intervals.push([a,a+r.eventMinutes]);}
  intervals.sort((a,b)=>a[0]-b[0]);
  if(intervals.length){
   const first=Date.parse(`${r.date}T00:00:00Z`)/60000+intervals[0][0];
   if(previous!==null)deficit+=Math.max(0,s.rest_min_minutes-(first-previous));
   previous=Date.parse(`${r.date}T00:00:00Z`)/60000+intervals[intervals.length-1][1];
  }
 }
 return {problems,deficit};
}
function rejectedReason(candidate){
 const before=constraintState(state.choice),after=constraintState(candidate);
 // Sur une fiche conforme, aucun dépassement ne peut être choisi.
 // Sur une ancienne fiche non conforme, seul un changement qui n'aggrave pas
 // l'écart est permis afin que les horaires restent modifiables pour correction.
 if(after.problems.length && (before.problems.length===0 || after.deficit>before.deficit || after.problems.some(e=>!before.problems.some(old=>old.code===e.code&&old.message===e.message)))){
  const added=after.problems.find(e=>!before.problems.some(old=>old.code===e.code&&old.message===e.message));
  return (added||after.problems[0]).message;
 }
 return '';
}
function applyGuardedChoice(next){
 const reason=rejectedReason(next);
 if(reason){lastRejectedConstraint=reason;renderPlanning();notice('Créneau refusé : '+reason,true);return false;}
 state.choice=next;markChanged();return true;
}
function renderPlanning(){if(!state.current)return;const choice=state.choice,calc=evaluate(configData(),choice,state.current);const s=state.settings;const lock=locked();const profile=currentProfile();const limit=profile.special?profile.maxMinutes:s.max_period_minutes;
 const sub=submissionFor(state.current.id),stale=sub&&Number(sub.revision)!==Number(state.revision.revision);
 $('save-state').textContent=lock?'Verrouillée':state.dirty?'Modifications non enregistrées':stale?'Règles modifiées':sub?.admin_modified_at?'Corrigée par ADMIN':sub?.unlocked_at?'Déverrouillée par ADMIN':sub?'Choix enregistrés':'Nouveau planning';
 $('save-state').className='pill '+(state.dirty||stale?'amber':sub?'':'gray');
 const offDays=state.days.filter(d=>d.active!==false&&d.can_be_off&&(!Array.isArray(state.current.allowed_days_off)||state.current.allowed_days_off.includes(d.date)));
 $('dayoff-grid').innerHTML=offDays.map(d=>`<label class="choice"><input type="radio" name="dayOff" value="${escapeHTML(d.date)}" ${choice.dayOff===d.date?'checked':''} ${lock?'disabled':''}><span class="tile"><span class="chip">REPOS</span><strong>${escapeHTML(frDate(d.date))}</strong><small>Journée non travaillée</small></span></label>`).join('');
 $('dayoff-grid').querySelectorAll('input').forEach(x=>x.addEventListener('change',()=>{const candidate=structuredClone(state.choice);candidate.dayOff=x.value;applyGuardedChoice(candidate)}));
 const evs=[['none','Aucune','0 h'],['partial','Réduite','Durée au choix'],['full','Complète',formatMinutes(s.event_full_minutes)]];
 $('event-grid').innerHTML=evs.map(([id,label,desc])=>`<label class="choice"><input type="radio" name="inauguration" value="${id}" ${choice.inauguration===id?'checked':''} ${lock?'disabled':''}><span class="tile"><span class="chip">${escapeHTML(desc)}</span><strong>${label}</strong><small>${id==='none'?'Pas de participation':'Participation à l’inauguration'}</small></span></label>`).join('');
 $('event-grid').querySelectorAll('input').forEach(x=>x.addEventListener('change',()=>{const candidate=structuredClone(state.choice);candidate.inauguration=x.value;applyGuardedChoice(candidate)}));
 const partial=$('event-partial');partial.innerHTML=Array.from({length:Math.floor((s.event_partial_max_minutes-s.event_partial_min_minutes)/s.slot_step_minutes)+1},(_,i)=>s.event_partial_min_minutes+i*s.slot_step_minutes).map(n=>`<option value="${n}" ${Number(choice.eventPartialMinutes)===n?'selected':''}>${formatMinutes(n)}</option>`).join('');
 $('event-partial-container').classList.toggle('hidden',choice.inauguration!=='partial');partial.disabled=lock;
 let body='';for(const d of calc.rows){const raw=getRow(d,choice),off=d.off;
  body+=`<tr class="${off?'is-off':''}"><td><strong>${escapeHTML(frDate(d.date))}</strong></td><td>${off?'Jour non travaillé':timePair(d,raw,'morning',lock)}</td><td>${off?'—':timePair(d,raw,'afternoon',lock)}</td><td>${d.eventMinutes?'+'+formatMinutes(d.eventMinutes):'—'}</td><td><strong>${formatMinutes(d.totalMinutes)}</strong></td></tr>`;
 }
 $('working-days').innerHTML=body;
 $('working-days').querySelectorAll('[data-time]').forEach(x=>x.addEventListener('change',()=>editTime(x.dataset.day,x.dataset.time,x.value)));
 $('period-total').textContent=`${formatMinutes(calc.summary.totalMinutes)} / ${formatMinutes(limit)} maximum`;
 $('rule-feedback').className='policy-status '+(calc.errors.length||lastRejectedConstraint?'invalid':'valid');
 $('rule-feedback').innerHTML=(lastRejectedConstraint?`<strong>Choix refusé — horaire inchangé :</strong> ${escapeHTML(lastRejectedConstraint)}<div class="subtle margin-top">Sélectionnez un autre créneau : les limites de ${briefDuration(limit)}, les pauses minimales de ${briefDuration(s.break_min_minutes)} et les repos de ${briefDuration(s.rest_min_minutes)} sont contrôlés.</div>`:'')+(calc.errors.length?`<strong>À corriger :</strong><ul>${calc.errors.map(x=>`<li>${escapeHTML(x.message)}</li>`).join('')}</ul>`:!lastRejectedConstraint?`Contrôle actif : maximum ${briefDuration(limit)} · pause méridienne minimale ${briefDuration(s.break_min_minutes)} · repos minimal ${briefDuration(s.rest_min_minutes)}. Les horaires non conformes sont indisponibles.`:'');
 renderRecoveryPicks(calc.summary,lock);
 $('last-save').textContent=sub?`Dernier enregistrement : ${new Date(sub.updated_at).toLocaleString('fr-FR')}${stale?' · Configuration modifiée depuis':''}`:'Enregistrez une fiche conforme.';
 $('save-planning').disabled=lock||calc.errors.length>0||!state.dirty&&!!sub&&!stale;
 $('lock-planning').disabled=!sub||!!state.dirty||!!stale||(lock&&!state.admin);
 $('lock-planning').textContent=lock?(state.admin?'Déverrouiller (ADMIN)':'Verrouillée · ADMIN requis'):'Verrouiller';
 $('lock-access-note').textContent=lock?(state.admin?'Fiche validée. Marie PARIS (ADMIN) peut la déverrouiller, corriger puis la verrouiller à nouveau.':'Fiche validée : seul le profil ADMIN de Marie PARIS peut la déverrouiller.'):(sub?.unlocked_at?'Fiche ouverte par ADMIN : les modifications nécessitent un nouvel enregistrement et un nouveau verrouillage.':'');
 // Aperçu toujours disponible : une fiche non enregistrée ou modifiée est marquée BROUILLON.
 $('print-planning').disabled=false;
 $('print-planning').textContent=(!sub||state.dirty||stale||calc.errors.length)?'Aperçu / Imprimer PDF (brouillon)':`Imprimer / PDF · ${profile.kind==='director'?'2':'3'} signatures`;
}
function timePair(day,raw,period,disabled){
 const lower=period==='morning'?'morning':'afternoon';const start=lower==='morning'?'morningStart':'afternoonStart';const end=lower==='morning'?'morningEnd':'afternoonEnd';
 const opts=range(day[lower+'_min'],lower==='afternoon'?afternoonEndClock(day):day.morning_max,state.settings.slot_step_minutes);
 return `<div class="slot-pair">${timeSelect(day.date,start,raw[start],opts,disabled)}<span>à</span>${timeSelect(day.date,end,raw[end],opts,disabled)}</div>`;
}
function proposedTimeChoice(date,field,value){
 const candidate=structuredClone(state.choice),day=state.days.find(d=>d.date===date);
 const t=getRow(day,candidate),period=field.startsWith('morning')?'morning':'afternoon',start=period+'Start',end=period+'End';
 t[field]=value;
 if(!value){t[start]='';t[end]='';}
 else if(field===start&&(!t[end]||minute(t[end])<=minute(value))){
  const possible=minute(value)+state.settings.slot_step_minutes;t[end]=possible<=minute(period==='afternoon'?afternoonEndClock(day):day.morning_max)?clock(possible):'';
 }else if(field===end&&(!t[start]||minute(t[start])>=minute(value))){
  const possible=minute(value)-state.settings.slot_step_minutes;t[start]=possible>=minute(day[period+'_min'])?clock(possible):'';
 }
 candidate.hours[date]={morningStart:t.morningStart,morningEnd:t.morningEnd,afternoonStart:t.afternoonStart,afternoonEnd:t.afternoonEnd};
 return candidate;
}
function timeSelect(date,field,value,values,disabled){
 const options=values.map(v=>{
  const reason=(!disabled&&v!==value)?rejectedReason(proposedTimeChoice(date,field,v)):'';
  const label=reason?`${v} · ${escapeHTML(shortRule[reason.includes('pause méridienne')?'break':reason.includes('Repos insuffisant')?'rest':'limit']())}`:v;
  return `<option value="${v}" ${v===value?'selected':''} ${reason?'disabled':''}>${label}</option>`;
 });
 return `<select class="shift-select" data-day="${escapeHTML(date)}" data-time="${field}" ${disabled?'disabled':''} aria-label="${escapeHTML(date+' '+field)}"><option value="" ${!value?'selected':''}>0 h</option>${options.join('')}</select>`;
}
function editTime(date,field,value){applyGuardedChoice(proposedTimeChoice(date,field,value));}
function renderRecoveryPicks(summary,lock){
 const choices=state.choice.recovery||{},profile=currentProfile();
 const cap=summary.allowedExtraHalfDays;
 const candidates=state.recoveries.filter(r=>r.active&&!r.mandatory);
 const unit=m=>m==='full'?2:['morning','afternoon'].includes(m)?1:0;
 const count=candidates.reduce((n,r)=>n+unit(choices[r.date]),0);
 if(profile.special){
  const recovery=summary.earnedRecoveryDays;
  $('recovery-explanation').innerHTML=`<strong>Règle des directeurs et de Sophie CASTELNEAU · 60 h maximum.</strong> `+
   `Récupération calculée : <strong>${String(recovery).replace('.',',')} jour(s)</strong>, dont 1er décembre fixe et `+
   `<strong>${cap} demi-journée(s)</strong> supplémentaire(s). Une journée entière compte pour deux demi-journées. `+
   `Choix actuel : <strong>${count}/${cap} demi-journée(s)</strong>. `+
   `Paliers : &gt; 38,5 h à 44 h = 1 j · &gt; 44 h à 48 h = 1,5 j · &gt; 48 h à 52 h = 2 j · &gt; 52 h à 60 h = 2,5 j.`+
   (recovery===0?' Aucun droit acquis au titre des paliers jusqu’à 38,5 h ; la date fixe reste affichée dans la démo.':'');
 }else{
  $('recovery-explanation').textContent=`Une seule demi-journée au choix à partir de ${formatMinutes(state.settings.recovery_threshold_minutes)} travaillées.`;
 }
 $('recover-picks').innerHTML=state.recoveries.filter(r=>r.active).map(r=>{
  const mode=choices[r.date]||'none';
  if(r.mandatory)return `<div class="recover-card mandatory"><strong>${escapeHTML(frDate(r.date))}</strong><p>Récupération fixe</p><span class="pill">Journée entière · fixe</span></div>`;
  const others=count-unit(mode);
  const options=[['none','Aucune'],['morning','Matinée'],['afternoon','Après-midi'],...(profile.special?[['full','Journée entière']]:[])];
  const html=options.map(([value,label])=>{
   const prohibited=value!=='none'&&(others+unit(value)>cap||(!profile.special&&!summary.eligible));
   return `<option value="${value}" ${mode===value?'selected':''} ${prohibited?'disabled':''}>${label}${prohibited?' · plafond atteint':''}</option>`;
  }).join('');
  return `<div class="recover-card"><strong>${escapeHTML(frDate(r.date))}</strong><p>Récupération conditionnelle${profile.special?' · ½ ou 1 journée':''}</p><select data-recovery="${escapeHTML(r.date)}" ${lock?'disabled':''}>${html}</select></div>`;
 }).join('');
 $('recover-picks').querySelectorAll('[data-recovery]').forEach(x=>x.addEventListener('change',()=>{
  const candidate=structuredClone(state.choice);candidate.recovery={...candidate.recovery,[x.dataset.recovery]:x.value};
  const newUnits=candidates.reduce((n,r)=>n+unit(candidate.recovery[r.date]),0);
  if(newUnits>cap){notice('Récupération refusée : droit maximum atteint.',true);renderPlanning();return;}
  state.choice=candidate;markChanged();
 }));
}
async function savePlanning(){try{const id=state.current.id;
 const checkNow=evaluate(configData(),state.choice,state.current);
 if(checkNow.errors.length)throw new Error('Enregistrement bloqué : '+checkNow.errors.map(x=>x.message).join(' ; '));
 const result=await callAPI('save_selection',{employee_id:id,selection:state.choice});
 state.submissions=state.submissions.filter(s=>s.employee_id!==id).concat([result.submission]);state.dirty=false;renderPlanning();notice('Choix enregistrés dans Supabase.');
}catch(e){notice(e.message,true)}}
async function adminUnlock(id){
 if(!state.admin){notice('Action réservée à Marie PARIS (ADMIN).',true);return;}
 if(!window.confirm('Déverrouiller cette fiche ? Elle pourra être corrigée, puis devra être de nouveau validée.'))return;
 try{
  const result=await callAPI('toggle_lock',{employee_id:id,lock:false});
  state.submissions=state.submissions.filter(s=>s.employee_id!==id).concat([result.submission]);
  if(state.current?.id===id){state.choice=structuredClone(result.submission.selection);state.dirty=false;renderPlanning();}
  else renderRoster();
  notice('Fiche déverrouillée par ADMIN. Modifications et nouveau verrouillage autorisés.');
 }catch(e){notice(e.message,true)}
}
async function toggleLock(){
 const id=state.current.id;const lock=!locked();
 if(!lock)return adminUnlock(id);
 try{
  const result=await callAPI('toggle_lock',{employee_id:id,lock:true});
  state.submissions=state.submissions.filter(s=>s.employee_id!==id).concat([result.submission]);renderPlanning();notice('Fiche verrouillée. Déverrouillage réservé à ADMIN.');
 }catch(e){notice(e.message,true)}
}
function renderTeams(){const root=$('team-list');root.innerHTML=`<table class="admin-table"><thead><tr><th>Pôle</th><th>Responsable signataire</th><th>Accès</th><th>Gestion</th></tr></thead><tbody>${state.teams.map(t=>`<tr><td><strong>${escapeHTML(t.name)}</strong><br><span class="subtle">${escapeHTML(t.id)} ${t.active?'':'· Inactif'}</span></td><td>${escapeHTML(fullName(employeeById(t.manager_employee_id)))}<br><span class="subtle">${escapeHTML(t.manager_title)}</span></td><td>${t.manager_user_id?'<span class="pill">Compte actif</span>':'<span class="pill gray">Sans compte</span>'}</td><td><div class="btn-row"><button class="btn btn-outline btn-small" data-team-edit="${escapeHTML(t.id)}">Modifier</button><button class="btn btn-outline btn-small" data-set-code="${escapeHTML(t.id)}">Définir / modifier le code</button><button class="btn btn-primary btn-small" data-account="${escapeHTML(t.id)}">Tester cet accès</button></div></td></tr>`).join('')}</tbody></table>`;
 root.querySelectorAll('[data-team-edit]').forEach(b=>b.addEventListener('click',()=>editRecord('team',b.dataset.teamEdit)));
 root.querySelectorAll('[data-account]').forEach(b=>b.addEventListener('click',()=>accountAction(b.dataset.account)));
 root.querySelectorAll('[data-set-code]').forEach(b=>b.addEventListener('click',()=>setTeamCode(b.dataset.setCode)));
}
function renderPeople(){const root=$('people-list');root.innerHTML=`<table class="admin-table"><thead><tr><th>Collaborateur</th><th>Fonction</th><th>Pôle</th><th>Fiche</th><th>Édition</th></tr></thead><tbody>${state.employees.map(e=>`<tr><td><strong>${escapeHTML(fullName(e))}</strong> ${e.active?'':'<span class="pill gray">Inactif</span>'}</td><td>${escapeHTML(e.job_title)}</td><td>${escapeHTML(teamById(e.team_id)?.name||e.team_id)}</td><td>${e.special_form?'Particulière':'Standard'}</td><td><button class="btn btn-outline btn-small" data-person-edit="${escapeHTML(e.id)}">Modifier</button></td></tr>`).join('')}</tbody></table>`;
 root.querySelectorAll('[data-person-edit]').forEach(b=>b.addEventListener('click',()=>editRecord('person',b.dataset.personEdit)));
}
function renderDays(){const root=$('days-list');root.innerHTML=`<table class="admin-table"><thead><tr><th>Date</th><th>Plage matin</th><th>Plage après-midi</th><th>Horaires par défaut</th><th>Repos possible</th><th>Édition</th></tr></thead><tbody>${state.days.map(d=>`<tr><td><strong>${escapeHTML(frDate(d.date))}</strong> ${d.active?'':'(inactif)'}</td><td>${escapeHTML(d.morning_min)} – ${escapeHTML(d.morning_max)}</td><td>${escapeHTML(d.afternoon_min)} – ${escapeHTML(d.afternoon_max)}</td><td>${escapeHTML(d.default_morning_start||'0 h')} / ${escapeHTML(d.default_morning_end||'0 h')}<br>${escapeHTML(d.default_afternoon_start||'0 h')} / ${escapeHTML(d.default_afternoon_end||'0 h')}</td><td>${d.can_be_off?'Oui':'Non'}</td><td><button class="btn btn-outline btn-small" data-day-edit="${escapeHTML(d.date)}">Modifier</button></td></tr>`).join('')}</tbody></table>`;
 root.querySelectorAll('[data-day-edit]').forEach(b=>b.addEventListener('click',()=>editRecord('day',b.dataset.dayEdit)));
}
function renderRecoveries(){const root=$('recoveries-list');root.innerHTML=`<table class="admin-table"><thead><tr><th>Date</th><th>Type</th><th>État</th><th></th></tr></thead><tbody>${state.recoveries.map(r=>`<tr><td>${escapeHTML(frDate(r.date))}</td><td>${r.mandatory?'Journée entière fixe':'½ journée ou journée entière selon profil'}</td><td>${r.active?'Active':'Inactive'}</td><td><button class="btn btn-outline btn-small" data-rec-edit="${escapeHTML(r.date)}">Modifier</button></td></tr>`).join('')}</tbody></table>`;
 root.querySelectorAll('[data-rec-edit]').forEach(b=>b.addEventListener('click',()=>editRecord('recovery',b.dataset.recEdit)));
}
const settingsFields=[
 ['title','Titre de la fiche','text'],['subtitle','Sous-titre','text'],
 ['finance_employee_id','Signataire direction administrative et financière','finance'],
 ['event_date','Date de l’inauguration','date'],['event_start','Heure de début de l’inauguration','time'],
 ['event_full_minutes','Inauguration complète (minutes)','number'],
 ['event_partial_min_minutes','Participation réduite minimum (minutes)','number'],
 ['event_partial_max_minutes','Participation réduite maximum (minutes)','number'],
 ['slot_step_minutes','Pas de sélection horaire (15, 30 ou 60 min)','step'],
 ['break_min_minutes','Pause méridienne minimum (minutes)','number'],
 ['rest_min_minutes','Repos entre journées (minutes)','number'],
 ['max_week_minutes','Plafond par semaine (minutes)','number'],
 ['max_period_minutes','Plafond sur la période (minutes)','number'],
 ['director_general_name','Signataire : directeur général','text'],
 ['director_max_minutes','Plafond directeurs / Sophie (minutes)','number'],
 ['director_tier_1_minutes','Palier spécial : plus de 38,5 h (minutes)','number'],
 ['director_tier_2_minutes','Palier spécial : plus de 44 h (minutes)','number'],
 ['director_tier_3_minutes','Palier spécial : plus de 48 h (minutes)','number'],
 ['director_tier_4_minutes','Palier spécial : plus de 52 h (minutes)','number'],
 ['recovery_threshold_minutes','Seuil de récupération (minutes)','number'],
 ['reference_minutes','Durée de référence (minutes)','number']
];
function fieldMarkup(field,label,type,value,extra={}){
 const required=type!=='optional'&&type!=='finance', v=String(value??'');
 const attr=`name="${escapeHTML(field)}" ${required?'required':''}`;
 let control='';
 if(type==='checkbox')control=`<input type="checkbox" name="${escapeHTML(field)}" ${value?'checked':''}>`;
 else if(type==='team')control=`<select class="input" ${attr}>${state.teams.map(t=>`<option value="${escapeHTML(t.id)}" ${t.id===v?'selected':''}>${escapeHTML(t.name)}</option>`).join('')}</select>`;
 else if(type==='manager'){
   const match=state.employees.filter(e=>e.team_id===extra.teamId);
   control=`<select class="input" name="${escapeHTML(field)}"><option value="">À désigner</option>${match.map(e=>`<option value="${escapeHTML(e.id)}" ${e.id===v?'selected':''}>${escapeHTML(fullName(e))}</option>`).join('')}</select>`;
 }
 else if(type==='finance')control=`<select class="input" name="${escapeHTML(field)}"><option value="">À désigner</option>${state.employees.map(e=>`<option value="${escapeHTML(e.id)}" ${e.id===v?'selected':''}>${escapeHTML(fullName(e))}</option>`).join('')}</select>`;
 else if(type==='step')control=`<select class="input" ${attr}>${[15,30,60].map(n=>`<option value="${n}" ${String(n)===v?'selected':''}>${n} min</option>`).join('')}</select>`;
 else control=`<input class="input" ${attr} type="${type==='optional'?'text':type}" value="${escapeHTML(v)}" ${type==='number'?'min="0" step="1"':''} ${extra.readonly?'readonly':''}>`;
 return `<div class="field ${extra.wide?'wide':''}"><label>${escapeHTML(label)}</label>${control}</div>`;
}
function renderSettings(){const s=state.settings;if(!s)return;
 $('settings-form').innerHTML=`<div class="form-grid">${settingsFields.map(([key,label,type])=>fieldMarkup(key,label,type,s[key],{wide:key==='title'||key==='subtitle'})).join('')}</div><div class="btn-row margin-top" style="justify-content:flex-end"><button type="submit" class="btn btn-primary">Enregistrer les règles</button></div>`;
}
function editRecord(mode,id=''){
 editorMode=mode;editorId=id;
 const existing=mode==='team'?teamById(id):mode==='person'?employeeById(id):mode==='day'?state.days.find(x=>x.date===id):state.recoveries.find(x=>x.date===id);
 $('editor-title').textContent=({team:'Pôle / service',person:'Collaborateur',day:'Jour et plages horaires',recovery:'Date de récupération'})[mode]+(id?' · Modifier':' · Ajouter');
 const f=[];
 if(mode==='team'){
  f.push(fieldMarkup('id','Identifiant du pôle','text',existing?.id||'',{readonly:!!id}));
  f.push(fieldMarkup('name','Nom du pôle','text',existing?.name||''));
  f.push(fieldMarkup('manager_title','Qualité du signataire','text',existing?.manager_title||'Directeur ou directrice de pôle'));
  f.push(fieldMarkup('manager_employee_id','Responsable signataire','manager',existing?.manager_employee_id||'',{teamId:id}));
  f.push(fieldMarkup('active','Pôle actif','checkbox',existing?.active??true));
 } else if(mode==='person'){
  f.push(fieldMarkup('last_name','Nom','text',existing?.last_name||''));f.push(fieldMarkup('first_name','Prénom','text',existing?.first_name||''));
  f.push(fieldMarkup('job_title','Fonction / rôle','text',existing?.job_title||''));f.push(fieldMarkup('team_id','Pôle','team',existing?.team_id||state.teams[0]?.id||''));
  f.push(fieldMarkup('special_form','Autre modèle de fiche (hors planning standard)','checkbox',existing?.special_form??false));
  f.push(fieldMarkup('active','Personne active','checkbox',existing?.active??true));
  f.push(fieldMarkup('allowed_days_off','Dates autorisées pour jour non travaillé (AAAA-MM-JJ séparées par des virgules, vide = toutes)','optional',(existing?.allowed_days_off||[]).join(', '),{wide:true}));
 } else if(mode==='day'){
  f.push(fieldMarkup('date','Date','date',existing?.date||'',{readonly:!!id}));
  for(const [field,label] of [['morning_min','Matin · début autorisé'],['morning_max','Matin · fin autorisée'],['afternoon_min','Après-midi · début autorisé'],['afternoon_max','Après-midi · fin autorisée'],['default_morning_start','Défaut · début matin'],['default_morning_end','Défaut · fin matin'],['default_afternoon_start','Défaut · début après-midi'],['default_afternoon_end','Défaut · fin après-midi']]){
   f.push(fieldMarkup(field,label,field.startsWith('default')?'optional':'time',existing?.[field]??({morning_min:'06:00',morning_max:'15:00',afternoon_min:'12:00',afternoon_max:'22:00'}[field]||'')));
  }
  f.push(fieldMarkup('can_be_off','Jour non travaillé autorisé','checkbox',existing?.can_be_off??false));f.push(fieldMarkup('active','Jour visible','checkbox',existing?.active??true));
 } else if(mode==='recovery'){
  f.push(fieldMarkup('date','Date de récupération','date',existing?.date||'',{readonly:!!id}));
  f.push(fieldMarkup('mandatory','Journée entière fixe','checkbox',existing?.mandatory??false));f.push(fieldMarkup('active','Récupération visible','checkbox',existing?.active??true));
 }
 $('editor-fields').innerHTML=f.join('');$('editor-submit').classList.remove('hidden');$('editor-submit').textContent='Enregistrer';$('editor').showModal();
}
function formObject(form,mode){const data=Object.fromEntries(new FormData(form).entries());
 const checked=mode==='team'?['active']:mode==='person'?['active','special_form']:mode==='day'?['active','can_be_off']:['active','mandatory'];
 for(const field of checked)data[field]=!!form.querySelector(`input[name="${field}"]:checked`);
 if(mode==='person')data.allowed_days_off=data.allowed_days_off?.trim()?data.allowed_days_off.split(',').map(x=>x.trim()).filter(Boolean):null;
 if(mode==='team'&&!data.manager_employee_id)data.manager_employee_id=null;
 return data;
}
async function saveRecord(event){event.preventDefault();const mode=editorMode,id=editorId;
 if(mode==='credentials')return;
 try{
  const values=formObject($('editor-form'),mode);
  const table=({team:'teams',person:'employees',day:'workdays',recovery:'recoveries'})[mode];
  if(mode==='day'){
   const allowed=/^([01]\d|2[0-3]):[0-5]\d$/;
   for(const field of ['morning_min','morning_max','afternoon_min','afternoon_max'])if(!allowed.test(values[field]))throw new Error('Saisissez les plages horaires au format HH:MM.');
   if(minute(values.morning_min)>=minute(values.morning_max)||minute(values.afternoon_min)>=minute(values.afternoon_max))throw new Error('La fin de chaque plage doit être postérieure au début.');
   if(values.date==='2026-11-25' && (minute(values.afternoon_max)>18*60 || minute(values.afternoon_min)>=18*60))throw new Error('Mercredi 25 novembre (inauguration) : la plage après-midi doit se terminer à 18 h au plus tard.');
   const step=state.settings.slot_step_minutes;
   for(const period of ['morning','afternoon'])for(const k of ['start','end']){
    const field='default_'+period+'_'+k;if(values[field]&&!allowed.test(values[field]))throw new Error('Heure par défaut incorrecte : '+field);
    if(values[field]&&(minute(values[field])-minute(values[period+'_min']))%step!==0)throw new Error('Heure par défaut incompatible avec le pas horaire : '+field);
    if(values.date==='2026-11-25' && field==='default_afternoon_end' && values[field] && minute(values[field])>18*60)throw new Error('Mercredi 25 novembre : l’après-midi ne peut pas dépasser 18 h.');
   }
  }
  if(mode==='person'){
    if(id&&state.teams.some(t=>t.manager_employee_id===id&&t.id!==values.team_id))throw new Error('Réattribuez d’abord le responsable de son ancien pôle avant de déplacer cette personne.');
    if(values.allowed_days_off && values.allowed_days_off.some(s=>!/^(19|20)\d\d-\d\d-\d\d$/.test(s)))throw new Error('Dates autorisées au format AAAA-MM-JJ.');
  }
  if(mode==='team'){
    if(!/^[A-Za-z0-9_-]{2,48}$/.test(values.id))throw new Error('Identifiant : 2 à 48 lettres, chiffres, tirets ou soulignés.');
    if(values.manager_employee_id && !state.employees.some(e=>e.id===values.manager_employee_id&&e.team_id===values.id))throw new Error('Le responsable doit appartenir à ce pôle.');
    if(id&&values.manager_employee_id!==teamById(id).manager_employee_id)values.manager_user_id=null;
  }
  if(mode==='person'&&!id)values.id=crypto.randomUUID();
  const query=id?db.from(table).update(values).eq(mode==='team'||mode==='person'?'id':'date',id):db.from(table).insert(values);
  check(await query,'Enregistrement');$('editor').close();notice('Modifications enregistrées.');await refresh();
 }catch(e){notice(e.message,true);}
}
async function setTeamCode(teamId){
 if(!state.admin)return;
 const team=teamById(teamId);if(!team||!team.manager_employee_id){notice('Désignez un responsable pour ce pôle.',true);return;}
 if(team.id==='PAG-A'){notice('Le code ADMIN de Marie PARIS est défini dans la démonstration.',true);return;}
 const code=window.prompt(`Nouveau code du responsable ${fullName(employeeById(team.manager_employee_id))} (${team.name}) :\nMinimum 12 caractères. Évitez les codes réutilisés ailleurs.`);
 if(code===null)return;
 if(code.trim().length<12){notice('Code trop court : minimum 12 caractères.',true);return;}
 try{await callAPI('set_team_code',{team_id:teamId,new_code:code.trim()});notice('Nouveau code enregistré de manière sécurisée pour '+team.name+'.');await refresh();await loadPublicLogins();}catch(e){notice(e.message,true)}
}
async function accountAction(teamId){
 const team=teamById(teamId);if(!team||!state.admin)return;
 // Aucune bascule de rôle sans code : revenir au formulaire d'identification.
 if(!window.confirm(`Tester l’accès du responsable du pôle ${team.name} ?\nVous devrez saisir son code sur la page d’accueil.`))return;
 await db.auth.signOut();state.admin=false;state.tab='roster';state.teamFilter='all';state.current=null;state.choice=null;
 authScreen();await loadPublicLogins();populateManagers(team.id==='PAG-A'?'admin@slpj.example':'responsable-'+team.id.toLowerCase()+'@slpj.example');
}
async function saveSettings(event){event.preventDefault();try{
 const values=Object.fromEntries(new FormData(event.currentTarget).entries());
 for(const [key,,type] of settingsFields)if(type==='number'||type==='step')values[key]=Number(values[key]);
 if(!values.finance_employee_id)values.finance_employee_id=null;
 if(!values.event_date)values.event_date=null;
 if(values.event_partial_min_minutes>values.event_partial_max_minutes)throw new Error('La durée minimale doit être inférieure à la durée maximale.');
 check(await db.from('settings').update({...values,updated_at:new Date().toISOString()}).eq('id',1),'Règles générales');
 notice('Règles modifiées. Les fiches précédentes sont à revalider.');await refresh();
}catch(e){notice(e.message,true)}}
function exportPeople(){const lines=[['Nom','Prénom','Fonction','Pôle','Type de fiche','Actif'],...state.employees.map(e=>[e.last_name,e.first_name,e.job_title,teamById(e.team_id)?.name||e.team_id,e.special_form?'Particulière':'Standard',e.active?'Oui':'Non'])];
 const csv='\ufeff'+lines.map(cols=>cols.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(';')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='slpj-collaborateurs.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),3000);
}
$('login-form').addEventListener('submit',async e=>{
 e.preventDefault();state.tab='roster';state.teamFilter='all';$('login-status').textContent='Vérification du code…';
 const email=$('login-email').value.trim(), code=$('login-password').value;
 if(!email||!code){$('login-status').textContent='Choisissez votre nom et renseignez votre code.';return;}
 try{
  const {error}=await db.auth.signInWithPassword({email,password:code});
  if(error)throw error;
  $('login-password').value='';$('logout').classList.remove('hidden');await enter();
 }catch(err){$('login-password').value='';$('login-status').textContent='Accès refusé : '+err.message;}
});
$('show-code').addEventListener('click',()=>{
 const input=$('login-password');input.type=input.type==='password'?'text':'password';
 $('show-code').textContent=input.type==='password'?'Afficher':'Masquer';
 $('show-code').setAttribute('aria-label',input.type==='password'?'Afficher le code':'Masquer le code');
});
$('logout').addEventListener('click',async()=>{await db?.auth.signOut();state.admin=false;state.current=null;state.choice=null;state.tab='roster';state.teamFilter='all';state.employeeSearch='';$('employee-search').value='';authScreen();});
$('refresh').addEventListener('click',async()=>{try{await refresh();notice('Données Supabase actualisées.');}catch(e){notice(e.message,true)}});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>changeTab(b.dataset.tab)));
$('team-filter').addEventListener('change',e=>{state.teamFilter=e.target.value;renderRoster();});
$('employee-search').addEventListener('input',e=>{state.employeeSearch=e.target.value;renderRoster();});
$('add-team').addEventListener('click',()=>editRecord('team'));
$('add-person').addEventListener('click',()=>editRecord('person'));
$('add-day').addEventListener('click',()=>editRecord('day'));
$('add-recovery').addEventListener('click',()=>editRecord('recovery'));
$('export-people').addEventListener('click',exportPeople);
$('settings-form').addEventListener('submit',saveSettings);
$('editor-form').addEventListener('submit',saveRecord);
$('editor-close').addEventListener('click',()=>$('editor').close());
$('back-to-roster').addEventListener('click',()=>{state.current=null;state.choice=null;$('workspace').classList.remove('hidden');$('planning').classList.add('hidden');renderRoster();});
$('event-partial').addEventListener('change',e=>{const candidate=structuredClone(state.choice);candidate.eventPartialMinutes=Number(e.target.value);applyGuardedChoice(candidate);});
$('save-planning').addEventListener('click',savePlanning);
$('lock-planning').addEventListener('click',toggleLock);
$('print-planning').addEventListener('click',()=>{
 if(!state.current)return;
 const sub=submissionFor(state.current.id);
 const useDraft=!sub||state.dirty||Number(sub.revision)!==Number(state.revision.revision)||evaluate(configData(),state.choice,state.current).errors.length>0;
 openPDF(state.current.id,useDraft?state.choice:null);
});
(async()=>{
 if(!db){fail('Renseignez config.js avec l’URL Supabase et la clé publique, puis actualisez cette page.');return;}
 authScreen();
 await loadPublicLogins();
 const {data:{session}}=await db.auth.getSession();
 if(session){$('logout').classList.remove('hidden');await enter();}
})();



})();
