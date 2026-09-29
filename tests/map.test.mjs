import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

let visibleMapTiles,retainMapTiles,resizeMapView;
before(async()=>{
  const project=new URL('../',import.meta.url);
  mkdirSync(new URL('private/',project),{recursive:true});
  const output=new URL('private/test-map-tiles.mjs',project);
  await build({entryPoints:[fileURLToPath(new URL('src/mapTiles.ts',project))],bundle:true,platform:'node',format:'esm',outfile:fileURLToPath(output),logLevel:'silent'});
  ({visibleMapTiles,retainMapTiles,resizeMapView}=await import(output.href));
});

test('map requests native detail for a 3x phone and desktop zoom',()=>{
  const phone={width:390,height:780,pixelRatio:3};
  const phoneTiles=visibleMapTiles({x:-760,y:-200,scale:5},phone);
  assert.ok(phoneTiles.length>0&&phoneTiles.every(tile=>tile.level===7650));
  const desktopTiles=visibleMapTiles({x:-6000,y:-2600,scale:5},{width:2525,height:1186,pixelRatio:1});
  assert.ok(desktopTiles.length>0&&desktopTiles.every(tile=>tile.level===7650));
  assert.ok(phoneTiles.length<75,'phone must request visible detail, not the whole map');
  assert.ok(phoneTiles.every(tile=>tile.src.includes('?v=')),'published assets need cache-versioned URLs');
});

test('changing map resolution retains already painted detail until it leaves the viewport',()=>{
  const viewport={width:1200,height:800,pixelRatio:1};
  const coarseView={x:0,y:0,scale:1};
  const coarse=visibleMapTiles(coarseView,viewport);
  const fineView={x:-1000,y:-500,scale:4};
  const fine=visibleMapTiles(fineView,viewport);
  const zoomed=retainMapTiles(coarse,fine,fineView,viewport);
  assert.ok(coarse.every(tile=>zoomed.some(retained=>retained.key===tile.key)),'loading a new level must not reveal the preview');
  const zoomedOut=retainMapTiles(zoomed,coarse,coarseView,viewport);
  assert.ok(fine.every(tile=>zoomedOut.some(retained=>retained.key===tile.key)),'lower detail must not discard sharper loaded tiles');
  assert.equal(new Set(zoomedOut.map(tile=>tile.key)).size,zoomedOut.length);
});

test('mobile browser toolbar resize preserves scale and geographic viewport center',()=>{
  const oldViewport={width:390,height:720,pixelRatio:3},nextViewport={...oldViewport,height:820};
  const view={x:-490,y:-220,scale:4};
  const resized=resizeMapView(view,oldViewport,nextViewport);
  assert.equal(resized.scale,4);
  assert.equal(resized.x,view.x);
  assert.equal(resized.y,view.y+50);
  const rotated={width:820,height:390,pixelRatio:3};
  const landscape=resizeMapView(view,oldViewport,rotated);
  assert.equal(landscape.scale,view.scale);
  assert.ok(Math.abs((rotated.width/2-landscape.x)/(landscape.scale*rotated.width)-(oldViewport.width/2-view.x)/(view.scale*oldViewport.width))<1e-12);
});
