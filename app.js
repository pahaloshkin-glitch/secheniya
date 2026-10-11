import * as THREE from './vendor/three.module.js';
import { OrbitControls } from './vendor/OrbitControls.js';

const $ = (selector) => document.querySelector(selector);
const viewport = $('#viewport');
const canvas = $('#sceneCanvas');
const objectTree = $('#objectTree');
const figureSelect = $('#figureSelect');
const tooltip = $('#toolTip');
const sceneHint = $('#sceneHint');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x0a2025, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
camera.position.set(5.4, 4.15, 5.8);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 2.5;
controls.maxDistance = 13;
controls.maxPolarAngle = Math.PI * 0.91;
controls.addEventListener('start',()=>{lastInteraction=performance.now();cameraTween=null;});

scene.add(new THREE.HemisphereLight(0xc5fff5, 0x12363a, 2.1));
const keyLight = new THREE.DirectionalLight(0xa8fff0, 2.4);
keyLight.position.set(3, 5, 4); scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0x77b9ff, 1.4);
rimLight.position.set(-4, 1, -4); scene.add(rimLight);

const grid = new THREE.GridHelper(9, 18, 0x2e5d60, 0x1f474b);
grid.position.y = -1.43;
grid.material.transparent = true;
grid.material.opacity = 0.42;
scene.add(grid);

const modelGroup = new THREE.Group();
const pointsGroup = new THREE.Group();
const lineGroup = new THREE.Group();
const planeGroup = new THREE.Group();
const solverGroup = new THREE.Group();
const referencePlaneGroup = new THREE.Group();
scene.add(referencePlaneGroup, modelGroup, pointsGroup, lineGroup, planeGroup, solverGroup);

const referencePlanes = {};
function makeReferencePlane(name, color, rotation, position) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 4.7, 1, 1), new THREE.MeshBasicMaterial({color,transparent:true,opacity:.105,side:THREE.DoubleSide,depthWrite:false}));
  mesh.rotation.set(rotation.x,rotation.y,rotation.z);mesh.position.set(position.x,position.y,position.z);mesh.renderOrder=0;
  const border = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(4.7,4.7)),new THREE.LineBasicMaterial({color,transparent:true,opacity:.55}));
  border.rotation.copy(mesh.rotation);border.position.copy(mesh.position);border.renderOrder=2;group.add(mesh,border);group.visible=false;referencePlaneGroup.add(group);referencePlanes[name]=group;
}
makeReferencePlane('xy',0xef82b5,new THREE.Euler(0,0,0),new THREE.Vector3(0,0,0));
makeReferencePlane('xz',0x71d8ef,new THREE.Euler(-Math.PI/2,0,0),new THREE.Vector3(0,0,0));
makeReferencePlane('yz',0x94e7b1,new THREE.Euler(0,Math.PI/2,0),new THREE.Vector3(0,0,0));

const raycaster = new THREE.Raycaster();
raycaster.params.Line.threshold = 0.11;
const pointer = new THREE.Vector2();
const downPos = new THREE.Vector2();
let downPointerType = 'mouse';
let solidMesh = null;
let modelEdges = null;
let edgePairs = [];
let modelVertices = [];
let currentFaces = [];
let triangleFaceMap = [];
let activeTool = 'select';
let currentFigure = 'cube';
let pointSerial = 1;
let intersectionSerial = 1;
let entitySerial = 1;
let allVisible = true;
let snapEnabled = true;
let motionEnabled = true;
let mobileDockTools = ['select','point','segment','plane'];
let toastTimer = null;
let lastInteraction = performance.now();
let cameraTween = null;
const clock = new THREE.Clock();
const solver = { open:false, step:-1, points:[], data:null, finalEntity:null };

const state = {
  points: new Map(),
  entities: [],
  selectedPoints: new Set(),
  selectedEntity: null,
  selectedEntities: new Set(),
  history: [],
  redo: []
};

let pointStyle={shape:'circle',color:'mint'};
const pointPalettes={mint:{vertex:0x68dfd0,user:0xffcb71,selected:0xff9a78,halo:0x49cfc1},sky:{vertex:0x76b7ff,user:0x8ce7ff,selected:0xffcf75,halo:0x548fe8},coral:{vertex:0xff9a78,user:0xffcf71,selected:0xffecb0,halo:0xff765f},violet:{vertex:0xb798ff,user:0xd9b5ff,selected:0xffd278,halo:0x8e6de8}};
function pointGeometry(kind){const radius=kind==='vertex'?.062:.074;if(pointStyle.shape==='diamond')return new THREE.OctahedronGeometry(radius,1);if(pointStyle.shape==='star')return new THREE.IcosahedronGeometry(radius,1);return new THREE.SphereGeometry(radius,18,12);}
function pointColor(kind){return pointPalettes[pointStyle.color]?.[kind==='vertex'?'vertex':'user']||0x68dfd0;}
function selectedPointColor(){return pointPalettes[pointStyle.color]?.selected||0xff9a78;}
function pointHaloColor(){return pointPalettes[pointStyle.color]?.halo||0x49cfc1;}

const figureData = {
  cube: {
    title: 'Куб', caption: 'Выберите три точки на рёбрах — и постройте сечение.',
    vertices: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[-1,1,-1],[1,1,-1],[1,1,1],[-1,1,1]],
    names: ['A','B','C','D','A₁','B₁','C₁','D₁'],
    faces: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
  },
  box: {
    title: 'Прямоугольный параллелепипед', caption: 'Исследуйте диагональные сечения и их контуры.',
    vertices: [[-1.35,-.8,-.8],[1.35,-.8,-.8],[1.35,-.8,.8],[-1.35,-.8,.8],[-1.35,.8,-.8],[1.35,.8,-.8],[1.35,.8,.8],[-1.35,.8,.8]],
    names: ['A','B','C','D','A₁','B₁','C₁','D₁'],
    faces: [[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]]
  },
  triPrism: {
    title: 'Треугольная призма', caption: 'Отметьте точки на трёх разных рёбрах призмы.',
    vertices: [[-1,-1,-.82],[1,-1,-.82],[0,-1,1],[-1,1,-.82],[1,1,-.82],[0,1,1]],
    names: ['A','B','C','A₁','B₁','C₁'],
    faces: [[0,2,1],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]]
  },
  hexPrism: (() => {
    const vertices = [], names = [];
    for (let y of [-1,1]) for (let i=0;i<6;i++) { const a=Math.PI/6+i*Math.PI/3; vertices.push([Math.cos(a)*1.1,y,Math.sin(a)*1.1]); names.push((y<0?'A':'A′')+(i+1)); }
    return {title:'Шестиугольная призма',caption:'Шесть боковых граней дают особенно интересные сечения.',vertices,names,faces:[[0,1,2,3,4,5],[6,11,10,9,8,7],...Array.from({length:6},(_,i)=>[i,(i+1)%6,(i+1)%6+6,i+6])]};
  })(),
  tetra: {
    title: 'Тетраэдр', caption: 'Четыре грани, четыре вершины и множество способов построения.',
    vertices: [[-1,-.9,-.72],[1,-.9,-.72],[0,-.9,1.05],[0,1.22,0]],
    names: ['A','B','C','D'], faces: [[0,2,1],[0,1,3],[1,2,3],[2,0,3]]
  },
  pyramid: {
    title: 'Четырёхугольная пирамида', caption: 'Постройте сечение через основание и боковые рёбра.',
    vertices: [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1],[0,1.35,0]],
    names: ['A','B','C','D','S'], faces: [[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]]
  },
  cylinder: (() => {
    const n=18,vertices=[],faces=[];
    for(let y of [-1,1]) for(let i=0;i<n;i++){const a=i/n*Math.PI*2;vertices.push([Math.cos(a),y,Math.sin(a)]);}
    faces.push(Array.from({length:n},(_,i)=>i)); faces.push(Array.from({length:n},(_,i)=>n+i));
    for(let i=0;i<n;i++) faces.push([i,(i+1)%n,(i+1)%n+n,i+n]);
    return {title:'Цилиндр',caption:'Добавьте свои точки на образующих или окружностях основания.',vertices,names:[],faces,hideVertices:true};
  })()
};

