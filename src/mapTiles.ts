export const MAP_WIDTH=7650;
export const MAP_HEIGHT=4950;
// Keep false for the bundled original vector placeholder. Set true after
// replacing the map and generating tiles as described in docs/CUSTOMIZE.md.
export const MAP_USE_TILES: boolean = false;
export const MAP_MILES_PER_PIXEL = 0.1;
const TILE_SIZE=512;
const LEVELS=[1024,2048,4096,MAP_WIDTH].filter((width,index,list)=>width<=MAP_WIDTH&&list.indexOf(width)===index).sort((a,b)=>a-b);
export const MAP_ASSET_VERSION='template-1';

export type MapView={x:number;y:number;scale:number};
export type MapViewport={width:number;height:number;pixelRatio:number};
export type MapTile={key:string;src:string;level:number;left:number;top:number;width:number;height:number};

export function visibleMapTiles(view:MapView,viewport:MapViewport):MapTile[]{
  const width=viewport.width*view.scale,height=width*MAP_HEIGHT/MAP_WIDTH;
  const level=LEVELS.find(value=>value>=width*viewport.pixelRatio)||MAP_WIDTH;
  const levelHeight=Math.round(MAP_HEIGHT*level/MAP_WIDTH);
  const left=Math.max(0,-view.x/width),right=Math.min(1,(viewport.width-view.x)/width);
  const top=Math.max(0,-view.y/height),bottom=Math.min(1,(viewport.height-view.y)/height);
  if(right<=left||bottom<=top)return [];
  // One extra ring loads before it scrolls into view.
  const firstX=Math.max(0,Math.floor(left*level/TILE_SIZE)-1);
  const lastX=Math.min(Math.ceil(level/TILE_SIZE)-1,Math.floor(right*level/TILE_SIZE)+1);
  const firstY=Math.max(0,Math.floor(top*levelHeight/TILE_SIZE)-1);
  const lastY=Math.min(Math.ceil(levelHeight/TILE_SIZE)-1,Math.floor(bottom*levelHeight/TILE_SIZE)+1);
  const tiles:MapTile[]=[];
  for(let row=firstY;row<=lastY;row++)for(let column=firstX;column<=lastX;column++){
    const x=column*TILE_SIZE,y=row*TILE_SIZE;
    tiles.push({key:`${level}/${column}-${row}`,src:`/images/map-tiles/${level}/${column}-${row}.webp?v=${MAP_ASSET_VERSION}`,level,left:x/level,top:y/levelHeight,width:Math.min(TILE_SIZE,level-x)/level,height:Math.min(TILE_SIZE,levelHeight-y)/levelHeight});
  }
  return tiles;
}

// Keep decoded tiles mounted across zoom levels. New low-resolution tiles must
// never cover a sharper tile, and a pending tile must never uncover the preview.
// Bound the offscreen cache; visible fallbacks stay until they leave the screen.
export function retainMapTiles(previous:MapTile[],requested:MapTile[],view:MapView,viewport:MapViewport):MapTile[]{
  const all=new Map(previous.map(tile=>[tile.key,tile]));
  for(const tile of requested){all.delete(tile.key);all.set(tile.key,tile);}
  const renderWidth=viewport.width*view.scale,renderHeight=renderWidth*MAP_HEIGHT/MAP_WIDTH;
  const visible=(tile:MapTile)=>view.x+(tile.left+tile.width)*renderWidth>=0&&view.x+tile.left*renderWidth<=viewport.width&&view.y+(tile.top+tile.height)*renderHeight>=0&&view.y+tile.top*renderHeight<=viewport.height;
  const wanted=new Set(requested.map(tile=>tile.key));
  for(const [key,tile] of all){
    if(all.size<=80)break;
    if(!wanted.has(key)&&!visible(tile))all.delete(key);
  }
  return [...all.values()];
}

export function resizeMapView(view:MapView,previous:MapViewport,next:MapViewport):MapView{
  if(!previous.width)return {x:0,y:(next.height-next.width*MAP_HEIGHT/MAP_WIDTH)/2,scale:1};
  // Browser chrome changing height is not a request to reset the map's zoom.
  const ratio=next.width/previous.width;
  return {...view,x:next.width/2-(previous.width/2-view.x)*ratio,y:next.height/2-(previous.height/2-view.y)*ratio};
}
