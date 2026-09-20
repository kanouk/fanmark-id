import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { places, type PlaceId } from './places';

export type WorldController = { select(id: PlaceId): void; setPaused(value: boolean): void; reset(): void; dispose(): void };
type Animated = { object: T.Object3D; kind: 'float' | 'hop' | 'cloud' | 'spin'; base: T.Vector3; phase: number; amount: number };

export function createWorld(host: HTMLElement, onSelect: (id: PlaceId) => void, onFailure: () => void): WorldController {
  const scene = new T.Scene();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0xfaf7f5, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  host.appendChild(renderer.domElement);
  const camera = new T.OrthographicCamera(-10, 10, 6, -6, .1, 90);
  const world = new T.Group();
  scene.add(world);
  const materialCache = new Map<string, T.MeshStandardMaterial>();
  const geometryCache = new Map<string, T.BufferGeometry>();
  const textures = new Set<T.Texture>();
  const animated: Animated[] = [];
  const targets: T.Object3D[] = [];
  const plaques = new Map<PlaceId, T.Group>();
  const glows = new Map<PlaceId, T.Mesh>();
  const cloudGroups: T.Group[] = [];
  const ray = new T.Raycaster();
  const pointer = new T.Vector2();
  const aim = new T.Vector2();
  let hovered: PlaceId | undefined;
  let selected: PlaceId = 'garden';
  let time = 0, frame = 0, last = 0, pulse = 0, renderCount = 0;
  let paused = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let visible = true, disposed = false;
  const mat = (color: string, roughness = .8) => {
    const key = `${color}:${roughness}`;
    if (!materialCache.has(key)) materialCache.set(key, new T.MeshStandardMaterial({ color, roughness, metalness: 0 }));
    return materialCache.get(key)!;
  };
  const mesh = (geometry: T.BufferGeometry, color: string, parent: T.Object3D, x = 0, y = 0, z = 0) => {
    const object = new T.Mesh(geometry, mat(color));
    object.position.set(x,y,z); object.castShadow = true; object.receiveShadow = true; parent.add(object); return object;
  };
  const round = (w:number,h:number,d:number,r:number,color:string,parent:T.Object3D,x=0,y=0,z=0) => {
    const key = `r:${w}:${h}:${d}:${r}`;
    if (!geometryCache.has(key)) geometryCache.set(key,new RoundedBoxGeometry(w,h,d,3,r));
    return mesh(geometryCache.get(key)!,color,parent,x,y,z);
  };
  const ballGeo = new T.SphereGeometry(1,24,16); geometryCache.set('ball',ballGeo);
  const ball = (x:number,y:number,z:number,sx:number,sy:number,sz:number,color:string,parent:T.Object3D=world) => {
    const b=mesh(ballGeo,color,parent,x,y,z); b.scale.set(sx,sy,sz); return b;
  };
  const cylinder = (rt:number,rb:number,h:number,color:string,parent:T.Object3D=world,x=0,y=0,z=0,segments=40) => {
    const key=`c:${rt}:${rb}:${h}:${segments}`;
    if(!geometryCache.has(key)) geometryCache.set(key,new T.CylinderGeometry(rt,rb,h,segments));
    return mesh(geometryCache.get(key)!,color,parent,x,y,z);
  };
  const tube = (points:T.Vector3[], radius:number, color:string, parent:T.Object3D=world) => {
    const g=new T.TubeGeometry(new T.CatmullRomCurve3(points),40,radius,7,false);
    geometryCache.set(`tube:${geometryCache.size}`,g); return mesh(g,color,parent);
  };
  const animate = (object:T.Object3D,kind:Animated['kind'],phase:number,amount=.1) => animated.push({object,kind,phase,amount,base:object.position.clone()});
  const texture = (text:string,w=512,h=256,background?:string) => {
    const canvas=document.createElement('canvas'); canvas.width=w; canvas.height=h;
    const ctx=canvas.getContext('2d')!;
    if(background){ctx.fillStyle=background;ctx.fillRect(0,0,w,h);}
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillStyle='#76695c';
    ctx.font=`${Math.round(h*.66)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    ctx.fillText(text,w/2,h*.51);
    const tex=new T.CanvasTexture(canvas); tex.colorSpace=T.SRGBColorSpace; tex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());textures.add(tex);return tex;
  };
  const label = (text:string,w:number,h:number,parent:T.Object3D,x:number,y:number,z:number,bg?:string) => {
    const g=new T.PlaneGeometry(w,h);geometryCache.set(`label:${geometryCache.size}`,g);
    const m=new T.MeshBasicMaterial({map:texture(text,512,256,bg),transparent:true,depthWrite:false,side:T.DoubleSide,toneMapped:false});
    const p=new T.Mesh(g,m);p.position.set(x,y,z);parent.add(p);return p;
  };
  // One static shadow pass; moving details use painted soft contact shadows.
  scene.add(new T.HemisphereLight(0xfffbef,0xb4d2c4,1.8));
  const sun=new T.DirectionalLight(0xfff4dc,2.6);sun.position.set(-7,13,7);sun.castShadow=true;
  sun.shadow.mapSize.set(2048,2048);sun.shadow.camera.left=-10;sun.shadow.camera.right=10;sun.shadow.camera.top=10;sun.shadow.camera.bottom=-10;sun.shadow.camera.near=1;sun.shadow.camera.far=36;sun.shadow.normalBias=.045;sun.shadow.bias=-.0003;scene.add(sun);
  const fill=new T.DirectionalLight(0xdcefff,1.4);fill.position.set(8,6,-5);scene.add(fill);

  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=128;
  const ctx=shadowCanvas.getContext('2d')!; const gradient=ctx.createRadialGradient(64,64,0,64,64,64);gradient.addColorStop(0,'rgba(89,92,65,.22)');gradient.addColorStop(.4,'rgba(89,92,65,.13)');gradient.addColorStop(1,'rgba(89,92,65,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,128,128);
  const shadowTex=new T.CanvasTexture(shadowCanvas);textures.add(shadowTex);
  const shadowMat=new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false});
  const shadowGeo=new T.PlaneGeometry(1,1);geometryCache.set('shadow',shadowGeo);
  const shadow=(x:number,z:number,sx:number,sz:number,y=.49,parent:T.Object3D=world)=>{const s=new T.Mesh(shadowGeo,shadowMat);s.rotation.x=-Math.PI/2;s.position.set(x,y,z);s.scale.set(sx,sz,1);parent.add(s);return s;};
  shadow(0,0,18,12,-1.13);
  // The rounded, layered island reads like a little handmade ceramic diorama.
  const lower=cylinder(6.15,5.8,.48,'#d6c9db',world,0,-.48,0,96);lower.scale.z=.69;
  const edge=cylinder(6.32,6.18,.5,'#e7dfcc',world,0,-.14,0,96);edge.scale.z=.7;
  const grass=cylinder(6.28,6.32,.28,'#c4d7ae',world,0,.24,0,96);grass.scale.z=.7;
  const grassTop=cylinder(6.14,6.25,.14,'#dce5bb',world,0,.43,0,96);grassTop.scale.z=.7;
  const plaza=cylinder(2.1,2.15,.055,'#f1e9d4',world,0,.53,.4,64);plaza.scale.z=.79;
  const pathPoints=[new T.Vector3(-5.2,.52,1.1),new T.Vector3(-3,.52,2),new T.Vector3(-.4,.52,1.7),new T.Vector3(2.6,.52,1.7),new T.Vector3(4.8,.52,.5)];
  const path=tube(pathPoints,.48,'#f1e9d4');path.scale.y=.11;path.position.y=.48;
  for(let i=0;i<8;i++){const p=round(.39,.06,.29,.09,'#fffbef',world,-1.7+i*.44,.59,2.8+Math.sin(i*.4)*.22);p.rotation.y=Math.sin(i)*.16;}
  const pond=cylinder(1.22,1.28,.04,'#9bd2d1',world,4,.52,1.9,64);pond.scale.z=.57;
  const pondInner=cylinder(.98,1.02,.05,'#b5e3dc',world,4,.55,1.9,64);pondInner.scale.z=.52;
  // Stepping stones and tiny water lilies.
  for(let i=0;i<3;i++){const p=cylinder(.12,.13,.035,'#83bca1',world,3.6+i*.39,.59,1.85+Math.sin(i)*.15,20);p.scale.z=.7;}
  ball(4.33,.63,1.96,.09,.075,.09,'#f2bad0');
  function tree(x:number,z:number,scale:number,color:string){
    const group=new T.Group();group.position.set(x,.49,z);group.scale.setScalar(scale);world.add(group);
    cylinder(.09,.14,1.24,'#c7a081',group,0,.6,0,12);
    const branch=cylinder(.04,.075,.65,'#c7a081',group,.18,.98,0,10);branch.rotation.z=-.5;
    ball(-.25,1.37,.02,.52,.58,.48,color,group);ball(.27,1.55,.04,.51,.65,.48,color,group);ball(.02,1.9,0,.46,.53,.45,color,group);
    shadow(0,0,1.5,1.1,.015,group);return group;
  }
  tree(-4.7,-1.6,1.25,'#f1afc1');tree(-5.15,.15,.8,'#efbfd0');tree(4.7,-1.85,1.22,'#8cbcac');tree(5.1,-.2,.75,'#b2cfa2');tree(-1.7,-2.95,.8,'#b1c4a0');tree(2.3,-2.55,.72,'#d3b6d7');
  for(let i=0;i<11;i++){const a=i*2.399;const x=Math.cos(a)*5.4,z=Math.sin(a)*3.2;ball(x,.67,z,.29,.25,.24,i%3===0?'#d0b8ce':'#9cbd92');}
  function flower(x:number,z:number,color:string,size=.11){
    cylinder(.018,.018,.25,'#8ba882',world,x,.63,z,6);
    for(let i=0;i<5;i++){const a=i/5*Math.PI*2;ball(x+Math.cos(a)*size*.8,.79+Math.sin(a)*size*.8,z,size*.66,size*.66,size*.4,color);}
    ball(x,.79,z+.04,size*.45,size*.45,size*.4,'#f4d57d');
  }
  [[-4,1.8],[-4.3,1.7],[-3.8,2.1],[-2.8,2.7],[2.4,2.8],[2.8,2.7],[4.6,.2],[4.4,.4],[-.8,-2.7]].forEach(([x,z],i)=>flower(x,z,i%2?'#f8cf81':'#e9a5bc'));
  function plaque(id:PlaceId,x:number,y:number,z:number){
    const p=places.find(p=>p.id===id)!;
    const g=new T.Group();g.position.set(x,y,z);g.rotation.y=.33;world.add(g);
    round(1.56,.73,.18,.14,'#fffaf0',g);
    const outline=round(1.63,.8,.12,.15,p.color,g,0,0,-.055);outline.castShadow=false;
    const face=label(p.emoji,1.39,.64,g,0,.005,.105);face.userData.place=id;
    g.traverse(obj=>{obj.userData.place=id;if(obj instanceof T.Mesh)targets.push(obj);});
    plaques.set(id,g);animate(g,'float',places.indexOf(p)*1.7,.075);
    const ringGeo=new T.RingGeometry(.74,.8,48);geometryCache.set(`ring:${id}`,ringGeo);
    const glow=new T.Mesh(ringGeo,new T.MeshBasicMaterial({color:p.color,transparent:true,opacity:.6,side:T.DoubleSide,depthWrite:false}));
    glow.rotation.x=-Math.PI/2;glow.position.set(x,.61,z);world.add(glow);glows.set(id,glow);
  }
  function windowPane(parent:T.Object3D,x:number,y:number,z:number,w=.4,h=.6){
    round(w+.1,h+.1,.11,.075,'#fffbec',parent,x,y,z);round(w,h,.12,.07,'#80b6b3',parent,x,y,z+.05);
    round(.035,h,.025,.007,'#f4eddc',parent,x,y,z+.125);round(w,.035,.025,.007,'#f4eddc',parent,x,y,z+.125);
  }
  function building(x:number,z:number,color:string,roofColor:string,type:'flowers'|'cafe'|'music'){
    const g=new T.Group();g.position.set(x,.55,z);g.rotation.y=.13;world.add(g);
    const w=type==='music'?1.65:1.85,h=type==='music'?1.9:1.45;
    round(w,h,1.35,.17,color,g,0,h/2,0);
    round(w+.22,.23,1.6,.09,'#fff4dd',g,0,h+.08,0);
    if(type==='music'){
      round(w+.32,.4,1.65,.2,roofColor,g,0,h+.26,0);
      round(.7,.94,.1,.22,'#7e9dbe',g,0,.55,.72);
      label('♫',.55,.47,g,0,1.4,.75);
      windowPane(g,-.55,.85,.69,.3,.5);windowPane(g,.55,.85,.69,.3,.5);
      cylinder(.08,.09,.4,'#e5ba8d',g,.5,h+.57,0,14);ball(.5,h+.86,0,.22,.22,.22,'#eed28c',g);
    } else {
      const roof=new T.ConeGeometry(1.45,.76,4);roof.rotateY(Math.PI/4);geometryCache.set(`roof:${type}`,roof);
      const top=mesh(roof,roofColor,g,0,h+.47,0);top.scale.z=.79;
      round(.46,.86,.08,.16,type==='cafe'?'#b68f6d':'#b9bca2',g,.42,.45,.72);
      windowPane(g,-.46,.83,.72,.55,.55);
      const awning=round(w+.13,.16,.75,.06,'#fff9eb',g,0,1.28,.86);awning.rotation.x=.14;
      for(let i=0;i<6;i++)round(.16,.17,.76,.03,roofColor,g,-.84+i*.335,1.29,.87).rotation.x=.14;
      round(w+.14,.22,.12,.055,roofColor,g,0,1.17,1.23);
      if(type==='flowers'){
        round(1.5,.36,.43,.08,'#dfb48e',g,0,.19,1.17);
        for(let i=0;i<5;i++){ball(-.57+i*.29,.5,1.18,.18,.17,.17,i%2?'#f0c1cf':'#f7dd91',g);ball(-.57+i*.29,.35,1.2,.17,.1,.13,'#8bad83',g);}
      } else {
        const cup=cylinder(.24,.19,.34,'#fff6e7',g,-.55,h+.92,0,32);cup.rotation.z=-.12;
        const handleGeo=new T.TorusGeometry(.15,.042,8,18);geometryCache.set('cup-handle',handleGeo);mesh(handleGeo,'#fff6e7',g,-.28,h+.92,0);
        cylinder(.195,.195,.015,'#986d52',g,-.55,h+1.096,0,32);
        const table=cylinder(.36,.36,.1,'#e1bc8c',g,1.13,.55,1.1,24);table.castShadow=true;
        cylinder(.055,.09,.5,'#b69574',g,1.13,.25,1.1,12);ball(1.13,.68,1.1,.09,.1,.09,'#fff6ec',g);
      }
    }
    shadow(0,0,w*1.6,2,.01,g);return g;
  }
  building(-3.25,-.75,'#ffecda','#e8a6b7','flowers');
  building(3.1,-.7,'#f6dfb5','#83bab6','cafe');
  building(.05,-2.62,'#d9d0e5','#b49bcb','music');
  plaque('garden',-3.05,2.9,.25);plaque('cafe',3.15,2.9,.37);plaque('music',.1,3.78,-2.5);
  // The main doorway turns a small emoji address into a place to enter.
  const arch=new T.Group();arch.position.set(-.1,.58,.55);arch.rotation.y=.2;world.add(arch);
  const archPoints:T.Vector3[]=[];for(let i=0;i<=30;i++){const a=i/30*Math.PI;archPoints.push(new T.Vector3(Math.cos(a)*.84,1.12+Math.sin(a)*.84,0));}
  tube(archPoints,.19,'#f2b2c3',arch);cylinder(.19,.19,1.13,'#f2b2c3',arch,-.84,.56,0);cylinder(.19,.19,1.13,'#f2b2c3',arch,.84,.56,0);
  cylinder(.25,.29,.13,'#fff6e3',arch,-.84,.04,0);cylinder(.25,.29,.13,'#fff6e3',arch,.84,.04,0);
  plaque('cat',-.1,2.18,1.48);
  // Little clay residents with emoji-like faces, rosy cheeks, and little feet.
  function resident(x:number,z:number,color:string,size:number,phase:number,cat=false){
    const g=new T.Group();g.position.set(x,.8,z);g.scale.setScalar(size);g.rotation.y=.35;world.add(g);
    ball(0,.24,0,.32,.37,.29,color,g);ball(-.14,-.08,.075,.105,.09,.17,'#a79880',g);ball(.14,-.08,.075,.105,.09,.17,'#a79880',g);
    ball(-.11,.31,.27,.032,.048,.025,'#61574d',g);ball(.11,.31,.27,.032,.048,.025,'#61574d',g);
    ball(-.21,.2,.245,.057,.033,.022,'#e9a2aa',g);ball(.21,.2,.245,.057,.033,.022,'#e9a2aa',g);
    tube([new T.Vector3(-.055,.2,.287),new T.Vector3(0,.174,.3),new T.Vector3(.055,.2,.287)],.012,'#736257',g);
    if(cat){
      for(const side of [-1,1]){const geo=new T.ConeGeometry(.135,.26,3);geometryCache.set(`ear:${side}`,geo);const ear=mesh(geo,color,g,side*.205,.57,0);ear.rotation.z=side*-.24;ball(side*.205,.565,.048,.06,.08,.035,'#e8b5b6',g);}
      const tail=tube([new T.Vector3(.24,.04,-.06),new T.Vector3(.44,.18,-.06),new T.Vector3(.49,.35,-.07)],.055,color,g);tail.castShadow=false;
    }else{ball(-.34,.19,0,.09,.13,.09,color,g);ball(.34,.27,0,.09,.16,.09,color,g).rotation.z=-.55;}
    animate(g,'hop',phase,.075);shadow(x,z,.78*size,.52*size,.59);return g;
  }
  resident(-1.18,1.67,'#f7d582',1.1,0);resident(.6,2.38,'#f7eedb',1.18,2,true);resident(2.32,1.1,'#a5cecb',.82,4);resident(-3.9,1.15,'#e0bad5',.77,1);
  // A small delivery cart carries a heart along the path.
  const cart=new T.Group();cart.position.set(-2,.78,2.7);world.add(cart);round(.57,.35,.4,.1,'#80b6b2',cart);
  [-.2,.2].forEach(x=>[-.19,.19].forEach(z=>ball(x,-.18,z,.085,.085,.085,'#a38e7e',cart)));
  label('💌',.42,.4,cart,0,.32,.15);animate(cart,'hop',3,.03);
  // Balloon with a ceramic basket and real 3D rigging.
  const balloon=new T.Group();balloon.position.set(4.5,4.35,-2.1);world.add(balloon);
  ball(0,.45,0,.65,.8,.65,'#f4d795',balloon);ball(0,.56,.58,.33,.43,.08,'#fff0cc',balloon);
  label('✨',.6,.57,balloon,0,.53,.685);
  round(.43,.28,.35,.07,'#bd9980',balloon,0,-.82,0);
  for(const x of [-.18,.18])tube([new T.Vector3(x,-.7,.12),new T.Vector3(x*1.8,-.18,.2)],.013,'#b9977c',balloon);
  animate(balloon,'float',1.8,.18);
  function cloud(x:number,y:number,z:number,s:number){const g=new T.Group();g.position.set(x,y,z);g.scale.setScalar(s);world.add(g);ball(-.42,0,0,.45,.23,.28,'#fffdf6',g);ball(0,.13,0,.48,.39,.33,'#fffdf6',g);ball(.45,.02,0,.39,.24,.27,'#fffdf6',g);g.traverse(o=>{o.castShadow=false;});animate(g,'cloud',x,.14);cloudGroups.push(g);}
  cloud(-5.2,3.35,-1.5,.9);cloud(1.5,3.9,-3.1,.65);cloud(5.7,2.4,1.1,.6);
  // A string of pastel pennants above the back of the village.
  tube([new T.Vector3(-3.8,3.2,-2),new T.Vector3(-1.9,2.8,-2.6),new T.Vector3(-.3,3.2,-3.4)],.014,'#bea993');
  for(let i=0;i<6;i++){const g=new T.ConeGeometry(.12,.25,3);geometryCache.set(`pennant:${i}`,g);const m=mesh(g,['#f0b2bf','#b4d0bb','#f3d88f'][i%3],world,-3.55+i*.52,2.96-Math.sin(i/5*Math.PI)*.22,-2.04-i*.21);m.rotation.z=Math.PI;}
  // Decorative stars are small geometry, not an expensive particle effect.
  const stars:T.Object3D[]=[];
  for(let i=0;i<7;i++){
    const group=new T.Group();group.position.set(Math.sin(i*4)*5.6,2.5+(i%3)*.72,Math.cos(i*3)*2.6);world.add(group);
    const color=i%2?'#e4bfd2':'#efcf86';ball(0,0,0,.055,.19,.055,color,group);ball(0,0,0,.17,.055,.055,color,group);group.rotation.z=.4;animate(group,'float',i,.12);stars.push(group);
  }
  const confettiGeo=new T.SphereGeometry(.045,6,5);geometryCache.set('confetti',confettiGeo);
  const confetti=new T.Group();world.add(confetti);confetti.visible=false;
  for(let i=0;i<18;i++){const bit=mesh(confettiGeo,['#f0b2bf','#8ac5ba','#f0d07b'][i%3],confetti);bit.scale.set(1,2,1);}

  // Batch static scenery by material; keep moving residents and raycast signs separate.
  world.updateMatrixWorld(true);
  const dynamicRoots = new Set<T.Object3D>([...animated.map(a => a.object), ...glows.values(), confetti]);
  const batches = new Map<string, { material: T.Material; cast: boolean; receive: boolean; objects: T.Mesh[] }>();
  world.traverse(object => {
    if (!(object instanceof T.Mesh) || Array.isArray(object.material) || targets.includes(object)) return;
    let ancestor: T.Object3D | null = object;
    while (ancestor && ancestor !== world) { if (dynamicRoots.has(ancestor)) return; ancestor = ancestor.parent; }
    const key = `${object.material.uuid}:${object.castShadow}:${object.receiveShadow}`;
    if (!batches.has(key)) batches.set(key, { material: object.material, cast: object.castShadow, receive: object.receiveShadow, objects: [] });
    batches.get(key)!.objects.push(object);
  });
  batches.forEach(batch => {
    if (batch.objects.length < 2) return;
    const parts = batch.objects.map(object => {
      const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
      return geometry.applyMatrix4(object.matrixWorld);
    });
    const combined = mergeGeometries(parts);
    parts.forEach(part => part.dispose());
    if (!combined) return;
    geometryCache.set(`batch:${geometryCache.size}`, combined);
    const object = new T.Mesh(combined, batch.material);
    object.castShadow = batch.cast; object.receiveShadow = batch.receive;
    batch.objects.forEach(original => original.removeFromParent());
    world.add(object);
  });

  function positionCamera(){const narrow=host.clientWidth<600;const ratio=host.clientWidth/Math.max(1,host.clientHeight);const width=narrow?14.6:Math.max(17.6,ratio*7.6);camera.left=-width/2;camera.right=width/2;camera.top=width/ratio/2;camera.bottom=-width/ratio/2;camera.position.set(8.2,10.5,17.8);camera.lookAt(0,narrow?1.8:1.7,0);camera.updateProjectionMatrix();}
  function draw(){if(!disposed){renderer.render(scene,camera);host.dataset.drawCalls=String(renderer.info.render.calls);host.dataset.renderCount=String(++renderCount);}}
  function resize(){renderer.setPixelRatio(Math.min(window.devicePixelRatio,host.clientWidth<600?1.25:1.5));renderer.setSize(host.clientWidth,host.clientHeight,false);positionCamera();renderer.shadowMap.needsUpdate=true;draw();}
  function update(){
    for(const a of animated){
      if(a.kind==='float'){a.object.position.y=a.base.y+Math.sin(time*.85+a.phase)*a.amount;a.object.rotation.z=Math.sin(time*.65+a.phase)*.025;}
      if(a.kind==='hop'){a.object.position.y=a.base.y+Math.max(0,Math.sin(time*1.7+a.phase))*a.amount;a.object.rotation.z=Math.sin(time*1.7+a.phase)*.035;}
      if(a.kind==='cloud')a.object.position.x=a.base.x+Math.sin(time*.17+a.phase)*a.amount;
    }
    world.rotation.y+=(aim.x*.06-world.rotation.y)*.06;world.rotation.x+=(aim.y*.018-world.rotation.x)*.06;
    plaques.forEach((g,id)=>{const target=id===hovered?1.1:id===selected?1.045:1;g.scale.lerp(new T.Vector3(target,target,target),.13);});
    if(pulse>0){pulse=Math.max(0,pulse-.025);confetti.visible=true;confetti.children.forEach((p,i)=>{const a=i*2.4;const age=1-pulse;p.position.set(Math.sin(a)*age*1.8,age*2.3-age*age*3+1.9,Math.cos(a)*age*.7);p.scale.setScalar(pulse);});}else confetti.visible=false;
  }
  function tick(stamp:number){frame=0;if(disposed||paused||!visible||document.hidden)return;if(stamp-last>1000/30){time+=Math.min((stamp-last)/1000,.07);last=stamp;update();draw();}frame=requestAnimationFrame(tick);}
  function sync(){cancelAnimationFrame(frame);frame=0;last=performance.now();if(!disposed&&!paused&&visible&&!document.hidden)frame=requestAnimationFrame(tick);}
  function pick(event:PointerEvent){const r=host.getBoundingClientRect();pointer.set(((event.clientX-r.left)/r.width)*2-1,-((event.clientY-r.top)/r.height)*2+1);ray.setFromCamera(pointer,camera);const hit=ray.intersectObjects(targets,false)[0];return hit?.object.userData.place as PlaceId|undefined;}
  function move(event:PointerEvent){hovered=pick(event);host.style.cursor=hovered?'pointer':'default';if(event.pointerType!=='touch'&&!paused){aim.copy(pointer);}if(paused){plaques.forEach((g,id)=>g.scale.setScalar(id===hovered?1.08:id===selected?1.045:1));draw();}}
  function leave(){hovered=undefined;aim.set(0,0);host.style.cursor='default';}
  let pointerDown:T.Vector2|undefined;
  function down(e:PointerEvent){pointerDown=new T.Vector2(e.clientX,e.clientY);}
  function up(e:PointerEvent){if(!pointerDown||pointerDown.distanceTo(new T.Vector2(e.clientX,e.clientY))>10)return;pointerDown=undefined;const id=pick(e);if(id){onSelect(id);select(id);}}
  function select(id:PlaceId){selected=id;glows.forEach((g,key)=>{g.visible=key===id;});if(!paused){const p=plaques.get(id)!;confetti.position.set(p.position.x,.3,p.position.z);pulse=1;}else{plaques.forEach((g,key)=>g.scale.setScalar(key===id?1.045:1));}draw();}
  function contextLost(e:Event){e.preventDefault();cancelAnimationFrame(frame);disposed=true;onFailure();}
  const observer=new ResizeObserver(resize);observer.observe(host);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();},{threshold:.01});intersection.observe(host);
  host.addEventListener('pointermove',move);host.addEventListener('pointerleave',leave);host.addEventListener('pointerdown',down);host.addEventListener('pointerup',up);
  renderer.domElement.addEventListener('webglcontextlost',contextLost);document.addEventListener('visibilitychange',sync);
  resize();select('garden');sync();
  return {
    select,
    setPaused(value){paused=value;aim.set(0,0);sync();if(paused)draw();},
    reset(){aim.set(0,0);world.rotation.set(0,0,0);positionCamera();draw();},
    dispose(){disposed=true;cancelAnimationFrame(frame);observer.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',sync);host.removeEventListener('pointermove',move);host.removeEventListener('pointerleave',leave);host.removeEventListener('pointerdown',down);host.removeEventListener('pointerup',up);renderer.domElement.removeEventListener('webglcontextlost',contextLost);const materials=new Set<T.Material>();scene.traverse(o=>{if(o instanceof T.Mesh){(Array.isArray(o.material)?o.material:[o.material]).forEach(m=>materials.add(m));}});materials.forEach(m=>m.dispose());geometryCache.forEach(g=>g.dispose());textures.forEach(t=>t.dispose());sun.shadow.dispose();renderer.dispose();renderer.domElement.remove();},
  };
}
