'use strict';
const assert=require('node:assert/strict');
const M=require('../frontend/app/worldmodel.js');
const legacySprites=require('../frontend/app/propsprites.js');
const remasterContext={module:{exports:{}},IndustrialTextures:{enabled:()=>true,ready:{then:fn=>fn()}}};
require('node:vm').runInNewContext(require('node:fs').readFileSync(require.resolve('../frontend/app/propsprites.js'),'utf8'),remasterContext);
const T=require('../frontend/app/stationtemplates.js');
const approved=require('./fixtures/station-default-approved.json');
assert.equal(T.catalog.length,7); // five work presets (each with a ready line) and two look-only presets
assert.deepEqual(T.catalog.filter(c=>c.group==='work').map(c=>c.purpose).sort(),['code','general','ops','research','write'],'one work preset per onboarding purpose');
for(const P of [legacySprites,remasterContext.module.exports])for(const item of T.catalog) {
  const doc=T.build(item.id,M,P,1000),s=M.create(doc);
  assert.equal(s.rooms().filter(r=>r.kind!=='corridor').length,item.rooms);
  const home=doc.rooms[doc.meta.spawnRoomId];
  for(const [key,value] of Object.entries(approved.room))assert.deepEqual(home[key],value,item.id+': approved home '+key);
  assert.deepEqual(doc.props.filter(p=>p.x>=0&&p.x<=17&&p.y>=0&&p.y<=10).map(({t,x,y,w,h})=>({t,x,y,w,h})),approved.props,item.id+': approved home furniture');
  for(const t of P.STARTER)assert.equal(doc.props.filter(p=>p.t===t).length,1);
  const validate=M.create({...structuredClone(doc),props:[]});
  for(const p of doc.props){
    assert.equal(validate.addProp(p).ok,true,p.t+' placement');
    // Preserve the approved existing desk; newly added desks use the active art's width.
    if(p.x<0||p.x>17||p.y<0||p.y>10)assert.equal(p.w,P.spec(p.t).w);
  }
  const g=s.projectGeometry();
  const pipeline=require('../frontend/app/pipeline.js'),WL=require('../frontend/app/workflowline.js');
  const copy=T.guides[item.id];
  assert.equal(!!copy,item.group==='work',item.id+': every work preset, and only a work preset, has a setup guide');
  if(item.group==='look') assert.equal(T.example(doc,M,pipeline,WL),null,item.id+': a look preset has no guide');
  if(item.group==='work') {
    const untouched=JSON.stringify(doc);
    const guide=T.example(doc,M,pipeline,WL);
    assert.equal(JSON.stringify(doc),untouched,item.id+': guide inspection never assigns agents or changes the input document');
    assert.equal(guide.ready,false,item.id+': a fresh preset is not ready before anyone works it');
    assert.match(guide.issue,/^Choose an agent for /,item.id+': the first thing to fix is staffing');
    const bays=s.props().filter(p=>p.t==='bay');
    assert.equal(guide.roles.length,bays.length,item.id+': one guide step per Bay');
    assert.deepEqual(guide.roles.map(r=>r.agentId),bays.map(()=>''),item.id+': a preset hires no one');
    for(const r of guide.roles) assert.equal(r.name,copy.roles[r.role].name,item.id+': every step is named from its role');
    for(const b of bays) {
      assert.ok(b.role,item.id+': every preset Bay carries its shelf role, so RECRUIT offers the right specialist');
      assert.ok(b.brief&&b.brief.length>60,item.id+': every step has written instructions');
    }
    assert.ok(s.props().find(p=>p.t==='intake'&&p.label===copy.label),item.id+': the guided line is named on its Inbox');
    assert.match(guide.sample,/^SAMPLE JOB: /);
    assert.ok(pipeline.compileRoutingPlan(g).errors.every(e=>e.code==='UNBOUND_BAY'),item.id+': only agent assignment remains');
    // ONE agent can work every step (multi-bay routing): with a workstation of its own the whole line is ready
    const one=M.create(structuredClone(doc));
    assert.equal(one.ensureWorkstation('solo').ok,true);
    for(const r of guide.roles) assert.equal(one.assignPropAgent(r.propId,'solo').ok,true);
    assert.equal(T.example(one.serialize(),M,pipeline,WL).ready,true,item.id+': one agent with a workstation runs the whole line');
    // several agents with no workstation of their own share no computer: not ready, in the Workflow panel's words
    const many=M.create(structuredClone(doc));
    guide.roles.forEach((r,i)=>assert.equal(many.assignPropAgent(r.propId,item.id+i).ok,true));
    if(guide.roles.length>1) {
      const nodesk=T.example(many.serialize(),M,pipeline,WL);
      assert.equal(nodesk.ready,false,item.id+': agents without their own workstation are not ready');
      assert.match(nodesk.issue,/needs a workstation/);
    }
    guide.roles.forEach((r,i)=>assert.equal(many.ensureWorkstation(item.id+i).ok,true));
    const staffed=T.example(many.serialize(),M,pipeline,WL);
    assert.equal(staffed.ready,true,item.id+': staffed with workstations, the line is ready');
    assert.equal(staffed.issue,'');
    assert.deepEqual(staffed.roles.map(r=>r.agentId),guide.roles.map((r,i)=>item.id+i));
    const geo=many.projectGeometry(),plan=pipeline.compileRoutingPlan(geo);
    assert.deepEqual(plan.errors,[],item.id+': the staffed line compiles cleanly');
    const comp=pipeline.lineComponents(geo).find(c=>c.key===staffed.key),flow=WL.lineFlow(plan,comp,pipeline,geo.props);
    assert.equal(flow.outbox.reached,true,item.id+': the line reaches its Outbox');
    assert.deepEqual(flow.order,staffed.roles.map(r=>r.propId),item.id+': guide steps are the Workflow panel\'s run order');
    const reordered=structuredClone(many.serialize()); reordered.props.reverse();
    assert.deepEqual(T.example(reordered,M,pipeline,WL).roles.map(r=>r.propId),staffed.roles.map(r=>r.propId),item.id+': step order follows the belts, not the saved array order');
    // cut the belt out of the Inbox: never ready
    const broken=M.create(structuredClone(many.serialize())),inbox=broken.props().find(p=>p.t==='intake'&&p.label===copy.label);
    assert.equal(broken.removeBelt(inbox.x+2,inbox.y+1).ok,true,item.id+': the Inbox belt exists where the shelf line lays it');
    assert.equal(T.example(broken.serialize(),M,pipeline,WL).ready,false,item.id+': a cut conveyor never reads ready');
    const loops=flow.gates.filter(x=>x.kind==='loop');
    if(item.id==='software'||item.id==='creative') {
      assert.equal(loops.length,1,item.id+': one review loop');
      assert.equal(loops[0].when,'approved'); assert.equal(loops[0].max,3);
      assert.equal(loops[0].backTo,staffed.roles[0].propId,item.id+': a failed check goes back to the first step');
      assert.match(many.propById(staffed.roles[1].propId).brief,/VERDICT: (pass|approved)/,item.id+': the checking step ends with the verdict the gate reads');
    } else assert.equal(loops.length,0,item.id+': no loop');
    if(item.id==='software') {
      assert.deepEqual(staffed.roles.map(r=>r.role),['ENGINEER','TESTER']);
      assert.match(guide.sample,/slugify\(title\)/);
      assert.match(many.propById(staffed.roles[0].propId).brief,/^Build what the incoming request asks for/);
    }
    if(item.id==='creative') {
      assert.deepEqual(staffed.roles.map(r=>r.role),['WRITER','REVIEWER']);
      assert.match(guide.sample,/fictional community garden/);
      assert.match(many.propById(staffed.roles[0].propId).brief,/^Draft a response/);
      assert.match(many.propById(staffed.roles[1].propId).brief,/^Review the incoming draft/);
    }
    if(item.id==='research') assert.deepEqual(staffed.roles.map(r=>r.role),['RESEARCHER','WRITER']);
    if(item.id==='operations') {
      assert.deepEqual(staffed.roles.map(r=>r.role).sort(),['ENGINEER','GENERALIST','RESEARCHER']);
      const filter=many.props().find(p=>p.t==='filter');
      assert.deepEqual(filter.routes,{code:'N',research:'S'},'operations: the sorter reads code and research lanes');
    }
    if(item.id==='cozy') {
      assert.equal(s.belts().length,6,'cozy: both conveyor runs are installed');
      const lim=s.props().find(p=>p.t==='intake').limits;
      assert.deepEqual([lim.maxUsdPerDay,lim.maxUsdPerMessage],[5,1],'cozy: the front desk carries its $5-a-day cap');
      assert.equal(Object.keys(pipeline.liveTiles(plan)).length,6,'cozy: both runs energized');
    }
  }
  // Every room is reachable from the central room through the real projected graph.
  const origin=[8-g.origin.tx,5-g.origin.ty];
  for(const r of s.rooms().filter(r=>r.kind!=='corridor')){
    const rect=r.rects[0],x=Math.floor((rect.x1+rect.x2)/2)-g.origin.tx,y=Math.floor((rect.y1+rect.y2)/2)-g.origin.ty;
    assert.equal(rect.x2-rect.x1+1,18,item.id+': normal room width');
    assert.equal(rect.y2-rect.y1+1,11,item.id+': normal room depth');
    assert.ok(g.path(origin[0],origin[1],x,y),item.id+': reachable '+r.name);
    // A path around furniture is insufficient: added rooms need clear entrances.
    if(r.id!==doc.meta.spawnRoomId)for(const hall of s.rooms().filter(h=>h.kind==='corridor'))for(const h of hall.rects){
      let landing=null;
      const overlapX=h.x1<=rect.x2&&h.x2>=rect.x1,overlapY=h.y1<=rect.y2&&h.y2>=rect.y1;
      if(overlapX&&h.y2===rect.y1-1)landing={x1:Math.max(h.x1,rect.x1),x2:Math.min(h.x2,rect.x2),y1:rect.y1,y2:rect.y1+2};
      if(overlapX&&h.y1===rect.y2+1)landing={x1:Math.max(h.x1,rect.x1),x2:Math.min(h.x2,rect.x2),y1:rect.y2-2,y2:rect.y2};
      if(overlapY&&h.x2===rect.x1-1)landing={x1:rect.x1,x2:rect.x1+2,y1:Math.max(h.y1,rect.y1),y2:Math.min(h.y2,rect.y2)};
      if(overlapY&&h.x1===rect.x2+1)landing={x1:rect.x2-2,x2:rect.x2,y1:Math.max(h.y1,rect.y1),y2:Math.min(h.y2,rect.y2)};
      if(landing)for(const p of doc.props)assert.ok(!M.rectsHit(landing,{x1:p.x,y1:p.y,x2:p.x+p.w-1,y2:p.y+p.h-1}),item.id+': '+p.t+' clear of '+r.name+' doorway');
    }
  }
  // Floor decals are walkable; they do not have a furniture interaction edge.
  for(const p of doc.props.filter(p=>!P.spec(p.t).flat))assert.ok(g.path(origin[0],origin[1],p.x-g.origin.tx,p.y+p.h-g.origin.ty),item.id+': reachable front of '+p.t);
  const current=M.create(M.starterDoc());current.ensureWorkstation('agent');current.ensureWorkstation('crew');
  const before=current.serialize(),identity=before.meta.createdAt;
  assert.equal(current.replaceLayout(doc).ok,true);
  assert.equal(current.doc().meta.createdAt,identity);
  for(const id of ['agent','crew'])assert.equal(current.props().filter(p=>p.agentId===id).length,1);
  assert.equal(current.undo().ok,true);assert.deepEqual(current.serialize(),before);
  assert.equal(current.redo().ok,true);
  const restored=M.deserialize(current.serialize());
  assert.deepEqual(restored.serialize(),current.serialize());
  const invalid=structuredClone(doc);invalid.props[0].x=999;
  const snapshot=current.serialize();assert.equal(current.replaceLayout(invalid).ok,false);assert.deepEqual(current.serialize(),snapshot);
}
// the onboarding station pick: the five purpose chips map one to one onto the five work presets; nothing clear → no guess
for(const [said,id] of [['Help me write, debug, and ship software.','software'],['Research hard questions and brief me clearly.','research'],['Run tasks, ops, and the day-to-day work.','operations'],['Write and edit sharp content.','creative'],['Be my general-purpose lead across whatever comes up.','cozy'],['I want to write code for my app','software'],['plan my garden',null],['',null],[null,null]])
  assert.equal(T.recommend(said),id,'recommend('+JSON.stringify(said)+')');
