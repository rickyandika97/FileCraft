'use strict';
const $ = id => document.getElementById(id);
const state = { tool: 'home', photos: [], selected: null, image: null, logo: null, logoURL: null, loadingLogo: false, logoVersion: 0, mode: 'final', importing: false, exporting: false, preparingExport: false, pickingFolder: false, stop: false, job: null, exportFolder: '', token: null, previewVersion: 0 };
const controls = { size: $('logo-size'), opacity: $('logo-opacity'), margin: $('logo-margin'), resolution: $('resolution'), format: $('format') };
let corner = 'tl', toastTimer, dragDepth = 0;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6500); }
function settings() { return { corner, size: +controls.size.value / 100, opacity: +controls.opacity.value / 100, margin: +controls.margin.value / 100, resolution: controls.resolution.value, format: controls.format.value }; }
function saveSettings() { try { localStorage.setItem('filecraft-settings', JSON.stringify(settings())); } catch (_) {} }
function restoreSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('filecraft-settings') || '{}');
    for (const key of ['size','opacity','margin']) if (Number.isFinite(saved[key])) controls[key].value = saved[key] * 100;
    for (const key of ['resolution','format']) if ([...controls[key].options].some(o => o.value === saved[key])) controls[key].value = saved[key];
    if (['tl','tr','bl','br'].includes(saved.corner)) corner = saved.corner;
  } catch (_) {}
  updateControls();
}
function updateControls() {
  for (const key of ['size','opacity','margin']) $('logo-' + key + '-value').textContent = controls[key].value + '%';
  document.querySelectorAll('[data-corner]').forEach(button => { const selected = button.dataset.corner === corner; button.classList.toggle('selected', selected); button.setAttribute('aria-pressed', String(selected)); });
}
function refreshAvailability() {
  const busy = state.importing || state.exporting || state.preparingExport || state.pickingFolder;
  $('watermark-back').disabled = busy;
  const photo = currentPhoto();
  $('crop-zoom').disabled = busy || !state.image;
  $('crop-position').disabled = busy || !state.image || (photo?.width === photo?.height && photo?.zoom === 1);
  $('reset-crop').disabled = busy || !state.image;
  $('settings').disabled = busy;
  $('add-photos').disabled = busy; $('add-folder').disabled = busy;
  $('photos-input').disabled = busy; $('folder-input').disabled = busy;
  $('clear-photos').disabled = busy; $('remove-photo').disabled = busy;
  $('export').disabled = busy || state.loadingLogo || !state.photos.length || !state.logo || !state.token;
  $('cancel-export').hidden = !state.exporting;
  document.body.classList.toggle('busy', busy);
  $('photo-count').textContent = state.photos.length;
  $('empty').hidden = !!state.photos.length;
  $('editor').hidden = !state.photos.length;
  $('export').firstChild.textContent = state.exporting ? 'Exporting… ' : `Export${state.photos.length ? ' ' + state.photos.length : ''} photo${state.photos.length === 1 ? '' : 's'} `;
  $('export-hint').textContent = state.importing ? 'Preparing your photos…' : state.exporting ? 'Saving one photo at a time.' : !state.photos.length ? 'Add photos and a logo to get started.' : !state.logo ? 'Choose your logo to enable export.' : 'Your originals stay untouched.';
}
async function request(path, body = {}, binary = false, refreshed = false) {
  const response = await fetch(path, { method: 'POST', headers: { 'X-App-Token': state.token, 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }, body: binary ? body : JSON.stringify(body) });
  const result = await response.json();
  if (response.status === 403 && result.error === 'Reload the application and try again' && !refreshed) {
    const sessionResponse = await fetch('/api/session');
    if (sessionResponse.ok) { const session = await sessionResponse.json(); state.token = session.token; return request(path,body,binary,true); }
  }
  if (!response.ok) throw new Error(result.error || 'Could not complete the request');
  return result;
}
async function chooseSaveLocation() {
  if (state.pickingFolder) return null;
  state.pickingFolder = true; refreshAvailability(); globalThis.PhotoResize?.refresh(); globalThis.PhotoPdf?.refresh();
  try {
    const selected = await request('/api/export/choose-folder');
    if (selected.cancelled) return null;
    return selected;
  } catch (error) { toast(error.message); return null; }
  finally { state.pickingFolder = false; refreshAvailability(); globalThis.PhotoResize?.refresh(); globalThis.PhotoPdf?.refresh(); }
}
async function startChosenExport(selected) {
  try { return await request('/api/export/start',{destination:selected.destination}); }
  catch (error) {
    if (error.message !== 'Choose a save folder again.') throw error;
    const replacement = await chooseSaveLocation();
    if (!replacement) return null;
    return request('/api/export/start',{destination:replacement.destination});
  }
}
async function decode(file) {
  if (typeof createImageBitmap === 'function' && file.type !== 'image/svg+xml') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (_) {}
  }
  const url = URL.createObjectURL(file), img = new Image();
  try { img.src = url; await img.decode(); return img; } finally { URL.revokeObjectURL(url); }
}
function release(img) { if (img && typeof img.close === 'function') img.close(); }
function dimensions(img) { return [img.naturalWidth || img.width, img.naturalHeight || img.height]; }
function cropGeometry(width, height, positionX = 0.5, positionY = positionX, zoom = 1) {
  const side = Math.min(width, height) / Math.max(1, Math.min(5, zoom));
  return { x: (width - side) * Math.max(0, Math.min(1, positionX)), y: (height - side) * Math.max(0, Math.min(1, positionY)), side };
}
function photoCrop(photo) { return cropGeometry(photo.width, photo.height, photo.positionX, photo.positionY, photo.zoom); }
function cropViewport() { return { size: 1200, x: 90, y: 90, side: 1020 }; }
function logoGeometry(width, height, side, config) {
  const margin = side * config.margin;
  const scale = Math.min(side * config.size / width, (side - margin * 2) * 0.6 / height);
  const w = width * scale, h = height * scale;
  return { x: config.corner.endsWith('r') ? side - margin - w : margin, y: config.corner.startsWith('b') ? side - margin - h : margin, width: w, height: h };
}
function renderFinal(canvas, image, photo, config, logo, side) {
  canvas.width = side; canvas.height = side;
  const ctx = canvas.getContext('2d'), crop = photoCrop(photo);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  // JPG exports flatten any transparency against white; PNG retains it.
  if (config.format === 'jpg') { ctx.fillStyle = '#fff'; ctx.fillRect(0,0,side,side); }
  ctx.drawImage(image,crop.x,crop.y,crop.side,crop.side,0,0,side,side);
  if (logo) {
    const [lw,lh] = dimensions(logo), box = logoGeometry(lw,lh,side,config);
    ctx.globalAlpha = config.opacity;
    ctx.drawImage(logo,box.x,box.y,box.width,box.height);
    ctx.globalAlpha = 1;
  }
}
function outputSide(photo, config) { return Math.max(1, Math.floor(Math.min(photoCrop(photo).side, config.resolution === 'original' ? Infinity : +config.resolution))); }
function currentPhoto() { return state.photos.find(p => p.id === state.selected); }
function drawPreview() {
  const photo = currentPhoto(); if (!photo || !state.image) return;
  const canvas = $('preview'), config = settings();
  if (state.mode === 'final') {
    renderFinal(canvas,state.image,photo,config,state.logo,Math.min(1200,outputSide(photo,config)));
  } else {
    const frame = cropViewport(), crop = photoCrop(photo), scale = frame.side / crop.side;
    canvas.width = canvas.height = frame.size;
    const ctx = canvas.getContext('2d'), { x, y, side } = frame;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.fillStyle = '#e9ede4'; ctx.fillRect(0,0,canvas.width,canvas.height);
    // The frame stays fixed; the full photo enlarges and moves underneath it.
    // A dimmed border reveals nearby content outside the exported square.
    ctx.drawImage(state.image,x-crop.x*scale,y-crop.y*scale,photo.width*scale,photo.height*scale);
    ctx.fillStyle = 'rgba(18,31,24,.52)';
    ctx.fillRect(0,0,canvas.width,y); ctx.fillRect(0,y+side,canvas.width,canvas.height-y-side);
    ctx.fillRect(0,y,x,side); ctx.fillRect(x+side,y,canvas.width-x-side,side);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(x+1.5,y+1.5,side-3,side-3);
    ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let i=1;i<3;i++) { ctx.moveTo(x+side*i/3,y); ctx.lineTo(x+side*i/3,y+side); ctx.moveTo(x,y+side*i/3); ctx.lineTo(x+side,y+side*i/3); } ctx.stroke();
  }
  $('current-name').textContent = photo.path;
  const side = outputSide(photo,config);
  $('current-dimensions').textContent = `${photo.width} × ${photo.height} original → ${side} × ${side} export`;
  const position = photo.width >= photo.height ? photo.positionX : photo.positionY;
  $('crop-position').value = position * 100;
  $('crop-position').disabled = (photo.width === photo.height && photo.zoom === 1) || state.exporting || state.importing;
  $('crop-position-value').textContent = Math.abs(position-.5) < .005 ? 'Centered' : `${Math.round(position*100)}%`;
  $('crop-zoom').value = photo.zoom;
  $('crop-zoom').disabled = state.exporting || state.importing;
  $('crop-zoom-value').textContent = `${Math.round(photo.zoom*100)}%`;
  $('crop-help').textContent = 'Scroll to zoom. Drag the photo to move it inside the square. The dimmed edges show what is outside your crop.';
}
async function selectPhoto(id) {
  pointer = null;
  state.selected = id;
  document.querySelectorAll('.photo-tile').forEach(tile => { const selected = tile.dataset.id === id; tile.classList.toggle('active',selected); tile.setAttribute('aria-pressed',String(selected)); });
  const photo = currentPhoto(), version = ++state.previewVersion;
  release(state.image); state.image = null;
  $('preview').getContext('2d').clearRect(0,0,$('preview').width,$('preview').height);
  if (!photo) return;
  $('current-name').textContent = photo.path; $('current-dimensions').textContent = '';
  $('preview-loading').hidden = false;
  try { const img = await decode(photo.file); if (version !== state.previewVersion) { release(img); return; } state.image = img; drawPreview(); }
  catch (error) { if (version === state.previewVersion) toast('Could not preview ' + photo.path + ': ' + error.message); }
  finally { if (version === state.previewVersion) $('preview-loading').hidden = true; }
}
function setPosition(value) {
  if (state.exporting || state.importing || !state.image) return;
  const photo = currentPhoto(); if (!photo) return;
  photo[photo.width >= photo.height ? 'positionX' : 'positionY'] = Math.max(0,Math.min(1,value));
  cropChanged(photo);
}
function cropChanged(photo) {
  const tile = document.querySelector(`.photo-tile[data-id="${photo.id}"]`);
  if (tile) tile.classList.toggle('adjusted',photo.zoom > 1 || Math.abs(photo.positionX-.5)>.005 || Math.abs(photo.positionY-.5)>.005);
  drawPreview();
}
function placeCrop(photo, x, y, side) {
  photo.positionX = photo.width > side ? Math.max(0,Math.min(1,x/(photo.width-side))) : .5;
  photo.positionY = photo.height > side ? Math.max(0,Math.min(1,y/(photo.height-side))) : .5;
}
function setZoom(value, point) {
  const photo = currentPhoto(); if (!photo || !state.image || state.exporting || state.importing) return;
  const crop = photoCrop(photo), zoom = Math.max(1,Math.min(5,value));
  if (zoom === photo.zoom) return;
  // Keep the point under the cursor in the same part of the crop. Sliders zoom around its center.
  const inside = point && point.x >= crop.x && point.x <= crop.x+crop.side && point.y >= crop.y && point.y <= crop.y+crop.side;
  const fx = inside ? (point.x-crop.x)/crop.side : .5, fy = inside ? (point.y-crop.y)/crop.side : .5;
  const side = Math.min(photo.width,photo.height)/zoom;
  photo.zoom = zoom;
  placeCrop(photo,crop.x+(crop.side-side)*fx,crop.y+(crop.side-side)*fy,side);
  cropChanged(photo);
}
function setMode(mode) {
  pointer = null;
  state.mode = mode;
  for (const m of ['final','crop']) { $('tab-'+m).classList.toggle('active',m===mode); $('tab-'+m).setAttribute('aria-selected',String(m===mode)); }
  $('crop-controls').hidden = mode !== 'crop'; $('stage').classList.toggle('adjusting',mode==='crop'); drawPreview();
}
function batchProgress(id, done, total, noun = 'files') {
  const progress = $(id), label = $(id+'-label');
  progress.hidden = label.hidden = !total;
  progress.max = total || 1; progress.value = done;
  label.textContent = total ? `${done} of ${total} ${total === 1 ? noun.slice(0,-1) : noun} finished · ${Math.round(done/total*100)}%` : '';
  progress.setAttribute('aria-valuetext',label.textContent);
  if (id === 'progress') $('status-count').textContent = total ? `${done} / ${total}` : '';
}
function setStatus(title, detail, done = 0, total = 0) {
  $('status').hidden = false; $('status-title').textContent = title; $('status-detail').textContent = detail;
  batchProgress('progress',done,total,'photos');
}
function errorsList(errors) {
  $('error-list').replaceChildren(); $('error-details').hidden = !errors.length;
  for (const message of errors) { const li = document.createElement('li'); li.textContent = message; $('error-list').append(li); }
}
function photoKey(file,path) { return [path,file.size,file.lastModified].join('|'); }
async function importPhotos(files) {
  if (state.importing || state.exporting) return;
  const accepted = [...files].filter(f => /\.(jpe?g|png|webp)$/i.test(f.relativePath || f.webkitRelativePath || f.name));
  if (!accepted.length) { toast('Choose JPG, PNG, or WEBP photos. Convert HEIC or RAW photos first.'); return; }
  state.importing = true; refreshAvailability(); $('show-exports').hidden = true; errorsList([]);
  const errors = [], known = new Set(state.photos.map(p=>p.key)); let added = 0, duplicates = 0;
  try {
    for (let i=0;i<accepted.length;i++) {
      const file = accepted[i], path = file.relativePath || file.webkitRelativePath || file.name, key = photoKey(file,path);
      setStatus('Preparing photos', path, i, accepted.length);
      if (known.has(key)) { duplicates++; continue; }
      let img;
      try {
        img = await decode(file); const [width,height] = dimensions(img);
        if (!width || !height) throw new Error('This image has no readable dimensions');
        const canvas = document.createElement('canvas'); canvas.width = 150; canvas.height = 150;
        const crop = cropGeometry(width,height); canvas.getContext('2d').drawImage(img,crop.x,crop.y,crop.side,crop.side,0,0,150,150);
        const blob = await canvasBlob(canvas,'image/jpeg',.75), thumb = URL.createObjectURL(blob);
        const photo = { id: crypto.randomUUID(), file, path, key, width, height, thumb, positionX: .5, positionY: .5, zoom: 1 };
        state.photos.push(photo); known.add(key); added++;
        const tile = document.createElement('button'); tile.className = 'photo-tile'; tile.dataset.id = photo.id; tile.title = path; tile.setAttribute('aria-label','Preview ' + path); tile.setAttribute('aria-pressed','false');
        const image = document.createElement('img'); image.src = thumb; image.alt = ''; const label = document.createElement('span'); label.textContent = file.name; tile.append(image,label); tile.addEventListener('click',()=>selectPhoto(photo.id)); $('filmstrip').append(tile);
        canvas.width = canvas.height = 1;
      } catch (error) { errors.push(path + ': ' + error.message); }
      finally { release(img); }
      await tick();
    }
    setStatus(added ? 'Photos ready' : 'No new photos added', `${added} added${duplicates ? ' · '+duplicates+' duplicates skipped' : ''}${errors.length ? ' · '+errors.length+' could not be read' : ''}. Choose a photo to review its square crop.`);
    errorsList(errors); if (!state.selected && state.photos.length) await selectPhoto(state.photos[0].id);
  } finally { state.importing = false; refreshAvailability(); $('photos-input').value = ''; $('folder-input').value = ''; }
}
async function loadLogo(file) {
  if (!file || state.exporting) return;
  const version = ++state.logoVersion;
  state.loadingLogo = true; refreshAvailability();
  let img;
  try {
    img = await decode(file); const [w,h] = dimensions(img); if (!w || !h) throw new Error('Logo has no readable dimensions');
    if (version !== state.logoVersion) { release(img); return; }
    release(state.logo); if (state.logoURL) URL.revokeObjectURL(state.logoURL);
    state.logo = img; state.logoURL = URL.createObjectURL(file); $('logo-thumb').src = state.logoURL;
    $('logo-thumb').hidden = false; $('logo-placeholder').hidden = true; $('clear-logo').hidden = false;
    $('logo-name').textContent = file.name; refreshAvailability(); drawPreview();
  } catch (error) { release(img); if (version === state.logoVersion) toast('Could not read this logo: '+error.message); }
  finally { if (version === state.logoVersion) { state.loadingLogo = false; refreshAvailability(); $('logo-input').value = ''; } }
}
function clearLogo() { state.logoVersion++; state.loadingLogo = false; release(state.logo); state.logo = null; if (state.logoURL) URL.revokeObjectURL(state.logoURL); state.logoURL = null; $('logo-thumb').removeAttribute('src'); $('logo-thumb').hidden = true; $('logo-placeholder').hidden = false; $('clear-logo').hidden = true; $('logo-name').textContent = 'Your logo is applied after the crop.'; refreshAvailability(); drawPreview(); }
function removePhoto(id) {
  if (state.importing || state.exporting) return;
  const index = state.photos.findIndex(p=>p.id===id); if (index<0) return;
  URL.revokeObjectURL(state.photos[index].thumb); state.photos.splice(index,1);
  document.querySelector(`.photo-tile[data-id="${id}"]`)?.remove();
  if (state.selected === id) selectPhoto(state.photos[Math.min(index,state.photos.length-1)]?.id || null);
  refreshAvailability();
}
function canvasBlob(canvas,type,quality) { return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob ? resolve(blob) : reject(new Error('Image is too large for this browser. Try a smaller export size.')),type,quality)); }
function exportPathPart(part) {
  let name = part.replace(/[\x00-\x1f<>:"\\|?*]/g,'_').replace(/[. ]+$/g,'') || 'photo';
  if (/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(name.split('.')[0].trimEnd())) name = '_' + name;
  return name;
}
function exportName(photo, config, used) {
  const parts = photo.path.split('/').filter(p=>p && p!=='.' && p!=='..').map(exportPathPart);
  const original = parts.pop() || 'photo', stem = original.replace(/\.[^.]+$/,'');
  const prefix = parts.length ? parts.join('/')+'/' : '';
  let name = `${prefix}${stem}-square-watermarked.${config.format}`, i = 2;
  while (used.has(name.normalize('NFC').toLowerCase())) name = `${prefix}${stem}-square-watermarked-${i++}.${config.format}`;
  used.add(name.normalize('NFC').toLowerCase()); return name;
}
async function exportPhotos() {
  if (state.exporting || state.importing || state.preparingExport || state.pickingFolder || state.loadingLogo || !state.logo || !state.photos.length) return;
  state.preparingExport = true; refreshAvailability();
  const selected = await chooseSaveLocation();
  state.preparingExport = false;
  if (!selected) { refreshAvailability(); return; }
  state.exporting = true; state.stop = false; $('cancel-export').textContent = 'Stop after this photo'; refreshAvailability(); $('show-exports').hidden = true; errorsList([]);
  const photos = state.photos.map(p=>({...p})), config = settings(), logo = state.logo, errors = [], used = new Set();
  let saved = 0, processed = 0, folder = '', job = null;
  try {
    const result = await startChosenExport(selected);
    if (!result) return;
    job = result.job; folder = result.path;
    state.job = job;
    state.exportFolder = folder;
    for (const photo of photos) {
      if (state.stop) break;
      setStatus('Exporting your photos', photo.path, processed, photos.length);
      let img, canvas;
      try {
        img = await decode(photo.file); canvas = document.createElement('canvas');
        renderFinal(canvas,img,photo,config,logo,outputSide(photo,config));
        const blob = await canvasBlob(canvas, config.format==='jpg' ? 'image/jpeg' : 'image/png', .94);
        const name = exportName(photo,config,used);
        await request(`/api/export/file?job=${encodeURIComponent(job)}&name=${encodeURIComponent(name)}`,blob,true); saved++;
      } catch (error) { errors.push(photo.path+': '+error.message); }
      finally { release(img); if (canvas) canvas.width = canvas.height = 1; }
      processed++; batchProgress('progress',processed,photos.length,'photos'); await tick();
    }
    await request(`/api/export/finish?job=${job}`);
    setStatus(state.stop ? 'Export stopped' : errors.length ? 'Export finished with some errors' : 'Your photos are ready', `${saved} photo${saved===1?'':'s'} saved${errors.length?' · '+errors.length+' failed':''}${state.stop?' · '+(photos.length-processed)+' not processed':''}.\n${folder}`, processed, photos.length);
    $('show-exports').hidden = !saved; errorsList(errors);
  } catch (error) {
    setStatus('Export interrupted', `${error.message}${saved?' · '+saved+' photos were already saved to '+folder:''}`,processed,photos.length); errorsList(errors); $('show-exports').hidden = !saved;
  } finally { state.exporting = false; refreshAvailability(); }
}
async function dropFiles(dataTransfer) {
  const collected = [];
  async function walk(entry,prefix='') {
    if (entry.isFile) { const file = await new Promise((resolve,reject)=>entry.file(resolve,reject)); file.relativePath = prefix + file.name; collected.push(file); }
    else if (entry.isDirectory) { const reader = entry.createReader(); let entries; do { entries = await new Promise((resolve,reject)=>reader.readEntries(resolve,reject)); for (const child of entries) await walk(child,prefix+entry.name+'/'); } while (entries.length); }
  }
  const entries = [...(dataTransfer.items || [])].map(item=>item.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) { for (const entry of entries) await walk(entry); } else collected.push(...dataTransfer.files);
  return collected;
}

function toolBusy() { return state.importing || state.exporting || state.preparingExport || state.pickingFolder || !!globalThis.PhotoResize?.isBusy() || !!globalThis.PhotoPdf?.isBusy(); }
function chooseTool(tool) {
  if (toolBusy()) return;
  if (tool === 'resize' && !globalThis.PhotoResize) { toast('The photo tool did not load. Please reload this page.'); return; }
  if (tool === 'pdf' && !globalThis.PhotoPdf) { toast('The PDF tool did not load. Please reload this page.'); return; }
  state.tool = tool;
  $('tool-home').hidden = tool !== 'home'; $('watermark-tool').hidden = tool !== 'watermark'; $('resize-tool').hidden = tool !== 'resize'; $('pdf-tool').hidden = tool !== 'pdf';
  $('drop-overlay').hidden = true; dragDepth = 0;
  if (tool === 'watermark') drawPreview();
}
$('choose-resize').addEventListener('click',()=>chooseTool('resize'));
$('choose-pdf').addEventListener('click',()=>chooseTool('pdf'));
$('pdf-back').addEventListener('click',()=>chooseTool('home'));
$('choose-watermark').addEventListener('click',()=>chooseTool('watermark'));
$('watermark-back').addEventListener('click',()=>chooseTool('home'));
$('resize-back').addEventListener('click',()=>chooseTool('home'));
$('home-link').addEventListener('click',e=>{ e.preventDefault(); chooseTool('home'); });

$('add-photos').addEventListener('click',()=>$('photos-input').click());
$('add-folder').addEventListener('click',()=>$('folder-input').click());
$('empty').addEventListener('click',()=>{ if (!state.importing && !state.exporting) $('photos-input').click(); });
$('empty').addEventListener('keydown',e=>{ if (e.key==='Enter' || e.key===' ') { e.preventDefault(); $('empty').click(); } });
$('photos-input').addEventListener('change',e=>importPhotos(e.target.files)); $('folder-input').addEventListener('change',e=>importPhotos(e.target.files));
$('logo-input').addEventListener('change',e=>loadLogo(e.target.files[0])); $('clear-logo').addEventListener('click',clearLogo);
for (const control of Object.values(controls)) control.addEventListener('input',()=>{ updateControls(); saveSettings(); drawPreview(); });
document.querySelectorAll('[data-corner]').forEach(button=>button.addEventListener('click',()=>{ corner = button.dataset.corner; updateControls(); saveSettings(); drawPreview(); }));
$('tab-final').addEventListener('click',()=>setMode('final')); $('tab-crop').addEventListener('click',()=>setMode('crop'));
$('crop-position').addEventListener('input',e=>setPosition(+e.target.value/100));
$('crop-zoom').addEventListener('input',e=>setZoom(+e.target.value));
$('reset-crop').addEventListener('click',()=>{
  const photo = currentPhoto(); if (!photo || !state.image || state.exporting || state.importing) return;
  photo.positionX = photo.positionY = .5; photo.zoom = 1; pointer = null; cropChanged(photo);
});
let pointer = null;
function previewPoint(e, photo) {
  const rect = $('preview').getBoundingClientRect(), frame = cropViewport(), crop = photoCrop(photo);
  return { x: crop.x+((e.clientX-rect.left)/rect.width*frame.size-frame.x)*crop.side/frame.side, y: crop.y+((e.clientY-rect.top)/rect.height*frame.size-frame.y)*crop.side/frame.side };
}
$('preview').addEventListener('wheel',e=>{
  const photo = currentPhoto(); if (state.mode !== 'crop' || !photo || !state.image || state.exporting || state.importing || pointer || !e.deltaY) return;
  e.preventDefault();
  const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? $('preview').getBoundingClientRect().height : 1);
  setZoom(photo.zoom*Math.exp(-Math.max(-240,Math.min(240,pixels))*.0015),previewPoint(e,photo));
},{ passive: false });
$('preview').addEventListener('pointerdown',e=>{
  const photo = currentPhoto(); if (state.mode!=='crop' || !photo || !state.image || state.exporting || state.importing || pointer || e.button !== 0) return;
  const crop = photoCrop(photo), rect = $('preview').getBoundingClientRect(), frame = cropViewport();
  if (crop.side === photo.width && crop.side === photo.height) return;
  pointer = { photoId: photo.id, startX: crop.x, startY: crop.y, clientX: e.clientX, clientY: e.clientY, scaleX: crop.side*frame.size/(rect.width*frame.side), scaleY: crop.side*frame.size/(rect.height*frame.side), id:e.pointerId };
  $('preview').setPointerCapture(e.pointerId);
});
function movePointer(e) {
  if (!pointer || e.pointerId!==pointer.id || state.mode !== 'crop' || state.exporting || state.importing || !state.image) return;
  const photo = currentPhoto(); if (!photo || photo.id !== pointer.photoId) return;
  // Pan the image in the same direction as the hand, using the original drag origin.
  placeCrop(photo,pointer.startX+(pointer.clientX-e.clientX)*pointer.scaleX,pointer.startY+(pointer.clientY-e.clientY)*pointer.scaleY,photoCrop(photo).side); cropChanged(photo);
}
function endPointer(e) { if (pointer?.id === e.pointerId) pointer = null; }
$('preview').addEventListener('pointermove',movePointer); $('preview').addEventListener('pointerup',endPointer); $('preview').addEventListener('pointercancel',endPointer); $('preview').addEventListener('lostpointercapture',endPointer);
$('remove-photo').addEventListener('click',()=>removePhoto(state.selected));
$('clear-photos').addEventListener('click',()=>{ if (state.importing||state.exporting) return; for (const p of state.photos) URL.revokeObjectURL(p.thumb); state.photos=[]; $('filmstrip').replaceChildren(); selectPhoto(null); refreshAvailability(); });
$('export').addEventListener('click',exportPhotos); $('cancel-export').addEventListener('click',()=>{ state.stop=true; $('cancel-export').textContent='Stopping after this photo…'; });
async function revealExport(job, folder) {
  const name = folder.split(/[\\/]/).pop();
  try { await request(`/api/export/reveal?job=${encodeURIComponent(job || '')}&folder=${encodeURIComponent(name || '')}&path=${encodeURIComponent(folder)}`); }
  catch (error) { toast(error.message); }
}
$('show-exports').addEventListener('click',()=>revealExport(state.job,state.exportFolder));
document.addEventListener('dragenter',e=>{ if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); dragDepth++; if (!toolBusy() && state.tool !== 'home' && !e.target.closest('#logo-drop')) $('drop-overlay').hidden=false; } });
document.addEventListener('dragover',e=>{ if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
document.addEventListener('dragleave',()=>{ dragDepth=Math.max(0,dragDepth-1); if (!dragDepth) $('drop-overlay').hidden=true; });
document.addEventListener('drop',async e=>{ if (e.dataTransfer.types && !e.dataTransfer.types.includes('Files')) return; e.preventDefault(); dragDepth=0; $('drop-overlay').hidden=true; if (toolBusy()) return; if (state.tool === 'home') { toast('Choose a tool first, then add your photos.'); return; } if (state.tool === 'watermark' && e.target.closest('#logo-drop')) { loadLogo(e.dataTransfer.files[0]); return; } try { if (state.tool === 'resize' && !globalThis.PhotoResize) { toast('The photo tool did not load. Please reload this page.'); return; } const tool = state.tool, files = await dropFiles(e.dataTransfer); if (tool === 'resize') await globalThis.PhotoResize.importFiles(files); else if (tool === 'pdf') await globalThis.PhotoPdf.importFiles(files); else await importPhotos(files); } catch (error) { toast('Could not read the dropped folder: '+error.message); } });
window.addEventListener('beforeunload',e=>{ if (state.exporting || globalThis.PhotoResize?.isSaving()) { e.preventDefault(); e.returnValue=''; } });
async function init() {
  restoreSettings(); refreshAvailability();
  try { const response = await fetch('/api/session'); if (!response.ok) throw new Error('Local service is unavailable'); const session = await response.json(); state.token=session.token; refreshAvailability(); globalThis.PhotoResize?.refresh(); globalThis.PhotoPdf?.refresh(); }
  catch (_) { toast('Start the tool with Start FileCraft.bat on Windows or Start FileCraft.command on Mac, then reload this page.'); }
}
init();

// Photo compression and batch resize are part of the same browser script.
'use strict';

// Work in bytes, not an estimated quality percentage. Every candidate is encoded and measured.
async function compressImage(image, maxBytes, createCanvas = () => document.createElement('canvas'), encode = canvasBlob) {
  if (!Number.isFinite(maxBytes) || maxBytes < 1000) throw new Error('Choose a file size limit of at least 1 KB.');
  const [originalWidth, originalHeight] = dimensions(image);
  if (!originalWidth || !originalHeight) throw new Error('This photo has no readable dimensions.');
  const target = Math.floor(maxBytes * .97); // Leave room below upload limits, including decimal MB limits.
  let scale = Math.min(1, 8192/originalWidth, 8192/originalHeight, Math.sqrt(24000000/(originalWidth*originalHeight)));
  const canvas = createCanvas();
  try {
    for (let attempt = 0; attempt < 16; attempt++) {
      canvas.width = Math.max(1,Math.floor(originalWidth*scale));
      canvas.height = Math.max(1,Math.floor(originalHeight*scale));
      let smallest;
      try {
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(image,0,0,canvas.width,canvas.height);
        const high = await encode(canvas,'image/jpeg',.94);
        if (high.size <= target) return { blob: high, width: canvas.width, height: canvas.height, quality: .94 };
        smallest = await encode(canvas,'image/jpeg',.72);
        if (smallest.size <= target) {
          let best = smallest, low = .72, highQuality = .94;
          for (let i=0;i<5;i++) {
            const quality = (low+highQuality)/2, candidate = await encode(canvas,'image/jpeg',quality);
            if (candidate.size <= target) { best = candidate; low = quality; } else highQuality = quality;
          }
          return { blob: best, width: canvas.width, height: canvas.height, quality: low };
        }
      } catch (error) {
        // Large canvases can exceed a browser's memory limit. Retry at smaller dimensions.
        if (canvas.width === 1 && canvas.height === 1) throw error;
      }
      if (canvas.width === 1 && canvas.height === 1) break;
      scale *= smallest ? Math.min(.85,Math.sqrt(target/smallest.size)*.92) : .7;
      await tick();
    }
    throw new Error('Could not make this photo fit the chosen limit. No oversized copy was saved.');
  } finally { canvas.width = canvas.height = 1; }
}

function resizeFileFormat(file) {
  const extension = file.name.split('.').pop().toLowerCase();
  return extension === 'jpeg' ? 'jpg' : extension;
}

async function makeSmallerCopy(photo, maxBytes) {
  // Avoid quality loss and preserve transparency when the original already fits.
  if (photo.file.size < maxBytes) return { blob: photo.file, width: photo.width, height: photo.height, format: resizeFileFormat(photo.file), copied: true };
  let image;
  try {
    image = await decode(photo.file);
    const result = await compressImage(image, Math.min(maxBytes,photo.file.size));
    if (result.blob.size >= maxBytes || result.blob.size >= photo.file.size) throw new Error('The new copy is not small enough. No oversized copy was saved.');
    return { ...result, format: 'jpg', copied: false };
  } finally { release(image); }
}

function resizeExportName(photo, format, used) {
  const parts = photo.path.split('/').filter(p=>p && p!=='.' && p!=='..').map(exportPathPart);
  const stem = (parts.pop() || 'photo').replace(/\.[^.]+$/,''), prefix = parts.length ? parts.join('/')+'/' : '';
  let name = `${prefix}${stem}-smaller.${format}`, i = 2;
  while (used.has(name.normalize('NFC').toLowerCase())) name = `${prefix}${stem}-smaller-${i++}.${format}`;
  used.add(name.normalize('NFC').toLowerCase()); return name;
}

function fileSizeText(bytes) {
  return bytes >= 1000000 ? `${(bytes/1000000).toFixed(2)} MB` : bytes >= 1000 ? `${(bytes/1000).toFixed(1)} KB` : `${bytes} bytes`;
}
function resizeLimitText(bytes) { return bytes >= 1000000 ? `${bytes/1000000} MB` : `${bytes/1000} KB`; }

'use strict';

globalThis.PhotoResize = (() => {
  const batch = { photos: [], limit: 3000000, importing: false, saving: false, preparing: false, stop: false, job: null, folder: '' };
  const busy = () => batch.importing || batch.saving || batch.preparing || state.pickingFolder;
  const presets = [...document.querySelectorAll('[data-bytes]')];
  function availability() {
    for (const id of ['resize-add','resize-folder','resize-input','resize-folder-input','resize-clear','resize-back','resize-empty','resize-custom-preset','resize-custom']) $(id).disabled = busy();
    for (const button of presets) button.disabled = busy();
    document.querySelectorAll('.resize-remove').forEach(button=>button.disabled=busy());
    $('resize-save').disabled = busy() || !batch.photos.length || !state.token;
    $('resize-save').textContent = batch.saving ? 'Saving smaller files…' : `Save smaller files${batch.photos.length ? ' ('+batch.photos.length+')' : ''}`;
    $('resize-stop').hidden = !batch.saving;
    $('resize-count').textContent = `${batch.photos.length} file${batch.photos.length===1?'':'s'} · ${fileSizeText(batch.photos.reduce((sum,p)=>sum+p.file.size,0))} before`;
    $('resize-empty').hidden = !!batch.photos.length;
    $('resize-list').hidden = !batch.photos.length;
  }
  function status(title, detail, done, total) {
    $('resize-status').hidden = false; $('resize-status-title').textContent = title; $('resize-status-detail').textContent = detail;
    batchProgress('resize-progress',done || 0,total);
  }
  function errors(messages) {
    $('resize-errors').replaceChildren(); $('resize-errors').hidden = !messages.length;
    for (const message of messages) { const li = document.createElement('li'); li.textContent = message; $('resize-errors').append(li); }
  }
  function summary() {
    const saved = batch.photos.filter(photo=>photo.result);
    const before = saved.reduce((sum,p)=>sum+p.file.size,0), after = saved.reduce((sum,p)=>sum+p.result.size,0);
    $('resize-summary').textContent = saved.length ? `${saved.length} file${saved.length===1?'':'s'} saved · Before: ${fileSizeText(before)} → After: ${fileSizeText(after)} · ${before ? Math.round((1-after/before)*100) : 0}% smaller in total` : '';
  }
  function updateRow(photo) {
    const result = photo.result;
    photo.after.textContent = result ? fileSizeText(result.size) : '—';
    photo.dimensions.textContent = result ? result.format === 'pdf' ? `PDF${result.pages ? ' · '+result.pages+' page'+(result.pages===1?'':'s') : ''}` : `${result.width} × ${result.height} · ${result.format.toUpperCase()}` : 'Shown after saving';
    photo.outcome.textContent = photo.message || (result ? result.copied ? 'Already small · copied' : `${Math.round((1-result.size/photo.file.size)*100)}% smaller · saved` : 'Ready to save');
    photo.row.classList.toggle('resize-row-error',!!photo.failed);
  }
  function addRow(photo) {
    const row = document.createElement('tr'), name = document.createElement('td'), before = document.createElement('td'), after = document.createElement('td'), outcome = document.createElement('td'), action = document.createElement('td');
    const identity = document.createElement('div'); identity.className = 'resize-photo-name';
    const image = document.createElement(photo.kind === 'pdf' ? 'span' : 'img');
    if (photo.kind === 'pdf') { image.className = 'pdf-file-badge'; image.textContent = 'PDF'; }
    else { image.src = photo.thumb; image.alt = ''; }
    const title = document.createElement('strong'); title.textContent = photo.path;
    identity.append(image,title); name.append(identity); before.textContent = fileSizeText(photo.file.size);
    const size = document.createElement('strong'), dimensionsLabel = document.createElement('small'); after.append(size,dimensionsLabel);
    const remove = document.createElement('button'); remove.className = 'resize-remove'; remove.textContent = '×'; remove.setAttribute('aria-label','Remove '+photo.path); remove.title = 'Remove from list';
    remove.addEventListener('click',()=>{
      if (busy()) return;
      if (photo.thumb) URL.revokeObjectURL(photo.thumb); batch.photos = batch.photos.filter(p=>p!==photo); row.remove(); summary(); availability();
      if (!batch.photos.length) { $('resize-status').hidden = true; $('resize-open').hidden = true; errors([]); }
    });
    action.append(remove); row.append(name,before,after,outcome,action);
    Object.assign(photo,{ row, after: size, dimensions: dimensionsLabel, outcome });
    $('resize-rows').append(row); updateRow(photo);
  }
  async function importFiles(files) {
    if (busy()) return;
    const accepted = [...files].filter(file=>/\.(jpe?g|png|webp|pdf)$/i.test(file.relativePath || file.webkitRelativePath || file.name));
    if (!accepted.length) { toast('Choose PDF, JPG, PNG or WEBP files. Convert HEIC or RAW photos first.'); return; }
    batch.importing = true; availability(); errors([]);
    const known = new Set(batch.photos.map(photo=>photo.key)), problems = []; let added = 0, duplicates = 0;
    try {
      for (let i=0;i<accepted.length;i++) {
        const file = accepted[i], path = file.relativePath || file.webkitRelativePath || file.name, key = photoKey(file,path);
        status('Adding your files',path,i,accepted.length);
        if (known.has(key)) { duplicates++; continue; }
        let image, canvas;
        try {
          const kind = /\.pdf$/i.test(path) ? 'pdf' : 'photo';
          let width = null, height = null, thumb = null;
          if (kind === 'pdf') {
            if (file.size > 100000000) throw new Error('PDF files up to 100 MB are supported.');
            if (!(await file.slice(0,1024).text()).includes('%PDF-')) throw new Error('This file does not appear to be a PDF.');
          } else {
            image = await decode(file); [width,height] = dimensions(image);
            if (!width || !height) throw new Error('This photo has no readable dimensions.');
            canvas = document.createElement('canvas'); const scale = Math.min(120/width,80/height,1);
            canvas.width = Math.max(1,Math.round(width*scale)); canvas.height = Math.max(1,Math.round(height*scale));
            const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(image,0,0,canvas.width,canvas.height);
            thumb = URL.createObjectURL(await canvasBlob(canvas,'image/jpeg',.75));
          }
          const photo = { file, path, key, kind, width, height, thumb, result: null, message: '', failed: false };
          batch.photos.push(photo); known.add(key); addRow(photo); added++;
        } catch (error) { problems.push(path+': '+error.message); }
        finally { release(image); if (canvas) canvas.width = canvas.height = 1; }
        await tick();
      }
      status('Files ready',`${added} added${duplicates?' · '+duplicates+' duplicates skipped':''}. Choose a size limit, then click Save smaller files.`);
      errors(problems); summary();
    } finally { batch.importing = false; $('resize-input').value = ''; $('resize-folder-input').value = ''; availability(); }
  }
  function setLimit(bytes, button) {
    if (busy()) return;
    batch.limit = bytes;
    for (const preset of presets) { const selected = preset === button; preset.classList.toggle('selected',selected); preset.setAttribute('aria-pressed',String(selected)); }
    const custom = button === $('resize-custom-preset');
    $('resize-custom-preset').classList.toggle('selected',custom); $('resize-custom-preset').setAttribute('aria-pressed',String(custom));
    $('resize-custom-controls').hidden = !custom;
    $('resize-limit-hint').textContent = `Every saved file will be under ${resizeLimitText(batch.limit)}.`;
    for (const photo of batch.photos) { photo.result = null; photo.message = ''; photo.failed = false; updateRow(photo); }
    $('resize-summary').textContent = ''; $('resize-open').hidden = true; $('resize-status').hidden = true; errors([]);
  }
  function selectCustom() {
    if (busy()) return;
    const value = Number($('resize-custom').value);
    const mb = Number.isFinite(value) ? Math.max(.1,Math.min(20,Math.round(value*10)/10)) : 3;
    const bytes = Math.round(mb*1000000);
    $('resize-custom').value = mb; $('resize-custom-value').textContent = `${mb} MB`;
    $('resize-custom').setAttribute('aria-valuetext',`Under ${mb} MB`);
    setLimit(bytes,$('resize-custom-preset'));
  }
  async function save() {
    if (busy() || !batch.photos.length || !state.token) return;
    batch.preparing = true; availability();
    const selected = await chooseSaveLocation();
    batch.preparing = false;
    if (!selected) { availability(); return; }
    batch.saving = true; batch.stop = false; $('resize-stop').textContent = 'Stop after this file'; availability(); errors([]); $('resize-open').hidden = true;
    const photos = [...batch.photos], limit = batch.limit, used = new Set(), problems = [];
    let processed = 0, saved = 0, folder = '', job = null;
    for (const photo of photos) { photo.result = null; photo.message = ''; photo.failed = false; updateRow(photo); }
    summary();
    try {
      const started = await startChosenExport(selected);
      if (!started) return;
      job = started.job; folder = started.path; batch.job = job; batch.folder = folder;
      for (const photo of photos) {
        if (batch.stop) break;
        status('Making and saving smaller files',`${processed+1} of ${photos.length} · ${photo.path}${photo.kind === 'pdf' ? '\nPDF support is prepared locally on first use.' : ''}`,processed,photos.length);
        photo.message = 'Making smaller…'; updateRow(photo);
        try {
          if (photo.kind === 'pdf') {
            const name = resizeExportName(photo,'pdf',used);
            const result = await request(`/api/export/pdf?job=${encodeURIComponent(job)}&name=${encodeURIComponent(name)}&limit=${limit}`,photo.file,true);
            if (result.size >= limit) throw new Error('This PDF exceeds the chosen limit.');
            photo.result = {size:result.size, pages:result.pages, format:'pdf', copied:result.copied};
          } else {
            const result = await makeSmallerCopy(photo,limit);
            if (result.blob.size >= limit) throw new Error('This copy exceeds the chosen limit. It was not saved.');
            const name = resizeExportName(photo,result.format,used);
            await request(`/api/export/file?job=${encodeURIComponent(job)}&name=${encodeURIComponent(name)}`,result.blob,true);
            photo.result = { size: result.blob.size, width: result.width, height: result.height, format: result.format, copied: result.copied };
          }
          photo.message = ''; saved++;
        } catch (error) { photo.failed = true; photo.message = 'Could not save'; problems.push(photo.path+': '+error.message); }
        updateRow(photo); summary(); processed++; batchProgress('resize-progress',processed,photos.length); await tick();
      }
      for (const photo of photos.slice(processed)) { photo.message = 'Not processed'; updateRow(photo); }
      await request(`/api/export/finish?job=${encodeURIComponent(job)}`);
      status(batch.stop ? 'Stopped after the current file' : problems.length ? 'Finished with some errors' : 'Your smaller files are ready',`${saved} file${saved===1?'':'s'} saved under ${resizeLimitText(limit)}${processed<photos.length?' · '+(photos.length-processed)+' not processed':''}.\n${folder}`,processed,photos.length);
      errors(problems);
    } catch (error) {
      status('Saving was interrupted',`${error.message}${saved?' · '+saved+' files are already saved in '+folder:''}`,processed,photos.length); errors(problems);
    } finally { batch.saving = false; $('resize-open').hidden = !saved; availability(); summary(); }
  }
  $('resize-add').addEventListener('click',()=>$('resize-input').click());
  $('resize-folder').addEventListener('click',()=>$('resize-folder-input').click());
  $('resize-empty').addEventListener('click',()=>{ if (!busy()) $('resize-input').click(); });
  $('resize-input').addEventListener('change',e=>importFiles(e.target.files));
  $('resize-folder-input').addEventListener('change',e=>importFiles(e.target.files));
  presets.forEach(button=>button.addEventListener('click',()=>setLimit(+button.dataset.bytes,button)));
  $('resize-custom-preset').addEventListener('click',selectCustom);
  $('resize-custom').addEventListener('input',selectCustom);
  $('resize-clear').addEventListener('click',()=>{
    if (busy()) return;
    for (const photo of batch.photos) if (photo.thumb) URL.revokeObjectURL(photo.thumb);
    batch.photos = []; $('resize-rows').replaceChildren(); $('resize-status').hidden = true; $('resize-open').hidden = true; errors([]); summary(); availability();
  });
  $('resize-save').addEventListener('click',save);
  $('resize-stop').addEventListener('click',()=>{ batch.stop = true; $('resize-stop').textContent = 'Stopping after this file…'; });
  $('resize-open').addEventListener('click',()=>revealExport(batch.job,batch.folder));
  availability();
  return { importFiles, isBusy: busy, isSaving: () => batch.saving, refresh: availability };
})();

// PDF page numbers always refer to the current visible order, starting at 1.
function parsePdfPages(text, total) {
  text = text.trim().replace(/[–—]/g,'-');
  if (!text) return Array.from({length:total},(_,i)=>i);
  const selected = new Set();
  for (const part of text.split(',')) {
    const match = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!match) throw new Error('Use page numbers like 1, 3, 5 or a range like 1-5.');
    const first = Number(match[1]), last = Number(match[2] || match[1]);
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last > total || first > last) throw new Error(`Choose page numbers from 1 to ${total}, with ranges like 1-5.`);
    for (let page=first;page<=last;page++) selected.add(page-1);
  }
  // The arranged page order wins over the order of numbers typed in a range.
  return [...selected].sort((a,b)=>a-b);
}

