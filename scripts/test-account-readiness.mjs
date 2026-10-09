import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const files = ['hooks/useAuth','components/AuthReadinessGate','components/PasswordSetupGate','components/MaintenanceGate'];
const source = Object.fromEntries(await Promise.all(files.map(async name => [name, await readFile(new URL('../src/'+name+'.tsx',import.meta.url),'utf8')])));
const jsx = (type,props) => ({type,props});
function run(name,imports) {
  const exports={};
  const code=ts.transpileModule(source[name],{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(code,{exports,require(key){if(key==='react/jsx-runtime')return {jsx,jsxs:jsx,Fragment:'fragment'};assert.ok(key in imports,key);return imports[key];},console:{error(){},warn(){}}});return exports;
}
function hooks() {
  const slots=[];let cursor=0;const effects=[];
  return {reset(){cursor=0;effects.length=0;},effects,api:{
    useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useCallback:fn=>fn,useMemo:fn=>fn(),useEffect:fn=>effects.push(fn),createContext:()=>({Provider:'Provider'}),useContext(){throw Error('Unexpected context');}
  }};
}
const uiImports={'lucide-react':{Loader2:'Spinner'},'@/components/ui/button':{Button:'Button'},'@/hooks/useTranslation':{useTranslation:()=>({t:key=>key})}};
function descendants(tree) {if(!tree||typeof tree!=='object')return [];return [tree,...[tree.props?.children].flat(Infinity).flatMap(descendants)];}
function renderGate(auth) {return run('components/AuthReadinessGate',{...uiImports,'@/hooks/useAuth':{useAuth:()=>auth}}).AuthReadinessGate({children:'protected-content'});}
test('an unproved profile keeps content closed and retries the read without claiming password setup',async()=>{
  const h=hooks();let outcome='timeout',reads=0;
  const e=run('hooks/useAuth',{react:h.api,'@/integrations/supabase/client':{supabase:{}},'@/lib/auth-backend':{isBetterAuthEnabled:()=>true,betterAuthClient:{getSession:async()=>({user:{id:'synthetic-user',emailVerified:true}})}},'@/lib/profile-api':{loadOwnProfile:async()=>{reads++;if(outcome==='timeout')throw Error('timeout');return {user_id:outcome==='mismatch'?'other':'synthetic-user',requires_password_setup:outcome==='oauth'};}}});
  const context=()=>{h.reset();return e.AuthProvider({children:null}).props.value;};
  assert.equal(await context().refreshSession(),false);let auth=context();assert.equal(auth.profileGateError,true);assert.equal(auth.loading,false);
  const tree=renderGate(auth);assert.ok(descendants(tree).some(x=>x.props?.role==='alert'));assert.ok(!descendants(tree).some(x=>x.props?.children==='protected-content'));
  const navigation=[];const gateHooks=hooks();
  run('components/PasswordSetupGate',{react:gateHooks.api,'@/hooks/useAuth':{useAuth:()=>auth},'react-router-dom':{useNavigate:()=> (...args)=>navigation.push(args),useLocation:()=>({pathname:'/plans',search:'?checkout=success'})}}).PasswordSetupGate();gateHooks.effects.forEach(fn=>fn());assert.equal(navigation.length,0);
  outcome='credential';await descendants(tree).find(x=>x.type==='Button').props.onClick();
  // The UI callback starts the read asynchronously; settle the refresh to inspect the actual provider state.
  await new Promise(resolve=>setImmediate(resolve));auth=context();assert.equal(reads,2);assert.equal(auth.profileGateError,false);assert.equal(auth.requiresPasswordSetup,false);assert.equal(renderGate(auth).props.children,'protected-content');
  outcome='mismatch';assert.equal(await context().refreshSession(),false);assert.equal(context().profileGateError,true);
  outcome='oauth';assert.equal(await context().refreshSession(),true);auth=context();assert.equal(auth.profileGateError,false);assert.equal(auth.requiresPasswordSetup,true);
  gateHooks.reset();run('components/PasswordSetupGate',{react:gateHooks.api,'@/hooks/useAuth':{useAuth:()=>auth},'react-router-dom':{useNavigate:()=> (...args)=>navigation.push(args),useLocation:()=>({pathname:'/plans',search:'?checkout=success'})}}).PasswordSetupGate();gateHooks.effects.forEach(fn=>fn());assert.equal(navigation[0][0],'/password-setup');assert.equal(navigation[0][1].state.from,'/plans?checkout=success');
});
test('profile verification in progress blocks content, while guests retain normal routes',()=>{
  assert.ok(descendants(renderGate({loading:true})).some(x=>x.type==='Spinner'));
  assert.equal(renderGate({loading:false,profileGateError:false}).props.children,'protected-content');
});
test('maintenance read failure offers retry; only confirmed maintenance renders maintenance',async()=>{
  const h=hooks();let state={loading:false,error:Error('timeout'),settings:{maintenance_mode:false}},reads=0;
  const e=run('components/MaintenanceGate',{...uiImports,react:h.api,'react-router-dom':{useLocation:()=>({pathname:'/plans'})},'@/hooks/useMaintenanceSettings':{useMaintenanceSettings:()=>({...state,refetch:async()=>{reads++;state={...state,error:null};}})},'@/hooks/useAuth':{useAuth:()=>({user:null})},'@/integrations/supabase/client':{supabase:{}},'@/lib/auth-backend':{isBetterAuthEnabled:()=>true,betterAuthClient:{}},'@/pages/Maintenance':{default:'Maintenance'}});
  const render=()=>{h.reset();return e.default({children:'app-content'});};let tree=render();assert.ok(descendants(tree).some(x=>x.props?.role==='alert'));assert.notEqual(tree.type,'Maintenance');await descendants(tree).find(x=>x.type==='Button').props.onClick();await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1);assert.equal(render().props.children,'app-content');state.settings.maintenance_mode=true;assert.equal(render().type,'Maintenance');
});
