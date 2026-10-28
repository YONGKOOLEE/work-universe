import { useMemo, useState, useEffect } from 'react';
import { Sparkles, GitBranch, FilePlus2, Link2, CornerDownRight } from 'lucide-react';
import { Modal, Button, Field, inputCls, Mono, StatusBadge } from './ui';
import { useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { detectDuplicates } from '../ai/engine';
import type { Stmt, Work } from '../lib/types';
import { cx, nextId } from '../lib/util';

type Choice = 'append' | 'child' | 'separate';

// 줄 단위 입력 → 담당자 작성 항목
const lines = (t: string, pre: string): Stmt[] =>
  t
    .split('\n')
    .map((x) => x.replace(/^[\s\-·ㅇ○□*]+/, '').trim())
    .filter(Boolean)
    .map((text, i) => ({ id: `${pre}${i + 1}`, text, prov: 'owner' }));

export function NewWorkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { s, raw, update, log, toast, me } = useStore();
  const { nav } = useRouter();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [bg, setBg] = useState('');
  const [cur, setCur] = useState('');
  const [agency, setAgency] = useState('');
  const [dept, setDept] = useState(me.dept);
  const [owners, setOwners] = useState<string[]>([me.id]);
  const [parent, setParent] = useState<string>('');
  const [type, setType] = useState('정책·제도');
  const [debounced, setDebounced] = useState({ name: '', desc: '' });
  const [choice, setChoice] = useState<Choice | null>(null);
  const [related, setRelated] = useState<string[]>([]);
  const [target, setTarget] = useState<string>('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced({ name, desc }), 350);
    return () => window.clearTimeout(t);
  }, [name, desc]);

  const res = useMemo(() => (debounced.name.trim().length >= 4 ? detectDuplicates(s, debounced.name, debounced.desc) : null), [s, debounced]);

  // AI 추천을 기본 선택으로 반영 (사용자가 바꿀 수 있음)
  useEffect(() => {
    if (!res) return;
    if (res.recommendation === 'child') {
      setChoice('child');
      setParent(res.parentId ?? '');
      setRelated(res.relatedIds);
    } else if (res.recommendation === 'append') {
      setChoice('append');
      setTarget(res.relatedIds[0] ?? '');
    } else if (res.recommendation === 'separate') {
      setChoice('separate');
      setRelated(res.relatedIds);
    } else setChoice('separate');
  }, [res]);

  const close = () => {
    setName('');
    setDesc('');
    setBg('');
    setCur('');
    setAgency('');
    setParent('');
    setChoice(null);
    setRelated([]);
    onClose();
  };

  const submit = () => {
    if (!name.trim()) return;
    if (choice === 'append') {
      const t = target || res?.candidates[0]?.work.id;
      if (!t) return;
      close();
      nav(`/docs?new=1&work=${t}`);
      toast('기존 업무에 자료를 추가합니다');
      return;
    }
    const id = nextId('W', raw.works.map((x) => x.id));
    const now = new Date().toISOString();
    const w: Work = {
      id,
      name: name.trim(),
      parentId: parent || null,
      relatedIds: related,
      type,
      agency: agency.trim() || '별도 확인 필요',
      dept,
      owners,
      ownerHistory: owners.map((u) => ({ userId: u, from: now, to: null, note: '업무 등록 시 지정' })),
      status: '검토 중',
      createdAt: now,
      updatedAt: now,
      version: 1,
      summary: desc.trim() || name.trim(),
      keywords: [],
      purpose: desc.trim() ? [{ id: 'p1', text: desc.trim(), prov: 'owner' }] : [],
      background: lines(bg, 'b'),
      current: lines(cur, 'c'),
      cautions: [],
      rejected: [],
      partners: [],
      nextIds: [],
      topics: [],
    };
    update((d) => {
      d.works.push(w);
      // 새 업무를 문서함·타임라인·회의록에서도 바로 선택된 상태로
      d.focus = { ...(d.focus ?? {}), [d.currentUserId]: id };
      log(d, id, '업무 생성', parent ? `'${d.works.find((x) => x.id === parent)?.name}'의 하위 업무로 등록` : '별도 업무로 등록');
      if (parent) log(d, parent, '하위 업무 추가', `'${w.name}' 하위 업무 등록`);
      related.forEach((r) => {
        const rw = d.works.find((x) => x.id === r);
        if (rw && !rw.relatedIds.includes(id)) rw.relatedIds.push(id);
        log(d, r, '관련 업무 연결', `'${w.name}'와 관련 업무로 연결`);
      });
    });
    close();
    nav(`/works/${id}`);
    toast(`${id} 업무를 등록했습니다 — 문서함·타임라인·회의록에서도 선택됨`);
  };

  const parentName = s.works.find((w) => w.id === parent)?.name;

  return (
    <Modal
      open={open}
      onClose={close}
      wide
      title="업무 등록"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim() || !owners.length || (choice === 'child' && !parent)}>
            {choice === 'append' ? '기존 업무에 자료 추가하기' : choice === 'child' ? '하위 업무로 등록' : '업무 등록'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[1fr_1.05fr]">
        <div className="space-y-3">
          <Field label="업무명 *" htmlFor="nw-name">
            <input id="nw-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 비대면 출금동의 추진" />
          </Field>
          <Field label="업무 설명" htmlFor="nw-desc" hint="업무명이 달라도 설명의 핵심 개념으로 중복 여부를 판단합니다">
            <textarea id="nw-desc" className={cx(inputCls, 'min-h-[64px]')} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="업무 목적 — 무엇을 하려는 업무인지" />
          </Field>
          <Field label="추진 배경 (선택)" htmlFor="nw-bg" hint="한 줄에 한 항목. 비워 두면 업무 한눈에 보기에 '작성 필요'로 표시">
            <textarea id="nw-bg" className={cx(inputCls, 'min-h-[56px]')} value={bg} onChange={(e) => setBg(e.target.value)} placeholder="왜 시작했는지" />
          </Field>
          <Field label="현재 진행 상황 (선택)" htmlFor="nw-cur">
            <textarea id="nw-cur" className={cx(inputCls, 'min-h-[56px]')} value={cur} onChange={(e) => setCur(e.target.value)} placeholder="예: 참가기관 의견 수렴 중" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="담당 부서" htmlFor="nw-dept">
              <input id="nw-dept" className={inputCls} value={dept} onChange={(e) => setDept(e.target.value)} />
            </Field>
            <Field label="담당자 (복수 선택 가능)">
              <div className="flex min-h-[38px] flex-wrap items-center gap-x-4 gap-y-1 rounded-md border border-line2 bg-surface px-3 py-2">
                {s.users.map((u) => (
                  <label key={u.id} className="flex items-center gap-1.5 text-[13px]">
                    <input
                      type="checkbox"
                      className="accent-[rgb(var(--brand))]"
                      checked={owners.includes(u.id)}
                      onChange={(e) => setOwners((o) => (e.target.checked ? [...o, u.id] : o.filter((x) => x !== u.id)))}
                    />
                    {u.name}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="상위 업무" htmlFor="nw-parent">
              <select id="nw-parent" className={inputCls} value={parent} onChange={(e) => setParent(e.target.value)}>
                <option value="">없음 (최상위)</option>
                {s.works.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.id} · {w.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="소관 기관 (선택)" htmlFor="nw-agency">
              <input id="nw-agency" className={inputCls} value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="비우면 '별도 확인 필요'" />
            </Field>
            <Field label="업무 유형" htmlFor="nw-type">
              <select id="nw-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>
                {['정책·제도', '법령·제도', '시스템 구축', '대외 협력', '운영·관리', '기타'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </Field>
          </div>
        </div>

        <div className="min-w-0 rounded-lg border border-line bg-sunken/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-[13.5px] font-semibold">
            <Sparkles size={15} className="text-infer" />
            AI 중복 · 유사 업무 분석
            <span className="ml-auto text-2xs font-normal text-faint">규칙 기반 · 개념 사전 + 문자열 유사도</span>
          </div>
          {!res ? (
            <p className="text-xs text-muted">업무명을 4자 이상 입력하면 기존 업무와 비교합니다.</p>
          ) : (
            <div className="space-y-3">
              <ul className="space-y-2">
                {res.candidates.map((c) => (
                  <li key={c.work.id} className="rounded-md border border-line bg-surface p-2.5">
                    <div className="flex items-center gap-2">
                      <Mono>{c.work.id}</Mono>
                      <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{c.work.name}</span>
                      <StatusBadge status={c.work.status} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                        <div className="h-full rounded-full bg-infer" style={{ width: `${Math.round(c.score * 100)}%` }} />
                      </div>
                      <span className="w-10 text-right text-xs font-semibold text-infer tnum">{Math.round(c.score * 100)}%</span>
                    </div>
                    <p className="mt-1 text-2xs text-muted">{c.reason}</p>
                  </li>
                ))}
                {!res.candidates.length && <li className="text-xs text-muted">유사 업무 없음</li>}
              </ul>
              <div className="rounded-md border border-infer/30 bg-infersoft px-3 py-2 text-[13px] leading-relaxed text-ink">
                <span className="mr-1 font-semibold text-infer">AI 추천</span>
                {res.message}
              </div>

              <fieldset className="space-y-2">
                <legend className="mb-1 text-xs font-semibold text-muted">처리 방법 선택</legend>
                {(
                  [
                    { id: 'append', Icon: FilePlus2, t: '기존 업무에 자료만 추가', d: '새 업무를 만들지 않고 문서 등록 화면으로 이동' },
                    { id: 'child', Icon: GitBranch, t: '기존 업무의 하위 업무로 등록', d: parentName ? `상위 업무: ${parentName}` : '상위 업무를 선택하세요' },
                    { id: 'separate', Icon: Link2, t: '별도 업무로 등록하고 관련 업무로 연결', d: '독립 업무로 등록 후 관련 업무 링크' },
                  ] as const
                ).map((o) => (
                  <label key={o.id} className={cx('flex cursor-pointer gap-2.5 rounded-md border bg-surface p-2.5', choice === o.id ? 'border-brand ring-1 ring-brand' : 'border-line')}>
                    <input
                      type="radio"
                      name="nw-choice"
                      className="mt-1 accent-[rgb(var(--brand))]"
                      checked={choice === o.id}
                      onChange={() => {
                        setChoice(o.id);
                        if (o.id === 'separate') setParent('');
                        if (o.id === 'child' && !parent && res.parentId) setParent(res.parentId);
                      }}
                    />
                    <o.Icon size={16} className="mt-0.5 shrink-0 text-brand" />
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">
                        {o.t}
                        {res.recommendation === o.id && <span className="ml-1.5 rounded bg-infersoft px-1 text-2xs font-semibold text-infer">AI 추천</span>}
                      </span>
                      <span className="block text-2xs text-muted">{o.d}</span>
                    </span>
                  </label>
                ))}
              </fieldset>

              {choice === 'append' && (
                <Field label="자료를 추가할 업무" htmlFor="nw-target">
                  <select id="nw-target" className={inputCls} value={target} onChange={(e) => setTarget(e.target.value)}>
                    {res.candidates.map((c) => (
                      <option key={c.work.id} value={c.work.id}>
                        {c.work.name}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
              {choice !== 'append' && res.candidates.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold text-muted">관련 업무로 연결</p>
                  <div className="space-y-1">
                    {res.candidates
                      .filter((c) => c.work.id !== parent)
                      .map((c) => (
                        <label key={c.work.id} className="flex items-center gap-2 text-[13px]">
                          <input
                            type="checkbox"
                            className="accent-[rgb(var(--brand))]"
                            checked={related.includes(c.work.id)}
                            onChange={(e) => setRelated((r) => (e.target.checked ? [...r, c.work.id] : r.filter((x) => x !== c.work.id)))}
                          />
                          {c.work.name}
                        </label>
                      ))}
                  </div>
                </div>
              )}
              {choice === 'child' && parentName && (
                <div className="rounded-md border border-line bg-surface px-3 py-2 text-xs">
                  <p className="mb-1 font-semibold text-muted">등록 후 업무 계층</p>
                  <p>{parentName}</p>
                  {s.works
                    .filter((w) => w.parentId === parent)
                    .map((w) => (
                      <p key={w.id} className="flex items-center gap-1 pl-3 text-muted">
                        <CornerDownRight size={11} />
                        {w.name}
                      </p>
                    ))}
                  <p className="flex items-center gap-1 pl-3 font-semibold text-brand">
                    <CornerDownRight size={11} />
                    {name || '(신규 업무)'} · 신규
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
