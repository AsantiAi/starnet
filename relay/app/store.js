/* StarNet Remote — what this phone remembers about its station, in IndexedDB.

   The device private key is a NON-EXTRACTABLE CryptoKey. IndexedDB stores it as an opaque object: the page can
   use it to prove it is this phone, but no script (ours included) can read the key's bytes back out.

     await RemoteStore.load()        -> { key:{ privateKey, publicRaw }, station:{ ... } } | null
     await RemoteStore.save(record)
     await RemoteStore.forget() */
(function (root) {
  'use strict';
  const DB = 'starnet-remote', OS = 'kv', K = 'pairing';

  function db() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => { r.result.createObjectStore(OS); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('storage unavailable'));
    });
  }
  function tx(mode, fn) {
    return db().then(d => new Promise((resolve, reject) => {
      const t = d.transaction(OS, mode);
      const s = t.objectStore(OS);
      let out;
      try { out = fn(s); } catch (e) { reject(e); return; }
      t.oncomplete = () => { d.close(); resolve(out && 'result' in out ? out.result : undefined); };
      t.onerror = () => { d.close(); reject(t.error || new Error('storage failed')); };
    }));
  }

  root.RemoteStore = {
    load: () => tx('readonly', s => s.get(K)).then(v => v || null),
    save: (rec) => tx('readwrite', s => s.put(rec, K)),
    forget: () => tx('readwrite', s => s.delete(K))
  };
}(typeof self !== 'undefined' ? self : this));
