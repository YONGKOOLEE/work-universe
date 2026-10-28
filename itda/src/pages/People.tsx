import { useState } from 'react';
import { Plus, Pencil, UserMinus, UserCheck, Trash2, UserRound } from 'lucide-react';
import { useStore } from '../lib/store';
import { Button, Card, CardHead, Field, Mono, inputCls } from '../components/ui';
import { addPerson, editPerson, removePerson, setPersonStatus, isLeft, type PersonInput } from '../lib/people';
import { clone, cx } from '../lib/util';
import type { AppState } from '../lib/types';

type Form = { id: string | null; name: string; dept: string; title: string; empNo: string; role: 'member' | 'lead' };

export default function People() {
  const { raw, update, toast, me } = useStore();
  const [form, setForm] = useState<Form | null>(null);
  const [formErr, setFormErr] = useState('');
  const [notice, setNotice] = useState<{ id: string; lines: string[]; kind: 'blocked' | 'left' } | null>(null);

  const ownedCount = (id: string) => raw.works.filter((w) => w.owners.includes(id)).length;
  const open = (u?: AppState['users'][number]) => {
    setFormErr('');
    setForm(u ? { id: u.id, name: u.name, dept: u.dept, title: u.title, empNo: u.empNo ?? '', role: u.role ?? 'member' } : { id: null, name: '', dept: me?.dept ?? '', title: '', empNo: '', role: 'member' });
  };

  const save = () => {
    if (!form) return;
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
        <Button variant="primary" onClick={() => open()} data-testid="people-add">
          <Plus size={16} />
          사람 추가
        </Button>
      </div>

      {form && (
        <Card>
          <CardHead title={form.id ? '사람 고치기' : '사람 추가'} icon={<UserRound size={16} />} />
          <div className="space-y-3 p-4" data-testid="people-form">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Field label="이름" htmlFor="pp-name">
                <input id="pp-name" className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <Field label="부서" htmlFor="pp-dept">
                <input id="pp-dept" className={inputCls} value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value })} />
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
                  <option value="lead">팀장</option>
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

      {notice && (
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
          ) : (
            <>
              <p className="font-semibold">담당을 먼저 넘기세요 — 이 사람이 아직 담당인 업무가 있습니다.</p>
              <ul className="mt-1 list-disc pl-5 text-muted">
                {notice.lines.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted">담당은 자동으로 바뀌지 않습니다. 「업무 인계 관리」에서 인계하거나 업무 화면에서 담당자를 바꾸세요.</p>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setNotice(null)}>
                닫기
              </Button>
            </>
          )}
        </Card>
      )}

      <Card className="overflow-x-auto scroll-thin">
        <table className="w-full min-w-[900px] text-[13px]">
          <thead>
            <tr className="border-b border-line bg-sunken/60 text-left text-xs text-muted">
              <th className="px-4 py-2.5 font-semibold">이름</th>
              <th className="px-3 py-2.5 font-semibold">부서</th>
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
                  <td className="px-3 py-3">{u.dept}</td>
                  <td className="px-3 py-3">{u.title}</td>
                  <td className="px-3 py-3">{u.empNo ? <Mono>{u.empNo}</Mono> : <span className="text-faint">—</span>}</td>
                  <td className="px-3 py-3">{u.role === 'lead' ? '팀장' : '팀원'}</td>
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
                      <Button size="sm" onClick={() => open(u)} data-testid="people-edit">
                        <Pencil size={12} />
                        고치기
                      </Button>
                      {left ? (
                        <Button size="sm" onClick={() => toggleStatus(u.id, 'active')} data-testid="people-left">
                          <UserCheck size={12} />
                          복귀
                        </Button>
                      ) : (
                        <Button size="sm" disabled={isMe} title={isMe ? '지금 사용 중인 사람은 바꿀 수 없습니다' : undefined} onClick={() => toggleStatus(u.id, 'left')} data-testid="people-left">
                          <UserMinus size={12} />
                          전출·퇴직
                        </Button>
                      )}
                      <Button size="sm" variant="danger" disabled={isMe} title={isMe ? '지금 사용 중인 사람은 지울 수 없습니다' : undefined} onClick={() => remove(u.id)} data-testid="people-remove">
                        <Trash2 size={12} />
                        지우기
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
