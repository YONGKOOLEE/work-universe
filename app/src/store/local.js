// 브라우저 저장소(12.4 키). DOM에 의존하지 않도록 storage 객체를 주입받는다.

const INDEX_KEY = 'wu:v1:index';
const universeKey = (id) => `wu:v1:u:${id}`;

// 저장소를 쓸 수 있으면 Storage 객체를, 아니면 null을 돌려준다.
// 쿠키·사이트 데이터 차단 시 window.localStorage 접근 자체가 예외를 던지므로 getter도 감싼다.
export function openStorage(getStorage) {
  try {
    const s = getStorage();
    if (!s) return null;
    const probe = 'wu:v1:probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}

export function createStore(storage) {
  // 저장된 값이 깨져 있으면(직접 고침, 저장 중 중단 등) 없는 것으로 본다. 샘플이면 앱이 다시 넣는다
  function parse(raw, fallback) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  // 목록이 깨졌거나 비었으면 저장소의 유니버스 키를 훑어 다시 만든다(localStorage의 key·length가 있을 때)
  function readIndex() {
    const list = parse(storage.getItem(INDEX_KEY), null);
    if (Array.isArray(list) && list.length) return list;
    if (typeof storage.key !== 'function' || typeof storage.length !== 'number') return Array.isArray(list) ? list : [];
    const rebuilt = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (!k || !k.startsWith('wu:v1:u:')) continue;
      const doc = parse(storage.getItem(k), null);
      if (doc && doc.universe) rebuilt.push({ id: doc.universe.id, name: doc.universe.name });
    }
    return rebuilt;
  }

  return {
    loadUniverse(id) {
      const doc = parse(storage.getItem(universeKey(id)), null);
      const ok = doc && doc.universe && ['nodes', 'edges', 'events', 'refs', 'identity_links'].every((k) => Array.isArray(doc[k]));
      return ok ? doc : null;
    },

    saveUniverse(doc) {
      const { id, name } = doc.universe;
      storage.setItem(universeKey(id), JSON.stringify(doc));
      const index = readIndex().filter((e) => e.id !== id);
      index.push({ id, name });
      storage.setItem(INDEX_KEY, JSON.stringify(index));
    },

    removeUniverse(id) {
      storage.removeItem(universeKey(id));
      storage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((e) => e.id !== id)));
    },

    listUniverses: readIndex,
  };
}
