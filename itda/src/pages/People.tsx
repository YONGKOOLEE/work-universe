import { useState } from 'react';
import { Plus, Pencil, UserMinus, UserCheck, Trash2, UserRound, ArrowRightLeft } from 'lucide-react';
import { canStartHandoverFor, useCanEditPeople, useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { Button, Card, CardHead, Field, Mono, inputCls } from '../components/ui';
import { addPerson, editPerson, personPrivateMemoCount, removePerson, roleLabel, setPersonStatus, isLeft, type PersonInput } from '../lib/people';
import { clone, cx } from '../lib/util';
import type { AppState } from '../lib/types';
import { OrgSection } from '../components/OrgSection';
import { effectiveOrgs, orgShort, orgTree } from '../lib/orgs';

type Form = { id: string | null; name: string; dept: string; title: string; empNo: string; role: 'member' | 'lead' };

export default function People() {
  const { raw, update, toast, me } = useStore();
  const { nav } = useRouter();
  const canEditAll = useCanEditPeople(); // 사람·조직 편집은 조직장만(사용자 결정 2026-10-29)
  const [form, setForm] = useState<Form | null>(null);
  const [formErr, setFormErr] = useState('');
  const [notice, setNotice] = useState<{ id: string; lines: string[]; kind: 'blocked' | 'left' | 'confirm-left' | 'confirm-remove' } | null>(null);

  const orgList = orgTree(effectiveOrgs(raw));
  const userNameOf = (id: string) => raw.users.find((u) => u.id === id)?.name ?? id;
  const ownedCount = (id: string) => raw.works.filter((w) => w.owners.includes(id)).length;
  const open = (u?: AppState['users'][number]) => {
    setFormErr('');
    setForm(u ? { id: u.id, name: u.name, dept: u.dept, title: u.title, empNo: u.empNo ?? '', role: u.role ?? 'member' } : { id: null, name: '', dept: me?.dept ?? '', title: '', empNo: '', role: 'member' });
  };

  const save = () => {
    if (!form || !canEditAll) return;
    const input: PersonInput = { name: form.name, dept: form.dept, title: form.title, empNo: form.empNo, role: form.role };
    // 먼저 사본에 해 보아 오류를 확인하고, 통과하면 저장소에 반영한다
    const probe = clone(raw);
    const r = form.id ? editPerson(probe, form.id, input) : addPerson(probe, input);
    if (r && 'error' in r) return setFormErr(r.error);
    if (r === null) {
      setForm(null);
      return toast('바뀐 내용이 없습니다');
    }
    update((d) => {
      if (form.id) editPerson(d, form.id, input);
      else addPerson(d, input);
    });
    toast(r.summary);
    setForm(null);
  };

  // 「전출·퇴직」은 확인 창을 먼저 띄운다(복귀는 바로)
  const askLeft = (id: string) => {
    const lines = raw.works.filter((w) => w.owners.includes(id)).map((w) => `${w.name} (${w.id})`);
    setNotice({ id, kind: 'confirm-left', lines });
  };
  const toggleStatus = (id: string, to: 'active' | 'left') => {
    const r = setPersonStatus(clone(raw), id, to);
    if (!r) return;
    if ('error' in r) return toast(r.error);
    update((d) => {
      setPersonStatus(d, id, to);
    });
    toast(r.summary);
    setNotice(to === 'left' && r.ownedWorks.length ? { id, kind: 'left', lines: r.ownedWorks.map((w) => `${w.name} (${w.id})`) } : null);
  };

  // 지우기: 쓰인 곳이 있으면 막고, 없으면 확인 창(나만 보기 메모 건수 포함)을 띄운다
  // 전출·퇴직 처리 직후 바로가기: 이 사람이 담당이고 내가 인계를 시작할 수 있는 업무 수
  const handoverable = notice?.kind === 'left' ? raw.works.filter((w) => w.owners.includes(notice.id) && canStartHandoverFor(raw, w.id, raw.currentUserId)).length : 0;

  const askRemove = (id: string) => {
    const r = removePerson(clone(raw), id);
    if ('error' in r) return toast(r.error);
    if ('blocked' in r) return setNotice({ id, kind: 'blocked', lines: r.blocked });
    setNotice({ id, kind: 'confirm-remove', lines: [] });
  };
  const remove = (id: string) => {
    const r = removePerson(clone(raw), id);
    if ('error' in r) return toast(r.error);
    if ('blocked' in r) return setNotice({ id, kind: 'blocked', lines: r.blocked });
    update((d) => {
      removePerson(d, id);
    });
    setNotice(null);
    toast(r.summary);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">사람</h1>
          <p className="text-[13px] text-muted">업무 담당·인계에 쓰는 사람을 등록하고 고칩니다. 전출·퇴직한 사람은 선택 목록에서 빠지지만 기록은 남습니다.</p>
        </div>
        {canEditAll && (
          <Button variant="primary" onClick={() => open()} data-testid="people-add">
            <Plus size={16} />
            사람 추가
          </Button>
        )}
      </div>
      {!canEditAll && (
        <p className="rounded-lg border border-line bg-sunken/60 px-4 py-2.5 text-[13px] text-muted" data-testid="people-readonly-note">
          사람·조직은 조직장(팀장·부장)이 고칩니다.
        </p>
      )}

      {canEditAll && form && (
        <Card>
          <CardHead title={form.id ? '사람 고치기' : '사람 추가'} icon={<UserRound size={16} />} />
          <div className="space-y-3 p-4" data-testid="people-form">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="이름" htmlFor="pp-name">
                <input id="pp-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="소속 조직" htmlFor="pp-dept">
                <select id="pp-dept" className={inputCls} value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })}>
                  {!orgList.some(({ org }) => org.name === form.dept) && <option value={form.dept}>{orgShort(form.dept) || '선택하세요'}</option>}
                  {orgList.map(({ org, depth }) => (
                    <option key={org.id} value={org.name}>
                      {'\u00a0\u00a0'.repeat(depth)}
                      {orgShort(org.name)} ({org.level})
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="직급" htmlFor="pp-title">
                <input id="pp-title" className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </Field>
              <Field label="사번 (선택)" htmlFor="pp-emp" hint="V-숫자 4자리, 예: V-1234">
                <input id="pp-emp" className={inputCls} value={form.empNo} onChange={(e) => setForm({ ...form, empNo: e.target.value })} placeholder="V-1234" />
              </Field>
              <Field label="역할" htmlFor="pp-role">
                <select id="pp-role" className={inputCls} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as 'member' | 'lead' })}>
                  <option value="member">팀원</option>
                  <option value="lead">조직장(팀장·부장)</option>
                </select>
              </Field>
            </div>
            {formErr && (
              <p className="text-xs text-danger" role="alert" data-testid="people-form-error">
                {formErr}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setForm(null)}>
                취소
              </Button>
              <Button variant="primary" onClick={save} data-testid="people-save">
                {form.id ? '저장' : '추가'}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {canEditAll && notice && (
        <Card className={cx('p-4 text-[13px]', notice.kind === 'blocked' ? 'border-warn/50' : 'border-brand/40')} data-testid="people-notice">
          {notice.kind === 'blocked' ? (
            <>
              <p className="font-semibold">지울 수 없습니다 — 이 사람이 쓰인 곳이 있습니다.</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {notice.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted">기록을 남기려면 「전출·퇴직으로 표시」를 권합니다. 선택 목록에서만 빠지고 기록은 그대로 남습니다.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => toggleStatus(notice.id, 'left')}>
                  전출·퇴직으로 표시
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
                  닫기
                </Button>
              </div>
            </>
          ) : notice.kind === 'confirm-left' ? (
            <div data-testid="people-confirm-left">
              <p className="font-semibold">{userNameOf(notice.id)}을(를) 전출·퇴직으로 표시할까요?</p>
              {notice.lines.length > 0 ? (
                <>
                  <p className="mt-1 text-muted">이 사람이 담당한 업무 {notice.lines.length}건:</p>
                  <ul className="mt-1 list-disc pl-5 text-muted">
                    {notice.lines.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-1 text-muted">이 사람이 담당한 업무는 없습니다.</p>
              )}
              <p className="mt-2 text-muted">담당은 자동으로 바뀌지 않습니다 — 업무 인계 관리에서 넘기세요. 「복귀」로 되돌릴 수 있습니다.</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" onClick={() => toggleStatus(notice.id, 'left')} data-testid="people-confirm-left-ok">
                  전출·퇴직으로 표시
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
                  취소
                </Button>
              </div>
            </div>
          ) : notice.kind === 'confirm-remove' ? (
            <div data-testid="people-confirm-remove">
              <p className="font-semibold">{userNameOf(notice.id)}을(를) 지울까요?</p>
              <p className="mt-1 text-muted">
                {personPrivateMemoCount(raw, notice.id) > 0 ? `이 사람이 쓴 「나만 보기」 메모 ${personPrivateMemoCount(raw, notice.id)}건도 함께 지워집니다. ` : '이 사람이 쓴 「나만 보기」 메모는 없습니다. '}
                지운 사람은 되돌릴 수 없습니다.
              </p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="danger" onClick={() => remove(notice.id)} data-testid="people-confirm-remove-ok">
                  지우기
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
                  취소
                </Button>
              </div>
            </div>
          ) : (
            <>
              <p className="font-semibold">담당을 먼저 넘기세요 — 이 사람이 아직 담당인 업무가 있습니다.</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {notice.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted">담당은 자동으로 바뀌지 않습니다. 「업무 인계 관리」에서 인계하거나 업무 화면에서 담당자를 바꾸세요.</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {handoverable > 0 && (
                  <Button size="sm" variant="primary" onClick={() => nav(`/handover?from=${notice.id}`)} data-testid="people-left-handover">
                    <ArrowRightLeft size={12} />
                    이 사람 업무 {handoverable}건 넘기기
                  </Button>
                )}
                <Button size="sm" variant="ghost" onClick={() => setNotice(null)}>
                  닫기
                </Button>
              </div>
              {handoverable < notice.lines.length && <p className="mt-1.5 text-2xs text-muted">{notice.lines.length - handoverable}건은 내 조직 범위 밖이라 그 조직의 조직장이 넘깁니다.</p>}
            </>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-sunken/60 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-semibold">이름</th>
              <th className="px-3 py-2.5 font-semibold">소속 조직</th>
              <th className="px-3 py-2.5 font-semibold">직급</th>
              <th className="px-3 py-2.5 font-semibold">사번</th>
              <th className="px-3 py-2.5 font-semibold">역할</th>
              <th className="px-3 py-2.5 font-semibold">상태</th>
              <th className="px-3 py-2.5 font-semibold">담당 업무</th>
              <th className="px-3 py-2.5 font-semibold">동작</th>
            </tr>
          </thead>
          <tbody>
            {raw.users.map((u) => {
              const isMe = u.id === raw.currentUserId;
              const left = isLeft(u);
              return (
                <tr key={u.id} className={cx('border-b border-line last:border-0', left && 'text-muted')} data-testid="people-row">
                  <td className="px-4 py-3 font-semibold">
                    {u.name}
                    {isMe && <span className="ml-1.5 rounded bg-brandsoft px-1.5 text-2xs font-semibold text-brand">사용 중</span>}
                  </td>
                  <td className="px-3 py-3">{orgShort(u.dept)}</td>
                  <td className="px-3 py-3">{u.title}</td>
                  <td className="px-3 py-3">{u.empNo ? <Mono>{u.empNo}</Mono> : <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-3">{roleLabel(raw, u)}</td>
                  <td className="px-3 py-3">{left ? <span className="rounded bg-sunken px-1.5 text-2xs font-semibold">전출·퇴직</span> : '재직'}</td>
                  <td className="px-3 py-3 tnum">{ownedCount(u.id)}</td>
                  <td className="px-3 py-3">
                    <div className="flex flex-wrap gap-1">
                      {!isMe && !left && (
                        <Button
                          size="sm"
                          variant="subtle"
                          data-testid="people-use"
                          onClick={() => {
                            update((d) => {
                              d.currentUserId = u.id;
                            });
                            toast(`${u.name}(으)로 쓰기 시작했습니다`);
                          }}
                        >
                          이 사람으로 쓰기
                        </Button>
                      )}
                      {canEditAll && (
                        <Button size="sm" onClick={() => open(u)} data-testid="people-edit">
                          <Pencil size={12} />
                          고치기
                        </Button>
                      )}
                      {!canEditAll ? null : left ? (
                        <Button size="sm" onClick={() => toggleStatus(u.id, 'active')} data-testid="people-left">
                          <UserCheck size={12} />
                          복귀
                        </Button>
                      ) : (
                        <Button size="sm" disabled={isMe} title={isMe ? '지금 사용 중인 사람은 바꿀 수 없습니다' : undefined} onClick={() => askLeft(u.id)} data-testid="people-left">
                          <UserMinus size={12} />
                          전출·퇴직
                        </Button>
                      )}
                      {canEditAll && (
                        <Button size="sm" variant="danger" disabled={isMe} title={isMe ? '지금 사용 중인 사람은 지울 수 없습니다' : undefined} onClick={() => askRemove(u.id)} data-testid="people-remove">
                          <Trash2 size={12} />
                          지우기
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <OrgSection />
    </div>
  );
}
