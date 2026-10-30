// AI 비서 설정 — 알림·미팅 후 질문 설정, 가상 데이터 삭제·복원, 전체 삭제(이중 확인).
// Windows·브라우저 알림은 없다: 이 화면을 연 동안 메뉴 숫자와 「오늘」 화면에만 표시된다.
import { useEffect, useState } from 'react';
import { Button, Field, inputCls } from '../../components/ui';
import { cx } from '../../lib/util';
import { isErr } from '../model';
import { validateConf } from '../notices';
import type { AssistantConf } from '../types';
import { useAssistant } from './hooks';
import { deletableIds, deleteCustomers, restoreDemo } from './logic';
import { AsstDialog } from './shared';

type Form = { notifyTime: string; reqRemind: string; bdayRemind: string; meetDaybefore: boolean; meetHourbefore: boolean; fuEnable: boolean; fuDuration: string; fuNotime: string };
const formOf = (c: AssistantConf): Form => ({ ...c, fuDuration: String(c.fuDuration) });
const CONFIRM_WORD = '삭제';

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { a, raw, userId, now, exec, toast } = useAssistant();
  const [f, setF] = useState<Form>(() => formOf(a.conf));
  const [error, setError] = useState('');
  const [ask, setAsk] = useState<'' | 'demo' | 'all'>('');
  const [word, setWord] = useState('');
  useEffect(() => {
    if (open) {
      setF(formOf(a.conf));
      setError('');
      setAsk('');
      setWord('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const demoMine = deletableIds(raw, userId, 'demo').length;
  const allMine = deletableIds(raw, userId, 'all').length;
  const demoAll = a.customers.filter((c) => c.isDemo).length;
  const up = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const saveConf = () => {
    setError('');
    const r = exec(null, (_s, d) => {
      const v = validateConf(d.conf, f);
      if (isErr(v)) return v;
      d.conf = v.conf;
      return { ok: true };
    });
    if (isErr(r)) return setError(r.error);
    toast('알림 설정을 저장했습니다');
  };
  const doDelete = (scope: 'demo' | 'all') => {
    const r = exec(null, (s, d) => ({ n: deleteCustomers(d, deletableIds(s, s.currentUserId, scope)) }));
    if (isErr(r)) return setError(r.error);
    setAsk('');
    setWord('');
    toast(scope === 'demo' ? `가상 고객 ${r.n}명을 지웠습니다 — 다시 채우지 않습니다` : `고객 ${r.n}명과 하위 기록을 모두 지웠습니다`);
  };
  const doRestore = () => {
    const r = exec(null, (s, d) => ({ n: restoreDemo(d, now, s.currentUserId) }));
    if (isErr(r)) return setError(r.error);
    toast(r.n ? `가상 고객 ${r.n}명을 채웠습니다(담당: 지금 사용자)` : '이미 모두 있어 더할 가상 고객이 없습니다');
  };

  return (
    <AsstDialog open={open} onClose={onClose} size="lg" title="AI 비서 설정" testId="asst-settings" footer={<Button onClick={onClose}>닫기</Button>}>
      <div className="space-y-6 text-[13px]">
        <section aria-labelledby="asst-set-notice">
          <h3 id="asst-set-notice" className="mb-1 text-[14px] font-semibold">
            알림 · 미팅 후 질문
          </h3>
          <p className="mb-3 text-xs text-muted">알림은 이 화면을 열어 둔 동안 왼쪽 메뉴의 숫자와 「오늘」 화면에만 표시됩니다. Windows 알림·브라우저 알림·창을 닫은 뒤의 알림은 없습니다.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="날짜 기준 알림 시각" htmlFor="asst-s-time">
              <input id="asst-s-time" type="time" className={inputCls} value={f.notifyTime} onChange={(e) => up('notifyTime', e.target.value)} data-testid="asst-s-time" />
            </Field>
            <Field label="요청 기한 알림 (며칠 전)" htmlFor="asst-s-req" hint="쉼표로 구분, 예: 7,2,0">
              <input id="asst-s-req" className={inputCls} value={f.reqRemind} onChange={(e) => up('reqRemind', e.target.value)} data-testid="asst-s-req" />
            </Field>
            <Field label="생일 알림 (며칠 전)" htmlFor="asst-s-bday" hint="쉼표로 구분, 예: 7,2,0">
              <input id="asst-s-bday" className={inputCls} value={f.bdayRemind} onChange={(e) => up('bdayRemind', e.target.value)} />
            </Field>
            <div className="space-y-1.5 self-end pb-1">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.meetDaybefore} onChange={(e) => up('meetDaybefore', e.target.checked)} />
                미팅 전날 알림
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={f.meetHourbefore} onChange={(e) => up('meetHourbefore', e.target.checked)} />
                미팅 1시간 전 알림
              </label>
            </div>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input type="checkbox" checked={f.fuEnable} onChange={(e) => up('fuEnable', e.target.checked)} data-testid="asst-s-fu" />
              미팅이 끝난 1시간 뒤부터 「미팅 후 질문」을 알림으로 안내
            </label>
            <Field label="기본 미팅 소요시간 (분)" htmlFor="asst-s-dur" hint="종료 시간이 없는 미팅에 적용 (10~480)">
              <input id="asst-s-dur" type="number" min={10} max={480} className={inputCls} value={f.fuDuration} onChange={(e) => up('fuDuration', e.target.value)} />
            </Field>
            <Field label="시간 없는 미팅의 질문 시각" htmlFor="asst-s-notime" hint="시작 시간도 없는 미팅은 당일 이 시각부터">
              <input id="asst-s-notime" type="time" className={inputCls} value={f.fuNotime} onChange={(e) => up('fuNotime', e.target.value)} />
            </Field>
          </div>
          <div className="mt-3 flex justify-end">
            <Button variant="primary" onClick={saveConf} data-testid="asst-s-save">
              설정 저장
            </Button>
          </div>
        </section>

        <section aria-labelledby="asst-set-data" className="border-t border-line pt-5">
          <h3 id="asst-set-data" className="mb-1 text-[14px] font-semibold">
            데이터
          </h3>
          <p className="mb-3 text-xs text-muted">
            고객 {a.customers.length}명 (가상 {demoAll}명). 지우기는 <b>내가 고칠 수 있는 고객</b>만 대상입니다(가상 {demoMine}명, 전체 {allMine}명). 다른 담당자의 고객은 지워지지 않습니다. 가상 고객만 지우면 다시 채우지 않습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { setAsk(ask === 'demo' ? '' : 'demo'); setWord(''); }} disabled={!demoMine} data-testid="asst-s-del-demo">
              가상 데이터 삭제
            </Button>
            <Button onClick={doRestore} data-testid="asst-s-restore">
              가상 데이터 다시 채우기
            </Button>
            <Button variant="danger" onClick={() => { setAsk(ask === 'all' ? '' : 'all'); setWord(''); }} disabled={!allMine} data-testid="asst-s-del-all">
              전체 삭제…
            </Button>
          </div>
          {ask === 'demo' && (
            <div className="mt-3 rounded-lg border border-warn/40 bg-warnsoft/40 p-3" data-testid="asst-s-confirm-demo">
              <p>가상 고객 {demoMine}명과 그 활동·요청·경조사·변경 이력을 지울까요? 직접 등록한 고객은 그대로 둡니다.</p>
              <div className="mt-2 flex gap-2">
                <Button variant="danger" size="sm" onClick={() => doDelete('demo')} data-testid="asst-s-confirm-demo-ok">
                  가상 데이터 삭제
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAsk('')}>
                  취소
                </Button>
              </div>
            </div>
          )}
          {ask === 'all' && (
            <div className="mt-3 rounded-lg border border-danger/50 bg-dangersoft/40 p-3" data-testid="asst-s-confirm-all">
              <p className="font-semibold text-danger">정말 전부 지울까요?</p>
              <p className="mt-1">
                내가 고칠 수 있는 고객 {allMine}명(직접 등록한 고객 포함)과 활동·요청·경조사·변경 이력이 모두 지워지며 <b>되돌릴 수 없습니다.</b> 필요하면 먼저 「데이터 옮기기 → 내보내기」로 백업하세요.
              </p>
              <label className="mt-2 block text-xs font-semibold text-muted">
                계속하려면 「{CONFIRM_WORD}」를 입력하세요
                <input className={cx(inputCls, 'mt-1 max-w-[200px] font-normal')} value={word} onChange={(e) => setWord(e.target.value)} data-testid="asst-s-word" autoComplete="off" />
              </label>
              <div className="mt-2 flex gap-2">
                <Button variant="danger" size="sm" disabled={word.trim() !== CONFIRM_WORD} onClick={() => doDelete('all')} data-testid="asst-s-confirm-all-ok">
                  전체 삭제
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setAsk('')}>
                  취소
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p className="mt-2 text-xs text-danger" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
    </AsstDialog>
  );
}
