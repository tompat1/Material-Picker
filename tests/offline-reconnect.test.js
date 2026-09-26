const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const core = require('../public/app-core.js');

function browserApp(videos) {
  const storage = new Map([['material-picker:v1', JSON.stringify({ videos, collections: [], selectedId: videos[0]?.id })]]);
  const element = { checked: false, value: '' };
  const context = vm.createContext({
    window: { MaterialPickerCore: core },
    document: { querySelector: () => element },
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    crypto, File, URL, performance, console, setTimeout, clearTimeout,
  });
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8').replace('\ninit();', '');
  vm.runInContext(source + `
    render = () => {};
    setStatus = () => {};
    showDesk = () => {};
    globalThis.app = {
      repairDuplicateArchives, processImportedFolderEntries,
      getState: () => state,
      load: (url, type = 'manifest') => new Promise((resolve, reject) => {
        new PackageHlsLoader({}).load({ url, type }, {}, {
          onSuccess: resolve, onError: reject
        });
      })
    };
  `, context);
  return { app: context.app, storage };
}

function archiveEntries(root) {
  return [
    ['master.m3u8', '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nvideo/playlist.m3u8'],
    ['video/playlist.m3u8', '#EXTM3U\n#EXTINF:2,\nsegments/00001.m4s'],
    ['audio/playlist.m3u8', '#EXTM3U\n#EXTINF:1,\nsegments/00001.m4s'],
    ['video/segments/00001.m4s', 'video bytes'],
    ['audio/segments/00001.m4s', 'audio bytes'],
  ].map(([path, text]) => {
    const name = path.split('/').pop();
    return { name, relPath: `${root}/${path}`, handle: { getFile: async () => new File([text], name) } };
  });
}

test('repairs 93 legacy archive records to 31, preserving original collections and a backup', () => {
  const originals = Array.from({ length: 31 }, (_, i) => ({
    id: `original-${i}`, title: `Talk ${i}`, collectionId: `day${i % 3}`,
    notes: `HLS Package: day${i % 3}/Talk ${i} - abc${i} (1 GB)`,
    url: `/hls-package/stale-${i}/master.m3u8`, createdAt: '2026-09-22',
    transcript: `Saved transcript ${i}`,
  }));
  const duplicates = originals.flatMap((v) => [1, 2].map((n) => ({
    ...v, id: `import-${n}-${v.id}`, collectionId: n === 1 ? '' : 'parent-folder',
    createdAt: '2026-09-26', transcript: '',
  })));
  const { app, storage } = browserApp([...duplicates, ...originals]);
  app.repairDuplicateArchives();
  assert.equal(app.getState().videos.length, 31);
  assert.ok(app.getState().videos.every(v => v.id.startsWith('original-') && v.transcript));
  assert.equal(JSON.parse(storage.get('material-picker:v1:before-archive-repair')).videos.length, 93);
  app.repairDuplicateArchives();
  assert.equal(app.getState().videos.length, 31);
});

test('repeated parent-folder scans reconnect metadata-free archives and load separate tracks', async () => {
  const root = 'day3/The Art of Impossible - Steven Kotler - 2cb26da0';
  const { app } = browserApp([{
    id: 'unrelated-import-id', title: 'The Art of Impossible Steven Kotler 2cb26da0',
    collectionId: 'day3', notes: `HLS Package: ${root} (1 GB)`,
    url: '/hls-package/expired/master.m3u8', offlineSize: 1000,
  }]);
  for (let scan = 0; scan < 2; scan++) {
    await app.processImportedFolderEntries(archiveEntries(root), 'iza_movies_psychology');
    const videos = app.getState().videos;
    assert.equal(videos.length, 1);
    assert.equal(videos[0].collectionId, 'day3');
    assert.equal(videos[0].offlineSize, 1000);
    const base = videos[0].offlineUrl.replace(/master.m3u8$/, '');
    assert.match((await app.load(base + 'master.m3u8')).data, /video\/playlist/);
    assert.match((await app.load(base + 'audio/playlist.m3u8', 'audioTrack')).data, /EXTINF:1/);
    assert.match((await app.load(base + 'video/playlist.m3u8', 'level')).data, /EXTINF:2/);
    assert.equal(Buffer.from((await app.load(base + 'video/segments/00001.m4s', 'fragment')).data).toString(), 'video bytes');
  }
});

test('archive matching normalizes Mac Unicode filenames without merging similar titles', () => {
  const videos = [
    { id: 'one', notes: 'HLS Package: day5/Compassionate Inquiry - Dr. Gabor Mat\u00e9 - 27296f3d (1 GB)' },
    { id: 'two', notes: 'HLS Package: day5/Compassionate Inquiry - Dr. Gabor Mat\u00e9 - another-id (1 GB)' },
  ];
  assert.deepEqual(core.offlineReconnectMatches(videos, {}, 'Compassionate Inquiry - Dr. Gabor Mate\u0301 - 27296f3d').map(v => v.id), ['one']);
});
