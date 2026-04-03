const CACHE_NAME = '3c1r-v1';
const ASSETS = [
  '/',
  '/index.html',
  '/src/main.tsx',
  '/src/App.tsx',
  '/src/index.css',
  'https://en-portal.g.kuroco-img.app/v=1749211658/files/user/character/riceshower/riceshower_03.png',
  'https://image2url.com/r2/default/images/1775182806778-8759d6b4-bd9b-4f16-8452-2a88232dbf92.png',
  'https://external-preview.redd.it/pov-you-are-taking-a-stroll-through-tracen-academy-v0-bGt1aDUyZjJ2MHBiMaRMbkSxRlEoPkqEkHUdwxn3xVHx7JrATurTT389ylVe.png?format=pjpg&auto=webp&s=b4a068732a2c9d2bdb92e6d3c09ed30ab987d7ef'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