function uid(prefix) { return `${prefix}-${entitySerial++}`; }
function recordHistory(entry){state.history.push(entry);state.redo=[];}
function clearGroup(group) { while(group.children.length) group.remove(group.children[0]); }
function disposeGroup(group){group.traverse(o=>{o.geometry?.dispose?.();if(o.material){const materials=Array.isArray(o.material)?o.material:[o.material];materials.forEach(m=>{m.map?.dispose?.();m.dispose?.();});}});clearGroup(group);}
function makeRoundedRect(ctx,x,y,w,h,r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); }
function textSprite(text, kind='vertex') {
  // Всегда одинаковая геометрия ярлыка: длинные имена не растягивают подпись в сцене.
  const c = document.createElement('canvas'); c.width = 192; c.height = 64;
  const ctx = c.getContext('2d'); const safeText=String(text).trim() || 'P'; const shown=safeText.length>8?`${safeText.slice(0,7)}…`:safeText;
  const colors = kind === 'vertex' ? ['#143c3d','#aaf6e9'] : kind === 'section' ? ['#4a2c25','#ffd0bf'] : ['#4a4021','#ffe6a1'];
  makeRoundedRect(ctx, 5, 7, 182, 46, 13); ctx.fillStyle=colors[0]; ctx.fill(); ctx.strokeStyle='rgba(220,255,249,.35)';ctx.lineWidth=1;ctx.stroke();
  let size=25;ctx.font=`700 ${size}px Courier New, monospace`;while(ctx.measureText(shown).width>142&&size>16){size-=1;ctx.font=`700 ${size}px Courier New, monospace`;}
  ctx.fillStyle=colors[1];ctx.textBaseline='middle';ctx.textAlign='center';ctx.fillText(shown,96,31);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.minFilter=THREE.LinearFilter;tex.magFilter=THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({map:tex,transparent:true,depthTest:false}));
  sprite.scale.set(.43,.143,1);sprite.userData.fullLabel=safeText;return sprite;
}

function animateObjectIn(object, config={}){object.userData.pop={start:performance.now(),duration:config.duration||300,from:config.from??.18};object.scale.setScalar(config.from??.18);}
function updateObjectAnimations(now){const roots=[modelGroup,pointsGroup,lineGroup,planeGroup];if(!motionEnabled){roots.forEach(root=>root.traverse(o=>{if(o.userData?.pop){o.scale.setScalar(1);delete o.userData.pop;}}));state.points.forEach(point=>{point.halo.material.opacity=state.selectedPoints.has(point.id)?.24:.1;point.halo.scale.setScalar(1);});return;}roots.forEach(root=>root.traverse(o=>{const pop=o.userData?.pop;if(!pop)return;const t=Math.min(1,(now-pop.start)/pop.duration);const eased=1-Math.pow(1-t,3);const overshoot=eased<.82?eased:(1+(eased-1)*.18);o.scale.setScalar(pop.from+(1-pop.from)*overshoot);if(t>=1){o.scale.setScalar(1);delete o.userData.pop;}}));const wave=(Math.sin(clock.getElapsedTime()*3.1)+1)/2;state.points.forEach(point=>{if(!point.visible)return;const selected=state.selectedPoints.has(point.id);point.ball.rotation.y+=selected?.026:.009;point.ball.rotation.x+=selected?.013:.004;point.halo.material.opacity=selected?.24:.08+wave*.045;point.halo.scale.setScalar(selected?1.75:1.05+wave*.13);});}
function defaultPointName() { let n; do { n = `P${pointSerial++}`; } while([...state.points.values()].some(p=>p.name===n)); return n; }
function updatePointVisual(point) {
  const selected = state.selectedPoints.has(point.id);
  point.ball.material.color.set(selected ? selectedPointColor() : pointColor(point.kind));
  point.ball.material.emissive.set(selected ? 0x24443d : 0x000000);
  point.halo.material.color.set(pointHaloColor());
  point.ball.scale.setScalar(selected ? 1.28 : 1);
  point.label.position.copy(point.position).add(new THREE.Vector3(.075,.13,.055));
}
function addPoint(position, name = defaultPointName(), options = {}) {
  const id = options.id || uid('point'); const kind=options.kind || 'user';
  const g=new THREE.Group(); const material=new THREE.MeshStandardMaterial({color:pointColor(kind),emissive:0x000000,roughness:.28,metalness:.18,flatShading:pointStyle.shape!=='circle'});
  const ball=new THREE.Mesh(pointGeometry(kind),material); ball.userData={kind:'point',pointId:id};
  const halo=new THREE.Mesh(new THREE.SphereGeometry(kind==='vertex'?.102:.122,16,10),new THREE.MeshBasicMaterial({color:pointHaloColor(),transparent:true,opacity:.10,depthWrite:false}));
  const label=textSprite(name,kind); g.add(halo,ball,label); g.position.copy(position); label.position.copy(position).add(new THREE.Vector3(.075,.13,.055)); // sprite position must be world, reparent below
  g.remove(label); pointsGroup.add(g); pointsGroup.add(label);
  const point={id,name,kind,position:position.clone(),group:g,ball,halo,label,removable:options.removable!==false,visible:true};
  state.points.set(id,point); updatePointVisual(point);if(!options.silent)animateObjectIn(g);
  if (!options.noHistory) recordHistory({type:'point',id});
  return point;
}
function removePoint(id, options={}) { const p=state.points.get(id); if(!p) return null;const dependents=options.cascade===false?[]:state.entities.filter(e=>e.pids?.includes(id)).map(e=>e.id);dependents.forEach(entityId=>removeEntity(entityId,{preserve:options.preserve}));pointsGroup.remove(p.group);pointsGroup.remove(p.label);if(!options.preserve){p.ball.geometry.dispose();p.ball.material.dispose();p.halo.geometry.dispose();p.halo.material.dispose();p.label.material.map.dispose();p.label.material.dispose();}state.points.delete(id);state.selectedPoints.delete(id);return p; }
function restorePoint(point){if(!point||state.points.has(point.id))return;state.points.set(point.id,point);pointsGroup.add(point.group);pointsGroup.add(point.label);updatePointVisual(point);}
function refreshPointLabel(point) { pointsGroup.remove(point.label); point.label.material.map.dispose(); point.label.material.dispose(); point.label=textSprite(point.name,point.kind); point.label.position.copy(point.position).add(new THREE.Vector3(.075,.13,.055)); pointsGroup.add(point.label); updatePointVisual(point); }
function applyPointStyle(shape,color,announce=true){if(['circle','diamond','star'].includes(shape))pointStyle.shape=shape;if(pointPalettes[color])pointStyle.color=color;state.points.forEach(point=>{point.ball.geometry.dispose();point.ball.geometry=pointGeometry(point.kind);point.ball.material.flatShading=pointStyle.shape!=='circle';point.ball.material.needsUpdate=true;updatePointVisual(point);});document.querySelectorAll('[data-point-shape]').forEach(btn=>btn.classList.toggle('active',btn.dataset.pointShape===pointStyle.shape));document.querySelectorAll('[data-point-color]').forEach(btn=>btn.classList.toggle('active',btn.dataset.pointColor===pointStyle.color));try{localStorage.setItem('pavlik-point-style',JSON.stringify(pointStyle));}catch(_){ }if(announce)showToast(`Точки: ${pointStyle.shape==='circle'?'круг':pointStyle.shape==='diamond'?'кристалл':'звезда'} · новый цвет применён.`);}

