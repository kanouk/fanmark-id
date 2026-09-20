import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { people, fallbackFanmarks, type PersonId } from './places';

export type WorldController = {
  setFanmarks(emojis: string[]): void;
  select(id: PersonId): void;
  focus(id: PersonId): void;
  setPaused(value: boolean): void;
  rotate(x: number, y: number): void;
  reset(): void;
  zoom(delta: number): void;
  dispose(): void;
};
type Walker = {
  id: PersonId; root: T.Group; body: T.Group; tag: T.Group;
  legs: T.Group[]; arms: T.Group[]; position:T.Vector3; initial:T.Vector3; direction:T.Vector3; destination:T.Vector3; speed: number; phase: number; headHeight: number;
};
const R = 3.18;
const surface = (lat: number, lon: number, radius = R) => new T.Vector3(
  Math.cos(lat) * Math.sin(lon) * radius,
  Math.sin(lat) * radius,
  Math.cos(lat) * Math.cos(lon) * radius,
);

export function createWorld(host: HTMLElement, onSelect: (emoji: string) => void, onFailure: () => void): WorldController {
  const scene = new T.Scene();
  const renderer = new T.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0xfaf7f5, 0);
  renderer.outputColorSpace = T.SRGBColorSpace;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');
  const camera = new T.OrthographicCamera(-5,5,5,-5,.1,60);
  camera.position.set(0,2.0,14);camera.lookAt(0,.8,0);
  const planet = new T.Group();planet.rotation.x = .06;scene.add(planet);
  const geometries = new Set<T.BufferGeometry>();
  const materials = new Set<T.Material>();
  const textures = new Set<T.Texture>();
  const cache = new Map<string,T.MeshStandardMaterial>();
  const geoCache = new Map<string,T.BufferGeometry>();
  const targets:T.Object3D[]=[];
  const walkers:Walker[]=[];
  const signs: { group:T.Group; canvas:HTMLCanvasElement; texture:T.CanvasTexture; emoji:string }[]=[];
  let fanmarks:string[]=[];
  let assigned=false;
  const shopNormals:T.Vector3[]=[];
  const ray = new T.Raycaster();
  const pointer = new T.Vector2();
  let time=0, frame=0, last=0, count=0, selected:PersonId|null=null;
  let paused=matchMedia('(prefers-reduced-motion: reduce)').matches, visible=true, disposed=false, failed=false;
  let drag:{id:number;x:number;y:number;startX:number;startY:number;moved:boolean;touch:boolean}|null=null;
  let yaw=0, tilt=.06, zoomLevel=1.25;
  const cameraQuaternion = new T.Quaternion(), planetInverse = new T.Quaternion();
  const matrix = new T.Matrix4();
  const normal=new T.Vector3(), east=new T.Vector3(), south=new T.Vector3();

  const ownGeo = <G extends T.BufferGeometry>(g:G) => {geometries.add(g);return g;};
  const ownMat = <M extends T.Material>(m:M) => {materials.add(m);return m;};
  const mat=(color:string)=>{if(!cache.has(color))cache.set(color,ownMat(new T.MeshStandardMaterial({color,roughness:.82})));return cache.get(color)!;};
  const mesh=(g:T.BufferGeometry,color:string,parent:T.Object3D,x=0,y=0,z=0)=>{const m=new T.Mesh(g,mat(color));m.position.set(x,y,z);parent.add(m);return m;};
  const sphere=ownGeo(new T.SphereGeometry(1,24,16));
  const ball=(parent:T.Object3D,color:string,x:number,y:number,z:number,sx:number,sy=sx,sz=sx)=>{const m=mesh(sphere,color,parent,x,y,z);m.scale.set(sx,sy,sz);return m;};
  const round=(parent:T.Object3D,color:string,w:number,h:number,d:number,r:number,x=0,y=0,z=0)=>{
    const key=`${w}:${h}:${d}:${r}`;if(!geoCache.has(key))geoCache.set(key,ownGeo(new RoundedBoxGeometry(w,h,d,3,r)));
    return mesh(geoCache.get(key)!,color,parent,x,y,z);
  };
  const cylinder=(parent:T.Object3D,color:string,rt:number,rb:number,h:number,x=0,y=0,z=0)=>{
    const key=`c:${rt}:${rb}:${h}`;if(!geoCache.has(key))geoCache.set(key,ownGeo(new T.CylinderGeometry(rt,rb,h,16)));
    return mesh(geoCache.get(key)!,color,parent,x,y,z);
  };
  function orient(object:T.Object3D,lat:number,lon:number,r=R){
    object.position.copy(surface(lat,lon,r));normal.copy(object.position).normalize();east.set(Math.cos(lon),0,-Math.sin(lon));south.crossVectors(east,normal).normalize();
    matrix.makeBasis(east,normal,south);object.quaternion.setFromRotationMatrix(matrix);
  }
  const ground=(lat:number,lon:number)=>{const g=new T.Group();orient(g,lat,lon);planet.add(g);return g;};
  scene.add(new T.HemisphereLight(0xfff9e7,0x91b8b0,2.4));
  const sun=new T.DirectionalLight(0xffedd5,3.1);sun.position.set(-5,8,9);scene.add(sun);
  const fill=new T.DirectionalLight(0xd5e9ff,1.25);fill.position.set(6,2,-4);scene.add(fill);
  // A genuinely round globe: one continuous sphere with subtle clay color variation.
  const globeGeo=ownGeo(new T.SphereGeometry(R,80,56));
  const pos=globeGeo.getAttribute('position');const colors:number[]=[];
  for(let i=0;i<pos.count;i++){
    const mix=T.MathUtils.clamp((pos.getY(i)/R+1)*.5,0,1);
    const c=new T.Color('#80b5a2').lerp(new T.Color('#d5e2b5'),mix);
    colors.push(c.r,c.g,c.b);
  }
  globeGeo.setAttribute('color',new T.Float32BufferAttribute(colors,3));
  const globe=new T.Mesh(globeGeo,ownMat(new T.MeshStandardMaterial({vertexColors:true,roughness:.92})));planet.add(globe);

  // Irregular, curved patches hug the sphere rather than sitting on a flat island.
  function patch(lat:number,lon:number,size:number,color:string,seed:number,offset=.018){
    const center=surface(lat,lon).normalize();const tangent=new T.Vector3(Math.cos(lon),0,-Math.sin(lon));const other=new T.Vector3().crossVectors(center,tangent).normalize();
    const verts:number[]=[];const indices:number[]=[];const N=64, rings=24;
    const p=new T.Vector3();
    for(let j=0;j<=rings;j++)for(let i=0;i<=N;i++){
      const a=i/N*Math.PI*2;const radius=size*j/rings*(1+.13*Math.sin(a*3+seed)+.08*Math.cos(a*5-seed));
      p.copy(center).multiplyScalar(R).addScaledVector(tangent,Math.cos(a)*radius).addScaledVector(other,Math.sin(a)*radius*.68).normalize().multiplyScalar(R+offset);
      verts.push(p.x,p.y,p.z);
      if(j<rings&&i<N){const k=j*(N+1)+i;indices.push(k,k+1,k+N+1,k+1,k+N+2,k+N+1);}
    }
    const g=ownGeo(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(verts,3));g.setIndex(indices);g.computeVertexNormals();
    const material=mat(color);material.side=T.DoubleSide;const m=new T.Mesh(g,material);planet.add(m);
  }
  patch(-.5,-.7,1.7,'#a5ced0',1);patch(-.5,1.6,1.4,'#a2c9c9',2);patch(.75,-2.1,1.6,'#a2c8af',3);patch(-.8,-2.4,1.6,'#accdb9',5);
  // Curving promenades follow the surface instead of forming latitude bands.
  const roadPoints:T.Vector3[]=[];
  function ribbon(points:T.Vector3[],width:number,color:string,closed=false,offset=.028){
    const curve=new T.CatmullRomCurve3(points,closed,'centripetal');
    const vertices:number[]=[],indices:number[]=[];
    const n=closed?300:90;
    for(let i=0;i<=n;i++){
      const t=i/n,center=curve.getPoint(t).normalize();
      const direction=curve.getTangent(t).normalize();
      const side=new T.Vector3().crossVectors(center,direction).normalize();
      for(const edge of [-1,1]){const p=center.clone().multiplyScalar(R).addScaledVector(side,edge*width).normalize().multiplyScalar(R+offset);vertices.push(p.x,p.y,p.z);}
      if(i<n){const j=i*2;indices.push(j,j+1,j+2,j+1,j+3,j+2);}
      if(i%4===0)roadPoints.push(center.clone());
    }
    const g=ownGeo(new T.BufferGeometry());g.setAttribute('position',new T.Float32BufferAttribute(vertices,3));g.setIndex(indices);g.computeVertexNormals();
    const material=mat(color);material.side=T.DoubleSide;planet.add(new T.Mesh(g,material));
  }
  const avenue=Array.from({length:12},(_,i)=>surface(.23+.28*Math.sin(i/12*Math.PI*4),i/12*Math.PI*2,1));
  ribbon(avenue,.13,'#e9dfc8',true);
  const southernWalk=Array.from({length:12},(_,i)=>surface(-.58+.19*Math.cos(i/12*Math.PI*4),i/12*Math.PI*2,1));
  ribbon(southernWalk,.10,'#e9dfc8',true);
  const shadowCanvas=document.createElement('canvas');shadowCanvas.width=shadowCanvas.height=64;
  const ctx=shadowCanvas.getContext('2d')!;const gradient=ctx.createRadialGradient(32,32,0,32,32,32);gradient.addColorStop(0,'rgba(58,75,55,.28)');gradient.addColorStop(.45,'rgba(58,75,55,.1)');gradient.addColorStop(1,'rgba(58,75,55,0)');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,64);
  const shadowTex=new T.CanvasTexture(shadowCanvas);textures.add(shadowTex);
  const shadowMat=ownMat(new T.MeshBasicMaterial({map:shadowTex,transparent:true,depthWrite:false}));
  const shadowGeo=ownGeo(new T.PlaneGeometry(1,1));
  function shadow(parent:T.Object3D,size:number){const s=new T.Mesh(shadowGeo,shadowMat);s.rotation.x=-Math.PI/2;s.position.y=.034;s.scale.set(size,size,1);parent.add(s);}
  function tree(lat:number,lon:number,size:number,color:string){
    const g=ground(lat,lon);g.scale.setScalar(size);cylinder(g,'#be987c',.055,.09,.65,0,.32,0);
    ball(g,color,-.19,.77,0,.3,.37,.28);ball(g,color,.16,.84,.02,.31,.4,.28);ball(g,color,0,1.08,0,.3,.36,.29);shadow(g,.85);
  }
  tree(.98,-1.15,.92,'#e6a9bd');tree(1.27,.05,.87,'#91b8a4');tree(.82,1.52,.8,'#a4c29b');tree(.28,-1.72,.77,'#d2b3cf');tree(-.35,2.9,.87,'#adc9a7');tree(.85,2.7,.8,'#e8b1bf');tree(-.42,-1.9,.9,'#9cbea0');tree(-.8,.2,.68,'#b3c9a2');
  function house(lat:number,lon:number,color:string,roof:string){
    const g=ground(lat,lon);g.rotation.y+=.18;round(g,color,.62,.64,.53,.065,0,.33,0);
    const geo=ownGeo(new T.ConeGeometry(.51,.33,4));geo.rotateY(Math.PI/4);const top=mesh(geo,roof,g,0,.79,0);top.scale.z=.85;
    round(g,'#f6eddb',.22,.32,.04,.05,0,.18,.28);round(g,'#8caaa4',.17,.22,.05,.04,-.18,.46,.29);shadow(g,1.05);
  }
