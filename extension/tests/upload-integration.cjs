// Run after building. Set PLAYWRIGHT_MODULE to a Playwright installation if needed.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const root = path.resolve(__dirname, '../.output/chrome-mv3');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
(async () => {
 const server = http.createServer((req, res) => {
   const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
   if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) { res.writeHead(404).end(); return; }
   res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
   res.end(fs.readFileSync(file));
 });
 await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
 const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
 try {
   const page = await browser.newPage({ viewport: { width: 480, height: 1200 } });
   const errors = []; page.on('pageerror', e => errors.push(e.message));
   const remote = new Map(), puts = [], auth = [], imageAuth = [];
   let failAfterJsonWrite = true, denyWrites = false;
   let releaseImages;
   const imagesGate = new Promise(resolve => { releaseImages = resolve; });
   let checkedLocalFiles = false;
   await page.route('https://api.github.com/**', async route => {
     const req = route.request(), url = new URL(req.url());
     auth.push(req.headers().authorization);
     if (!checkedLocalFiles) {
       const localReady = await page.evaluate(async () => {
         const db = await new Promise(resolve => { const r=indexedDB.open('doubao-uploads',1);r.onsuccess=()=>resolve(r.result); });
         const jobs = await new Promise(resolve => { const r=db.transaction('jobs').objectStore('jobs').getAll();r.onsuccess=()=>resolve(r.result); });
         const files = await new Promise(resolve => { const r=db.transaction('files').objectStore('files').count();r.onsuccess=()=>resolve(r.result); });
         db.close();return jobs[0].prepared && files === 4;
       });
       assert.equal(localReady, true, 'All image and text bytes must be local before any GitHub request');
       checkedLocalFiles = true;
     }
     if (url.pathname === '/repos/test/prompts') { await route.fulfill({ json: { default_branch: 'main' } }); return; }
     const file = decodeURIComponent(url.pathname.split('/contents/')[1]);
     if (req.method() === 'GET') {
       assert.equal(url.searchParams.get('ref'), 'main');
       await route.fulfill(remote.has(file) ? { json: { sha: remote.get(file).sha } } : { status: 404, json: { message: 'Not Found' } });
       return;
     }
     const body = req.postDataJSON();
     if (denyWrites) { await route.fulfill({ status: 401, json: { message: 'invalid token' } }); return; }
     assert.equal(body.branch, 'main'); assert.equal(body.message, `InfoFlow: ${file}`);
     if (remote.has(file)) assert.equal(body.sha, remote.get(file).sha);
     puts.push({ file, body }); remote.set(file, { sha: `sha-${puts.length}`, content: Buffer.from(body.content, 'base64') });
     if (file.endsWith('.json') && failAfterJsonWrite) {
       failAfterJsonWrite = false; await route.fulfill({ status: 500, json: { message: 'simulated lost acknowledgement' } }); return;
     }
     await route.fulfill({ status: 201, json: { content: { sha: `sha-${puts.length}` } } });
   });
   const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==', 'base64');
   await page.route('https://test.byteimg.com/**', async route => {
     await imagesGate;
     imageAuth.push(route.request().headers().authorization);
     await route.fulfill({ contentType: 'image/png', body: png });
   });
   await page.addInitScript({ content: `
     const listeners=[];
     const initial={doubao_github_settings:{repo:'test/prompts',token:'fake-test-token',branch:''},'doubao_content_draft:/chat/123':{contents:'  中文正文\\n第二行  ',reply_words:'  回复词  ',images:[{id:'b',url:'https://test.byteimg.com/b.png',name:'b.png'},{id:'a',url:'https://test.byteimg.com/a.png',name:'a.png'}],scanned:true}};
     let store=JSON.parse(localStorage.getItem('mockStore')||'null')||initial;
     const storage={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(k=>[k,store[k]])),set:async data=>{const changes={};for(const k in data)changes[k]={oldValue:store[k],newValue:data[k]};Object.assign(store,data);localStorage.setItem('mockStore',JSON.stringify(store));listeners.forEach(fn=>fn(changes,'local'));},setAccessLevel:async()=>{}};
     window.chrome={storage:{local:storage,onChanged:{addListener:fn=>listeners.push(fn)}},tabs:{query:async()=>[{id:1,url:'https://www.doubao.com/chat/123'}]},runtime:{id:'test',getURL:p=>location.origin+p,onMessage:{addListener:fn=>window.receiver=fn},onStartup:{addListener:()=>{}},onInstalled:{addListener:()=>{}},sendMessage:message=>new Promise(resolve=>window.receiver(message,{id:'test',url:location.origin+'/popup.html'},resolve))},alarms:{get:async()=>({}),create:async()=>{},onAlarm:{addListener:fn=>window.alarm=fn}},action:{setBadgeText:async()=>{},setBadgeBackgroundColor:async()=>{}}};
     Object.defineProperty(navigator,'clipboard',{value:{readText:async()=>''}});
     ${background}
   ` });
   const url = `http://127.0.0.1:${server.address().port}/popup.html`;
   await page.goto(url);
   await page.locator('[data-tab="compose"]').click();
   await page.waitForFunction(() => document.querySelectorAll('.image-card').length === 2);
   await page.locator('#submit-content').click();
   await page.waitForFunction(() => document.querySelector('#compose-status').textContent.includes('任务已保存本地'));
   assert.equal(auth.length, 0, 'Submission must acknowledge without waiting for images or GitHub');
   assert.equal(await page.locator('#submit-content').isEnabled(), true);
   releaseImages();
   await page.waitForFunction(() => document.querySelector('#upload-jobs').textContent.includes('稍后自动重试'));
   assert.equal(remote.size, 3); // Two images and JSON reached the server; no Markdown yet.
   const initialPaths = [...remote.keys()];
   assert(initialPaths.every(p => p.startsWith('infoflow-data/')));
   assert(initialPaths[0].includes('/Images/Prompts/') && initialPaths[0].endsWith('-0.png'));
   const jsonPath = initialPaths.find(p => p.endsWith('.json'));
   const record = JSON.parse(remote.get(jsonPath).content.toString('utf8'));
   assert.equal(record.content, '中文正文\n第二行'); assert.equal(record.reply_words, '回复词'); assert.equal(record.category, 'Prompts');
   assert.equal(record.image, record.images[0]); assert.equal(record.images.length, 2);
   assert(record.images[0].endsWith('-0.png') && record.images[1].endsWith('-1.png'));
   assert.equal(record.url, 'https://www.doubao.com/chat/123'); assert.equal(record.notes, '');
   await page.locator('#submit-content').click();
   await page.waitForFunction(() => document.querySelector('#compose-status').textContent.includes('相同任务已存在'));
   // Persist a due retry, then reload all background state as if the worker restarted.
   await page.evaluate(async () => {
     const db = await new Promise(resolve => { const r=indexedDB.open('doubao-uploads',1);r.onsuccess=()=>resolve(r.result); });
     await new Promise(resolve => { const tx=db.transaction('jobs','readwrite'),s=tx.objectStore('jobs'),r=s.getAll();r.onsuccess=()=>{for(const job of r.result){job.nextAttempt=0;s.put(job);}};tx.oncomplete=resolve; });
     db.close();
   });
   await page.reload();
   await page.locator('[data-tab="compose"]').click();
   await page.waitForFunction(() => document.querySelector('#upload-jobs').textContent.includes('上传完成'));
   assert.equal(remote.size, 4);
   assert.equal(puts.filter(p => p.file.includes('/Images/')).length, 2);
   assert.equal(puts.filter(p => p.file === jsonPath).length, 2);
   const md = remote.get(jsonPath.replace(/\.json$/, '.md')).content.toString('utf8');
   assert(md.includes('## Reply Words\n\n回复词')); assert(md.includes('## Images'));
   assert(auth.every(a => a === 'Bearer fake-test-token')); assert(imageAuth.every(a => a === undefined));
   await page.locator('#submit-content').click();
   await page.waitForFunction(() => document.querySelector('#compose-status').textContent.includes('相同内容已上传'));
   assert.equal(remote.size, 4);
   const invalid = await page.evaluate(() => chrome.runtime.sendMessage({type:'upload:enqueue',input:{contents:'',reply_words:'only notes',url:'',images:[],convertToJpeg:true}}));
   assert.equal(invalid.ok, false);
   const hostile = await page.evaluate(() => chrome.runtime.sendMessage({type:'upload:enqueue',input:{contents:'x',reply_words:'',url:'',images:[{url:'https://evil.example/a.png',name:'a.png'}],convertToJpeg:true}}));
   assert.equal(hostile.ok, false);
   // No page-origin caller may dispatch upload messages.
   const denied = await page.evaluate(() => receiver({type:'upload:enqueue'},{id:'test',url:'https://www.doubao.com/chat/123'},()=>{throw new Error('unexpected response')}));
   assert.equal(denied, undefined);
   denyWrites = true;
   const retryJob = await page.evaluate(() => chrome.runtime.sendMessage({ type:'upload:enqueue',input:{contents:'text only retry',reply_words:'',url:'',images:[],convertToJpeg:false} }));
   assert.equal(retryJob.ok, true);
   await page.waitForFunction(() => document.querySelector('#upload-jobs').textContent.includes('Token 无效'));
   assert.equal(remote.size, 4);
   denyWrites = false;
   await page.locator('#upload-jobs button').click();
   await page.waitForFunction(() => [...document.querySelectorAll('#upload-jobs a')].length === 2);
   assert.equal(remote.size, 6);
   const noImages = [...remote.entries()].find(([file, data]) => file.endsWith('.json') && JSON.parse(data.content.toString()).content === 'text only retry');
   assert.deepEqual(JSON.parse(noImages[1].content.toString()).images, []);
   const ts = require('typescript');
   const moduleSource = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../utils/prepare-image.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
   const workerCheck = await page.evaluate(async source => {
     const workerSource = source + `
       self.onmessage=async()=>{try {
         const c=new OffscreenCanvas(1200,1200),ctx=c.getContext('2d'),pixels=ctx.createImageData(1200,1200);let seed=12345;
         for(let i=0;i<pixels.data.length;i+=4){for(let n=0;n<3;n++){seed=(1664525*seed+1013904223)>>>0;pixels.data[i+n]=seed>>>24;}pixels.data[i+3]=255;}
         ctx.putImageData(pixels,0,0);
         const png=await c.convertToBlob({type:'image/png'}),jpeg=await prepareImage(png,'test.png',true),off=await prepareImage(png,'test.png',false);
         const smallCanvas=new OffscreenCanvas(1,1);smallCanvas.getContext('2d');
         const tiny=await smallCanvas.convertToBlob({type:'image/png'}),exact=new Blob([tiny,new Uint8Array(JPEG_THRESHOLD-tiny.size)],{type:'image/png'});
         const boundary=await prepareImage(exact,'equal.png',true);
         self.postMessage({worker:typeof document==='undefined',converted:jpeg.converted,smaller:jpeg.blob.size<png.size,type:jpeg.blob.type,off:off.blob===png,boundary:boundary.blob===exact});
       }catch(e){self.postMessage({error:String(e)});}};`;
     const url=URL.createObjectURL(new Blob([workerSource],{type:'text/javascript'}));
     const worker=new Worker(url,{type:'module'});
     try { return await new Promise((resolve,reject)=>{worker.onmessage=e=>resolve(e.data);worker.onerror=e=>reject(new Error(e.message));worker.postMessage({});}); }
     finally { worker.terminate();URL.revokeObjectURL(url); }
   }, moduleSource);
   assert.deepEqual(workerCheck, { worker:true,converted:true,smaller:true,type:'image/jpeg',off:true,boundary:true });
   assert.deepEqual(errors, []);
   console.log('PASS: real IndexedDB queue, ordered assets, UTF-8 JSON/MD, default branch, lost response + worker restart, SHA retry, duplicate protection, validation, token isolation. All GitHub requests mocked; no remote writes.');
 } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode=1; });
