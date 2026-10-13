'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function app() {
  const htmlIds = new Set([...fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8').matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  const elements = new Map(), uploads = [], draws = [], decoded = [], documentHandlers = {}, apiCalls = [];
  class Element {
    constructor() {
      this.value = 0; this.options = []; this.firstChild = {}; this.handlers = {}; this.children = []; this.dataset = {};
      this.classList = { toggle() {} };
    }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    setAttribute(name,value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    showModal() { this.open = true; }
    close() { this.open = false; this.handlers.close?.(); }
    click() { return this.handlers.click?.(); }
    append(...items) { for (const item of items) { this.children.push(item); item.parent = this; } }
    replaceChildren() { this.children = []; }
    remove() { this.parent.children = this.parent.children.filter(child=>child!==this); }
    getContext() { return { fillRect() {}, drawImage: (...args)=>draws.push(args) }; }
  }
  const element = id => { assert.ok(htmlIds.has(id), `Missing HTML element: ${id}`); if (!elements.has(id)) elements.set(id,new Element()); return elements.get(id); };
  for (const [id,value] of Object.entries({ 'logo-size':18,'logo-opacity':80,'logo-margin':4,resolution:'original',format:'jpg','resize-custom':3,'pdf-output':'combined','pdf-name':'combined.pdf','pdf-range':'','pdf-groups':'' })) element(id).value = value;
  const presets = [10000000,5000000,3000000,2000000].map(bytes=>{ const button = new Element(); button.dataset.bytes = String(bytes); return button; });
  const sandbox = vm.createContext({
    document: { getElementById: element, querySelectorAll: selector=>selector==='[data-bytes]' ? presets : [], querySelector: ()=>null, createElement: ()=>new Element(), body: new Element(), addEventListener(name,handler) { documentHandlers[name] = handler; } },
    window: { addEventListener() {} }, localStorage: { getItem: ()=>null },
    fetch: async()=>({ok:true,json:async()=>({token:'test'})}),
    URL: { createObjectURL: ()=>'blob:test', revokeObjectURL() {} }, setTimeout, clearTimeout,
    testDecode: async file=>{ decoded.push(file); return { width:file.width,height:file.height }; },
    testEncode: async (canvas,type,quality)=>({size:Math.floor(canvas.width*canvas.height*quality*2)+200,type}),
    testRequest: async (url,body,binary)=>{
      apiCalls.push({url,body,binary});
      if (url === '/api/export/choose-folder') return { destination:'chosen', path:'/exports', cancelled:false };
      if (url === '/api/export/start') return { job: 'batch', path: '/exports/test' };
      if (url.startsWith('/api/pdf/source?')) return {source:'source-'+apiCalls.length,pages:Array.from({length:body.pages || 1},(_,page)=>({page,thumbnail:'data:image/jpeg;base64,test',width:500,height:700}))};
      if (url.startsWith('/api/pdf/export?')) return {saved:true,pages:body.pages.length,size:1234};
      if (url === '/api/pdf/preview') return {image:`data:image/jpeg;base64,clear-page-${body.page}`,width:1000,height:1400};
      if (binary) uploads.push({ url, body });
      if (url.startsWith('/api/export/pdf?')) {
        const limit=+new URLSearchParams(url.split('?')[1]).get('limit');
        return {saved:true,format:'pdf',pages:2,size:body.size<limit?body.size:Math.floor(limit*.9),copied:body.size<limit};
      }
      return { saved:true };
    },
  });
  const run = code=>vm.runInContext(code,sandbox);
  run(fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8'));
  run("decode = testDecode; canvasBlob = testEncode; request = testRequest; state.token = 'test'; chooseTool('resize'); PhotoResize.refresh();");
  const importFiles = files=>sandbox.PhotoResize.importFiles(files);
  const save = ()=>element('resize-save').handlers.click();
  const row = index=>element('resize-rows').children[index];
  return { sandbox,run,element,presets,uploads,draws,decoded,importFiles,save,row,documentHandlers,apiCalls,createCanvas: ()=>new Element() };
}
function file(name,size,width=2000,height=1000) { return { name,size,width,height,lastModified:1 }; }
function pdfFile(name,size) { return {...file(name,size),slice:()=>({text:async()=>'%PDF-1.7\n'})}; }

test('startup chooser keeps separate photo lists when switching tools', async()=>{
  const a = app(); a.run("state.photos = [{id:'watermark-only',zoom:2}]; chooseTool('home')");
  assert.equal(a.element('tool-home').hidden,false);
  assert.equal(a.element('watermark-tool').hidden,true);
  assert.equal(a.element('resize-tool').hidden,true);
  a.element('choose-resize').handlers.click();
  await a.importFiles([file('one.jpg',4000000)]);
  a.element('resize-back').handlers.click();
  a.element('choose-watermark').handlers.click();
  assert.equal(a.run('state.photos[0].zoom'),2);
  assert.equal(a.element('watermark-tool').hidden,false);
  a.run("chooseTool('resize')"); assert.equal(a.element('resize-rows').children.length,1);
});

test('before/after sizes come from actual successful uploads and default files fit under 3 MB', async()=>{
  const a = app(); await a.importFiles([file('wide.jpg',4000000),file('already.png',1500000)]);
  assert.equal(a.row(0).children[1].textContent,'4.00 MB');
  assert.equal(a.row(0).children[2].children[0].textContent,'—');
  await a.save(); assert.equal(a.uploads.length,2);
  for (const upload of a.uploads) assert.ok(upload.body.size<3000000);
  assert.equal(a.row(0).children[2].children[0].textContent,a.run(`fileSizeText(${a.uploads[0].body.size})`));
  assert.match(a.row(1).children[3].textContent,/Already small/);
  assert.match(a.element('resize-summary').textContent,/2 files saved/);
  assert.equal(a.element('resize-open').hidden,false);
});

test('small transparent PNGs and WEBPs are copied unchanged without another decode', async()=>{
  const a = app(), sources = [file('transparent.png',12000),file('tiny.webp',9000)];
  await a.importFiles(sources); const before = a.decoded.length; await a.save();
  assert.equal(a.decoded.length,before);
  assert.equal(a.uploads[0].body,sources[0]); assert.equal(a.uploads[1].body,sources[1]);
  assert.match(a.uploads[1].url,/smaller.webp/);
});

test('compression reduces dimensions when quality alone is insufficient and keeps the whole photo', async()=>{
  const a = app(), image = {width:4000,height:2000};
  const result = await a.sandbox.compressImage(image,500000,a.createCanvas,a.sandbox.testEncode);
  assert.ok(result.blob.size<500000); assert.ok(result.width<4000);
  assert.ok(Math.abs(result.width/result.height-2)<.01);
  for (const args of a.draws) { assert.equal(args[0],image); assert.equal(args.length,5); assert.equal(args[1],0); assert.equal(args[2],0); }
});

test('strict boundary recompresses a file exactly at the limit, and all presets fit', async()=>{
  const html = fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8');
  assert.deepEqual([...html.matchAll(/data-bytes="(\d+)"/g)].map(m=>+m[1]),[10000000,5000000,3000000,2000000]);
  assert.match(html,/selected" data-bytes="3000000" aria-pressed="true"/);
  for (const limit of [10000000,5000000,3000000,2000000]) {
    const a = app(); a.presets.find(p=>+p.dataset.bytes===limit).handlers.click();
    const source = file('photo.jpg',limit);
    await a.importFiles([source]); await a.save();
    assert.equal(a.uploads.length,1); assert.notEqual(a.uploads[0].body,source); assert.ok(a.uploads[0].body.size<limit);
  }
});

test('one failure continues the batch and no failed or oversized result is reported as saved', async()=>{
  const a = app(); await a.importFiles([file('bad.jpg',4000000),file('good.jpg',4000000)]);
  a.run("const originalCopy = makeSmallerCopy; makeSmallerCopy = async (photo,limit) => photo.file.name === 'bad.jpg' ? {blob:{size:limit},format:'jpg'} : originalCopy(photo,limit)");
  await a.save(); assert.equal(a.uploads.length,1);
  assert.equal(a.row(0).children[2].children[0].textContent,'—');
  assert.equal(a.row(0).children[3].textContent,'Could not save');
  assert.match(a.element('resize-summary').textContent,/1 file saved/);
  assert.match(a.element('resize-errors').children[0].textContent,/exceeds/);
  assert.equal(a.element('resize-progress').value,2);
  assert.equal(a.element('resize-progress').hidden,false);
  assert.equal(a.element('resize-progress-label').textContent,'2 of 2 files finished · 100%');
});

test('progress waits for each saved file, advances immediately, and remains visible at completion', async()=>{
  const a = app(); await a.importFiles([pdfFile('report.pdf',5000000),file('photo.jpg',1000)]);
  let entered, release;
  const firstUpload = new Promise(resolve=>{entered=resolve;});
  const hold = new Promise(resolve=>{release=resolve;});
  const oldRequest = a.sandbox.testRequest, snapshots = [];
  a.sandbox.progressRequest = async (...args)=>{
    if (args[2]) {
      snapshots.push(a.element('resize-progress').value);
      if (snapshots.length===1) { entered(); await hold; }
    }
    if (args[0].startsWith('/api/export/finish')) snapshots.push(a.element('resize-progress').value);
    return oldRequest(...args);
  };
  a.run('request = progressRequest');
  const saving = a.save(); await firstUpload;
  assert.equal(a.element('resize-progress').hidden,false);
  assert.equal(a.element('resize-progress').max,2);
  assert.equal(a.element('resize-progress-label').textContent,'0 of 2 files finished · 0%');
  release(); await saving;
  assert.deepEqual(snapshots,[0,1,2]);
  assert.equal(a.element('resize-progress').hidden,false);
  assert.equal(a.element('resize-progress')['aria-valuetext'],'2 of 2 files finished · 100%');
});

test('stop finishes the current photo and retains exact sizes only for saved photos', async()=>{
  const a = app(); await a.importFiles([file('one.jpg',1000),file('two.jpg',1000),file('three.jpg',1000)]);
  const oldRequest = a.sandbox.testRequest;
  a.sandbox.stopRequest = async (...args)=>{ const result = await oldRequest(...args); if (args[2]) a.element('resize-stop').handlers.click(); return result; };
  a.run('request = stopRequest'); await a.save();
  assert.equal(a.uploads.length,1); assert.match(a.row(1).children[3].textContent,/Not processed/);
  assert.match(a.element('resize-status-detail').textContent,/2 not processed/);
  assert.equal(a.element('resize-open').hidden,false);
  assert.equal(a.element('resize-progress').value,1);
  assert.equal(a.element('resize-progress-label').textContent,'1 of 3 files finished · 33%');
});

test('presets and navigation cannot change during processing; selecting another preset clears old comparisons', async()=>{
  const a = app(); await a.importFiles([file('one.jpg',4000000)]);
  const saving = a.save(); a.presets[3].handlers.click(); a.run("chooseTool('home')");
  assert.equal(a.run('state.tool'),'resize'); await saving;
  assert.ok(a.uploads[0].body.size>2000000); // The original 3 MB preset stayed active.
  a.presets[3].handlers.click();
  assert.equal(a.row(0).children[2].children[0].textContent,'—');
  assert.equal(a.element('resize-summary').textContent,'');
  assert.equal(a.element('resize-open').hidden,true);
  await a.save(); assert.ok(a.uploads.at(-1).body.size<2000000);
});

test('batch keeps nested paths, numbers colliding names and skips duplicate imports', async()=>{
  const a = app(), first = file('Photo?.jpg',1000), other = file('Photo*.jpg',1000);
  first.relativePath = 'CON/Photo?.jpg'; other.relativePath = 'CON/Photo*.jpg';
  await a.importFiles([first,other,first]); assert.equal(a.element('resize-rows').children.length,2);
  await a.save();
  assert.match(decodeURIComponent(a.uploads[0].url),/_CON\/Photo_-smaller.jpg/);
  assert.match(decodeURIComponent(a.uploads[1].url),/_CON\/Photo_-smaller-2.jpg/);
});

test('a single app script loads resize and imports a dropped folder, including nested photos', async()=>{
  const a = app(); assert.equal(typeof a.sandbox.PhotoResize.importFiles,'function');
  const leaf = source=>({ isFile:true, file:resolve=>resolve(source) });
  const directory = (name,children)=>({ name,isDirectory:true,createReader() { let read=false; return {readEntries(resolve) { resolve(read?[]:children); read=true; }}; } });
  const folder = directory('Photos',[leaf(file('one.jpg',1000)),directory('Nested',[leaf(file('two.png',1000))])]);
  await a.documentHandlers.drop({ preventDefault() {}, target:{closest:()=>null}, dataTransfer:{items:[{webkitGetAsEntry:()=>folder}]} });
  assert.equal(a.element('resize-rows').children.length,2);
  await a.save();
  assert.match(decodeURIComponent(a.uploads[0].url),/Photos\/one-smaller.jpg/);
  assert.match(decodeURIComponent(a.uploads[1].url),/Photos\/Nested\/two-smaller.png/);
});

test('an unavailable resize tool shows reload guidance instead of the undefined importFiles error', async()=>{
  const a = app(); a.run('PhotoResize = undefined');
  await a.documentHandlers.drop({preventDefault() {},target:{closest:()=>null},dataTransfer:{files:[file('one.jpg',1000)]}});
  assert.match(a.element('toast').textContent,/reload this page/);
  assert.doesNotMatch(a.element('toast').textContent,/undefined|importFiles/);
  a.run("state.tool='home'; chooseTool('resize')"); assert.equal(a.run('state.tool'),'home');
  a.run('clearTimeout(toastTimer)');
});

test('custom slider uses the exact chosen limit and resets comparisons when changed', async()=>{
  const a = app(); a.element('resize-custom-preset').handlers.click();
  assert.equal(a.element('resize-custom-controls').hidden,false);
  assert.equal(a.element('resize-custom-preset')['aria-pressed'],'true');
  assert.ok(a.presets.every(p=>p['aria-pressed']==='false'));
  a.element('resize-custom').value='1.3'; a.element('resize-custom').handlers.input();
  assert.equal(a.element('resize-custom-value').textContent,'1.3 MB');
  assert.match(a.element('resize-limit-hint').textContent,/1.3 MB/);
  await a.importFiles([file('one.jpg',4000000)]); await a.save();
  assert.ok(a.uploads[0].body.size<1300000);
  a.element('resize-custom').value='0.1'; a.element('resize-custom').handlers.input();
  assert.equal(a.row(0).children[2].children[0].textContent,'—');
  await a.save(); assert.ok(a.uploads.at(-1).body.size<100000);
  a.presets[0].handlers.click(); assert.equal(a.element('resize-custom-controls').hidden,true);
  assert.equal(a.element('resize-custom-preset')['aria-pressed'],'false');
});

test('custom size is bounded, preserves already-small files at the upper limit, and cannot change during a save', async()=>{
  const a = app(); a.element('resize-custom').value=999; a.element('resize-custom-preset').handlers.click();
  assert.equal(a.element('resize-custom').value,20);
  const source = file('one.jpg',4000000); await a.importFiles([source]);
  const saving = a.save(); a.element('resize-custom').value=.1; a.element('resize-custom').handlers.input();
  await saving; assert.equal(a.uploads[0].body,source);
  a.element('resize-custom').value=-1; a.element('resize-custom').handlers.input();
  assert.equal(a.element('resize-custom').value,.1);
});

test('both folder buttons include the saved folder name, even if the service has lost its jobs', async()=>{
  const a = app(), requests = [];
  const oldRequest = a.sandbox.testRequest;
  a.sandbox.recordRequest = async (...args)=>{ requests.push(args[0]); return oldRequest(...args); };
  a.run('request = recordRequest');
  await a.importFiles([file('one.jpg',1000)]); await a.save();
  await a.element('resize-open').handlers.click();
  assert.match(requests.at(-1),/job=batch&folder=test&path=%2Fexports%2Ftest$/);
  a.run("state.job='old'");
  // Use a literal JSON string so Windows backslashes are preserved in the evaluated script.
  a.run('state.exportFolder=' + JSON.stringify(['C:', 'Exports', '2026-10-12_17-13-00_21e6'].join(String.fromCharCode(92))));
  await a.element('show-exports').handlers.click();
  assert.match(requests.at(-1),/folder=2026-10-12_17-13-00_21e6&path=/);
});

test('a stale session token refreshes once and retries folder opening with the same request', async()=>{
  const a = app(), calls = [];
  await new Promise(resolve=>setTimeout(resolve,0));
  a.sandbox.refreshedFetch = async (url,options)=>{
    calls.push({url,options});
    if (url === '/api/session') return {ok:true,json:async()=>({token:'new-token'})};
    if (calls.length === 1) return {ok:false,status:403,json:async()=>({error:'Reload the application and try again'})};
    return {ok:true,status:200,json:async()=>({opened:true})};
  };
  a.run("fetch=refreshedFetch; state.token='expired'");
  // The helper normally substitutes its test transport; restore the source request declaration.
  const source = fs.readFileSync(path.join(__dirname,'../app/app.js'),'utf8');
  a.run(source.slice(source.indexOf('async function request('),source.indexOf('async function decode(')));
  const result = await a.run("request('/api/export/reveal?folder=saved')");
  assert.equal(result.opened,true); assert.equal(calls.length,3);
  assert.equal(calls[0].options.headers['X-App-Token'],'expired');
  assert.equal(calls[2].options.headers['X-App-Token'],'new-token');
  assert.equal(calls[0].url,calls[2].url); assert.equal(calls[0].options.body,calls[2].options.body);
});

test('resize asks for a destination for each batch, passes its approved ID and displays its path', async()=>{
  const a = app(); await a.importFiles([file('one.jpg',1000)]); await a.save(); await a.save();
  assert.equal(a.apiCalls.filter(call=>call.url === '/api/export/choose-folder').length,2);
  assert.ok(a.apiCalls.filter(call=>call.url === '/api/export/start').every(call=>call.body.destination === 'chosen'));
  assert.match(a.element('resize-status-detail').textContent,/\/exports\/test/);
});

test('cancelling a folder picker saves nothing and keeps existing before/after results', async()=>{
  const a = app(); await a.importFiles([file('one.jpg',1000)]); await a.save();
  const resultBefore = a.row(0).children[2].children[0].textContent;
  const oldRequest = a.sandbox.testRequest;
  a.sandbox.cancelPicker = async (...args)=>args[0] === '/api/export/choose-folder' ? {cancelled:true} : oldRequest(...args);
  a.run('request=cancelPicker'); await a.save();
  assert.equal(a.uploads.length,1);
  assert.equal(a.row(0).children[2].children[0].textContent,resultBefore);
  assert.equal(a.sandbox.PhotoResize.isBusy(),false);
  a.run("state.photos=[{file:{name:'one.jpg',size:1000},path:'one.jpg'}]; state.logo={width:10,height:10}");
  await a.run('exportPhotos()'); assert.equal(a.run('state.exporting'),false);
  assert.equal(a.apiCalls.filter(call=>call.url === '/api/export/start').length,1);
});

test('crop and watermark also ask where to save and send the chosen destination', async()=>{
  const a = app();
  a.run("state.photos=[{id:'crop',file:{name:'one.jpg',size:1000,width:100,height:100},path:'one.jpg',width:100,height:100,positionX:.5,positionY:.5,zoom:1}]; state.logo={width:10,height:10}; chooseTool('watermark')");
  await a.run('exportPhotos()');
  assert.equal(a.apiCalls[0].url,'/api/export/choose-folder');
  const start = a.apiCalls.find(call=>call.url === '/api/export/start');
  assert.equal(start.body.destination,'chosen');
  assert.equal(a.uploads.length,1);
  assert.match(a.uploads[0].url,/square-watermarked.jpg/);
  assert.equal(a.element('progress').hidden,false);
  assert.equal(a.element('progress').value,1);
  assert.equal(a.element('progress-label').textContent,'1 of 1 photo finished · 100%');
  await a.run('exportPhotos()');
  assert.equal(a.apiCalls.filter(call=>call.url === '/api/export/choose-folder').length,2);
});

test('PDFs and photos share a batch, and PDFs retain .pdf names without image decoding', async()=>{
  const a=app(); const pdf=pdfFile('Report.PDF',5000000), photo=file('photo.jpg',1000);
  await a.importFiles([pdf,photo]);
  assert.equal(a.element('resize-rows').children.length,2);
  assert.deepEqual(a.decoded,[photo]);
  await a.save();
  assert.match(a.uploads[0].url,/api\/export\/pdf\?/);
  assert.match(a.uploads[0].url,/Report-smaller.pdf/);
  assert.equal(a.uploads[0].body,pdf);
  assert.equal(a.row(0).children[2].children[0].textContent,'2.70 MB');
  assert.equal(a.row(0).children[2].children[1].textContent,'PDF · 2 pages');
  assert.match(a.element('resize-summary').textContent,/2 files saved/);
});

test('unreadable and oversized PDFs are rejected during import while valid files remain usable', async()=>{
  const a=app(); const bad={...pdfFile('bad.pdf',1000),slice:()=>({text:async()=>'not a PDF'})};
  await a.importFiles([bad,pdfFile('huge.pdf',100000001),pdfFile('good.pdf',1000)]);
  assert.equal(a.element('resize-rows').children.length,1);
  assert.equal(a.element('resize-errors').children.length,2);
  await a.save(); assert.equal(a.uploads.length,1);
});

test('one PDF failing its limit does not stop the next file or display a fictional after-size', async()=>{
  const a=app(); await a.importFiles([pdfFile('dense.pdf',5000000),file('photo.jpg',1000)]);
  const old=a.sandbox.testRequest;
  a.sandbox.failPdf=async(...args)=>{if(args[0].startsWith('/api/export/pdf?')) throw new Error('Choose a larger limit');return old(...args);};
  a.run('request=failPdf'); await a.save();
  assert.equal(a.row(0).children[2].children[0].textContent,'—');
  assert.equal(a.row(0).children[3].textContent,'Could not save');
  assert.equal(a.uploads.length,1);
  assert.match(a.element('resize-errors').children[0].textContent,/larger limit/);
});

test('PDF tool imports PDFs and photos, rearranges by arrows and drag, then exports exactly that order', async()=>{
  const a=app(); a.element('choose-pdf').handlers.click();
  assert.equal(a.element('pdf-tool').hidden,false);
  await a.sandbox.PhotoPdf.importFiles([{...pdfFile('one.pdf',1000),pages:3},file('photo.png',1000),file('photo.jpeg',1000)]);
  assert.equal(a.element('pdf-pages').children.length,5);
  const originalSources=a.apiCalls.filter(call=>call.url.startsWith('/api/pdf/source'));
  assert.equal(originalSources.length,3); assert.equal(a.decoded.length,0);
  const first=a.element('pdf-pages').children[0]; first.children[3].children[1].handlers.click();
  let cards=a.element('pdf-pages').children;
  assert.match(cards[0].children[2].textContent,/original page 2/);
  assert.match(cards[1].children[2].textContent,/original page 1/);
  let transfer;
  cards[4].handlers.dragstart({dataTransfer:{setData:(type,data)=>{transfer={type,data};}}});
  cards[0].handlers.drop({preventDefault(){},stopPropagation(){},dataTransfer:{types:[transfer.type],getData:()=>transfer.data}});
  await a.element('pdf-save').handlers.click();
  const output=a.apiCalls.find(call=>call.url.startsWith('/api/pdf/export'));
  assert.deepEqual(JSON.parse(JSON.stringify(output.body.pages)),[
    {source:'source-3',page:0},{source:'source-1',page:1},{source:'source-1',page:0},{source:'source-1',page:2},{source:'source-2',page:0}
  ]);
  assert.equal(a.element('pdf-progress-label').textContent,'1 of 1 file finished · 100%');
  assert.match(a.element('pdf-results').children[0].textContent,/5 pages/);
});

test('PDF range selection supports separated pages and inclusive ranges, and rejects invalid numbers without altering ticks', async()=>{
  const a=app(); await a.sandbox.PhotoPdf.importFiles([{...pdfFile('five.pdf',1000),pages:5}]);
  a.element('pdf-range').value='1, 3, 5';a.element('pdf-apply-range').handlers.click();
  assert.equal(a.element('pdf-count').textContent,'5 pages · 3 chosen');
  a.element('pdf-range').value='6';a.element('pdf-apply-range').handlers.click();
  assert.equal(a.element('pdf-count').textContent,'5 pages · 3 chosen');
  assert.match(a.element('pdf-errors').children[0].textContent,/1 to 5/);
  await a.element('pdf-save').handlers.click();
  const output=a.apiCalls.find(call=>call.url.startsWith('/api/pdf/export'));
  assert.deepEqual(Array.from(output.body.pages,page=>page.page),[0,2,4]);
  a.element('pdf-range').value='1–5';a.element('pdf-apply-range').handlers.click();
  assert.equal(a.element('pdf-count').textContent,'5 pages · 5 chosen');
  for (const text of ['0','5-1','1,,3','1.5','1000000000','1;2']) assert.throws(()=>a.run(`parsePdfPages(${JSON.stringify(text)},5)`));
});

test('PDF split exports chosen pages separately, or creates one new PDF per specified range', async()=>{
  const a=app(); await a.sandbox.PhotoPdf.importFiles([{...pdfFile('five.pdf',1000),pages:5}]);
  a.element('pdf-range').value='1,3,5';a.element('pdf-apply-range').handlers.click();
  a.element('pdf-output').value='separate';a.element('pdf-output').handlers.input();
  a.element('pdf-name').value='CON.pdf';
  await a.element('pdf-save').handlers.click();
  let outputs=a.apiCalls.filter(call=>call.url.startsWith('/api/pdf/export'));
  assert.deepEqual(outputs.map(call=>decodeURIComponent(call.url).split('name=')[1]),['_CON-page-1.pdf','_CON-page-3.pdf','_CON-page-5.pdf']);
  assert.deepEqual(outputs.map(call=>call.body.pages[0].page),[0,2,4]);
  a.element('pdf-output').value='groups';a.element('pdf-groups').value='1-2\n3,5';a.element('pdf-output').handlers.input();
  assert.equal(a.element('pdf-groups-controls').hidden,false);
  await a.element('pdf-save').handlers.click();
  outputs=a.apiCalls.filter(call=>call.url.startsWith('/api/pdf/export')).slice(3);
  assert.deepEqual(outputs.map(call=>Array.from(call.body.pages,page=>page.page)),[[0,1],[2,4]]);
  assert.match(decodeURIComponent(outputs[1].url),/_CON-part-2.pdf/);
  assert.equal(a.element('pdf-progress').value,2);
  assert.equal(a.apiCalls.filter(call=>call.url === '/api/export/choose-folder').length,2);
});

test('PDF cancelled saves preserve pages, duplicate imports are skipped, and clearing releases temporary sources', async()=>{
  const a=app(), first={...pdfFile('one.pdf',1000),pages:2}, second=file('two.jpg',1000);
  await a.sandbox.PhotoPdf.importFiles([first,first,second]);
  assert.equal(a.element('pdf-pages').children.length,3);
  const oldRequest=a.sandbox.testRequest;
  a.sandbox.pdfCancel=async (...args)=>args[0]==='/api/export/choose-folder'?{cancelled:true}:oldRequest(...args);
  a.run('request=pdfCancel');await a.element('pdf-save').handlers.click();
  assert.equal(a.apiCalls.filter(call=>call.url.startsWith('/api/pdf/export')).length,0);
  assert.equal(a.element('pdf-pages').children.length,3);
  a.run('request=testRequest');await a.element('pdf-clear').handlers.click();
  assert.equal(a.apiCalls.filter(call=>call.url==='/api/pdf/remove').length,2);
  assert.equal(a.element('pdf-pages').children.length,0);
  assert.equal(a.element('pdf-save').disabled,true);
});

test('PDF export progress and stop preserve saved files, with controls locked during processing', async()=>{
  const a=app();await a.sandbox.PhotoPdf.importFiles([{...pdfFile('five.pdf',1000),pages:3}]);
  a.element('pdf-output').value='separate';
  const oldRequest=a.sandbox.testRequest;
  a.sandbox.pdfStop=async (...args)=>{
    if (args[0].startsWith('/api/pdf/export')) {
      assert.equal(a.element('pdf-clear').disabled,true);
      a.element('pdf-all').handlers.click(); a.run("chooseTool('home')");
      assert.notEqual(a.run('state.tool'),'home');
      a.element('pdf-stop').handlers.click();
    }
    return oldRequest(...args);
  };
  a.run("state.tool='pdf'; request=pdfStop");await a.element('pdf-save').handlers.click();
  assert.equal(a.apiCalls.filter(call=>call.url.startsWith('/api/pdf/export')).length,1);
  assert.equal(a.element('pdf-progress-label').textContent,'1 of 3 files finished · 33%');
  assert.match(a.element('pdf-status-detail').textContent,/2 not processed/);
  assert.equal(a.element('pdf-open').hidden,false);
  assert.equal(a.element('pdf-clear').disabled,false);
});

test('clicking a PDF page opens a clear preview in the arranged order without changing chosen pages', async()=>{
  const a=app();await a.sandbox.PhotoPdf.importFiles([{...pdfFile('pages.pdf',1000),pages:2},file('photo.jpg',1000)]);
  a.element('pdf-pages').children[0].children[3].children[1].handlers.click();
  const first=a.element('pdf-pages').children[0];first.children[0].children[0].checked=false;first.children[0].children[0].handlers.change();
  await first.children[1].handlers.click();
  assert.equal(a.element('pdf-preview-dialog').open,true);
  assert.equal(a.element('pdf-preview-title').textContent,'Page 1 of 3');
  assert.match(a.element('pdf-preview-origin').textContent,/pages.pdf · original page 2/);
  assert.equal(a.element('pdf-preview-image').src,'data:image/jpeg;base64,clear-page-1');
  assert.equal(a.element('pdf-preview-previous').disabled,true);
  assert.equal(a.element('pdf-count').textContent,'3 pages · 2 chosen');
  a.element('pdf-preview-zoom').handlers.click();assert.equal(a.element('pdf-preview-zoom')['aria-pressed'],'true');assert.equal(a.element('pdf-preview-zoom').textContent,'Fit page');
  await a.element('pdf-preview-next').handlers.click();
  assert.match(a.element('pdf-preview-origin').textContent,/original page 1/);
  await a.element('pdf-preview-next').handlers.click();assert.match(a.element('pdf-preview-origin').textContent,/photo.jpg/);
  assert.equal(a.element('pdf-preview-next').disabled,true);
  a.element('pdf-preview-close').handlers.click();assert.equal(a.element('pdf-preview-dialog').open,false);
  const count=a.apiCalls.filter(call=>call.url==='/api/pdf/preview').length;
  await a.element('pdf-pages').children[2].children[1].handlers.click();
  assert.equal(a.apiCalls.filter(call=>call.url==='/api/pdf/preview').length,count);
  a.element('pdf-preview-close').handlers.click();assert.equal(a.element('pdf-preview-image').src,undefined);
});

test('a slower page preview cannot replace a newer page or reopen a closed preview', async()=>{
  const a=app();await a.sandbox.PhotoPdf.importFiles([{...pdfFile('pages.pdf',1000),pages:2}]);
  let release;const pending=new Promise(resolve=>{release=resolve;});const oldRequest=a.sandbox.testRequest;
  a.sandbox.slowPreview=async (...args)=>args[0]==='/api/pdf/preview'&&args[1].page===0?pending:oldRequest(...args);
  a.run('request=slowPreview');
  const first=a.element('pdf-pages').children[0].children[1].handlers.click();
  await a.element('pdf-preview-next').handlers.click();
  release({image:'stale-page',width:1000,height:1400});await first;
  assert.equal(a.element('pdf-preview-title').textContent,'Page 2 of 2');
  assert.equal(a.element('pdf-preview-image').src,'data:image/jpeg;base64,clear-page-1');
  let finish;const closedPending=new Promise(resolve=>{finish=resolve;});
  a.sandbox.closedPreview=async (...args)=>args[0]==='/api/pdf/preview'?closedPending:oldRequest(...args);a.run('request=closedPreview');
  const second=a.element('pdf-preview-previous').handlers.click();a.element('pdf-preview-close').handlers.click();
  finish({image:'after-close',width:1000,height:1400});await second;
  assert.equal(a.element('pdf-preview-dialog').open,false);
  assert.equal(a.element('pdf-preview-image').src,undefined);
});

test('a failed clearer preview retains the correct thumbnail and does not change export selection', async()=>{
  const a=app();await a.sandbox.PhotoPdf.importFiles([pdfFile('one.pdf',1000)]);
  const oldRequest=a.sandbox.testRequest;
  a.sandbox.failedPreview=async (...args)=>{if(args[0]==='/api/pdf/preview')throw new Error('The workspace expired.');return oldRequest(...args);};a.run('request=failedPreview');
  await a.element('pdf-pages').children[0].children[1].handlers.click();
  assert.equal(a.element('pdf-preview-image').src,'data:image/jpeg;base64,test');
  assert.match(a.element('pdf-preview-message').textContent,/small preview.*workspace expired/);
  assert.equal(a.element('pdf-preview-stage')['aria-busy'],'false');
  assert.equal(a.element('pdf-preview-zoom').disabled,true);
  assert.equal(a.element('pdf-count').textContent,'1 page · 1 chosen');
});