for(const c of T.catalog.filter(c=>c.group==='work')) assert.ok(c.pitch&&c.pitch.length>20,c.id+': a one-line pitch for the onboarding pick');
// THE SETUP PATH (sweep 2026-09-29): the guide knows its Inbox; each work preset names its purpose in onboarding's words;
// WORKFLOWS opens the guide while a step is unstaffed; the Inbox button opens that Inbox in the Workflow panel; a recruit
// for a borrowed-class step is named for the step; the onboarding pick speaks the same words and points at WORKFLOWS
{
  const P=legacySprites,pipeline=require('../frontend/app/pipeline.js'),WL=require('../frontend/app/workflowline.js'),fs=require('node:fs'),path=require('node:path');
  const doc=T.build('software',M,P,1000),g=T.example(doc,M,pipeline,WL);
  assert.equal(g.inboxId,doc.props.find(p=>p.t==='intake'&&p.label===T.guides.software.label).id,'the guide carries its line\'s Inbox');
  assert.deepEqual(T.catalog.filter(c=>c.group==='work').map(c=>c.purposeLabel),['Code & build','Research & brief','Write & edit','Run tasks & ops','A bit of everything'],'work presets name their purpose in the onboarding question\'s words');
  assert.equal(M.bayRoleInfo('TESTER').name,'TESTER','a Tester recruit is named for its step');
  const build=fs.readFileSync(path.join(__dirname,'..','frontend','app','build.js'),'utf8'),onb=fs.readFileSync(path.join(__dirname,'..','frontend','app','onboarding.js'),'utf8'),ob=fs.readFileSync(path.join(__dirname,'..','frontend','app','onboarding.js'),'utf8');
  const ow=build.slice(build.indexOf('function openWorkflows()'),build.indexOf('function openWorkflows()')+1400);
  assert.match(ow,/ex\.roles\.some\(r => !r\.agentId\)\) \{ openPresetExample\(\); return; \}/,'WORKFLOWS opens the setup guide while a preset step is unstaffed');
  assert.match(build,/if \(ri && ri\.name\) spec\.agentName = ri\.name;/,'summonForRole names a borrowed-class recruit for its step');
  assert.match(build,/inboxBtn\.onclick = \(\) => \{ closeP\(\); try \{ rebake\(\); openFlowCard\(e\.inboxId\); \}/,'the guide\'s Inbox button opens that Inbox in the Workflow panel');
  assert.match(onb,/c\.purposeLabel \? ' — ' \+ c\.purposeLabel/,'the station question labels each choice with its purpose');
  assert.match(ob,/WORK › WORKFLOWS walks you through who works each step/,'the pick\'s closing line points at WORKFLOWS');
  assert.match(build,/querySelector\('\.refit-firstrun, \.refit-preset-example, \.refit-station-builds'\)\)\) fireFirstRide\(\)/,'the first ride never narrates over the presets dialog or the setup guide (one voice)');
}
console.log('station-templates: seven layouts (five work presets with a ready line each, two looks), classic/remastered catalogs, approved home, one-agent and per-agent staffing, purpose-chip recommendations, belt-order steps, loop gates, the setup path, clear entrances, prop access, ownership, undo/redo and persistence PASS');