function getEdges(faces) { const set=new Set(), arr=[]; faces.forEach(face=>face.forEach((a,i)=>{const b=face[(i+1)%face.length], key=a<b?`${a}-${b}`:`${b}-${a}`;if(!set.has(key)){set.add(key);arr.push([a,b]);}})); return arr; }
function buildSolid(key) {
  currentFigure=key; const def=figureData[key];
  disposeGroup(modelGroup); disposeGroup(pointsGroup); disposeGroup(lineGroup); disposeGroup(planeGroup);
  state.points.clear();state.entities=[];state.selectedPoints.clear();state.selectedEntity=null;state.selectedEntities.clear();state.history=[];state.redo=[];pointSerial=1;intersectionSerial=1;clearSolverGhost();solver.step=-1;solver.points=[];solver.data=null;solver.finalEntity=null;allVisible=true;modelGroup.visible=true;pointsGroup.visible=true;lineGroup.visible=true;planeGroup.visible=true;solverGroup.visible=true;referencePlaneGroup.visible=true;
  const vertices=def.vertices.map(v=>new THREE.Vector3(...v));modelVertices=vertices;currentFaces=def.faces;triangleFaceMap=[];edgePairs=getEdges(def.faces).map(([a,b])=>[vertices[a],vertices[b]]);
  const positions=[]; def.faces.forEach((face,faceIndex)=>{for(let i=1;i<face.length-1;i++){[face[0],face[i],face[i+1]].forEach(index=>positions.push(...vertices[index].toArray()));triangleFaceMap.push(faceIndex);}});
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  const material=new THREE.MeshPhysicalMaterial({color:0x3d8f8d,roughness:.3,metalness:.05,transparent:true,opacity:.24,side:THREE.DoubleSide,depthWrite:false,clearcoat:.2});
  solidMesh=new THREE.Mesh(geometry,material); solidMesh.userData={kind:'solid'};solidMesh.renderOrder=1;modelGroup.add(solidMesh);
  const edgePositions=[];edgePairs.forEach(([a,b])=>edgePositions.push(...a.toArray(),...b.toArray()));
  const edgeGeometry=new THREE.BufferGeometry();edgeGeometry.setAttribute('position',new THREE.Float32BufferAttribute(edgePositions,3));
  const lines=new THREE.LineSegments(edgeGeometry,new THREE.LineBasicMaterial({color:0xb6f0e9,transparent:true,opacity:.9}));lines.renderOrder=3;lines.userData={kind:'modelEdges'};modelEdges=lines;modelGroup.add(lines);
  if(!def.hideVertices){vertices.forEach((v,i)=>addPoint(v,def.names[i]||`V${i+1}`,{kind:'vertex',removable:false,noHistory:true,silent:true}));}
  $('#figureCrumb').textContent=def.title; $('#stageTitle').textContent=`3D-модель · ${def.title}`;$('#figureCaption').textContent=def.caption;figureSelect.value=key;document.querySelectorAll('[data-figure]').forEach(btn=>btn.classList.toggle('active',btn.dataset.figure===key));
  grid.position.y=Math.min(...vertices.map(v=>v.y))-.42;
  modelGroup.userData.pop={start:performance.now(),duration:430,from:.78};
  controls.target.set(0,0,0);setCameraDistance(7);renderTree();updateUI();
}

function addLine(p1,p2,extended=false) {
  const id=uid(extended?'trace':'line'); const a=p1.position.clone(), b=p2.position.clone();
  if(extended){const dir=b.clone().sub(a).normalize();const mid=a.clone().add(b).multiplyScalar(.5);a.copy(mid).addScaledVector(dir,-5);b.copy(mid).addScaledVector(dir,5);}
  const geom=new THREE.BufferGeometry().setFromPoints([a,b]);const mat=extended?new THREE.LineDashedMaterial({color:0x75e0d1,dashSize:.12,gapSize:.08,transparent:true,opacity:.93}):new THREE.LineBasicMaterial({color:0x76b7ff});
  const line=new THREE.Line(geom,mat);if(extended)line.computeLineDistances();line.renderOrder=5;line.userData={kind:'entity',entityId:id};lineGroup.add(line);
  const entity={id,type:extended?'trace':'line',name:extended?`След ${p1.name}${p2.name}`:`${p1.name}${p2.name}`,obj:line,pids:[p1.id,p2.id],visible:true,removable:true};state.entities.push(entity);recordHistory({type:'entity',id});animateObjectIn(line,{from:.05,duration:240});return entity;
}
function removeEntity(id,options={}) {const i=state.entities.findIndex(e=>e.id===id);if(i<0)return null;const e=state.entities[i];(e.type==='plane'?planeGroup:lineGroup).remove(e.obj);if(!options.preserve)e.obj.traverse?.(o=>{if(o.geometry)o.geometry.dispose?.();if(o.material)o.material.dispose?.();});state.entities.splice(i,1);state.selectedEntities.delete(id);if(state.selectedEntity===id)state.selectedEntity=null;return e;}
function restoreEntity(entity){if(!entity||state.entities.some(e=>e.id===entity.id))return;state.entities.push(entity);(entity.type==='plane'?planeGroup:lineGroup).add(entity.obj);}
function dedupe(points){const result=[];for(const p of points)if(!result.some(q=>q.distanceToSquared(p)<.00005))result.push(p);return result;}
function calculateSection(selected) {
  if(selected.length!==3)return null;const [p1,p2,p3]=selected;const normal=p2.position.clone().sub(p1.position).cross(p3.position.clone().sub(p1.position));
  if(normal.lengthSq()<.0005)return {error:'Эти точки лежат на одной прямой — выберите другие.'};normal.normalize();const hits=[];
  edgePairs.forEach(([a,b])=>{const da=normal.dot(a.clone().sub(p1.position)),db=normal.dot(b.clone().sub(p1.position));if(Math.abs(da)<.0001)hits.push(a.clone());if(Math.abs(db)<.0001)hits.push(b.clone());if(da*db<-.0000001){const t=da/(da-db);hits.push(a.clone().lerp(b,t));}});
  const polygon=dedupe(hits);if(polygon.length<3)return {error:'Плоскость не пересекает фигуру. Попробуйте другие точки.'};
  const center=polygon.reduce((s,p)=>s.add(p),new THREE.Vector3()).multiplyScalar(1/polygon.length);let u=polygon[0].clone().sub(center);if(u.lengthSq()<.0001)u=new THREE.Vector3(1,0,0);u.normalize();const v=new THREE.Vector3().crossVectors(normal,u).normalize();polygon.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(v),a.clone().sub(center).dot(u))-Math.atan2(b.clone().sub(center).dot(v),b.clone().sub(center).dot(u)));return {polygon,normal,center};
}
function createSection(selected, prepared=null) {
  const calculated=prepared||calculateSection(selected);if(!calculated||calculated.error){showToast(calculated?.error||'Не удалось построить сечение.');return null;}const {polygon,normal,center}=calculated;
  const pos=[];for(let i=1;i<polygon.length-1;i++)pos.push(...polygon[0].toArray(),...polygon[i].toArray(),...polygon[i+1].toArray());
  const surfaceGeo=new THREE.BufferGeometry();surfaceGeo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));surfaceGeo.computeVertexNormals();
  const group=new THREE.Group();const face=new THREE.Mesh(surfaceGeo,new THREE.MeshBasicMaterial({color:0xff9977,transparent:true,opacity:.28,side:THREE.DoubleSide,depthWrite:false}));face.renderOrder=4;group.add(face);
  const outline=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(polygon),new THREE.LineBasicMaterial({color:0xffab8e,transparent:true,opacity:1}));outline.renderOrder=6;group.add(outline);
  polygon.forEach(position=>{const pin=new THREE.Mesh(new THREE.SphereGeometry(.043,14,10),new THREE.MeshBasicMaterial({color:0xffc0a7,depthTest:false}));pin.position.copy(position);pin.renderOrder=7;group.add(pin);});
  const label=textSprite('α', 'section');label.position.copy(center).addScaledVector(normal,.11);label.renderOrder=8;group.add(label);planeGroup.add(group);
  const id=uid('plane');group.userData={kind:'entity',entityId:id};const entity={id,type:'plane',name:`α · сечение (${polygon.length} уг.)`,obj:group,pids:selected.map(p=>p.id),visible:true,removable:true,polygon};state.entities.push(entity);recordHistory({type:'entity',id});animateObjectIn(group);return entity;
}

