// 백업 권유 한 줄(R-21 ②, D-23): 머리글 아래 「내보내기를 권합니다」 + 「지금 내보내기」 + 「닫기」.
// 판단은 rules/backup.js가 한다. 이 파일은 그린다. 권유가 아니면 칸을 비우고 숨긴다.

import { BACKUP_CHANGES, BACKUP_DAYS } from '../rules/backup.js';
import { el } from './dom.js';

/** @param {HTMLElement} slot @param {{suggest:boolean, changes:number, reason:string|null, days:number|null}|null} advice */
export function renderBackupNudge(slot, advice, { onExport, onClose }) {
  if (!advice || !advice.suggest) {
    slot.replaceChildren();
    slot.hidden = true;
    return;
  }
  const why = advice.reason === 'count'
    ? `바뀐 것이 ${advice.changes}건으로 ${BACKUP_CHANGES}건을 넘었습니다.`
    : `마지막 내보내기 뒤 ${advice.days}일이 지났고(${BACKUP_DAYS}일 기준) 바뀐 것이 ${advice.changes}건 있습니다.`;
  slot.replaceChildren(
    el('strong', {}, '내보내기를 권합니다'), ` — ${why} 브라우저 저장소가 지워지면 되돌릴 수 없어, 지금 유니버스를 파일로 내려받아 두세요. `,
    el('button', { type: 'button', class: 'primary', 'data-testid': 'backup-export', onclick: onExport }, '지금 내보내기'), ' ',
    el('button', { type: 'button', 'data-testid': 'backup-close', onclick: onClose }, '닫기'),
  );
  slot.hidden = false;
}
