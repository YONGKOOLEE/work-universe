import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Network } from 'lucide-react';
import { useStore } from '../lib/store';
import { Button, Card, CardHead, Field, inputCls } from './ui';
import { addOrg, editOrg, removeOrg, effectiveOrgs, orgShort, orgTree, subtreeNames } from '../lib/orgs';
import { clone } from '../lib/util';
import { ORG_LEVELS, type Org, type OrgLevel } from '../lib/types';

const rank = (l: OrgLevel) => ORG_LEVELS.indexOf(l);
const indent = (n: number) => '  '.repeat(n);

type Draft = { name: string; level: OrgLevel; parentId: string };

/** 조직 관리 — 업무 → 팀 → 부 → 본부 → 회사. 사람 화면 안에 놓는다 */
export function OrgSection() {
  const { raw, update, toast } = useStore();
  const orgs = useMemo(() => effectiveOrgs(raw), [raw]);
  const tree = useMemo(() => orgTree(orgs), [orgs]);
  const [add, setAdd] = useState<Draft>({ name: '', level: '팀', parentId: '' });
  const [editId, setEditId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ name: '', level: '팀', parentId: '' });
  const [err, setErr] = useState('');

  const parentOptions = (level: OrgLevel, selfId?: string) => {
    const banned = selfId ? subtreeNames(orgs, selfId) : new Set<string>();
    return tree.filter(({ org }) => rank(org.level) < rank(level) && !banned.has(org.name));
  };
  const countWorks = (o: Org) => raw.works.filter((w) => w.dept === o.name).length;
  const countPeople = (o: Org) => raw.users.filter((u) => u.dept === o.name).length;

  const onAdd = () => {
    const input = { name: add.name, level: add.level, parentId: add.parentId || null };
    const r = addOrg(clone(raw), input);
    if ('error' in r) return setErr(r.error);
    update((d) => {
      addOrg(d, input);
    });
    toast(r.summary);
    setErr('');
    setAdd({ name: '', level: add.level, parentId: add.parentId });
  };

  const startEdit = (o: Org) => {
    setErr('');
    setEditId(o.id);
    setDraft({ name: o.name, level: o.level, parentId: o.parentId ?? '' });
  };

  const onSave = (id: string) => {
    const patch = { name: draft.name, level: draft.level, parentId: draft.parentId || null };
    const r = editOrg(clone(raw), id, patch);
    if (r && 'error' in r) return setErr(r.error);
    if (r === null) {
      setEditId(null);
      setErr('');
      return toast('바뀐 내용이 없습니다');
    }
    update((d) => {
      editOrg(d, id, patch);
    });
    toast(r.summary);
    setErr('');
    setEditId(null);
  };

  const onRemove = (id: string) => {
    const r = removeOrg(clone(raw), id);
    if ('error' in r) return setErr(r.error);
    update((d) => {
      removeOrg(d, id);
    });
    toast(r.summary);
    setErr('');
  };

  const levelSelect = (value: OrgLevel, on: (l: OrgLevel) => void, label: string, id?: string, testId?: string) => (
    <select id={id} aria-label={label} className={inputCls} value={value} onChange={(e) => on(e.target.value as OrgLevel)} data-testid={testId}>
      {ORG_LEVELS.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <Card data-testid="org-section">
      <CardHead title="조직" icon={<Network size={16} />} />
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted">업무가 모여 팀, 팀이 모여 부, 부가 모여 본부, 본부가 모여 회사가 됩니다. 상위 조직을 바꾸는 것이 곧 조직개편이며, 아래 조직·업무가 함께 옮겨 갑니다.</p>

        <div className="grid items-end gap-3 sm:grid-cols-[1.4fr_0.7fr_1.2fr_auto]">
          <Field label="새 조직 이름" htmlFor="org-add-name">
            <input id="org-add-name" className={inputCls} value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} data-testid="org-add-name" />
          </Field>
          <Field label="단계" htmlFor="org-add-level">
            {levelSelect(add.level, (l) => setAdd({ ...add, level: l, parentId: '' }), '새 조직 단계', 'org-add-level', 'org-add-level')}
          </Field>
          <Field label="상위 조직" htmlFor="org-add-parent">
            <select id="org-add-parent" className={inputCls} value={add.parentId} onChange={(e) => setAdd({ ...add, parentId: e.target.value })} data-testid="org-add-parent">
              <option value="">없음</option>
              {parentOptions(add.level).map(({ org, depth }) => (
                <option key={org.id} value={org.id}>
                  {indent(depth)}
                  {orgShort(org.name)} ({org.level})
                </option>
              ))}
            </select>
          </Field>
          <Button variant="primary" onClick={onAdd} data-testid="org-add-save">
            <Plus size={14} />
            추가
          </Button>
        </div>

        {err && (
          <p className="text-xs text-danger" role="alert" data-testid="org-error">
            {err}
          </p>
        )}

        <ul className="divide-y divide-line rounded-md border border-line text-[13px]">
          {tree.map(({ org, depth }) => (
            <li key={org.id} className="px-3 py-2" data-testid="org-row">
              {editId === org.id ? (
                <div className="grid items-end gap-2 sm:grid-cols-[1.4fr_0.7fr_1.2fr_auto]">
                  <input aria-label="조직 이름" className={inputCls} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  {levelSelect(draft.level, (l) => setDraft({ ...draft, level: l }), '조직 단계')}
                  <select aria-label="상위 조직" className={inputCls} value={draft.parentId} onChange={(e) => setDraft({ ...draft, parentId: e.target.value })}>
                    <option value="">없음</option>
                    {parentOptions(draft.level, org.id).map(({ org: p, depth: dp }) => (
                      <option key={p.id} value={p.id}>
                        {indent(dp)}
                        {orgShort(p.name)} ({p.level})
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1">
                    <Button size="sm" variant="primary" onClick={() => onSave(org.id)} data-testid={`org-save-${org.id}`}>
                      저장
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>
                      취소
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-2">
                  <span style={{ paddingLeft: depth * 20 }} className="font-semibold">
                    {orgShort(org.name)}
                  </span>
                  <span className="rounded bg-brandsoft px-1.5 text-2xs font-semibold text-brand">{org.level}</span>
                  <span className="text-2xs text-muted">
                    업무 {countWorks(org)} · 사람 {countPeople(org)}
                  </span>
                  <span className="ml-auto flex gap-1">
                    <Button size="sm" onClick={() => startEdit(org)} data-testid={`org-edit-${org.id}`}>
                      <Pencil size={12} />
                      고치기
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => onRemove(org.id)} data-testid={`org-remove-${org.id}`}>
                      <Trash2 size={12} />
                      지우기
                    </Button>
                  </span>
                </div>
              )}
            </li>
          ))}
          {!tree.length && <li className="px-3 py-3 text-muted">조직이 없습니다. 위에서 추가하세요.</li>}
        </ul>
      </div>
    </Card>
  );
}