globalThis.PhotoPdf = (() => {
  const workspace = { sources: [], pages: [], working: false, preparing: false, exporting: false, stop: false, job: null, folder: '' };
  const viewer = { page: null, version: 0, cache: new Map(), zoomed: false };
  let nextPageId = 0;
  const busy = () => workspace.working || workspace.preparing || workspace.exporting || state.pickingFolder;
  const chosenPages = () => workspace.pages.filter(page=>page.selected);
  function previewZoom(zoomed) {
    viewer.zoomed = zoomed;
    $('pdf-preview-stage').classList.toggle('zoomed',zoomed);
    $('pdf-preview-zoom').textContent = zoomed ? 'Fit page' : 'Zoom in';
    $('pdf-preview-zoom').setAttribute('aria-pressed',String(zoomed));
    $('pdf-preview-stage').scrollTop = $('pdf-preview-stage').scrollLeft = 0;
  }
  async function previewPage(page) {
    const index = workspace.pages.indexOf(page);
    if (busy() || index < 0) return;
    const version = ++viewer.version, key = page.source+':'+page.page;
    viewer.page = page; previewZoom(false);
    const dialog = $('pdf-preview-dialog'), image = $('pdf-preview-image');
    $('pdf-preview-title').textContent = `Page ${index+1} of ${workspace.pages.length}`;
    $('pdf-preview-origin').textContent = `${page.name} · original page ${page.page+1}`;
    image.alt = `Preview of ${page.name}, original page ${page.page+1}`;
    image.src = page.thumbnail;
    $('pdf-preview-previous').disabled = index === 0;
    $('pdf-preview-next').disabled = index === workspace.pages.length-1;
    $('pdf-preview-zoom').disabled = true;
    $('pdf-preview-message').textContent = 'Loading a clearer preview…';
    $('pdf-preview-stage').setAttribute('aria-busy','true');
    if (!dialog.open) dialog.showModal();
    try {
      let result = viewer.cache.get(key);
      if (!result) result = await request('/api/pdf/preview',{source:page.source,page:page.page});
      if (version !== viewer.version || !dialog.open) return;
      viewer.cache.delete(key); viewer.cache.set(key,result);
      while (viewer.cache.size>6) viewer.cache.delete(viewer.cache.keys().next().value);
      image.src = result.image;
      $('pdf-preview-zoom').disabled = false;
      $('pdf-preview-message').textContent = 'Use Zoom in to read more closely. Arrow keys move between pages; Esc closes the preview.';
    } catch (error) {
      if (version === viewer.version && dialog.open) $('pdf-preview-message').textContent = 'Showing the small preview. '+error.message;
    } finally {
      if (version === viewer.version) $('pdf-preview-stage').setAttribute('aria-busy','false');
    }
  }
  function outputs() {
    const mode = $('pdf-output').value, stem = exportPathPart(($('pdf-name').value.trim() || 'combined').replace(/\.pdf$/i,'')) || 'combined';
    const selected = chosenPages();
    if (mode === 'groups') {
      const lines = $('pdf-groups').value.split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
      if (!lines.length) throw new Error('Enter one page range per line, for example 1-5 on the first line and 6-10 on the second.');
      if (lines.length > 1000) throw new Error('Save up to 1000 PDFs in one batch.');
      return lines.map((line,index)=>({name:`${stem}-part-${index+1}.pdf`,pages:parsePdfPages(line,workspace.pages.length).map(number=>workspace.pages[number])}));
    }
    if (!selected.length) throw new Error('Choose at least one page to save.');
    if (mode === 'separate') return selected.map(page=>({name:`${stem}-page-${workspace.pages.indexOf(page)+1}.pdf`,pages:[page]}));
    return [{name:stem+'.pdf',pages:selected}];
  }
  function refresh() {
    for (const id of ['pdf-back','pdf-add','pdf-folder','pdf-input','pdf-folder-input','pdf-all','pdf-none','pdf-clear','pdf-range','pdf-apply-range','pdf-output','pdf-groups','pdf-name']) $(id).disabled = busy();
    for (const id of ['pdf-all','pdf-none','pdf-apply-range']) $(id).disabled = busy() || !workspace.pages.length;
    $('pdf-save').disabled = busy() || !workspace.pages.length || !state.token;
    $('pdf-save').textContent = workspace.exporting ? 'Saving PDFs…' : $('pdf-output').value === 'combined' ? 'Save new PDF' : 'Save new PDFs';
    $('pdf-stop').hidden = !workspace.exporting;
    $('pdf-empty').hidden = !!workspace.pages.length;
    $('pdf-count').textContent = `${workspace.pages.length} page${workspace.pages.length===1?'':'s'} · ${chosenPages().length} chosen`;
    $('pdf-groups-controls').hidden = $('pdf-output').value !== 'groups';
    if (!workspace.pages.length) $('pdf-plan').textContent = 'Add files to get started.';
    else {
      try { const plan = outputs(); $('pdf-plan').textContent = `${plan.length} new PDF${plan.length===1?'':'s'} · ${plan.reduce((sum,item)=>sum+item.pages.length,0)} pages in total`; }
      catch (error) { $('pdf-plan').textContent = error.message; }
    }
    for (const page of workspace.pages) {
      page.checkbox.disabled = busy(); page.card.draggable = !busy();
      page.previewButton.disabled = busy();
      page.earlier.disabled = busy() || workspace.pages.indexOf(page) === 0;
      page.later.disabled = busy() || workspace.pages.indexOf(page) === workspace.pages.length-1;
    }
    for (const source of workspace.sources) source.remove.disabled = busy();
  }
  function status(title, detail, done=0, total=0) {
    $('pdf-status').hidden = false; $('pdf-status-title').textContent = title; $('pdf-status-detail').textContent = detail;
    batchProgress('pdf-progress',done,total);
  }
  function errors(messages) {
    $('pdf-errors').replaceChildren(); $('pdf-errors').hidden = !messages.length;
    for (const message of messages) { const item = document.createElement('li'); item.textContent = message; $('pdf-errors').append(item); }
  }
  function move(pageId, target) {
    if (busy()) return;
    const from = workspace.pages.findIndex(page=>page.id===pageId);
    if (from<0 || target<0 || target>=workspace.pages.length || from===target) return;
    const [page] = workspace.pages.splice(from,1); workspace.pages.splice(target,0,page);
    $('pdf-range').value = ''; $('pdf-groups').value = '';
    renderPages();
  }
  function renderPages() {
    $('pdf-pages').replaceChildren();
    workspace.pages.forEach((page,index)=>{
      const card = document.createElement('article'), label = document.createElement('label'), checkbox = document.createElement('input'), number = document.createElement('span');
      card.className = 'pdf-page'; card.classList.toggle('selected',page.selected); card.draggable = !busy();
      checkbox.type = 'checkbox'; checkbox.checked = page.selected; number.textContent = `Page ${index+1}`;
      checkbox.addEventListener('change',()=>{ if (busy()) return; page.selected = checkbox.checked; card.classList.toggle('selected',page.selected); $('pdf-range').value=''; refresh(); });
      label.append(checkbox,number);
      const preview = document.createElement('img'); preview.src = page.thumbnail; preview.alt = `Preview of ${page.name}, original page ${page.page+1}`; preview.draggable = false;
      const previewButton = document.createElement('button'), previewLabel = document.createElement('span');
      previewButton.className = 'pdf-page-preview'; previewButton.setAttribute('aria-label',`Preview page ${index+1} from ${page.name}`); previewLabel.textContent = 'Preview page';
      previewButton.append(preview,previewLabel); previewButton.addEventListener('click',()=>previewPage(page));
      card.addEventListener('click',event=>{ if (!event.target.closest('label,button,input')) previewPage(page); });
      const origin = document.createElement('p'); origin.textContent = `${page.name} · original page ${page.page+1}`;
      const actions = document.createElement('div'), earlier = document.createElement('button'), later = document.createElement('button'); actions.className='pdf-page-actions';
      earlier.className = later.className = 'secondary'; earlier.textContent='←'; later.textContent='→';
      earlier.setAttribute('aria-label',`Move page ${index+1} earlier`); later.setAttribute('aria-label',`Move page ${index+1} later`);
      earlier.addEventListener('click',()=>{ move(page.id,workspace.pages.indexOf(page)-1); page.earlier.focus?.(); });
      later.addEventListener('click',()=>{ move(page.id,workspace.pages.indexOf(page)+1); page.later.focus?.(); });
      card.addEventListener('dragstart',event=>{ if (busy()) { event.preventDefault(); return; } event.dataTransfer.setData('text/x-square-page',String(page.id)); event.dataTransfer.effectAllowed='move'; });
      card.addEventListener('dragover',event=>{ if (busy() || !event.dataTransfer.types.includes('text/x-square-page')) return; event.preventDefault(); card.classList.toggle('drag-target',true); });
      card.addEventListener('dragleave',()=>card.classList.toggle('drag-target',false));
      card.addEventListener('drop',event=>{ if (!event.dataTransfer.types.includes('text/x-square-page')) return; event.preventDefault(); event.stopPropagation(); card.classList.toggle('drag-target',false); move(+event.dataTransfer.getData('text/x-square-page'),workspace.pages.indexOf(page)); });
      actions.append(earlier,later); card.append(label,previewButton,origin,actions); $('pdf-pages').append(card);
      Object.assign(page,{card,checkbox,earlier,later,previewButton});
    });
    refresh();
  }
  function renderSources() {
    $('pdf-sources').replaceChildren();
    for (const source of workspace.sources) {
      const chip = document.createElement('div'), text = document.createElement('span'), remove = document.createElement('button'); chip.className='pdf-source';
      text.textContent = `${source.name} · ${source.count} page${source.count===1?'':'s'}`;
      remove.textContent = '×'; remove.setAttribute('aria-label','Remove '+source.name);
      remove.addEventListener('click',()=>removeSources([source]));
      chip.append(text,remove); $('pdf-sources').append(chip); source.remove=remove;
    }
  }
  async function removeSources(sources) {
    if (busy()) return;
    workspace.working=true; refresh();
    const problems=[];
    for (const source of sources) {
      try {
        await request('/api/pdf/remove',{source:source.id});
        for (const key of viewer.cache.keys()) if (key.startsWith(source.id+':')) viewer.cache.delete(key);
        if (viewer.page?.source === source.id && $('pdf-preview-dialog').open) $('pdf-preview-dialog').close();
        workspace.sources=workspace.sources.filter(item=>item!==source);
        workspace.pages=workspace.pages.filter(page=>page.source!==source.id);
      } catch (error) { problems.push(source.name+': '+error.message); }
    }
    workspace.working=false; $('pdf-range').value=''; $('pdf-groups').value='';
    if (!workspace.pages.length) $('pdf-status').hidden=true;
    renderSources(); renderPages(); errors(problems);
  }
  async function importFiles(files) {
    if (busy() || !state.token) return;
    const accepted=[...files].filter(file=>/\.(pdf|png|jpe?g)$/i.test(file.name));
    if (!accepted.length) { toast('Choose PDF, PNG or JPG files.'); return; }
    workspace.working=true; refresh(); errors([]); $('pdf-open').hidden=true; $('pdf-results').replaceChildren();
    const known=new Set(workspace.sources.map(source=>source.key)), problems=[]; let added=0, duplicates=0;
    for (let index=0;index<accepted.length;index++) {
      const file=accepted[index], name=file.relativePath || file.webkitRelativePath || file.name, key=photoKey(file,name);
      status('Preparing your pages',`${index+1} of ${accepted.length} · ${name}\nPDF support is prepared locally on first use.`,index,accepted.length);
      try {
        if (known.has(key)) { duplicates++; continue; }
        if (file.size>100000000) throw new Error('This file is over 100 MB. Add a smaller file.');
        const result=await request('/api/pdf/source?name='+encodeURIComponent(file.name),file,true);
        workspace.sources.push({id:result.source,key,name,count:result.pages.length}); known.add(key);
        for (const page of result.pages) workspace.pages.push({...page,id:++nextPageId,source:result.source,name,selected:true});
        added++; renderSources(); renderPages();
      } catch (error) { problems.push(name+': '+error.message); }
      finally { batchProgress('pdf-progress',index+1,accepted.length); }
      await tick();
    }
    workspace.working=false; renderSources(); renderPages(); errors(problems);
    status(problems.length?'Some files could not be added':'Your pages are ready',`${added} file${added===1?'':'s'} added${duplicates?' · '+duplicates+' already added':''}. Choose your pages and arrange them before saving.`,accepted.length,accepted.length);
  }
  async function save() {
    if (busy() || !workspace.pages.length || !state.token) return;
    let plan; try { plan=outputs(); } catch (error) { errors([error.message]); return; }
    workspace.preparing=true; refresh();
    const selected=await chooseSaveLocation();
    workspace.preparing=false;
    if (!selected) { refresh(); return; }
    workspace.exporting=true; workspace.stop=false; $('pdf-stop').textContent='Stop after this PDF'; refresh(); errors([]); $('pdf-open').hidden=true; $('pdf-results').replaceChildren();
    const problems=[]; let processed=0, saved=0;
    try {
      const started=await startChosenExport(selected);
      if (!started) return;
      workspace.job=started.job; workspace.folder=started.path;
      for (const item of plan) {
        if (workspace.stop) break;
        status('Saving your new PDFs',`${processed+1} of ${plan.length} · ${item.name} · ${item.pages.length} page${item.pages.length===1?'':'s'}`,processed,plan.length);
        try {
          const pages=item.pages.map(page=>({source:page.source,page:page.page}));
          const result=await request(`/api/pdf/export?job=${encodeURIComponent(started.job)}&name=${encodeURIComponent(item.name)}`,{pages});
          const row=document.createElement('li'); row.textContent=`${item.name} · ${result.pages} page${result.pages===1?'':'s'} · ${fileSizeText(result.size)}`; $('pdf-results').append(row); saved++;
        } catch (error) { problems.push(item.name+': '+error.message); }
        processed++; batchProgress('pdf-progress',processed,plan.length); await tick();
      }
      await request('/api/export/finish?job='+encodeURIComponent(started.job));
      status(workspace.stop?'Stopped after the current PDF':problems.length?'Finished with some errors':'Your new PDFs are ready',`${saved} new PDF${saved===1?'':'s'} saved${processed<plan.length?' · '+(plan.length-processed)+' not processed':''}.\n${workspace.folder}`,processed,plan.length);
    } catch (error) { status('Saving was interrupted',`${error.message}${saved?'\nSaved copies are in '+workspace.folder:''}`,processed,plan.length); problems.push(error.message); }
    finally { workspace.exporting=false; $('pdf-open').hidden=!saved; errors(problems); refresh(); }
  }
  $('pdf-add').addEventListener('click',()=>$('pdf-input').click());
  $('pdf-folder').addEventListener('click',()=>$('pdf-folder-input').click());
  for (const id of ['pdf-input','pdf-folder-input']) $(id).addEventListener('change',async event=>{ await importFiles(event.target.files); event.target.value=''; });
  $('pdf-clear').addEventListener('click',()=>removeSources([...workspace.sources]));
  for (const [id,selected] of [['pdf-all',true],['pdf-none',false]]) $(id).addEventListener('click',()=>{ if (busy()) return; for (const page of workspace.pages) page.selected=selected; $('pdf-range').value=''; renderPages(); });
  $('pdf-apply-range').addEventListener('click',()=>{
    if (busy()) return;
    try { const selected=new Set(parsePdfPages($('pdf-range').value,workspace.pages.length)); for (let index=0;index<workspace.pages.length;index++) workspace.pages[index].selected=selected.has(index); errors([]); renderPages(); }
    catch (error) { errors([error.message]); }
  });
  for (const id of ['pdf-output','pdf-name','pdf-groups']) $(id).addEventListener('input',refresh);
  $('pdf-save').addEventListener('click',save);
  $('pdf-stop').addEventListener('click',()=>{ workspace.stop=true; $('pdf-stop').textContent='Stopping after this PDF…'; });
  $('pdf-open').addEventListener('click',()=>revealExport(workspace.job,workspace.folder));
  $('pdf-preview-close').addEventListener('click',()=>$('pdf-preview-dialog').close());
  $('pdf-preview-dialog').addEventListener('close',()=>{ viewer.version++; viewer.page=null; $('pdf-preview-stage').setAttribute('aria-busy','false'); $('pdf-preview-image').removeAttribute('src'); });
  $('pdf-preview-dialog').addEventListener('click',event=>{
    if (event.target !== $('pdf-preview-dialog')) return;
    const rect=event.target.getBoundingClientRect();
    if (event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) event.target.close();
  });
  for (const [id,step] of [['pdf-preview-previous',-1],['pdf-preview-next',1]]) $(id).addEventListener('click',()=>{
    if (!viewer.page) return;
    const next=workspace.pages[workspace.pages.indexOf(viewer.page)+step];
    if (next) return previewPage(next);
  });
  $('pdf-preview-zoom').addEventListener('click',()=>{ if (!$('pdf-preview-zoom').disabled) previewZoom(!viewer.zoomed); });
  $('pdf-preview-dialog').addEventListener('keydown',event=>{
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key==='ArrowLeft' || event.key==='ArrowRight') { event.preventDefault(); $(event.key==='ArrowLeft'?'pdf-preview-previous':'pdf-preview-next').click(); }
  });
  refresh();
  return {importFiles,isBusy:busy,refresh};
})();
