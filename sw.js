const CACHE="osu-skill-lab-v0.9";
const CORE=["./","./index.html","./ranked-catalog.js","./manifest.webmanifest","./mobile-analyzer.js","./version.json"];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(
    keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))
  )).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET")return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin || url.pathname.includes("/api/"))return;
  // Public data have independent HTTP caching and update frequently.
  // Never store a full Ranked catalogue in the PWA shell cache.
  if(url.pathname.includes("/data/"))return;
  event.respondWith(
    fetch(request).then(response=>{
      if(response.ok){
        const copy=response.clone();
        caches.open(CACHE).then(cache=>cache.put(request,copy)).catch(()=>{});
      }
      return response;
    }).catch(()=>caches.match(request).then(cached=>cached||caches.match("./index.html")))
  );
});