function linePoints(entity){const attr=entity?.obj?.geometry?.getAttribute('position');if(!attr||attr.count<2)return null;return [new THREE.Vector3().fromBufferAttribute(attr,0),new THREE.Vector3().fromBufferAttribute(attr,1)];}
function closestLineIntersection(a0,a1,b0,b1){const r=a1.clone().sub(a0),s=b1.clone().sub(b0),w=a0.clone().sub(b0);const A=r.dot(r),B=r.dot(s),C=s.dot(s),D=r.dot(w),E=s.dot(w),den=A*C-B*B;if(Math.abs(den)<.00001)return {error:'Прямые параллельны или совпадают.'};const t=(B*E-C*D)/den,u=(A*E-B*D)/den,p=a0.clone().addScaledVector(r,t),q=b0.clone().addScaledVector(s,u),distance=p.distanceTo(q);if(distance>.1)return {error:'Прямые скрещиваются и не имеют общей точки.'};return {point:p.add(q).multiplyScalar(.5),t,u};}
function createIntersection(first,second,requireOnEdge=false){const a=linePoints(first);const b=Array.isArray(second)?second:linePoints(second);if(!a||!b){showToast('Сначала выберите две построенные прямые.');return null;}const result=closestLineIntersection(a[0],a[1],b[0],b[1]);if(result.error){showToast(result.error);return null;}if(requireOnEdge&&(result.u<-.02||result.u>1.02)){showToast('Продлённая прямая не пересекает выбранное ребро.');return null;}const name=`I${intersectionSerial++}`;const p=addPoint(result.point,name);clearPointSelection();state.selectedPoints.add(p.id);updatePointVisual(p);showToast(`Точка пересечения ${name} добавлена.`);return p;}
function clearSolverGhost(){while(solverGroup.children.length){const child=solverGroup.children[0];solverGroup.remove(child);child.traverse?.(o=>{o.geometry?.dispose?.();o.material?.dispose?.();});}}
function solverLine(points,color,dashed=false){const geo=new THREE.BufferGeometry().setFromPoints(points);const mat=dashed?new THREE.LineDashedMaterial({color,dashSize:.1,gapSize:.08,transparent:true,opacity:.92}):new THREE.LineBasicMaterial({color,transparent:true,opacity:.92});const line=points.length>2?new THREE.LineLoop(geo,mat):new THREE.Line(geo,mat);if(dashed)line.computeLineDistances();line.renderOrder=8;solverGroup.add(line);return line;}
function prepareSolverData(data,selected){const n=data.polygon.length;data.polyLabels=Array(n).fill(null);selected.forEach(point=>{let nearest=-1,best=Infinity;data.polygon.forEach((position,index)=>{const distance=position.distanceTo(point.position);if(distance<best){best=distance;nearest=index;}});if(best<.14&&nearest>=0)data.polyLabels[nearest]=point.name;});let a=0,b=1;for(let i=0;i<n;i++){const next=(i+1)%n;if(data.polyLabels[i]&&data.polyLabels[next]){a=i;b=next;break;}}if(!(data.polyLabels[a]&&data.polyLabels[b])){const known=data.polyLabels.findIndex(Boolean);if(known>=0){a=known;b=(known+1)%n;}}let q=1;for(let i=0;i<n;i++)if(!data.polyLabels[i])data.polyLabels[i]=`Q${q++}`;data.trace={a,b};data.revealOrder=Array.from({length:n},(_,i)=>i).filter(i=>i!==a&&i!==b);return data;}
function solverDot(position,label,accent=false){const dot=new THREE.Mesh(new THREE.SphereGeometry(.052,15,10),new THREE.MeshBasicMaterial({color:accent?0x8df2e2:0xffd2bd,depthTest:false}));dot.position.copy(position);dot.renderOrder=9;solverGroup.add(dot);const tag=textSprite(label,'section');tag.position.copy(position).add(new THREE.Vector3(.03,.1,.03));tag.scale.multiplyScalar(.7);tag.renderOrder=10;solverGroup.add(tag);}
function drawSolverGuide(step){clearSolverGhost();if(!solver.data||step<0)return;const data=solver.data,poly=data.polygon,{a,b}=data.trace,first=poly[a],second=poly[b],dir=second.clone().sub(first).normalize(),mid=first.clone().add(second).multiplyScalar(.5);if(step>=1){solverLine([first,second],0x76b7ff);solverDot(first,data.polyLabels[a],true);solverDot(second,data.polyLabels[b],true);}if(step>=2)solverLine([mid.clone().addScaledVector(dir,-4),mid.clone().addScaledVector(dir,4)],0x75e0d1,true);const revealed=Math.min(data.revealOrder.length,Math.max(0,step-2));for(let i=0;i<revealed;i++){const index=data.revealOrder[i];solverDot(poly[index],data.polyLabels[index]);}if(step>=3+data.revealOrder.length)solverLine(poly,0xffc0a7,true);}
function setSolverOpen(open){solver.open=open;$('#solverDock').classList.toggle('open',open);if(!open){clearSolverGhost();solver.step=-1;solver.points=[];solver.data=null;solver.finalEntity=null;}updateSolverDock();}
function solverMeta(){const count=solver.data?.revealOrder?.length||0,trace=solver.data?.trace,labels=solver.data?.polyLabels;if(solver.step<0)return ['Отметьте три точки','Выберите на фигуре 3 точки, через которые должна пройти секущая плоскость. Можно выбрать вершины, добавить точки или использовать пересечения.','Проверить точки',0];if(solver.step===0)return ['Три точки задают сечение','Точки уже отмечены на модели. Не показываем готовую плоскость заранее: сначала найдём её первый след на грани фигуры.','Найти первый след',1];if(solver.step===1)return ['Первый след на грани',`Голубой отрезок соединяет ${labels?.[trace?.a]||'P'} и ${labels?.[trace?.b]||'Q'}. Обе конечные точки выделены на модели, поэтому прямая не возникает «из ниоткуда».`,'Продлить след',2];if(solver.step===2)return ['Продлеваем найденный след','Мятный пунктир — это та же прямая, продлённая в пределах рабочей плоскости. Теперь она помогает найти следующие пересечения с рёбрами.','Найти следующую точку',2];if(solver.step>=3&&solver.step<=2+count){const found=solver.step-2;return [`Найдена точка ${found} из ${count}`,`Появилась ${labels?.[solver.data.revealOrder[found-1]]||`Q${found}`}: она лежит одновременно на ребре фигуры и на секущей плоскости.`,'Найти следующую точку',3];}if(solver.step===3+count)return ['Контур почти готов','Все точки пересечения уже отмечены. Пунктир показывает порядок их соединения, но плоскость ещё не залита.','Показать сечение',3];return ['Готово','Контур замкнут, поэтому можно показать заполненное сечение. Его можно вращать, скрывать и использовать в следующих построениях.','Новый разбор',4];}
function updateSolverDock(){if(!solver.open)return;const [title,text,button,phase]=solverMeta();$('#solverTitle').textContent=title;$('#solverText').textContent=text;$('#solverNext').textContent=button;const finalStep=4+(solver.data?.revealOrder?.length||0);$('#solverBack').disabled=solver.step<=0||solver.step>=finalStep;document.querySelectorAll('.solver-progress i').forEach((el,i)=>el.classList.toggle('active',i<phase));}
function solverNext(){if(!solver.open)return;if(solver.step===-1){const selected=selectedPoints();if(selected.length!==3){showToast(`Для решатора нужно выбрать 3 точки. Сейчас: ${selected.length}.`);return;}const data=calculateSection(selected);if(data?.error){showToast(data.error);return;}solver.points=selected;solver.data=prepareSolverData(data,selected);solver.step=0;drawSolverGuide(solver.step);showToast('Три точки приняты. Начинаем построение без показа готового ответа.');updateSolverDock();return;}const outlineStep=3+solver.data.revealOrder.length,finalStep=4+solver.data.revealOrder.length;if(solver.step<outlineStep){solver.step+=1;drawSolverGuide(solver.step);updateSolverDock();return;}if(solver.step===outlineStep){clearSolverGhost();solver.finalEntity=createSection(solver.points,solver.data);if(!solver.finalEntity)return;solver.step=finalStep;renderTree();updateUI();showToast('Ответ построен только после всех промежуточных точек.');return;}clearSolverGhost();solver.step=-1;solver.points=[];solver.data=null;solver.finalEntity=null;clearPointSelection();setActiveTool('plane');updateSolverDock();}
function solverBack(){const finalStep=4+(solver.data?.revealOrder?.length||0);if(solver.step<=0||solver.step>=finalStep)return;solver.step-=1;drawSolverGuide(solver.step);updateSolverDock();}
function setActiveTool(tool) {activeTool=tool;document.querySelectorAll('.tool').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));document.querySelectorAll('[data-mobile-tool]').forEach(b=>b.classList.toggle('active',b.dataset.mobileTool===tool));$('#faceFocusBtn')?.classList.toggle('active',tool==='faceView');const label={select:'ВЫБОР',point:'ТОЧКА',segment:'ОТРЕЗОК',plane:'СЕЧЕНИЕ',extend:'СЛЕД',intersect:'ПЕРЕСЕЧЕНИЕ',edgeCross:'РЕБРО',faceView:'ГРАНЬ'}[tool];$('#modeBadge').textContent=label;const help={select:'Кликните по точке, чтобы добавить её в выделение.',point:'Кликните по грани или ребру, чтобы добавить новую точку.',segment:'Выберите две точки и соедините их отрезком.',plane:'Выберите три точки — через них пройдёт секущая плоскость.',extend:'Выберите две точки, чтобы продлить прямую.',intersect:'Выберите две построенные прямые — на сцене или в списке объектов.',edgeCross:'Выберите построенную прямую, затем кликните по ребру фигуры.',faceView:'Нажмите на грань фигуры — камера развернет её к вам.'}[tool];$('#commandText').textContent=help;tooltip.textContent=help;sceneHint.style.opacity=tool==='select'?1:.65;if(window.innerWidth<761)closeMobilePanels?.();updateUI();}
function clearPointSelection(){state.selectedPoints.clear();state.selectedEntity=null;state.selectedEntities.clear();state.points.forEach(updatePointVisual);}
function togglePoint(id){const p=state.points.get(id);if(!p||!p.visible)return;state.selectedEntity=null;state.selectedEntities.clear();if(state.selectedPoints.has(id))state.selectedPoints.delete(id);else state.selectedPoints.add(id);state.points.forEach(updatePointVisual);renderTree();updateUI();}
function selectEntity(id){const entity=state.entities.find(e=>e.id===id);if(!entity)return;if(activeTool==='intersect'){if(entity.type==='plane'){showToast('Для пересечения выберите две прямые, а не плоскость.');return;}state.selectedPoints.clear();if(state.selectedEntities.has(id)){state.selectedEntities.delete(id);state.selectedEntity=[...state.selectedEntities][0]||null;}else{state.selectedEntities.add(id);state.selectedEntity=id;}}else if(activeTool==='edgeCross'){if(entity.type==='plane'){showToast('Для этого инструмента нужна прямая.');return;}state.selectedPoints.clear();state.selectedEntities.clear();state.selectedEntities.add(id);state.selectedEntity=id;}else{state.selectedEntity=id;state.selectedEntities.clear();state.selectedEntities.add(id);state.selectedPoints.clear();}state.points.forEach(updatePointVisual);renderTree();updateUI();}
function selectedPoints(){return [...state.selectedPoints].map(id=>state.points.get(id)).filter(Boolean);}
function selectedLines(){return [...state.selectedEntities].map(id=>state.entities.find(e=>e.id===id)).filter(e=>e&&(e.type==='line'||e.type==='trace'));}
function requiredCount(){return activeTool==='plane'?3:(activeTool==='segment'||activeTool==='extend'?2:0);}
function performAction(){const req=requiredCount(),selected=selectedPoints();if(activeTool==='point'){showToast('Режим точки активен: коснитесь грани, ребра или уже проведённой прямой.');return;}if(activeTool==='faceView'){showToast('Нажмите прямо на грань фигуры — она развернётся к вам.');return;}if(activeTool==='intersect'){ const lines=selectedLines();if(lines.length!==2){showToast('Выберите две прямые для поиска пересечения.');return;}createIntersection(lines[0],lines[1]);renderTree();updateUI();return;}if(activeTool==='edgeCross'){showToast('Выберите построенную прямую, затем кликните по ребру фигуры.');return;}if(selected.length!==req)return;if(activeTool==='segment'){addLine(selected[0],selected[1]);showToast('Отрезок добавлен в конструкцию.');}else if(activeTool==='extend'){addLine(selected[0],selected[1],true);showToast('Прямая продлена — найден след плоскости.');}else if(activeTool==='plane'){if(solver.open&&solver.step===-1){solverNext();return;}const p=createSection(selected);if(p)showToast(`Сечение построено: ${p.polygon.length}-угольник.`);else return;}clearPointSelection();renderTree();updateUI();}
function updateUI(){const sel=state.selectedPoints.size,entityCount=state.selectedEntities.size,req=requiredCount();$('#selectedCount').textContent=Math.min(sel,3);$('#progressLine').style.width=`${Math.min(sel,3)/3*100}%`;const action=$('#actionBtn');
  if(activeTool==='plane'){action.textContent=sel===3?(solver.open&&solver.step===-1?'Решить по шагам':'Построить сечение'):`Выберите ${Math.max(0,3-sel)} ${plural(Math.max(0,3-sel),'точку','точки','точек')}`;}else if(activeTool==='segment'){action.textContent=sel===2?'Соединить точки':`Выберите ${Math.max(0,2-sel)} ${plural(Math.max(0,2-sel),'точку','точки','точек')}`;}else if(activeTool==='extend'){action.textContent=sel===2?'Продлить прямую':`Выберите ${Math.max(0,2-sel)} ${plural(Math.max(0,2-sel),'точку','точки','точек')}`;}else if(activeTool==='intersect'){action.textContent=entityCount===2?'Создать точку пересечения':`Выберите ${Math.max(0,2-entityCount)} ${plural(Math.max(0,2-entityCount),'прямую','прямые','прямых')}`;}else if(activeTool==='edgeCross'){action.textContent=entityCount===1?'Кликните по ребру': 'Выберите прямую';}else if(activeTool==='point'){action.textContent='Добавляйте точки';}else if(activeTool==='faceView'){action.textContent='Нажмите на грань';}else{action.textContent='Выберите инструмент';}
  action.disabled = activeTool==='select'||(req>0&&sel!==req)||(activeTool==='intersect'&&entityCount!==2)||(activeTool==='edgeCross'&&entityCount!==1);const info=$('#selectionInfo'),rename=$('#renameBtn'),del=$('#deleteBtn');
  if(entityCount&&(activeTool==='intersect'||activeTool==='edgeCross')){const names=selectedLines().map(e=>e.name).join(', ');info.innerHTML='<span class="selection-dot"></span><span>Линии: <b>'+esc(names)+'</b></span>';info.classList.add('has-selection');rename.disabled=entityCount!==1;del.disabled=entityCount!==1;}else if(state.selectedEntity){const e=state.entities.find(e=>e.id===state.selectedEntity);info.innerHTML='<span class="selection-dot"></span><span>Выбран объект: <b>'+esc(e?.name||'')+'</b></span>';info.classList.add('has-selection');rename.disabled=false;del.disabled=false;}else if(sel){const names=selectedPoints().map(p=>p.name).join(', ');info.innerHTML='<span class="selection-dot"></span><span>Выбрано: <b>'+esc(names)+'</b></span>';info.classList.add('has-selection');rename.disabled=sel!==1;del.disabled=sel!==1||!selectedPoints()[0].removable;}else{info.innerHTML='<span class="selection-dot"></span><span>Ничего не выделено</span>';info.classList.remove('has-selection');rename.disabled=true;del.disabled=true;}
  $('#undoBtn').disabled=state.history.length===0;$('#redoBtn').disabled=state.redo.length===0;updateSelectionTray();updateSolverDock();
}
function updateSelectionTray(){const list=$('#selectionChips'),points=selectedPoints(),lines=selectedLines();if(points.length){list.innerHTML=points.map(p=>`<button class="selection-chip" data-unselect="${p.id}" title="Снять выделение с точки ${esc(p.name)}">${esc(p.name)} ×</button>`).join('');}else if(lines.length){list.innerHTML=lines.map(line=>`<span class="selection-chip line-chip">↔ ${esc(line.name)}</span>`).join('');}else{list.innerHTML='<span class="empty-chip">Нет точек</span>';}$('#clearSelectionBtn').disabled=!points.length&&!lines.length;}
function plural(n,one,few,many){const r=Math.abs(n)%100,r1=r%10;return r>10&&r<20?many:r1>1&&r1<5?few:r1===1?one:many;}
function esc(v){return String(v).replace(/[&<>'"]/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[s]));}

function eyeSvg(){return '<svg viewBox="0 0 24 24"><path d="M2.5 12s3.4-5.5 9.5-5.5 9.5 5.5 9.5 5.5-3.4 5.5-9.5 5.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.4"/></svg>';}
function rowHTML(obj,cat){const isPoint=cat==='point',isSelected=isPoint?state.selectedPoints.has(obj.id):(state.selectedEntity===obj.id||state.selectedEntities.has(obj.id));const icon=isPoint?(obj.kind==='vertex'?'vertex':'user'):(obj.type==='plane'?'plane':obj.type==='trace'?'extended':'line');const sub=isPoint?`(${obj.position.x.toFixed(1)}; ${obj.position.y.toFixed(1)}; ${obj.position.z.toFixed(1)})`:obj.type==='plane'?`${obj.polygon.length} уг.`:'';return `<div class="tree-row ${isSelected?'selected':''}" data-kind="${cat}" data-id="${obj.id}"><span class="tree-icon ${icon}"></span><span class="tree-name">${esc(obj.name)}</span><span class="tree-sub">${sub}</span><button class="tree-eye" data-eye="${obj.id}" title="Показать / скрыть">${eyeSvg()}</button></div>`;}
function renderTree(){const verts=[...state.points.values()].filter(p=>p.kind==='vertex'),custom=[...state.points.values()].filter(p=>p.kind!=='vertex'),lines=state.entities.filter(e=>e.type==='line'||e.type==='trace'),planes=state.entities.filter(e=>e.type==='plane');
  let html=`<div class="tree-group"><div class="tree-group-title"><span class="chev">⌄</span> ВЕРШИНЫ <span class="count">${verts.length}</span></div>${verts.map(p=>rowHTML(p,'point')).join('')}</div>`;
  html+=`<div class="tree-group"><div class="tree-group-title"><span class="chev">⌄</span> ТОЧКИ <span class="count">${custom.length}</span></div>${custom.length?custom.map(p=>rowHTML(p,'point')).join(''):'<div class="tree-row"><span class="tree-sub">Добавьте точку на модели</span></div>'}</div>`;
  html+=`<div class="tree-group"><div class="tree-group-title"><span class="chev">⌄</span> ЛИНИИ <span class="count">${lines.length}</span></div>${lines.length?lines.map(e=>rowHTML(e,'entity')).join(''):'<div class="tree-row"><span class="tree-sub">Нет построенных линий</span></div>'}</div>`;
  html+=`<div class="tree-group"><div class="tree-group-title"><span class="chev">⌄</span> ПЛОСКОСТИ <span class="count">${planes.length}</span></div>${planes.length?planes.map(e=>rowHTML(e,'entity')).join(''):'<div class="tree-row"><span class="tree-sub">Сечение ещё не построено</span></div>'}</div>`;objectTree.innerHTML=html;
}

function pickNearestModelEdge(point){let best={d:Infinity,pair:null};edgePairs.forEach(pair=>{const close=new THREE.Line3(pair[0],pair[1]).closestPointToPoint(point,true,new THREE.Vector3()),d=close.distanceTo(point);if(d<best.d)best={d,pair};});return best;}
function pointAddedFeedback(position, note=''){const point=addPoint(position);clearPointSelection();state.selectedPoints.add(point.id);updatePointVisual(point);renderTree();updateUI();showToast(`Точка ${point.name} добавлена${note}.`);return point;}
function entityIdFromHit(hit){let obj=hit?.object;while(obj&&!obj.userData?.entityId)obj=obj.parent;return obj?.userData?.entityId||null;}
function handleCanvasClick(event){const rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);
  const pointMeshes=[...state.points.values()].filter(p=>p.visible).map(p=>p.ball),pointHits=raycaster.intersectObjects(pointMeshes,false);if(pointHits.length){togglePoint(pointHits[0].object.userData.pointId);return;}
  const surfaceHit=solidMesh?raycaster.intersectObject(solidMesh,false)[0]:null;const edgeHit=modelEdges?raycaster.intersectObject(modelEdges,false)[0]:null;const entityHits=raycaster.intersectObjects(state.entities.filter(e=>e.visible&&e.type!=='plane').map(e=>e.obj),true);
  if(activeTool==='faceView'){if(surfaceHit){focusFaceFromHit(surfaceHit);return;}showToast('Нажмите на видимую грань фигуры.');return;}
  // В режиме точки поверхность всегда приоритетнее линии: можно ставить точку даже поверх проведённой прямой на ребре.
  if(activeTool==='point'){ if(surfaceHit){let position=surfaceHit.point.clone();const best=pickNearestModelEdge(edgeHit?.point||position);if(snapEnabled&&best.d<.22)position=new THREE.Line3(best.pair[0],best.pair[1]).closestPointToPoint(position,true,new THREE.Vector3());pointAddedFeedback(position,snapEnabled&&best.d<.22?' на ребро':' на грань');return;}if(entityHits.length){pointAddedFeedback(entityHits[0].point.clone(),' на прямую');return;}showToast('Кликните по фигуре или по построенной прямой.');return;}
  if(activeTool==='edgeCross'){const selected=selectedLines();if(selected.length!==1){showToast('Сначала выберите одну построенную прямую.');return;}if(!edgeHit){showToast('Кликните точно по ребру фигуры.');return;}const edge=pickNearestModelEdge(edgeHit.point);createIntersection(selected[0],edge.pair,true);renderTree();updateUI();return;}
  if(entityHits.length){const id=entityIdFromHit(entityHits[0]);if(id){selectEntity(id);return;}}
  showToast(activeTool==='intersect'?'Кликните по двум построенным прямым.':'Выберите точку на модели или включите инструмент «Точка».');
}
function updateCoords(event){const rect=canvas.getBoundingClientRect();pointer.x=((event.clientX-rect.left)/rect.width)*2-1;pointer.y=-((event.clientY-rect.top)/rect.height)*2+1;raycaster.setFromCamera(pointer,camera);const hit=solidMesh?raycaster.intersectObject(solidMesh,false)[0]:null;if(hit){const p=hit.point;$('#coordsReadout').textContent=`X ${p.x.toFixed(2)} · Y ${p.y.toFixed(2)} · Z ${p.z.toFixed(2)}`;}else $('#coordsReadout').textContent='X — · Y — · Z —';}
function setCameraDistance(distance){const dir=camera.position.clone().sub(controls.target).normalize();camera.position.copy(controls.target).addScaledVector(dir,distance);controls.update();$('#zoomRange').value=distance.toFixed(1);}
function animateCameraTo(target,distance=null){const startTarget=controls.target.clone(),startPos=camera.position.clone(),dir=camera.position.clone().sub(controls.target).normalize(),dist=distance||camera.position.distanceTo(controls.target),endPos=target.clone().addScaledVector(dir,dist);cameraTween={start:performance.now(),duration:430,startTarget,startPos,endTarget:target.clone(),endPos};}
function focusOnSelection(){let points=selectedPoints();if(!points.length&&state.selectedEntity){const entity=state.entities.find(e=>e.id===state.selectedEntity);points=(entity?.pids||[]).map(id=>state.points.get(id)).filter(Boolean);}if(!points.length){showToast('Выберите точки или объект, на котором нужно сфокусироваться.');return;}const center=points.reduce((acc,p)=>acc.add(p.position),new THREE.Vector3()).multiplyScalar(1/points.length);animateCameraTo(center,Math.max(3.3,camera.position.distanceTo(controls.target)*.82));showToast('Камера сфокусирована на выбранном.');}
function resetCamera(){cameraTween=null;camera.position.set(5.4,4.15,5.8);controls.target.set(0,0,0);controls.update();$('#zoomRange').value=7;}
function focusFaceFromHit(hit){const faceIndex=triangleFaceMap[hit.faceIndex];const indices=currentFaces[faceIndex];if(!indices?.length)return;const center=indices.reduce((sum,index)=>sum.add(modelVertices[index]),new THREE.Vector3()).multiplyScalar(1/indices.length);const bodyCenter=modelVertices.reduce((sum,vertex)=>sum.add(vertex),new THREE.Vector3()).multiplyScalar(1/Math.max(1,modelVertices.length));let outward=center.clone().sub(bodyCenter);if(outward.lengthSq()<.001){const a=modelVertices[indices[0]],b=modelVertices[indices[1]],c=modelVertices[indices[2]];outward=b.clone().sub(a).cross(c.clone().sub(a));}outward.normalize();const distance=Math.max(3.4,Math.max(...modelVertices.map(vertex=>vertex.distanceTo(bodyCenter)))*3.1);cameraTween={start:performance.now(),duration:520,startTarget:controls.target.clone(),startPos:camera.position.clone(),endTarget:center.clone(),endPos:center.clone().addScaledVector(outward,distance)};showToast('Грань развернута к вам. Чтобы выбрать другую — нажмите на неё.');}
function showToast(message){const toast=$('#toast');toast.textContent=message;toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('show'),2600);}
function undo(){const h=state.history.pop();if(!h)return;if(h.type==='point')h.payload=removePoint(h.id,{preserve:true,cascade:false});else h.payload=removeEntity(h.id,{preserve:true});if(h.payload)state.redo.push(h);clearPointSelection();renderTree();updateUI();showToast('Последнее действие отменено.');}
function redo(){const h=state.redo.pop();if(!h)return;if(h.type==='point')restorePoint(h.payload);else restoreEntity(h.payload);state.history.push(h);renderTree();updateUI();showToast('Действие повторено.');}
function clearConstruction(){[...state.points.values()].filter(p=>p.removable).forEach(p=>removePoint(p.id));[...state.entities].forEach(e=>removeEntity(e.id));state.history=[];state.redo=[];clearPointSelection();renderTree();updateUI();showToast('Построение очищено.');}
function toggleVisibility(id){const p=state.points.get(id);if(p){p.visible=!p.visible;p.group.visible=p.visible;p.label.visible=p.visible;}else{const e=state.entities.find(e=>e.id===id);if(e){e.visible=!e.visible;e.obj.visible=e.visible;}}renderTree();}
function randomTask(){buildSolid(currentFigure);const validEdges=edgePairs.filter(([a,b])=>a.distanceTo(b)>.3);const picks=[];while(picks.length<Math.min(3,validEdges.length)){const edge=validEdges[Math.floor(Math.random()*validEdges.length)];if(!picks.includes(edge))picks.push(edge);}picks.forEach((edge,i)=>{const t=.23+Math.random()*.54;const p=addPoint(edge[0].clone().lerp(edge[1],t),`P${i+1}`,{noHistory:true});state.selectedPoints.add(p.id);});state.points.forEach(updatePointVisual);renderTree();updateUI();setActiveTool('plane');showToast('Новая задача готова: постройте секущую плоскость.');}

canvas.addEventListener('pointerdown',e=>{downPos.set(e.clientX,e.clientY);downPointerType=e.pointerType||'mouse';});
canvas.addEventListener('pointerup',e=>{const threshold=downPointerType==='touch'?14:5;if(downPos.distanceTo(new THREE.Vector2(e.clientX,e.clientY))<threshold)handleCanvasClick(e);});
canvas.addEventListener('pointermove',updateCoords);
canvas.addEventListener('mouseleave',()=>$('#coordsReadout').textContent='X — · Y — · Z —');
objectTree.addEventListener('click',e=>{const eye=e.target.closest('[data-eye]');if(eye){e.stopPropagation();toggleVisibility(eye.dataset.eye);return;}const row=e.target.closest('.tree-row[data-id]');if(!row)return;if(row.dataset.kind==='point')togglePoint(row.dataset.id);else selectEntity(row.dataset.id);});
document.querySelectorAll('.tool').forEach(btn=>btn.addEventListener('click',()=>setActiveTool(btn.dataset.tool)));
document.querySelectorAll('[data-mobile-tool]').forEach(btn=>btn.addEventListener('click',()=>setActiveTool(btn.dataset.mobileTool)));
figureSelect.addEventListener('change',()=>buildSolid(figureSelect.value));
document.querySelectorAll('[data-figure]').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.dataset.figure;figureSelect.value=key;buildSolid(key);showToast(`Выбрана фигура: ${figureData[key].title}.`);}));
const themeNames={sea:'Мятная глубина',aurora:'Северное сияние',violet:'Фиолетовые сумерки',indigo:'Синий неон',sunset:'Закат',coral:'Коралловый свет',rose:'Розовый киберпанк',forest:'Лесной контур',graphite:'Графит'};const availableDockTools=['select','point','segment','plane','extend','intersect','edgeCross'];
function applyTheme(theme,announce=true){const value=themeNames[theme]?theme:'sea';document.documentElement.dataset.theme=value;document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.classList.toggle('active',btn.dataset.themeChoice===value));try{localStorage.setItem('pavlik-theme',value);}catch(_){ }if(announce)showToast(`Тема «${themeNames[value]}» включена.`);}
function setMobileDock(tools,announce=false){const requested=[...new Set(tools)].filter(tool=>availableDockTools.includes(tool));mobileDockTools=requested.length>=2?requested:['select','point'];document.querySelectorAll('[data-mobile-tool]').forEach(btn=>btn.classList.toggle('dock-hidden',!mobileDockTools.includes(btn.dataset.mobileTool)));document.querySelectorAll('[data-dock-tool]').forEach(btn=>{const on=mobileDockTools.includes(btn.dataset.dockTool);btn.classList.toggle('active',on);btn.setAttribute('aria-pressed',String(on));});try{localStorage.setItem('pavlik-mobile-dock',JSON.stringify(mobileDockTools));}catch(_){ }if(announce)showToast(`Мобильная панель: ${mobileDockTools.length} инструментов.`);}
function setMotion(enabled,announce=true){motionEnabled=enabled;document.documentElement.dataset.motion=enabled?'on':'off';const button=$('#motionBtn');button.classList.toggle('is-on',enabled);button.setAttribute('aria-pressed',String(enabled));try{localStorage.setItem('pavlik-motion',enabled?'on':'off');}catch(_){ }if(announce)showToast(enabled?'Анимации и свечение включены.':'Анимации отключены.');}
let savedTheme='sea',savedDock=null,savedMotion='on',savedPointStyle=null;try{savedTheme=localStorage.getItem('pavlik-theme')||'sea';savedDock=JSON.parse(localStorage.getItem('pavlik-mobile-dock')||'null');savedMotion=localStorage.getItem('pavlik-motion')||'on';savedPointStyle=JSON.parse(localStorage.getItem('pavlik-point-style')||'null');}catch(_){ }applyTheme(savedTheme,false);setMobileDock(Array.isArray(savedDock)?savedDock:['select','point','segment','plane']);setMotion(savedMotion!=='off',false);applyPointStyle(savedPointStyle?.shape||'circle',savedPointStyle?.color||'mint',false);document.querySelectorAll('[data-theme-choice]').forEach(btn=>btn.addEventListener('click',()=>applyTheme(btn.dataset.themeChoice)));document.querySelectorAll('[data-dock-tool]').forEach(btn=>btn.addEventListener('click',()=>{const tool=btn.dataset.dockTool;const next=mobileDockTools.includes(tool)?mobileDockTools.filter(item=>item!==tool):[...mobileDockTools,tool];if(next.length<2){showToast('Оставьте минимум два быстрых инструмента.');return;}setMobileDock(next,true);}));document.querySelectorAll('[data-point-shape]').forEach(btn=>btn.addEventListener('click',()=>applyPointStyle(btn.dataset.pointShape,pointStyle.color)));document.querySelectorAll('[data-point-color]').forEach(btn=>btn.addEventListener('click',()=>applyPointStyle(pointStyle.shape,btn.dataset.pointColor)));$('#motionBtn').addEventListener('click',()=>setMotion(!motionEnabled));
$('#actionBtn').addEventListener('click',performAction);$('#undoBtn').addEventListener('click',undo);$('#redoBtn').addEventListener('click',redo);$('#clearBtn').addEventListener('click',clearConstruction);$('#randomTaskBtn').addEventListener('click',randomTask);
$('#clearSelectionBtn').addEventListener('click',()=>{clearPointSelection();renderTree();updateUI();});$('#selectionChips').addEventListener('click',e=>{const chip=e.target.closest('[data-unselect]');if(chip)togglePoint(chip.dataset.unselect);});
$('#homeView').addEventListener('click',()=>{resetCamera();showToast('Исходный ракурс восстановлен.');});$('#focusSelection').addEventListener('click',focusOnSelection);$('#toggleGrid').addEventListener('click',e=>{grid.visible=!grid.visible;e.currentTarget.classList.toggle('is-on',grid.visible);showToast(grid.visible?'Сетка показана.':'Сетка скрыта.');});
$('#orbitBtn').addEventListener('click',e=>{controls.autoRotate=!controls.autoRotate;controls.autoRotateSpeed=.8;e.currentTarget.classList.toggle('is-on',controls.autoRotate);showToast(controls.autoRotate?'Автовращение включено.':'Автовращение выключено.');});
document.querySelectorAll('[data-refplane]').forEach(btn=>btn.addEventListener('click',()=>{const name=btn.dataset.refplane,plane=referencePlanes[name];plane.visible=!plane.visible;btn.classList.toggle('is-on',plane.visible);showToast(plane.visible?`Плоскость ${name.toUpperCase()} показана.`:`Плоскость ${name.toUpperCase()} скрыта.`);}));
$('#snapBtn').addEventListener('click',e=>{snapEnabled=!snapEnabled;e.currentTarget.classList.toggle('is-on',snapEnabled);e.currentTarget.setAttribute('aria-pressed',String(snapEnabled));showToast(snapEnabled?'Привязка к рёбрам включена.':'Привязка к рёбрам выключена.');});$('#faceFocusBtn').addEventListener('click',()=>{setActiveTool(activeTool==='faceView'?'select':'faceView');showToast(activeTool==='faceView'?'Режим выбора грани включён. Нажмите на сторону фигуры.':'Режим выбора граней выключен.');});
$('#zoomIn').addEventListener('click',()=>setCameraDistance(Math.max(3,parseFloat($('#zoomRange').value)-.5)));$('#zoomOut').addEventListener('click',()=>setCameraDistance(Math.min(11,parseFloat($('#zoomRange').value)+.5)));$('#zoomRange').addEventListener('input',e=>setCameraDistance(parseFloat(e.target.value)));
$('#snapshotBtn').addEventListener('click',()=>{const a=document.createElement('a');a.download=`stereolab-${currentFigure}.png`;a.href=renderer.domElement.toDataURL('image/png');a.click();showToast('Изображение сцены сохранено.');});
$('#hideAllBtn').addEventListener('click',()=>{allVisible=!allVisible;modelGroup.visible=allVisible;pointsGroup.visible=allVisible;lineGroup.visible=allVisible;planeGroup.visible=allVisible;solverGroup.visible=allVisible;referencePlaneGroup.visible=allVisible;showToast(allVisible?'Все объекты показаны.':'Все объекты скрыты.');});
let renameTarget=null;function closeRename(){renameTarget=null;$('#renameDialog').classList.remove('open');$('#renameDialog').setAttribute('aria-hidden','true');}function openRename(){if(state.selectedEntity){const entity=state.entities.find(x=>x.id===state.selectedEntity);if(!entity)return;renameTarget={type:'entity',id:entity.id};$('#renameTitle').textContent='Название объекта';$('#renameInput').value=entity.name;}else if(state.selectedPoints.size===1){const point=selectedPoints()[0];renameTarget={type:'point',id:point.id};$('#renameTitle').textContent='Название точки';$('#renameInput').value=point.name;}else return;$('#renameDialog').classList.add('open');$('#renameDialog').setAttribute('aria-hidden','false');setTimeout(()=>{$('#renameInput').focus();$('#renameInput').select();},60);}function saveRename(){const name=$('#renameInput').value.trim().slice(0,12);if(!renameTarget||!name){showToast('Введите название объекта.');return;}if(renameTarget.type==='entity'){const entity=state.entities.find(x=>x.id===renameTarget.id);if(entity)entity.name=name;}else{const point=state.points.get(renameTarget.id);if(point){point.name=name;refreshPointLabel(point);}}closeRename();renderTree();updateUI();showToast('Название сохранено.');}
$('#renameBtn').addEventListener('click',openRename);$('#renameClose').addEventListener('click',closeRename);$('#renameCancel').addEventListener('click',closeRename);$('#renameSave').addEventListener('click',saveRename);$('#renameDialog').addEventListener('click',e=>{if(e.target.id==='renameDialog')closeRename();});$('#renameInput').addEventListener('keydown',e=>{if(e.key==='Enter')saveRename();if(e.key==='Escape')closeRename();});
$('#deleteBtn').addEventListener('click',()=>{let deleted=false;if(state.selectedEntity){removeEntity(state.selectedEntity);state.selectedEntity=null;deleted=true;}else if(state.selectedPoints.size===1){const p=selectedPoints()[0];if(p.removable){removePoint(p.id);deleted=true;}}if(deleted){state.history=[];state.redo=[];showToast('Объект удалён. Связанные построения также очищены.');}renderTree();updateUI();});
$('#guideBtn').addEventListener('click',()=>$('#modal').classList.add('open'));document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>$('#modal').classList.remove('open')));$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')$('#modal').classList.remove('open')});
function closeSettings(){ $('#settingsPanel').classList.remove('open');$('#settingsOverlay').classList.remove('visible');}
function openSettings(){closeMobilePanels();$('#settingsPanel').classList.add('open');$('#settingsOverlay').classList.add('visible');}
$('#settingsBtn').addEventListener('click',openSettings);$('#settingsClose').addEventListener('click',closeSettings);$('#settingsOverlay').addEventListener('click',closeSettings);
$('#solverBtn').addEventListener('click',()=>{setSolverOpen(!solver.open);if(solver.open)setActiveTool('plane');});$('#solverClose').addEventListener('click',()=>setSolverOpen(false));$('#solverNext').addEventListener('click',solverNext);$('#solverBack').addEventListener('click',solverBack);
function closeMobilePanels(){document.querySelectorAll('.left-panel,.right-panel').forEach(el=>el.classList.remove('mobile-open'));$('#mobileOverlay').classList.remove('visible');}
function openMobilePanel(id){closeMobilePanels();$(`#${id}`).classList.add('mobile-open');$('#mobileOverlay').classList.add('visible');}
$('#mobileToolsBtn').addEventListener('click',()=>openMobilePanel('toolsPanel'));$('#mobileObjectsBtn').addEventListener('click',()=>openMobilePanel('objectsPanel'));document.querySelectorAll('[data-close-panel]').forEach(btn=>btn.addEventListener('click',closeMobilePanels));$('#mobileOverlay').addEventListener('click',closeMobilePanels);
$('#fullscreenBtn').addEventListener('click',()=>{if(!document.fullscreenElement)document.documentElement.requestFullscreen?.();else document.exitFullscreen?.();});
window.addEventListener('keydown',e=>{if(e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;const k=e.key.toLowerCase();if(k>='1'&&k<='7'){setActiveTool(['select','point','segment','plane','extend','intersect','edgeCross'][Number(k)-1]);}if(k==='escape'){closeSettings();clearPointSelection();renderTree();updateUI();}if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();if(e.shiftKey)redo();else undo();}if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();redo();}if(k==='r')resetCamera();if(k==='h')$('#guideBtn').click();if(k===' '){e.preventDefault();$('#orbitBtn').click();}if(k==='delete'||k==='backspace')$('#deleteBtn').click();});
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;camera.aspect=w/h;camera.updateProjectionMatrix();renderer.setSize(w,h,false);}new ResizeObserver(resize).observe(viewport);
function animate(){requestAnimationFrame(animate);const now=performance.now();if(cameraTween){const t=Math.min(1,(now-cameraTween.start)/cameraTween.duration),e=1-Math.pow(1-t,3);controls.target.lerpVectors(cameraTween.startTarget,cameraTween.endTarget,e);camera.position.lerpVectors(cameraTween.startPos,cameraTween.endPos,e);if(t>=1)cameraTween=null;}updateObjectAnimations(now);controls.update();renderer.render(scene,camera);} 
buildSolid('cube');resize();animate();
