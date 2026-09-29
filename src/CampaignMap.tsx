import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Crosshair, Edit3, Eye, EyeOff, Layers3, LocateFixed, MapPin, Minus, Plus, Ruler, Trash2, X } from 'lucide-react';
import type { MapMarker, MapMarkerColor } from '../shared/types';
import { api, send } from './api';
import { ErrorLine, Modal, Submit } from './components';
import { MAP_WIDTH, MAP_HEIGHT, MAP_ASSET_VERSION, MAP_USE_TILES, MAP_MILES_PER_PIXEL, visibleMapTiles, retainMapTiles, resizeMapView, type MapTile, type MapView as View, type MapViewport } from './mapTiles';

const colors:Record<MapMarkerColor,string>={gold:'#eab54e',cyan:'#59b9c9',red:'#d35b52',violet:'#a17bd5',green:'#81a85d'};
const colorLabels:Record<MapMarkerColor,string>={gold:'Жовті',cyan:'Блакитні',red:'Червоні',violet:'Фіолетові',green:'Зелені'};
const markerColors=Object.keys(colors) as MapMarkerColor[];

type Point={x:number;y:number};

export default function CampaignMap({notify}:{notify:(value:string)=>void}){
  const viewportRef=useRef<HTMLDivElement>(null),stageRef=useRef<HTMLDivElement>(null);
  const pointersRef=useRef(new Map<number,Point>());
  const gestureRef=useRef<{view:View;center:Point;distance:number}|null>(null);
  const [markers,setMarkers]=useState<MapMarker[]>([]),[error,setError]=useState(''),[view,setView]=useState<View>({x:0,y:0,scale:1});
  const viewRef=useRef(view);viewRef.current=view;
  const [viewport,setViewport]=useState<MapViewport>({width:0,height:0,pixelRatio:window.devicePixelRatio||1});
  const [retainedTiles,setRetainedTiles]=useState<MapTile[]>([]);
  const [tileStates,setTileStates]=useState<Record<string,'loading'|'ready'|'error'>>({});
  const [tileRetry,setTileRetry]=useState(0);
  const reportTile=useCallback((key:string,state:'loading'|'ready'|'error')=>setTileStates(current=>current[key]===state?current:{...current,[key]:state}),[]);
  const [tool,setTool]=useState<'pan'|'marker'|'measure'>('pan'),[draft,setDraft]=useState<Point|null>(null),[selected,setSelected]=useState<MapMarker|null>(null),[editing,setEditing]=useState<MapMarker|null>(null),[measure,setMeasure]=useState<Point[]>([]);
  const [layersOpen,setLayersOpen]=useState(()=>window.innerWidth>600),[visibleColors,setVisibleColors]=useState<Record<MapMarkerColor,boolean>>({gold:true,cyan:true,red:true,violet:true,green:true});
  const load=async()=>{try{setMarkers(await api<MapMarker[]>('/map-markers'));setError('');}catch(e){setError((e as Error).message);}};
  useEffect(()=>{load();},[]);
  useEffect(()=>{if(!selected)return;const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==='Escape')setSelected(null);};window.addEventListener('keydown',closeOnEscape);return()=>window.removeEventListener('keydown',closeOnEscape);},[selected]);
  useEffect(()=>{
    const element=viewportRef.current;if(!element)return;
    element.addEventListener('wheel',wheel,{passive:false});
    return()=>element.removeEventListener('wheel',wheel);
  },[]);
  useLayoutEffect(()=>{
    const element=viewportRef.current;if(!element)return;
    let previous:MapViewport={width:0,height:0,pixelRatio:window.devicePixelRatio||1};
    const resize=()=>{
      const next={width:element.clientWidth,height:element.clientHeight,pixelRatio:window.devicePixelRatio||1};
      if(!next.width||!next.height||next.width===previous.width&&next.height===previous.height&&next.pixelRatio===previous.pixelRatio)return;
      const old=previous;previous=next;setViewport(next);
      setView(current=>old.width?resizeMapView(current,old,next):fitView(next));
    };
    resize();const observer=new ResizeObserver(resize);observer.observe(element);window.addEventListener('resize',resize);
    return()=>{observer.disconnect();window.removeEventListener('resize',resize);};
  },[]);
  const tiles=useMemo(()=>MAP_USE_TILES&&viewport.width?visibleMapTiles(view,viewport):[],[view,viewport]);
  const renderTiles=useMemo(()=>retainMapTiles(retainedTiles,tiles,view,viewport),[retainedTiles,tiles,view,viewport]);
  useEffect(()=>{setRetainedTiles(current=>retainMapTiles(current,tiles,view,viewport));},[tiles,view,viewport]);

  function pointFromClient(clientX:number,clientY:number):Point|null{
    const stage=stageRef.current;if(!stage)return null;
    const rect=stage.getBoundingClientRect();
    const x=(clientX-rect.left)/rect.width;
    const y=(clientY-rect.top)/rect.height;
    return {x:Math.max(0,Math.min(1,x)),y:Math.max(0,Math.min(1,y))};
  }
  function zoomAt(factor:number,clientX?:number,clientY?:number){
    const rect=viewportRef.current?.getBoundingClientRect();if(!rect)return;
    const cx=clientX??rect.left+rect.width/2,cy=clientY??rect.top+rect.height/2;
    setView(old=>{const scale=Math.max(.5,Math.min(5,old.scale*factor));const px=cx-rect.left,py=cy-rect.top;return{x:px-(px-old.x)*(scale/old.scale),y:py-(py-old.y)*(scale/old.scale),scale};});
  }
  function fitMap(){if(viewport.width)setView(fitView(viewport));}
  function reset(){fitMap();setMeasure([]);setTool('pan');}
  function startGesture(){
    const rect=viewportRef.current?.getBoundingClientRect(),points=[...pointersRef.current.values()];if(!rect||!points.length){gestureRef.current=null;return;}
    const center=points.length===1?points[0]:{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2};
    gestureRef.current={view:viewRef.current,center:{x:center.x-rect.left,y:center.y-rect.top},distance:points.length<2?0:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y)};
  }
  function pointerDown(event:ReactPointerEvent<HTMLDivElement>){
    if(event.button!==0)return;
    const point=pointFromClient(event.clientX,event.clientY);if(!point)return;
    if(tool==='marker'){setDraft(point);return;}
    if(tool==='measure'){
      event.preventDefault();
      const extend=event.ctrlKey;
      setMeasure(current=>current.length===0?[point]:current.length===1?[...current,point]:extend?[...current,point]:[point]);
      return;
    }
    pointersRef.current.set(event.pointerId,{x:event.clientX,y:event.clientY});event.currentTarget.setPointerCapture(event.pointerId);startGesture();
  }
  function pointerMove(event:ReactPointerEvent<HTMLDivElement>){
    if(!pointersRef.current.has(event.pointerId))return;
    pointersRef.current.set(event.pointerId,{x:event.clientX,y:event.clientY});
    const gesture=gestureRef.current,rect=viewportRef.current?.getBoundingClientRect(),points=[...pointersRef.current.values()];if(!gesture||!rect)return;
    const center=points.length===1?points[0]:{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2};
    const distance=points.length<2?0:Math.hypot(points[1].x-points[0].x,points[1].y-points[0].y);
    const scale=gesture.distance&&distance?Math.max(.5,Math.min(5,gesture.view.scale*distance/gesture.distance)):gesture.view.scale;
    const next={x:center.x-rect.left-(gesture.center.x-gesture.view.x)*scale/gesture.view.scale,y:center.y-rect.top-(gesture.center.y-gesture.view.y)*scale/gesture.view.scale,scale};
    viewRef.current=next;setView(next);
  }
  function pointerUp(event:ReactPointerEvent<HTMLDivElement>){
    pointersRef.current.delete(event.pointerId);
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    startGesture();
  }
  function wheel(event:WheelEvent){event.preventDefault();zoomAt(event.deltaY<0?1.18:.85,event.clientX,event.clientY);}
  function toggleLayer(color:MapMarkerColor){setVisibleColors(current=>{const next={...current,[color]:!current[color]};if(!next[color]&&selected?.color===color)setSelected(null);return next;});}
  function toggleAllLayers(){const showAll=!markerColors.every(color=>visibleColors[color]);const next=Object.fromEntries(markerColors.map(color=>[color,showAll])) as Record<MapMarkerColor,boolean>;setVisibleColors(next);if(!showAll)setSelected(null);}
  const distance=measure.slice(1).reduce((miles,point,index)=>miles+Math.hypot((point.x-measure[index].x)*MAP_WIDTH,(point.y-measure[index].y)*MAP_HEIGHT)*MAP_MILES_PER_PIXEL,0);
  const lastSegment=measure.length>=2?[measure[measure.length-2],measure[measure.length-1]]:null;
  const pendingTiles=tiles.filter(tile=>tileStates[tile.key]!=='ready').length;
  const failedTiles=tiles.filter(tile=>tileStates[tile.key]==='error').length;
  const renderWidth=viewport.width*view.scale;
  return <section className="world-map-page" aria-label="Інтерактивна мапа кампанії">
    <div className="map-toolbar" aria-label="Інструменти мапи">
      <button className={tool==='pan'?'active':''} onClick={()=>setTool('pan')} title="Пересувати мапу"><Crosshair size={18}/><span>Огляд</span></button>
      <button className={tool==='marker'?'active':''} onClick={()=>setTool('marker')} title="Поставити позначку"><MapPin size={18}/><span>Позначка</span></button>
      <button className={tool==='measure'?'active':''} onClick={()=>{setTool('measure');setMeasure([])}} title="Виміряти відстань · Ctrl + клік додає відрізок"><Ruler size={18}/><span>Лінійка</span></button>
      <i/>
      <button onClick={()=>zoomAt(1.2)} aria-label="Наблизити"><Plus size={18}/></button><button onClick={()=>zoomAt(.82)} aria-label="Віддалити"><Minus size={18}/></button><button onClick={reset} aria-label="Показати всю мапу"><LocateFixed size={18}/></button>
    </div>
    <div className={`map-viewport tool-${tool}`} ref={viewportRef} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="map-stage" ref={stageRef} style={{left:view.x,top:view.y,width:renderWidth,height:renderWidth*MAP_HEIGHT/MAP_WIDTH}}>
        <img className="map-preview" src={MAP_USE_TILES?`/images/map-tiles/preview.webp?v=${MAP_ASSET_VERSION}`:'/images/template-map.svg'} alt="Мапа кампанії" draggable={false} fetchPriority="high"/>
        {MAP_USE_TILES&&[...renderTiles].sort((a,b)=>a.level-b.level).map(tile=><MapTileImage key={tile.key} tile={tile} report={reportTile} retry={tileRetry}/>)}
        {markers.filter(marker=>visibleColors[marker.color]).map(marker=><button key={marker.id} className={`world-marker ${selected?.id===marker.id?'selected':''}`} style={{left:`${marker.x*100}%`,top:`${marker.y*100}%`,'--marker-color':colors[marker.color]} as CSSProperties} onPointerDown={e=>e.stopPropagation()} onClick={e=>{e.stopPropagation();setSelected(marker);if(window.innerWidth<=600)setLayersOpen(false)}} aria-label={marker.title}><MapPin size={27}/><span>{marker.title}</span></button>)}
        {measure.length>=2&&<svg className="map-measure-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline className="measure-outline" points={measure.map(point=>`${point.x*100},${point.y*100}`).join(' ')}/><polyline className="measure-dash" points={measure.map(point=>`${point.x*100},${point.y*100}`).join(' ')}/></svg>}
        {measure.map((point,index)=><span className="map-measure-point" key={index} style={{left:`${point.x*100}%`,top:`${point.y*100}%`}} aria-hidden="true"/>)}
        {lastSegment&&<span className="map-distance" style={{left:`${(lastSegment[0].x+lastSegment[1].x)*50}%`,top:`${(lastSegment[0].y+lastSegment[1].y)*50}%`}}>{Math.round(distance)} миль</span>}
      </div>
    </div>
    <aside className={`map-layers ${layersOpen?'open':''}`} aria-label="Шари позначок"><button className="map-layers-toggle" aria-label={layersOpen?'Сховати шари позначок':'Показати шари позначок'} aria-expanded={layersOpen} onClick={()=>{if(!layersOpen&&window.innerWidth<=600)setSelected(null);setLayersOpen(value=>!value)}}><Layers3 size={17}/><span>Шари позначок</span><small>{markers.filter(marker=>visibleColors[marker.color]).length}/{markers.length}</small></button>{layersOpen&&<div className="map-layer-list">{markerColors.map(color=>{const visible=visibleColors[color],count=markers.filter(marker=>marker.color===color).length;return <button key={color} role="switch" aria-checked={visible} onClick={()=>toggleLayer(color)}><i style={{background:colors[color]}}/><span>{colorLabels[color]}<small>{count}</small></span>{visible?<Eye size={16}/>:<EyeOff size={16}/>}</button>})}<button className="map-layers-all" onClick={toggleAllLayers}>{markerColors.every(color=>visibleColors[color])?'Сховати всі':'Показати всі'}</button></div>}</aside>
    <div className="map-status"><span>{Math.round(view.scale*100)}%</span><span>{tool==='marker'?'Клікни місце для нової позначки':tool==='measure'?(measure.length===0?'Клікни першу точку · Ctrl + клік додає відрізок':measure.length===1?'Клікни другу точку · Ctrl + клік додає відрізок':'Ctrl + клік — продовжити маршрут · клік — новий вимір'):'Тягни мапу · наближай колесом або двома пальцями'}</span>{MAP_USE_TILES&&pendingTiles>0&&<span className="map-detail-progress">{failedTiles?'Не всі деталі завантажились':`Деталі мапи ${tiles.length-pendingTiles}/${tiles.length}`}</span>}{MAP_USE_TILES&&failedTiles>0&&<button className="map-detail-retry" onClick={()=>setTileRetry(value=>value+1)}>Повторити</button>}</div>
    {selected&&<><button className="map-note-scrim" aria-label="Закрити опис позначки" onClick={()=>setSelected(null)}/><aside className="map-note-panel" role="dialog" aria-modal={window.innerWidth<=600||undefined} aria-label={`Позначка мапи: ${selected.title}`}><button className="icon-button" aria-label="Закрити" onClick={()=>setSelected(null)}><X size={17}/></button><span className="map-note-kicker"><MapPin size={14}/>Позначка мапи</span><h2>{selected.title}</h2><p>{selected.body||'До цієї позначки ще немає нотатки.'}</p><small>Додав: {selected.created_by_name}</small><div><button className="button secondary small" onClick={()=>setEditing(selected)}><Edit3 size={15}/>Редагувати</button><button className="text-button danger-text" onClick={async()=>{if(!confirm(`Прибрати позначку «${selected.title}»?`))return;await send(`/map-markers/${selected.id}`,'DELETE',{version:selected.version});setSelected(null);await load();notify('Позначку прибрано');}}><Trash2 size={15}/>Прибрати</button></div></aside></>}
    {error&&<div className="map-load-error"><ErrorLine error={error}/><button className="button secondary small" onClick={load}>Спробувати ще раз</button></div>}
    {draft&&<MarkerEditor point={draft} close={()=>{setDraft(null);setTool('pan')}} saved={async()=>{setDraft(null);setTool('pan');await load();notify('Позначку додано');}}/>}
    {editing&&<MarkerEditor marker={editing} point={{x:editing.x,y:editing.y}} close={()=>setEditing(null)} saved={async()=>{setEditing(null);setSelected(null);await load();notify('Позначку оновлено');}}/>}
  </section>;
}

