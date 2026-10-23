// 폴더 연결(CR-14 C, R-27, D-32)의 순수 계산: 내 파일 이름과 폴더 파일 목록 판정. DOM·저장소를 쓰지 않는다.

import { parseImportText } from '../model/import.js';
import { validateDocument } from '../model/validate.js';

/**
 * 내 파일 이름(9차 검토 R9-3): 공유 폴더에서 한눈에 알아보도록 `유니버스 이름(작성자).json`.
 * 작성자가 없으면 `유니버스 이름.json`, 유니버스 이름이 비면 ID로 대신한다.
 * 같은 이름의 유니버스가 이 브라우저에 둘 이상이면(withId) 서로 덮어쓰지 않게 `…-유니버스ID.json`으로 ID를 붙인다.
 * 파일 이름에 못 쓰는 글자(\ / : * ? " < > |)와 공백 덩어리는 _로 바꾸고, 앞뒤의 점·밑줄은 떼며, 각 부분은 60자까지.
 * (CR-14 초안 C14-7은 "작성자 이름.json", 처음 구현은 `작성자-ID.json`이었다)
 * @param {{authorName?:string, universeName?:string, universeId:string, withId?:boolean}} p
 */
export function myFileName({ authorName, universeName, universeId, withId = false }) {
  const clean = (s) => String(s ?? '').replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 60);
  const id = clean(universeId) || 'universe';
  const title = clean(universeName);
  const author = clean(authorName);
  const base = `${title || id}${author ? `(${author})` : ''}`;
  return withId && title ? `${base}-${id}.json` : `${base}.json`;
}

/**
 * 폴더에서 읽은 파일을 하나씩 검사한다. 깨진 파일은 그 파일만 ok:false로 두고 나머지는 계속한다.
 * @param {{name:string, text:string}[]} files
 * @param {{myFiles?:Set<string>, existingIds?:Set<string>, currentId?:string}} ctx
 *   myFiles: 내 파일 이름(목록에서 구분), existingIds: 이 브라우저에 이미 있는 유니버스 ID, currentId: 지금 연 유니버스 ID
 * @returns {{name:string, ok:boolean, universe:{id:string, name:string, level:string}|null, reason?:string, mine:boolean, exists:boolean, current:boolean}[]}
 */
export function planFolder(files, { myFiles = new Set(), existingIds = new Set(), currentId = '' } = {}) {
  return (Array.isArray(files) ? files : []).map((f) => {
    const name = String(f && f.name);
    const mine = myFiles.has(name);
    const base = { name, ok: false, universe: null, mine, exists: false, current: false };
    const parsed = parseImportText(f && f.text);
    if (!parsed.ok) {
      const why = { empty: '내용이 비어 있습니다', too_big: '파일이 너무 큽니다', json: 'JSON 형식이 아닙니다(깨졌거나 다른 형식)', shape: '유니버스 문서 형식이 아닙니다' }[parsed.error.reason];
      return { ...base, reason: why || '읽을 수 없습니다' };
    }
    let checked;
    try {
      checked = validateDocument(parsed.doc);
    } catch {
      return { ...base, reason: '유니버스 문서 형식이 아닙니다' };
    }
    if (checked.readOnly) return { ...base, reason: `형식 버전이 다릅니다(파일 ${parsed.doc.schema_version ?? '없음'})` };
    if (!checked.ok) return { ...base, reason: `유니버스 문서로 읽을 수 없습니다(고칠 것 ${checked.errors.length}건)` };
    const u = parsed.doc.universe;
    return {
      ...base,
      ok: true,
      universe: { id: u.id, name: u.name, level: u.level },
      exists: existingIds.has(u.id),
      current: !!currentId && u.id === currentId,
    };
  });
}