house(.42,-2.75,'#eddbb6','#8bb9ae');house(-.15,2,'#d5c9dc','#b49bc8');
  function flowerPot(parent:T.Object3D,x:number,z:number,color='#e9a9bd'){
    const g=new T.Group();g.position.set(x,0,z);parent.add(g);
    cylinder(g,'#c69c7b',.11,.075,.16,0,.08,0);cylinder(g,'#e0bda0',.12,.12,.035,0,.155,0);
    for(let i=0;i<3;i++){
      const a=i*2.4;const fx=Math.sin(a)*.065,fz=Math.cos(a)*.065;
      cylinder(g,'#729b79',.011,.012,.18,fx,.24,fz);
      ball(g,'#85ad81',fx+.035,.23,fz,.06,.028,.036);
      for(let j=0;j<5;j++){const p=j/5*Math.PI*2;ball(g,color,fx+Math.cos(p)*.035,.35+Math.sin(p)*.035,fz,.031);}
      ball(g,'#efcd7b',fx,.35,fz+.022,.021);
    }
  }
  function bench(parent:T.Object3D,x:number,z:number,turn=0){
    const g=new T.Group();parent.add(g);g.position.set(x,0,z);g.rotation.y=turn;
    for(const side of [-1,1]){
      round(g,'#6e8278',.055,.24,.28,.022,side*.28,.13,0);
      round(g,'#6e8278',.045,.37,.05,.02,side*.28,.35,-.12);
      round(g,'#b39471',.055,.045,.35,.02,side*.34,.37,0);
    }
    for(let i=0;i<3;i++)round(g,'#cba67b',.78,.055,.075,.02,0,.27,-.09+i*.085);
    for(let i=0;i<2;i++)round(g,'#dbb98b',.78,.075,.055,.022,0,.4+i*.09,-.14);
    shadow(g,.95);
  }
  const lampGlow=ownMat(new T.MeshBasicMaterial({color:'#ffdda1'}));
  function lamp(parent:T.Object3D,x:number,z:number){
    const g=new T.Group();parent.add(g);g.position.set(x,0,z);
    cylinder(g,'#7c7964',.065,.10,.10,0,.055,0);cylinder(g,'#7c7964',.025,.04,.74,0,.44,0);
    const light=new T.Mesh(sphere,lampGlow);light.scale.set(.085,.135,.085);light.position.y=.89;g.add(light);
    for(const a of [0,Math.PI/2,Math.PI,Math.PI*1.5])cylinder(g,'#7c7964',.011,.011,.24,Math.cos(a)*.085,.89,Math.sin(a)*.085);
    cylinder(g,'#8e876b',.10,.10,.035,0,.77,0);
    mesh(ownGeo(new T.ConeGeometry(.15,.13,6)),'#8e876b',g,0,1.05,0);ball(g,'#b29a6e',0,1.13,0,.03);
  }
  function signpost(parent:T.Object3D,x:number,z:number){
    const g=new T.Group();parent.add(g);g.position.set(x,0,z);
    cylinder(g,'#ba9873',.025,.035,.55,0,.28,0);
    round(g,'#d8b48a',.34,.1,.045,.035,.065,.46,0).rotation.z=.07;
    round(g,'#b69872',.29,.1,.045,.035,-.08,.32,0).rotation.z=-.1;
  }
  function shop(lat:number,lon:number,kind:'flowers'|'cafe'){
    const g=ground(lat,lon);g.scale.setScalar(1.15);
    shopNormals.push(surface(lat,lon,1));
    patch(lat-.05,lon,1.12,'#e9e1ce',2,.022);
    const door=surface(lat-.34,lon,1);
    const connection=surface(lat>0?.23+.28*Math.sin(lon*2):-.58+.19*Math.cos(lon*2),lon+.1,1);
    ribbon([door,door.clone().lerp(connection,.5).normalize(),connection],.075,'#e9dfc8',false,.033);
    const accent=kind==='flowers'?'#df9fb4':'#75b2ac';
    round(g,kind==='flowers'?'#f9e5d1':'#f0d9b2',1.22,1,.87,.11,0,.51,0);
    const roofGeo=ownGeo(new T.ConeGeometry(.95,.5,4));roofGeo.rotateY(Math.PI/4);
    const roof=mesh(roofGeo,accent,g,0,1.24,0);roof.scale.z=.82;
    round(g,'#aa8462',.3,.57,.08,.14,.3,.29,.48);
    round(g,'#cda879',.23,.5,.05,.1,.3,.3,.53);
    ball(g,'#e8c875',.36,.3,.56,.018);
    round(g,'#e9d9bb',.42,.075,.23,.035,.3,.035,.66);
    round(g,'#fff4dd',.43,.38,.08,.045,-.27,.59,.48);
    round(g,kind==='flowers'?'#93b4a5':'#dbb977',.34,.29,.09,.025,-.27,.59,.53);
    round(g,'#fff4dd',.035,.29,.025,.007,-.27,.59,.58);
    round(g,'#fff9e9',1.36,.13,.55,.045,0,.91,.52).rotation.x=.16;
    for(let i=0;i<5;i++)round(g,accent,.14,.14,.56,.02,-.52+i*.26,.92,.52).rotation.x=.16;
    round(g,accent,1.36,.16,.1,.035,0,.81,.8);
    if(kind==='flowers'){
      round(g,'#d5ac87',1,.23,.3,.055,0,.14,.73);
      for(let i=0;i<5;i++){
        ball(g,'#86a880',-.4+i*.2,.29,.74,.115,.09,.1);
        ball(g,i%2?'#eaa5bd':'#f3d586',-.4+i*.2,.4,.74,.105,.11,.1);
      }
    }else{
      cylinder(g,'#fff4df',.2,.16,.26,0,1.6,0);cylinder(g,'#8a654d',.16,.16,.012,0,1.737,0);
      const handle=ownGeo(new T.TorusGeometry(.12,.028,8,16));mesh(handle,'#fff4df',g,.2,1.61,0);
      cylinder(g,'#dab787',.25,.25,.075,.75,.46,.54);cylinder(g,'#b59573',.035,.05,.42,.75,.22,.54);
      ball(g,'#fff6e7',.75,.55,.54,.065,.09,.065);
    }
    bench(g,-1.0,.46,.1);lamp(g,.94,.5);flowerPot(g,-.76,-.18);flowerPot(g,.55,.72,kind==='flowers'?'#ecb6c8':'#edcd88');
    signpost(g,-.93,.98);
    const board=fanmark(null);
    // Store signs belong to their buildings; human bubbles remain head-tracked.
    board.removeFromParent();g.add(board);board.position.set(0,1.09,.63);board.scale.setScalar(.7);shadow(g,1.4);
  }
  for(let i=0;i<8;i++)shop(Math.asin(1-2*(i+.5)/8),i*2.399963-.85,i%2?'cafe':'flowers');
  // Groves and small resting places continue around the unseen hemisphere too.
  const treeColors=['#a4c19b','#91b49c','#e6a9bd','#b9caa1','#d3b5cf'];
  for(let i=0;i<42;i++){
    const lat=Math.asin(1-2*(i+.5)/42),lon=i*2.399963+1.1;
    const n=surface(lat,lon,1);
    if(shopNormals.some(s=>s.angleTo(n)<.5)||roadPoints.some(p=>p.angleTo(n)<.08))continue;
    tree(lat,lon,.48+(i%3)*.10,treeColors[i%treeColors.length]);
    const bushes=ground(lat-.08,lon+.08);
    for(let j=0;j<3;j++)ball(bushes,j%2?'#8dab82':'#b1c398',j*.12-.12,.09,Math.sin(j)*.06,.13,.12,.12);
  }
  for(const [lat,lon] of [[.02,-.65],[-.4,1.05],[.3,2.5]]){
    patch(lat,lon,.48,'#e8e0ca',4,.024);
    const park=ground(lat,lon);bench(park,0,0,.25);lamp(park,.48,0);flowerPot(park,-.5,.03);shadow(park,1.1);
  }
  // Flowers and pebbles make the back of the planet worth exploring too.
  for(let i=0;i<34;i++){
    const lat=Math.asin(1-2*(i+.5)/34),lon=i*2.399;const g=ground(lat,lon);
    if(i%3===0){ball(g,i%2?'#d1b8cd':'#a1bc8f',0,.055,0,.12,.09,.1);}
    else {cylinder(g,'#77997d',.012,.012,.16,0,.08,0);for(let j=0;j<5;j++){const a=j/5*Math.PI*2;ball(g,i%2?'#efb5c7':'#f1d58f',Math.cos(a)*.047,.19+Math.sin(a)*.047,0,.035);}ball(g,'#e9bf6d',0,.19,.027,.024);}
  }

  function fanmark(id:PersonId|null){
    const g=new T.Group();planet.add(g);
    round(g,'#fffcf2',1,.42,.1,.14);
    if(id){
      const tail=new T.Shape();tail.moveTo(-.09,-.16);tail.lineTo(.09,-.16);tail.lineTo(-.01,-.33);tail.closePath();
      const tailMesh=new T.Mesh(ownGeo(new T.ShapeGeometry(tail)),mat('#fffcf2'));tailMesh.position.z=.04;g.add(tailMesh);
    }
    const canvas=document.createElement('canvas');canvas.width=384;canvas.height=160;

    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=4;textures.add(tex);
    const face=new T.Mesh(ownGeo(new T.PlaneGeometry(.9,.375)),ownMat(new T.MeshBasicMaterial({map:tex,transparent:true,depthWrite:false,toneMapped:false})));
    face.position.z=.057;g.add(face);g.userData.person=id;
    const signIndex=signs.length;
    signs.push({group:g,canvas,texture:tex,emoji:''});
    g.visible=false;
    g.traverse(o=>{o.userData.sign=signIndex;o.userData.person=id;if(o instanceof T.Mesh)targets.push(o);});return g;
  }
  function updateSigns(){
    signs.forEach((sign,index)=>{
      sign.group.visible=fanmarks.length>0;
      const emoji=fanmarks[index] ?? '';
      sign.emoji=emoji;
      const c=sign.canvas.getContext('2d')!;c.clearRect(0,0,384,160);
      c.textAlign='center';c.textBaseline='middle';
      let fontSize=108;
      c.font=`${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      const width=c.measureText(emoji).width;
      if(width>345){fontSize*=345/width;c.font=`${fontSize}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;}
      c.fillText(emoji,192,86);sign.texture.needsUpdate=true;
    });
  }
  function randomDestination(){
    let result:T.Vector3;
    do {result=surface(Math.asin(Math.random()*2-1),Math.random()*Math.PI*2,1);}
    while(shopNormals.some(shop=>shop.angleTo(result)<.45));
    return result;
  }
  people.forEach((person,index)=>{
    const animal=person.kind==='human'?null:person.kind;
    const skin=animal?(animal==='cat'?'#efd7ad':'#d5c8e5'):person.skin;
    let start=surface(person.lat,person.lon,1);
    if(shopNormals.some(shop=>shop.angleTo(start)<.5))start=randomDestination();
    const root=ground(Math.asin(start.y),Math.atan2(start.x,start.z));const body=new T.Group();root.add(body);body.scale.setScalar(.82);
    // Oversized heads and short articulated limbs give them a soft toy-like silhouette.
    const legs:T.Group[]=[],arms:T.Group[]=[];
    for(const side of [-1,1]){
      const leg=new T.Group();leg.position.set(side*.105,.28,0);body.add(leg);legs.push(leg);
      round(leg,index%2?'#f4e5c9':'#8d9eaa',.13,.24,.15,.06,0,-.095,0);ball(leg,'#eee7d7',0,-.2,.055,.095,.055,.135);
      const arm=new T.Group();arm.position.set(side*.23,.58,0);body.add(arm);arms.push(arm);
      round(arm,person.shirt,.12,.22,.13,.055,0,-.085,0);ball(arm,skin,0,-.21,0,.068,.072,.068);
    }
    round(body,person.shirt,.42,.39,.31,.12,0,.45,0);
    ball(body,skin,0,.88,0,.275,.29,.26);
    if(!animal){
    // Hair cap, bangs, and ears, with a bun/hat/headphones on different residents.
    const hairGeo=ownGeo(new T.SphereGeometry(.286,24,12,0,Math.PI*2,0,Math.PI*.51));mesh(hairGeo,person.hair,body,0,.95,-.015);
    ball(body,person.hair,-.16,1.055,.14,.13,.08,.13);ball(body,person.hair,.13,1.065,.14,.12,.075,.13);
    ball(body,person.hair,-.235,.97,-.03,.07,.17,.17);ball(body,person.hair,.235,.97,-.03,.07,.17,.17);
    ball(body,skin,-.27,.85,0,.054,.078,.055);ball(body,skin,.27,.85,0,.054,.078,.055);
    } else {
      for(const side of [-1,1]){
        if(animal==='cat'){
          const ear=mesh(ownGeo(new T.ConeGeometry(.125,.27,3)),skin,body,side*.18,1.16,0);ear.rotation.z=-side*.16;
          ball(body,'#dbadac',side*.18,1.17,.055,.055,.075,.018);
        }else{
          ball(body,skin,side*.14,1.33,-.025,.085,.28,.08);
          ball(body,'#e5b6cd',side*.14,1.35,.043,.04,.18,.025);
        }
      }
      ball(body,'#fff6e8',0,.77,.22,.13,.087,.075);
      ball(body,'#b68b85',0,.82,.294,.037,.025,.018);
      ball(body,skin,0,.32,-.21,.12);
    }
    for(const side of [-1,1]){ball(body,'#49423e',side*.095,.886,.265,.027,.035,.022);ball(body,'#e7a0a3',side*.177,.8,.23,.045,.027,.023);}
    const smileCurve=new T.CatmullRomCurve3([new T.Vector3(-.04,.8,.274),new T.Vector3(0,.781,.28),new T.Vector3(.04,.8,.274)]);
    mesh(ownGeo(new T.TubeGeometry(smileCurve,10,.009,5,false)),'#936a58',body);
    if(index%6===0){ball(body,person.hair,0,1.21,-.085,.135);ball(body,'#d582a5',.04,1.21,.05,.07);}
    if(index%6===1){
      const band=ownGeo(new T.TorusGeometry(.292,.035,8,20,Math.PI));const headphones=mesh(band,'#69587a',body,0,.93,0);headphones.rotation.z=0;
      for(const side of [-1,1])round(body,'#736681',.1,.17,.15,.05,side*.284,.9,0);
    }
    if(index%6===3){round(body,'#ddae78',.29,.31,.17,.06,0,.48,-.21);round(body,'#536567',.17,.12,.08,.025,0,.44,.2);ball(body,'#adc4c7',0,.44,.251,.035,.035,.01);}
    shadow(root,.7);
    const tag=fanmark(person.id);
    root.traverse(o=>{o.userData.person=person.id;if(o instanceof T.Mesh)targets.push(o);});
    walkers.push({id:person.id,root,body,tag,legs,arms,position:start.clone(),initial:start.clone(),direction:new T.Vector3(Math.cos(person.lon),0,-Math.sin(person.lon)),destination:randomDestination(),speed:person.speed,phase:index*1.8,headHeight:animal==='rabbit'?1.64:1.29});
  });
  // Static scenery batches share materials. People remain separate for walking animation.
  planet.updateMatrixWorld(true);
  const dynamic=new Set<T.Object3D>([...walkers.map(w=>w.root),...signs.map(s=>s.group)]);
  const batches=new Map<T.Material,T.Mesh[]>();
  planet.traverse(o=>{
    if(!(o instanceof T.Mesh)||Array.isArray(o.material)||o===globe)return;
    let parent:T.Object3D|null=o;while(parent&&parent!==planet){if(dynamic.has(parent))return;parent=parent.parent;}
    if(!batches.has(o.material))batches.set(o.material,[]);batches.get(o.material)!.push(o);
  });
  const inverse=new T.Matrix4().copy(planet.matrixWorld).invert();
  batches.forEach((objects,material)=>{
    if(objects.length<2)return;
    const parts=objects.map(o=>(o.geometry.index?o.geometry.toNonIndexed():o.geometry.clone()).applyMatrix4(new T.Matrix4().multiplyMatrices(inverse,o.matrixWorld)));
    const merged=mergeGeometries(parts);parts.forEach(p=>p.dispose());if(!merged)return;
    ownGeo(merged);objects.forEach(o=>o.removeFromParent());planet.add(new T.Mesh(merged,material));
  });

  function pose(){
    planet.rotation.set(tilt,yaw,0);planet.updateMatrixWorld(true);
    planet.getWorldQuaternion(planetInverse).invert();camera.getWorldQuaternion(cameraQuaternion);
    walkers.forEach(w=>{
      const up=w.position;
      const forward=w.direction.clone().addScaledVector(up,-w.direction.dot(up)).normalize();
      const right=new T.Vector3().crossVectors(up,forward).normalize();
      w.root.position.copy(up).multiplyScalar(R+.015);
      matrix.makeBasis(right,up,forward);w.root.quaternion.setFromRotationMatrix(matrix);
      const stride=Math.sin(time*4+w.phase);
      w.body.position.y=.035+Math.abs(stride)*.025;
      w.legs.forEach((leg,i)=>{leg.rotation.x=stride*(i?1:-1)*.42;});
      w.arms.forEach((arm,i)=>{arm.rotation.x=stride*(i?-1:1)*.32;});
      // Follow the actual animated head, including the resident's gentle lean.
      w.root.updateWorldMatrix(true,true);
      w.tag.position.set(0,w.headHeight,0).applyMatrix4(w.body.matrixWorld);
      w.tag.position.add(new T.Vector3(0,.54+Math.sin(time*1.5+w.phase)*.035,0).applyQuaternion(cameraQuaternion));
      planet.worldToLocal(w.tag.position);
      w.tag.quaternion.copy(planetInverse).multiply(cameraQuaternion);
      w.tag.scale.setScalar(w.id===selected?1.12:1);
    });
  }
  function draw(){if(disposed||failed)return;pose();renderer.render(scene,camera);host.dataset.renderCount=String(++count);host.dataset.drawCalls=String(renderer.info.render.calls);host.dataset.rotation=`${yaw.toFixed(3)},${tilt.toFixed(3)}`;host.dataset.zoom=zoomLevel.toFixed(2);}
  function resize(){const width=host.clientWidth,height=host.clientHeight;const aspect=width/Math.max(1,height);const span=width<420?8.2:8.4;camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;
    // Keep characters legible on narrow screens while cropping the lower planet.
    if(aspect<.9){camera.left=-3.7;camera.right=3.7;camera.top=3.7/aspect;camera.bottom=-3.7/aspect;}
    camera.zoom=zoomLevel;camera.updateProjectionMatrix();renderer.setPixelRatio(Math.min(devicePixelRatio,width<600?1.25:1.5));renderer.setSize(width,height,false);draw();
  }
  function walk(dt:number){
    walkers.forEach(w=>{
      if(w.position.angleTo(w.destination)<.15)w.destination=randomDestination();
      const desired=w.destination.clone().addScaledVector(w.position,-w.destination.dot(w.position)).normalize();
      for(const shop of shopNormals){
        const angle=w.position.angleTo(shop);
        if(angle<.58){
          const away=w.position.clone().sub(shop).addScaledVector(w.position,-w.position.clone().sub(shop).dot(w.position)).normalize();
          desired.addScaledVector(away,(.58-angle)*14);
        }
      }
      desired.normalize();
      w.direction.lerp(desired,Math.min(1,dt*2)).addScaledVector(w.position,-w.direction.dot(w.position)).normalize();
      const next=w.position.clone().addScaledVector(w.direction,w.speed*dt).normalize();
      if(shopNormals.every(shop=>shop.angleTo(next)>.34))w.position.copy(next);
      else w.destination=randomDestination();
    });
  }
  function tick(stamp:number){frame=0;if(disposed||failed||paused||!visible||document.hidden)return;if(stamp-last>=1000/30){const dt=Math.min((stamp-last)/1000,.07);time+=dt;walk(dt);last=stamp;draw();}frame=requestAnimationFrame(tick);}
  function sync(){cancelAnimationFrame(frame);last=performance.now();if(!disposed&&!failed&&!paused&&visible&&!document.hidden)frame=requestAnimationFrame(tick);}
  function rotate(x:number,y:number){yaw+=x;tilt=T.MathUtils.clamp(tilt+y,-1.15,1.15);draw();}
  function zoom(delta:number){zoomLevel=T.MathUtils.clamp(zoomLevel+delta,.75,1.8);camera.zoom=zoomLevel;camera.updateProjectionMatrix();draw();}
  function wheel(e:WheelEvent){if(e.ctrlKey||e.metaKey){e.preventDefault();zoom(-e.deltaY*.002);}}
  function select(id:PersonId){selected=id;draw();}
  function focus(id:PersonId){const w=walkers.find(w=>w.id===id)!;yaw=-Math.atan2(w.position.x,w.position.z);tilt=.06;select(id);}
  function point(event:PointerEvent){const rect=host.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
    // The planet itself occludes identities on the far side.
    const hits=ray.intersectObjects([globe,...targets.filter(o=>{let p:T.Object3D|null=o;while(p){if(!p.visible)return false;p=p.parent;}return true;})],false);return hits[0]?.object;
  }
  function down(e:PointerEvent){if(!e.isPrimary||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false,touch:e.pointerType==='touch'};host.setPointerCapture(e.pointerId);}
  function move(e:PointerEvent){if(!drag||drag.id!==e.pointerId){const hit=point(e);host.style.cursor=hit&&(hit.userData.person||hit.userData.sign!==undefined)?'pointer':'grab';return;}
    const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved ||= Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>7;
    drag.x=e.clientX;drag.y=e.clientY;if(drag.moved)rotate(dx*.008,drag.touch?0:dy*.006);
  }
  function up(e:PointerEvent){if(!drag||drag.id!==e.pointerId)return;const click=!drag.moved;drag=null;if(host.hasPointerCapture(e.pointerId))host.releasePointerCapture(e.pointerId);if(click){const hit=point(e);if(hit){const id=hit.userData.person as PersonId|undefined;if(id)select(id);const sign=hit.userData.sign!==undefined?signs[hit.userData.sign]:signs.find(s=>s.group.userData.person===id&&id);if(sign?.emoji)onSelect(sign.emoji);}}}
  function cancel(){drag=null;}
  function key(e:KeyboardEvent){const directions:Record<string,[number,number]>={ArrowLeft:[-.16,0],ArrowRight:[.16,0],ArrowUp:[0,-.12],ArrowDown:[0,.12]};if(directions[e.key]){e.preventDefault();rotate(...directions[e.key]);}}
  function lost(e:Event){e.preventDefault();failed=true;cancelAnimationFrame(frame);onFailure();}
  const resizeObserver=new ResizeObserver(resize);resizeObserver.observe(host);
  const intersection=new IntersectionObserver(([entry])=>{visible=entry.isIntersecting;sync();},{threshold:.01});intersection.observe(host);
  host.addEventListener('pointerdown',down);host.addEventListener('pointermove',move);host.addEventListener('pointerup',up);host.addEventListener('pointercancel',cancel);host.addEventListener('lostpointercapture',cancel);host.addEventListener('keydown',key);host.addEventListener('wheel',wheel,{passive:false});
  renderer.domElement.addEventListener('webglcontextlost',lost);document.addEventListener('visibilitychange',sync);
  resize();sync();
  return {select,focus,rotate,zoom,
    setFanmarks(emojis){if(assigned)return;assigned=true;fanmarks=[...new Set([...emojis.filter(Boolean),...fallbackFanmarks])];updateSigns();draw();},
    setPaused(value){paused=value;sync();draw();},
    reset(){yaw=0;tilt=.06;time=0;walkers.forEach(w=>{w.position.copy(w.initial);w.destination=randomDestination();});zoomLevel=1.25;camera.zoom=zoomLevel;camera.updateProjectionMatrix();draw();},
    dispose(){disposed=true;cancelAnimationFrame(frame);resizeObserver.disconnect();intersection.disconnect();document.removeEventListener('visibilitychange',sync);host.removeEventListener('pointerdown',down);host.removeEventListener('pointermove',move);host.removeEventListener('pointerup',up);host.removeEventListener('pointercancel',cancel);host.removeEventListener('lostpointercapture',cancel);host.removeEventListener('keydown',key);host.removeEventListener('wheel',wheel);renderer.domElement.removeEventListener('webglcontextlost',lost);geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());renderer.dispose();renderer.domElement.remove();},
  };
}
