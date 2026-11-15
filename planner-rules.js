/** Règles partagées : contrôles affichés dans le navigateur ET appliqués sur Supabase Edge. */
const minute = (s) => s === '' || s == null ? null : /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s).slice(0,5)) ? Number(String(s).slice(0,2))*60+Number(String(s).slice(3,5)) : NaN;
const clock = (n) => `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;
const formatMinutes = (n) => `${Math.floor(n/60)} h ${String(n%60).padStart(2,'0')}`;
const range = (a,b,step=30) => { a=minute(a);b=minute(b);if(!Number.isFinite(a)||!Number.isFinite(b)||step<1||b<a)return [];const r=[];for(let i=a;i<=b;i+=step)r.push(clock(i));return r;};
const isoWeek = (s) => {const d=new Date(`${s}T00:00:00Z`); d.setUTCDate(d.getUTCDate()+4-(d.getUTCDay()||7));const y=d.getUTCFullYear();const start=Date.UTC(y,0,1);return `${y}-S${String(Math.ceil(((d.getTime()-start)/86400000+1)/7)).padStart(2,'0')}`;};
const dateMinutes = (s) => Date.parse(`${s}T00:00:00Z`)/60000;
const defaults = (d) => ({morningStart:d.default_morning_start||'',morningEnd:d.default_morning_end||'',afternoonStart:d.default_afternoon_start||'',afternoonEnd:d.default_afternoon_end||''});
const getRow = (day,selection) => ({...defaults(day),...(selection?.hours?.[day.date]||{})});
const initialChoice = (data) => ({dayOff:'',inauguration:'none',eventPartialMinutes:Math.max(data.settings.event_partial_min_minutes,30),hours:{},recovery:{}});
// Le mercredi 25 novembre (inauguration), la plage d'après-midi se termine à 18 h,
// même si un ancien enregistrement local contient encore 22 h.
// Le lundi 30 novembre est saisi et controle comme toute journee travaillee,
// mais exclu des plafonds et des droits a recuperation.
const NON_COUNTED_DATES = new Set(['2026-11-30']);
const excludedFromCalculation = d => NON_COUNTED_DATES.has(d.date);
const WEDNESDAY_DATE='2026-11-25';
const WEDNESDAY_CUTOFF=18*60;
const afternoonEndLimit=d=>d.date===WEDNESDAY_DATE ? Math.min(minute(d.afternoon_max),WEDNESDAY_CUTOFF) : minute(d.afternoon_max);
const afternoonEndClock=d=>clock(afternoonEndLimit(d));
const validPair=(a,b,min,max,step)=>{if(a===null&&b===null)return true;return Number.isFinite(a)&&Number.isFinite(b)&&a!==null&&b!==null&&a>=min&&b<=max&&a<b&&(a-min)%step===0&&(b-min)%step===0;};
// Fiches à 60 h : directeurs de pôle (Rachel GODEFROY exclue) et Sophie CASTELNEAU.
// Détection à partir de la désignation du directeur dans l'annuaire ADMIN.
function profileFor(data,employee) {
 const team=(data.teams||[]).find(t=>t.id===employee?.team_id);
 const director=!!team && employee?.id!=='com-godefroy-rachel' && team.manager_employee_id===employee?.id &&
   /^direct(eur|rice)/i.test(String(team.manager_title||''));
 const castelneau=employee?.id==='pub-castelneau-sophie';
 const special=director||castelneau;
 const maxMinutes=special?Number(data.settings.director_max_minutes||3600):Math.min(data.settings.max_week_minutes,data.settings.max_period_minutes);
 return {kind:castelneau?'castelneau':director?'director':'standard',special,maxMinutes};
}
function specialEntitlement(minutes,settings) {
 const cuts=[Number(settings.director_tier_1_minutes??2310),Number(settings.director_tier_2_minutes??2640),
   Number(settings.director_tier_3_minutes??2880),Number(settings.director_tier_4_minutes??3120)];
 return minutes>cuts[3]?2.5:minutes>cuts[2]?2:minutes>cuts[1]?1.5:minutes>cuts[0]?1:0;
}
function evaluate(data,choice,employee=null) {
 const s=data.settings, days=[...(data.days||[])].filter(d=>d.active!==false).sort((a,b)=>a.date.localeCompare(b.date));
 const rec=[...(data.recoveries||[])].filter(r=>r.active!==false).sort((a,b)=>a.date.localeCompare(b.date));
 const errors=[], rows=[], weekly={}, step=s.slot_step_minutes||30, profile=profileFor(data,employee);
 const add=(code,message)=>errors.push({code,message});
 if(!choice||typeof choice!=='object'||Array.isArray(choice))return {rows,errors:[{code:'selection',message:'Choix manquants.'}],summary:{totalMinutes:0,eligible:false,weekly:{}}};
 const eligibleOff=days.filter(d=>d.can_be_off && (!Array.isArray(employee?.allowed_days_off)||employee.allowed_days_off.includes(d.date)));
 if(!choice.dayOff)add('dayOff','Choisissez un jour non travaillé.');
 else if(!eligibleOff.some(d=>d.date===choice.dayOff))add('dayOff','Jour non travaillé non autorisé.');
 if(!['none','partial','full'].includes(choice.inauguration))add('event','Participation à l’inauguration invalide.');
 let eventMinutes=choice.inauguration==='full'?s.event_full_minutes:choice.inauguration==='partial'?Number(choice.eventPartialMinutes):0;
 if(choice.inauguration==='partial'&&(!Number.isInteger(eventMinutes)||eventMinutes<s.event_partial_min_minutes||eventMinutes>s.event_partial_max_minutes||(eventMinutes-s.event_partial_min_minutes)%step!==0))add('event','Durée réduite de l’inauguration invalide.');
 if(choice.dayOff===s.event_date&&eventMinutes)add('event','Inauguration impossible durant le jour non travaillé.');
 if(eventMinutes>0&&!days.some(d=>d.date===s.event_date))add('event','La date de l’inauguration ne fait pas partie des journées actives.');
 if(choice.hours && (typeof choice.hours!=='object'||Array.isArray(choice.hours)||Object.keys(choice.hours).some(k=>!days.some(d=>d.date===k))))add('hours','Horaires sur une date inconnue.');
 let previousEnd=null,previousDay='',totalMinutes=0,excludedMinutes=0;
 for(const d of days){
   const off=d.date===choice.dayOff; const t=getRow(d,choice);let total=0, event=0;const intervals=[];
   for(const [start,end,lo,hi,label] of [
    ['morningStart','morningEnd','morning_min','morning_max','matin'],
    ['afternoonStart','afternoonEnd','afternoon_min','afternoon_max','après-midi']]) {
     const a=off?null:minute(t[start]),b=off?null:minute(t[end]);
     const min=minute(d[lo]),max=label==='après-midi'?afternoonEndLimit(d):minute(d[hi]);
     if(label==='après-midi' && d.date===WEDNESDAY_DATE &&
        (a!==null&&Number.isFinite(a)&&a>WEDNESDAY_CUTOFF || b!==null&&Number.isFinite(b)&&b>WEDNESDAY_CUTOFF)){
       add('hours',`${d.date} : l'après-midi du mercredi se termine au plus tard à 18:00 (inauguration).`);
       continue;
     }
     if(!validPair(a,b,min,max,step)){add('hours',`${d.date} : créneau du ${label} invalide (plage ou pas de ${step} min).`);continue;}
     if(a!==null){intervals.push([a,b]);total+=b-a;}
   }
   // IMPORTANT : les plages 06:00–15:00 et 12:00–22:00 se chevauchent.
   // Il faut distinguer explicitement les créneaux « matin » / « après-midi » :
   // chercher les intervalles uniquement par leurs bornes créerait un faux doublon.
   const morningEnd=off?null:minute(t.morningEnd);
   const afternoonStart=off?null:minute(t.afternoonStart);
   if(morningEnd!==null && afternoonStart!==null &&
      Number.isFinite(morningEnd) && Number.isFinite(afternoonStart) &&
      afternoonStart-morningEnd<s.break_min_minutes)
     add('break',`${d.date} : pause méridienne de ${formatMinutes(s.break_min_minutes)} minimum.`);
   if(d.date===s.event_date&&!off&&eventMinutes>0){
     const start=minute(s.event_start),end=start+eventMinutes;
     if(!Number.isFinite(start)||end>1440)add('event','Horaire d’inauguration invalide.');
     else if(intervals.some(([a,b])=>a<end&&b>start))add('event',`${d.date} : inauguration et horaires de travail se chevauchent.`);
     else {event=eventMinutes;intervals.push([start,end]);}
   }
   intervals.sort((a,b)=>a[0]-b[0]);
   if(intervals.length){
     const first=dateMinutes(d.date)+intervals[0][0];
     if(previousEnd!==null && first-previousEnd<s.rest_min_minutes)add('rest',`Repos insuffisant entre ${previousDay} et ${d.date} (minimum ${formatMinutes(s.rest_min_minutes)}).`);
     previousEnd=dateMinutes(d.date)+intervals.at(-1)[1];previousDay=d.date;
   }
   total+=event;
   // Les horaires demeurent controles (plages, pause et repos), affiches et sauvegardes.
   // Seul leur impact sur les totaux et recuperations est neutralise.
   const excluded=excludedFromCalculation(d);
   if(excluded)excludedMinutes+=total;
   else {
     totalMinutes+=total;
     const week=isoWeek(d.date);weekly[week]=(weekly[week]||0)+total;
   }
   rows.push({...d,...t,off,eventMinutes:event,totalMinutes:total,
     countedMinutes:excluded?0:total,excludedFromCalculation:excluded});
 }
 for(const [week,n] of Object.entries(weekly))if(n>(profile.special?profile.maxMinutes:s.max_week_minutes))add('limit',`${week} : dépassement du maximum hebdomadaire de ${formatMinutes(profile.special?profile.maxMinutes:s.max_week_minutes)}.`);
 if(totalMinutes>(profile.special?profile.maxMinutes:s.max_period_minutes))add('limit',`Total supérieur à ${formatMinutes(profile.special?profile.maxMinutes:s.max_period_minutes)} autorisées.`);
 const earnedDays=profile.special?specialEntitlement(totalMinutes,s):null;
 const eligible=profile.special?earnedDays>1:totalMinutes>=s.recovery_threshold_minutes;
 const allowedExtra=profile.special?Math.max(0,Math.round((earnedDays-1)*2)):1;
 const selected=[];
 for(const r of rec){
  const mode=choice.recovery?.[r.date]||'none';
  if(r.mandatory){if(mode!=='none'&&mode!=='full')add('recovery',`Récupération fixe incorrecte le ${r.date}.`);}
  else if(mode!=='none'){
   if(!['morning','afternoon',...(profile.special?['full']:[])].includes(mode))add('recovery',`Choix de récupération incorrect le ${r.date}.`);
   else selected.push({date:r.date,mode});
  }
 }
 if(choice.recovery && Object.keys(choice.recovery).some(k=>!rec.some(r=>r.date===k)))add('recovery','Date de récupération inconnue.');
 // Une journée entière équivaut à deux demi-journées. Les trois dates
 // supplémentaires peuvent combiner journée entière et demi-journée.
 const selectedUnits=selected.reduce((sum,p)=>sum+(p.mode==='full'?2:1),0);
 if(selectedUnits>allowedExtra)add('recovery',`Maximum ${allowedExtra} demi-journée(s) supplémentaire(s) pour ce total.`);
 if(profile.special){
   // La récupération fixe du 1er décembre est conservée. Les droits des
   // directeurs et de Sophie doivent être intégralement distribués à 0,5 j près.
   if(selectedUnits<allowedExtra)add('recovery',`Sélectionnez ${allowedExtra} demi-journée(s) supplémentaire(s) (journée entière possible) selon le palier de ${formatMinutes(totalMinutes)}.`);
 } else if(selectedUnits&&!eligible)add('recovery',`Demi-journée accessible à partir de ${formatMinutes(s.recovery_threshold_minutes)}.`);
 return {rows,errors,summary:{totalMinutes,excludedMinutes,weekly,eligible,recovery:selected[0]||null,recoverySelections:selected,
    selectedExtraHalfDays:selectedUnits,allowedExtraHalfDays:allowedExtra,earnedRecoveryDays:earnedDays,profile:profile.kind,limitMinutes:profile.special?profile.maxMinutes:s.max_period_minutes,
    referenceMinutes:s.reference_minutes}};
}

window.SLPJ_RULES = {minute, clock, formatMinutes, range, isoWeek, defaults, getRow, initialChoice, evaluate, profileFor, specialEntitlement, afternoonEndLimit, afternoonEndClock};