function fitView(viewport:MapViewport):View{
  const scale=Math.min(1,viewport.height/(viewport.width*MAP_HEIGHT/MAP_WIDTH));
  return {x:viewport.width*(1-scale)/2,y:(viewport.height-viewport.width*scale*MAP_HEIGHT/MAP_WIDTH)/2,scale};
}

function MapTileImage({tile,report,retry}:{tile:MapTile;report:(key:string,state:'loading'|'ready'|'error')=>void;retry:number}){
  const [ready,setReady]=useState(false),[attempt,setAttempt]=useState(0);
  const failed=useRef(false);
  useLayoutEffect(()=>{report(tile.key,'loading');},[tile.key,report]);
  useEffect(()=>{
    if(!failed.current)return;
    failed.current=false;setReady(false);setAttempt(value=>value+1);report(tile.key,'loading');
  },[retry,tile.key,report]);
  function failure(){failed.current=true;report(tile.key,'error');}
  return <img className="map-tile" src={`${tile.src}${attempt?`&retry=${attempt}`:''}`} data-tile-key={tile.key} data-ready={ready} style={{left:`${tile.left*100}%`,top:`${tile.top*100}%`,width:`${tile.width*100}%`,height:`${tile.height*100}%`,visibility:ready?'visible':'hidden'}} alt="" draggable={false} decoding="async" onLoad={async event=>{
    const element=event.currentTarget,source=element.src;
    try{
      // Decode before revealing; the previous layer remains painted throughout.
      await element.decode();
      if(!element.isConnected||element.src!==source)return;
      setReady(true);failed.current=false;report(tile.key,'ready');
    }catch{if(element.isConnected&&element.src===source)failure();}
  }} onError={failure}/>;
}

