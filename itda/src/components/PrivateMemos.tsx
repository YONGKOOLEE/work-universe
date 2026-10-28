// 「나만 보기」 메모(사용자 결정 2026-10-29): 쓴 사람에게만 보인다. 남의 업무에도 남길 수 있다.
import { useState } from 'react';
import { Lock, X } from 'lucide-react';
import { useStore } from '../lib/store';
import { addPrivateMemo, removePrivateMemo } from '../universe/commands';
import { Button, Card, CardHead, inputCls } from './ui';
import { cx, fmtDate } from '../lib/util';

export function PrivateMemos({ workId }: { workId: string }) {
  const { s, update, toast } = useStore();
  const [t, setT] = useState('');
  const memos = (s.privateMemos || []).filter((m) => m.workId === workId && m.userId === s.currentUserId);
  return (
    <Card className="min-w-0" data-testid="private-memos">
      <CardHead icon={<Lock size={15} />} title="나만 보기 메모" sub="나에게만 보이고, 업무 기록·인계 자료·변경 이력에는 들어가지 않습니다" />
      {memos.length > 0 && (
        <ul className="divide-y divide-line">
          {memos.map((m) => (
            <li key={m.id} className="flex items-start gap-2 px-4 py-2 text-[13px]">
              <span className="w-[86px] shrink-0 font-mono text-2xs text-faint tnum">{fmtDate(m.at)}</span>
              <span className="flex-1">{m.text}</span>
              <button
                className="rounded p-0.5 text-faint hover:bg-sunken hover:text-danger"
                aria-label="메모 지우기"
                onClick={() =>
                  update((d) => {
                    removePrivateMemo(d, m.id, d.currentUserId);
                  })
                }
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2 border-t border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!t.trim()) return;
          const at = new Date().toISOString();
          update((d) => {
            addPrivateMemo(d, workId, d.currentUserId, t, at);
          });
          setT('');
          toast('나만 보기 메모를 남겼습니다');
        }}
      >
        <input className={cx(inputCls, 'flex-1')} placeholder="나만 볼 메모(예: 다음 주 담당자에게 물어볼 것)" value={t} onChange={(e) => setT(e.target.value)} aria-label="나만 보기 메모" data-testid="private-memo-text" />
        <Button type="submit">남기기</Button>
      </form>
    </Card>
  );
}
