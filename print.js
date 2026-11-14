/* SLPJ : édition PDF depuis une session Supabase. */
(()=>{
'use strict';
const {formatMinutes}=window.SLPJ_RULES;
const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateFR=s=>s?new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(`${s}T12:00:00Z`)):'—';
const cfg=window.SLPJ_CONFIG||{};
const db=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY);
// L'aperçu reçoit son rapport de l'onglet principal. Il n'a pas besoin de
// rouvrir une session, ce qui fonctionne même avec deux fichiers file://.
function showReport(data){
 if(!data.preview && (data.stale||data.errors?.length)){
  $('paper').innerHTML=`<div class="error"><strong>Impression bloquée.</strong> Les règles ont changé ou la fiche n’est plus conforme : corrigez et réenregistrez le planning avant de générer le PDF. <a href="./">Retour à l’accueil</a></div>`;
  $('print').disabled=true;return;
 }
 render(data);$('print').disabled=false;
}
function showError(message){
 $('paper').innerHTML=`<div class="error">${esc(message)} <a href="./">Retour à l’accueil</a></div>`;
 $('print').disabled=true;
}
async function fallbackReport(id){
 try{
  const {data:{session}}=await db.auth.getSession();
  if(!session)throw new Error('Ouvrez la fiche depuis l’application principale, puis cliquez sur « Aperçu / Imprimer PDF ».');
  const {data,error}=await db.functions.invoke('planning-api',{body:{action:'get_report',employee_id:id}});
  if(error){let reason=error.message;try{reason=(await error.context.json()).error||reason}catch{}throw new Error(reason)}
  showReport(data);
 }catch(e){showError(e.message||String(e))}
}
async function init(){
 const params=new URLSearchParams(location.search);
 const id=params.get('employee'),ticket=params.get('ticket');
 if(!id){showError('Collaborateur non renseigné.');return;}
 if(ticket&&window.opener){
  let complete=false;
  const timer=setTimeout(()=>{
   if(!complete){complete=true;showError('La liaison avec la fiche principale a expiré. Fermez cet aperçu et rouvrez-le depuis le bouton PDF de l’application.');}
  },8000);
  window.addEventListener('message',event=>{
   const msg=event.data;
   if(complete||event.source!==window.opener||event.origin!==location.origin||!msg||msg.type!=='slpj-print-response'||msg.ticket!==ticket)return;
   complete=true;clearTimeout(timer);
   if(msg.error)showError(msg.error);
   else if(msg.report)showReport(msg.report);
   else showError('Réponse PDF incomplète.');
  });
  $('print-subtitle').textContent='Préparation du document depuis la fiche ouverte…';
  try{window.opener.postMessage({type:'slpj-print-ready',ticket},location.origin)}
  catch(e){complete=true;clearTimeout(timer);showError('Impossible de contacter l’application principale : '+e.message)}
  return;
 }
 // Permet encore de consulter un PDF enregistré si la démo est lancée
 // via son mini-serveur (même origine et session conservée).
 await fallbackReport(id);
}
function render(data){const {employee:e,team,submission:sub,settings:s,rows,recoveries,summary,errors,stale,signers,preview=false}=data;
 const ch=sub.selection;
 const total=summary.totalMinutes;
 const picks=summary.recoverySelections||[summary.recovery].filter(Boolean);
 const extraText=picks.length?picks.map(p=>dateFR(p.date)+' · '+(p.mode==='full'?'Journée entière':p.mode==='morning'?'Matinée':'Après-midi')).join(' ; '):'Aucune récupération supplémentaire';
 const dayOff=ch.dayOff?dateFR(ch.dayOff):'Non renseigné';
 const inauguration=ch.inauguration==='full'?'Complète':ch.inauguration==='partial'?`Réduite (${formatMinutes(ch.eventPartialMinutes)})`:'Non';
 const dateNow=new Date().toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});
 const warning=stale||errors?.length?`<div class="paper-warning"><strong>Contrôle requis :</strong> ${stale?'les règles ont été modifiées depuis l’enregistrement. ':''}${esc((errors||[]).map(x=>x.message).join(' · '))}</div>`:'';
 const draftBanner=preview?'<div class="paper-draft-banner"><strong>APERÇU POUR VALIDATION DU FORMAT — BROUILLON NON ENREGISTRÉ</strong><span>Document de démonstration, ne vaut pas validation des horaires ni des signatures.</span></div>':'';
 $('print-subtitle').textContent=preview?'Aperçu d’un brouillon · possibilité d’imprimer ou enregistrer en PDF':'Fiche enregistrée · possibilité d’imprimer ou enregistrer en PDF';
 $('paper').innerHTML=`${draftBanner}<div class="paper-header"><div><div class="eyebrow">DOCUMENT DE CONTRÔLE ET DE SIGNATURE</div><h1>${esc(s.title)}</h1><p>${esc(s.subtitle)} · Édité le ${esc(dateNow)}</p></div><span class="paper-logo"><img src="./logo-slpj.png" alt="Logo SLPJ"></span></div>
 <section class="paper-section"><h2>Identité du collaborateur</h2><div class="paper-fields"><div><strong>Nom et prénom :</strong> ${esc(e.last_name+' '+e.first_name)}</div><div><strong>Pôle :</strong> ${esc(team.name)}</div><div><strong>Fonction :</strong> ${esc(e.job_title)}</div><div><strong>État :</strong> ${preview?'BROUILLON / non enregistré':sub.locked_at?'Fiche verrouillée':sub.unlocked_at?'Fiche déverrouillée par ADMIN':'Choix enregistrés, non verrouillés'}</div></div></section>
 <section class="paper-section"><h2>Choix du collaborateur</h2><div class="paper-choices"><div class="paper-choice">Jour non travaillé<strong>${esc(dayOff)}</strong></div><div class="paper-choice">Inauguration<strong>${esc(inauguration)}</strong></div><div class="paper-choice">Récupération<strong>${esc(extraText)}</strong></div></div></section>
 <section class="paper-section"><h2>Planning de présence</h2><table class="paper-table"><thead><tr><th>Date</th><th>Matin</th><th>Après-midi</th><th>Inauguration</th><th>Total</th></tr></thead><tbody>${rows.map(r=>`<tr class="${r.off?'offrow':''}"><td>${esc(dateFR(r.date))}</td><td>${r.off?'Jour non travaillé':r.morningStart&&r.morningEnd?esc(r.morningStart+' – '+r.morningEnd):'0 h'}</td><td>${r.off?'—':r.afternoonStart&&r.afternoonEnd?esc(r.afternoonStart+' – '+r.afternoonEnd):'0 h'}</td><td>${r.eventMinutes?formatMinutes(r.eventMinutes):'—'}</td><td><strong>${formatMinutes(r.totalMinutes)}</strong></td></tr>`).join('')}</tbody></table>
 <div class="paper-fields" style="margin-top:8px"><div><strong>Total :</strong> ${formatMinutes(total)}</div><div><strong>Plafond applicable :</strong> ${formatMinutes(summary.limitMinutes||s.max_period_minutes)}${summary.profile!=='standard' ? ' · Récupération : '+String(summary.earnedRecoveryDays).replace('.',',')+' jour(s)' : ''}</div></div></section>
 <section class="paper-section"><h2>Récupérations fixes</h2><p>${recoveries.filter(r=>r.active&&r.mandatory).map(r=>esc(dateFR(r.date))+' : journée entière').join(' · ')||'Aucune'}</p></section>${warning}
 ${!preview&&sub.admin_modified_at?`<div class="paper-meta">Fiche corrigée par Marie PARIS (ADMIN) le ${esc(new Date(sub.admin_modified_at).toLocaleString('fr-FR'))}. Un nouveau contrôle et une nouvelle signature sont nécessaires.</div>`:''}
 <section class="paper-section"><h2>Signatures</h2><div class="signature-grid" style="grid-template-columns:repeat(${signers.length},minmax(0,1fr))">${signers.map(p=>`<div class="signature-box"><strong>${esc(p.title)}</strong><span class="signature-name">${esc(p.name)}</span><div class="signature-line">Date et signature</div></div>`).join('')}</div></section>
 <div class="paper-footer"><strong>Document soumis au contrôle et aux signatures.</strong><br>${preview?'APERÇU NON ENREGISTRÉ — les choix de cette page ne sont pas sauvegardés.':'Fiche générée à partir des données enregistrées dans Supabase.'} · Document à contrôler avant signature.</div>`;
}
$('close').addEventListener('click',()=>window.close());$('print').addEventListener('click',()=>window.print());init();

})();
