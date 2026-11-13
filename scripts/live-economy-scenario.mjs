import assert from 'node:assert/strict';
import { decodeState } from '../server/cloud-state.mjs';
import { applyCommand, profit, inventoryStatementValues } from '../src/engine.mjs';
import { assertEconomicState } from './economic-checks.mjs';

// All decisions and clock advances use the public authenticated API. Admin reads
// below inspect only this synthetic session to independently reconcile its books.
export async function runEconomicScenario({run,students,teacher,endpoint,call,requireOk,checks,db,summary,session,samples}) {
  let sequence=0,previousSnapshots=[];
  const records=[];checks.daily=records;
  async function persisted(){
    return db.runTransaction(async tx=>{
      const ref=db.collection('studioSessions').doc(session.id),metadata=(await tx.get(ref)).data();
      const chunks=await tx.getAll(...Array.from({length:metadata.chunkCount},(_,i)=>ref.collection('stateChunks').doc(String(i))));
      return {state:decodeState(chunks.map(d=>Buffer.from(d.data().data)),metadata),bytes:metadata.bytes,chunks:metadata.chunkCount};
    },{readOnly:true});
  }
  const initial=(await persisted()).state;
  async function act(who,command,phase='decision',duplicate=false){
    const reviewed=requireOk(await call('decision-review',endpoint,who));
    const request={key:`${run}-economic-${++sequence}`,revision:reviewed.state.revision,command};
    const response=requireOk(await call(phase,endpoint+'/command',who,request));
    if(duplicate)assert.deepEqual(requireOk(await call('duplicate-decision',endpoint+'/command',who,request)),response);
    return response;
  }
  // Scale supplier capacity for this 12-team teaching setup; prices, recipes and
  // accepted contracts remain the ordinary model. A shortage is introduced later.
  for(const supplier of initial.catalog.suppliers)await act(teacher,{type:'catalog',collection:'suppliers',id:supplier.id,patch:{stock:supplier.stock*12,replenish:supplier.replenish*12}},'instructor-setup');
  for(const route of initial.catalog.routes)await act(teacher,{type:'catalog',collection:'routes',id:route.id,patch:{term:48,reliability:75}},'instructor-setup');
  for(let team=0;team<12;team++){
    const commands=[
      {type:'offer',offerId:'local-standard',price:25000+team*500,min:1,max:500,delivery:60,payment:72,enabled:true},
      {type:'offer',offerId:'export-standard',price:27000+team*500,min:1,max:500,delivery:96,payment:96,enabled:true},
      {type:'invest',kind:'delivery'},{type:'invest',kind:'purchasing'},
      {type:'reorder',supplierId:'cell-circular',point:9600,qty:9600,enabled:true},
      {type:'reorder',supplierId:'frame-circular',point:300,qty:300,enabled:true},
      {type:'reorder',supplierId:'controller-circular',point:600,qty:600,enabled:true},
      team%2?{type:'loan',plan:'annuity',repaymentAnchor:'request',amount:1000000,weeks:6}:{type:'loan',amount:1000000,term:336},
      {type:'deposit',amount:100000,weeks:1},
      {type:'energy',energyId:team%2?'wind':'solar'}
    ];
    for(let role=0;role<10;role++)await act(students[team+role*12],commands[role],'student-setup',role===8);
  }
  console.log('All 120 students made authenticated setup decisions; advancing 60 simulated days.');
  let last;
  for(let day=1;day<=60;day++){
    for(let team=0;team<12;team++){
      await act(students[team+(day%10)*12],{type:'offer',offerId:`${day%2?'local':'export'}-standard`,price:25000+team*500+(day%7)*100,min:1,max:500,delivery:day%2?60:96,payment:72,enabled:true},'market-offer');
      if(day%7===0)await act(students[team+((day+1)%10)*12],day%14===0?{type:'deposit',amount:100000,weeks:1}:{type:'budget',marketing:team*100+day*10,research:team*50},'weekly-finance');
      if(day===2||day%10===0){
        const who=students[team+((day+2)%10)*12],view=requireOk(await call('dispatch-review',endpoint,who));
        const company=view.state.company,order=company.orders.find(o=>o.remaining>0);
        if(order&&company.inventory.panel.qty>0)await act(who,{type:'dispatch',orderId:order.id,qty:Math.min(5,order.remaining,company.inventory.panel.qty),routeId:team%2?'road':'rail'},'manual-delivery');
      }
    }
    // Exercise an explicit three-day shared-material shortage and recovery.
    if(day===20||day===23){const supplier=initial.catalog.suppliers.find(s=>s.id==='cell-circular');await act(teacher,{type:'catalog',collection:'suppliers',id:supplier.id,patch:day===20?{stock:0,replenish:0}:{stock:supplier.stock*12,replenish:supplier.replenish*12}},'supply-shock');}
    await act(teacher,{type:'step',hours:24},'day-advance');
    last=await persisted();assertEconomicState(last.state,{initial,day});
    assert.deepEqual(last.state.snapshots.slice(0,-1),previousSnapshots,'Closed daily reports changed');previousSnapshots=structuredClone(last.state.snapshots);
    const cs=last.state.companies;
    const row={day,hour:last.state.hour,revision:last.state.revision,compressedBytes:last.bytes,chunks:last.chunks,
      production:cs.reduce((n,c)=>n+c.production,0),orders:cs.reduce((n,c)=>n+c.orders.length,0),
      shipments:cs.reduce((n,c)=>n+c.shipments.length,0),receivedUnits:cs.reduce((n,c)=>n+c.received,0),
      paidShipments:cs.reduce((n,c)=>n+c.shipments.filter(x=>x.paidAt!==null).length,0),
      cashCents:cs.reduce((n,c)=>n+(c.accounts.cash||0),0),profitCents:cs.reduce((n,c)=>n+profit(c),0)};
    records.push(row);console.log(JSON.stringify(row));
    if([1,15,30,45,59].includes(day)){
      const phase=`day-${day}-120-views`;
      const views=await Promise.all(students.map(s=>call(phase,endpoint,s)));
      for(let i=0;i<120;i++){
        const view=requireOk(views[i]).state,c=last.state.companies[i%12];
        assert.equal(view.company.id,c.id);assert.deepEqual(view.company.accounts,c.accounts);
        assert.equal(view.company.profit,profit(c));assert.deepEqual(view.snapshots,last.state.snapshots);
        assert.ok(view.companies.every(x=>!Object.hasOwn(x,'cash')));
      }
      const result=summary(phase);assert.ok(result.max<15000,`${phase} exceeds browser's15s request timeout: ${result.max}ms`);
    }
  }
  assert.equal(last.state.status,'completed');assert.equal(last.state.hour,1440);
  assert.equal(new Set(last.state.audit.filter(a=>a.role==='student').map(a=>a.actorId)).size,120);
  for(const c of last.state.companies){
    assert.ok(c.production>0&&c.received>0&&c.shipments.some(s=>s.paidAt!==null));
    assert.ok(c.purchases.some(p=>p.receivedAt!==null&&p.paidAt!==null));
    assert.ok(c.loans.every(l=>l.paidAt!==null));assert.ok(c.deposits.some(d=>d.maturedAt!==null));
    // The final week's deposits intentionally extend beyond the session: they
    // must remain assets/forecast obligations, never be silently written off.
    assert.ok(c.deposits.filter(d=>d.maturedAt===null).every(d=>d.placedAt+d.term>last.state.hour));
    const view=requireOk(await call('final-financial-report',endpoint+`?company=${c.id}`,teacher)).state;
    assert.equal(view.company.profit,profit(c));assert.deepEqual(view.company.accounts,c.accounts);
    const {purchases,inventoryChange}=inventoryStatementValues(view.company);assert.equal(purchases-inventoryChange,c.accounts.cogs||0);
  }
  assert.equal((await call('completed-student-access',endpoint,students[0])).status,403);
  const replay=requireOk(await call('full-economic-replay',endpoint+'/replay',teacher));
  const reconstructed=structuredClone(replay.initial);
  for(const record of replay.commands)applyCommand(reconstructed,record.actor,record.command,record.realAt,{replay:true});
  // JSON persistence normalizes negative zero; compare the persisted contract.
  assert.deepEqual(JSON.parse(JSON.stringify(reconstructed)),last.state,'Production replay must exactly reproduce every account, event and report');
  const receipts=await db.collection('studioRequests').where('sessionId','==',session.id).get();
  assert.equal(receipts.docs.length,sequence,'Duplicate submissions must never create extra receipts');
  checks.economy={days:60,students:120,teams:12,acceptedDecisions:sequence,replayExact:true,allDailyReportsReconciled:true,allLoansRepaid:true,pendingDeposits:last.state.companies.reduce((n,c)=>n+c.deposits.filter(d=>d.maturedAt===null).length,0),final:records.at(-1)};
  checks.unexpectedFailures=samples.filter(s=>s.status===0||(s.status>=400&&!(s.phase==='completed-student-access'&&s.status===403))).length;
  assert.equal(checks.unexpectedFailures,0);
  checks.browserDeadlineOverruns=samples.filter(s=>s.ms>=15000).length;
  assert.equal(checks.browserDeadlineOverruns,0,'Every ordinary API request must finish within the browser deadline');
}
