'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

// Exercise the app's actual input handlers and canvas source rectangles without a browser.
function editor(width = 1600, height = 1000) {
  const elements = new Map(), draws = [];
  const context2d = { drawImage: (...args) => draws.push(args), fillRect() {}, strokeRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, clearRect() {} };
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      value: ({ 'logo-size': 16, 'logo-opacity': 91, 'logo-margin': 3.5, resolution: 'original', format: 'jpg' })[id] || 0,
      options: [], firstChild: {}, classList: { toggle() {} }, handlers: {},
      addEventListener(name, fn, options) { this.handlers[name] = fn; this[name+'Options'] = options; },
      setAttribute() {}, getContext: () => context2d,
      getBoundingClientRect: () => ({ left: 10, top: 20, width: 600, height: 600 }),
      setPointerCapture() {},
    });
    return elements.get(id);
  }
  const sandbox = vm.createContext({
    document: { getElementById: element, querySelectorAll: () => [], querySelector: () => null, body: { classList: { toggle() {} } }, addEventListener() {} },
    window: { addEventListener() {} }, localStorage: { getItem: () => null },
    fetch: async () => ({ ok: true, json: async () => ({ token: 'test' }) }), setTimeout, clearTimeout,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8'), sandbox);
  const run = code => vm.runInContext(code, sandbox);
  run(`state.photos = [{ id: 'test', path: 'test.png', width: ${width}, height: ${height}, positionX: .5, positionY: .5, zoom: 1 }]; state.selected = 'test'; state.image = { width: ${width}, height: ${height} }; setMode('crop'); refreshAvailability();`);
  function wheel(deltaY, deltaMode = 0, x = width/2, y = height/2) {
    const crop = run('photoCrop(currentPhoto())'), frame = run('cropViewport()');
    const event = { deltaY, deltaMode, clientX: 10+(frame.x+(x-crop.x)*frame.side/crop.side)/frame.size*600, clientY: 20+(frame.y+(y-crop.y)*frame.side/crop.side)/frame.size*600, prevented: false, preventDefault() { this.prevented = true; } };
    element('preview').handlers.wheel(event);
    return event;
  }
  return { run, element, draws, wheel, crop: () => run('photoCrop(currentPhoto())'), photo: () => run('currentPhoto()') };
}
function close(a,b) { assert.ok(Math.abs(a-b)<1e-7, `${a} != ${b}`); }
function bounded(crop, width, height) {
  assert.ok(crop.x >= 0 && crop.y >= 0);
  assert.ok(crop.x+crop.side <= width+1e-7 && crop.y+crop.side <= height+1e-7);
}

test('wheel zoom preserves the cursor anchor and reverses without page scrolling', () => {
  const app = editor(), before = app.crop(), x = 1000, y = 400;
  const fx = (x-before.x)/before.side, fy = (y-before.y)/before.side;
  assert.equal(app.element('preview').wheelOptions.passive, false);
  assert.equal(app.wheel(-120,0,x,y).prevented, true);
  const after = app.crop();
  assert.ok(after.side < before.side);
  close(after.x+after.side*fx,x); close(after.y+after.side*fy,y);
  app.wheel(120,0,x,y);
  close(app.photo().zoom,1); close(app.crop().x,before.x); close(app.crop().y,before.y);
});

test('portrait, landscape and square crops stay bounded at both zoom limits', () => {
  for (const [w,h] of [[1600,1000],[1000,1600],[1000,1000]]) {
    const app = editor(w,h);
    app.run('placeCrop(currentPhoto(),0,0,photoCrop(currentPhoto()).side)');
    for (let i=0;i<30;i++) { app.wheel(-200,0,0,0); bounded(app.crop(),w,h); }
    assert.equal(app.photo().zoom,5);
    for (let i=0;i<30;i++) { app.wheel(200,0,w,h); bounded(app.crop(),w,h); }
    assert.equal(app.photo().zoom,1); assert.equal(app.crop().side,Math.min(w,h));
  }
});

test('line and page wheel deltas normalize; final mode and busy states ignore zoom', () => {
  const pixels = editor(), lines = editor();
  pixels.wheel(-48); lines.wheel(-3,1); close(pixels.photo().zoom,lines.photo().zoom);
  const pages = editor(); pages.wheel(-1,2); assert.ok(pages.photo().zoom>1);
  for (const flag of ["state.mode = 'final'",'state.exporting = true', 'state.importing = true']) {
    const app = editor(); app.run(flag);
    assert.equal(app.wheel(-100).prevented,false); assert.equal(app.photo().zoom,1);
  }
});

test('dragging pans the image with the hand in both axes, without jumps or drift', () => {
  const app = editor(1000,1000); app.run('setZoom(2)');
  const preview = app.element('preview');
  preview.handlers.pointerdown({ pointerId: 1, button: 0, clientX: 310, clientY: 320 });
  close(app.crop().x,250); close(app.crop().y,250);
  preview.handlers.pointermove({ pointerId: 1, clientX: 361, clientY: 371 });
  close(app.crop().x,200); close(app.crop().y,200);
  preview.handlers.pointermove({ pointerId: 1, clientX: 412, clientY: 422 });
  close(app.crop().x,150); close(app.crop().y,150);
  preview.handlers.pointermove({ pointerId: 1, clientX: 9999, clientY: -9999 });
  close(app.crop().x,0); close(app.crop().y,500);
  preview.handlers.pointerup({ pointerId: 1 });
  const before = app.crop();
  preview.handlers.pointermove({ pointerId: 1, clientX: 0, clientY: 0 });
  close(app.crop().x,before.x); close(app.crop().y,before.y);
});

test('crop stays large in a fixed square frame while the image enlarges, including outer content', () => {
  for (const [w,h] of [[1600,1000],[1000,1600],[1000,1000]]) {
    const app = editor(w,h), frame = app.run('cropViewport()');
    const check = () => {
      const [image,dx,dy,dw,dh] = app.draws.at(-1), crop = app.crop();
      assert.equal(app.element('preview').width,frame.size);
      assert.equal(app.element('preview').height,frame.size);
      close(dw/dh,w/h);
      close((frame.x-dx)/dw*w,crop.x); close((frame.y-dy)/dh*h,crop.y);
      close(frame.side/dw*w,crop.side); close(frame.side/dh*h,crop.side);
      assert.ok(dx<=frame.x && dy<=frame.y);
      assert.ok(dx+dw>=frame.x+frame.side && dy+dh>=frame.y+frame.side);
      return dw;
    };
    const before = check(); app.run('setZoom(2)'); close(check(),before*2);
    app.run('placeCrop(currentPhoto(),0,0,photoCrop(currentPhoto()).side); drawPreview()'); check();
  }
});

test('final rendering and export use the chosen crop without upscaling; reset restores it', () => {
  const app = editor(); app.run('setZoom(2); placeCrop(currentPhoto(),600,100,500)');
  app.run("setMode('final')");
  assert.deepEqual(app.draws.at(-1).slice(1),[600,100,500,500,0,0,500,500]);
  app.run("renderFinal($('preview'),state.image,currentPhoto(),settings(),null,outputSide(currentPhoto(),settings()))");
  assert.deepEqual(app.draws.at(-1).slice(1),[600,100,500,500,0,0,500,500]);
  app.run('controls.resolution.value = 800; setZoom(1)');
  assert.equal(app.run('outputSide(currentPhoto(),settings())'),800);
  app.run('setZoom(5)'); assert.equal(app.run('outputSide(currentPhoto(),settings())'),200);
  app.element('reset-crop').handlers.click();
  assert.equal(app.photo().zoom,1); close(app.crop().x,300); close(app.crop().y,0);
});

test('crop adjustments stay with each photo and controls re-enable after an import', () => {
  const app = editor(); app.run('setZoom(3)');
  app.run("state.photos.push({ id: 'other', width: 1000, height: 1000, positionX: .5, positionY: .5, zoom: 1 }); state.selected = 'other';");
  assert.equal(app.photo().zoom,1);
  app.run("state.selected = 'test'; state.importing = true; refreshAvailability()");
  close(app.photo().zoom,3); assert.equal(app.element('crop-zoom').disabled,true);
  app.run('state.importing = false; refreshAvailability()');
  assert.equal(app.element('crop-zoom').disabled,false);
  assert.equal(app.element('crop-position').disabled,false);
});

test('exported paths handle names allowed on Mac that Windows cannot save', () => {
  const app = editor();
  for (const [source, expected] of [
    ['CON/Photo: 01?.JPG', '_CON/Photo_ 01_-square-watermarked.jpg'],
    ['LPT²/AUX.data/board.JPG', '_LPT²/_AUX.data/board-square-watermarked.jpg'],
    ['folder. /bad<>"|*.png', 'folder/bad_____-square-watermarked.jpg'],
    ['Produk café/Photo 01.jpg', 'Produk café/Photo 01-square-watermarked.jpg'],
  ]) {
    assert.equal(app.run(`exportName({path: ${JSON.stringify(source)}}, {format: 'jpg'}, new Set())`),expected);
  }
});

test('filenames that become identical after sanitizing receive distinct numbered exports', () => {
  const app = editor(); app.run('globalThis.usedNames = new Set()');
  const first = app.run("exportName({path: 'Photo?.jpg'}, {format: 'jpg'}, usedNames)");
  const second = app.run("exportName({path: 'Photo*.jpg'}, {format: 'jpg'}, usedNames)");
  assert.equal(first,'Photo_-square-watermarked.jpg');
  assert.equal(second,'Photo_-square-watermarked-2.jpg');
});