function MarkerEditor({point,marker,close,saved}:{point:Point;marker?:MapMarker;close:()=>void;saved:()=>Promise<void>}){
  const [form,setForm]=useState({title:marker?.title||'',body:marker?.body||'',color:marker?.color||'gold' as MapMarkerColor}),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(event:FormEvent){event.preventDefault();setBusy(true);setError('');try{await send(marker?`/map-markers/${marker.id}`:'/map-markers',marker?'PUT':'POST',{...form,x:point.x,y:point.y,version:marker?.version});await saved();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <Modal title={marker?'Редагувати позначку':'Нова позначка'} close={close}><form onSubmit={submit}><label className="field">Назва *<input autoFocus required maxLength={120} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Місто, руїни або важливе місце"/></label><label className="field">Нотатка<textarea rows={6} maxLength={10000} value={form.body} onChange={e=>setForm({...form,body:e.target.value})} placeholder="Що тут сталося або що потрібно пам’ятати…"/></label><fieldset className="marker-colors"><legend>Колір</legend>{markerColors.map(color=><label key={color}><input type="radio" name="marker-color" checked={form.color===color} onChange={()=>setForm({...form,color})}/><span style={{background:colors[color]}}/></label>)}</fieldset><ErrorLine error={error}/><div className="form-actions"><button type="button" className="button ghost" onClick={close}>Скасувати</button><Submit busy={busy}>{marker?'Зберегти':'Додати позначку'}</Submit></div></form></Modal>;
}
