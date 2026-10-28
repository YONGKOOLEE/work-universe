import { useRef, useState } from 'react';
import { unzipSync, strFromU8 } from 'fflate';
import { Sparkles, Upload, Loader2, FileText, AlertTriangle, Bot, Square } from 'lucide-react';
import { Modal, Button, Field, inputCls, ProvChip } from './ui';
import { ReflectionPreview } from './ReflectionPreview';
import { useStore } from '../lib/store';
import { useRouter } from '../lib/router';
import { useAI } from '../ai/claude';
import { analyzeDocument, type DocAnalysis } from '../ai/engine';
import { mockExtract, claudeExtract, applyProposals, type Extraction, type Proposal } from '../ai/reflect';
import { extractPdf } from '../lib/pdf';
import { docEventFor, EXCLUDED_DOC_TYPES } from '../lib/docEvents';
import { DOC_TYPES, type Doc, type DocParagraph, type DocType, type RelType } from '../lib/types';
import { cx, uid } from '../lib/util';

function hwpxText(buf: ArrayBuffer) {
  const files = unzipSync(new Uint8Array(buf));
  const sections = Object.keys(files)
    .filter((k) => /Contents\/section\d+\.xml$/.test(k))
    .sort();
  const out: string[] = [];
  for (const k of sections) {
    const xml = strFromU8(files[k]);
    const paras = xml.match(/<hp:p\b[\s\S]*?<\/hp:p>/g) ?? [];
    for (const p of paras) {
      const t = (p.match(/<hp:t>([\s\S]*?)<\/hp:t>/g) ?? []).map((x) => x.replace(/<[^>]+>/g, '')).join('');
      const clean = t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
      if (clean) out.push(clean);
    }
  }
  return out.join('\n');
}


/** 업로드 본문에서 작성일·제목·회의록 여부를 찾는다 (찾지 못하면 비워 둠) */
export function detectMeta(text: string, fileName: string) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const head = lines.slice(0, 40).join('\n');
  const pad = (n: string) => n.padStart(2, '0');
  let date: string | undefined;
  let dateSrc: string | undefined;
  const labeled = head.match(/(?:일\s*시|일\s*자|작성\s*일(?:\s*자)?|회\s*의\s*일(?:\s*시)?|개\s*최\s*일(?:\s*시)?|날\s*짜)\s*[:：]\s*(\d{4})\s*[.년-]\s*(\d{1,2})\s*[.월-]\s*(\d{1,2})[^\n]*/);
  if (labeled) {
    date = `${labeled[1]}-${pad(labeled[2])}-${pad(labeled[3])}`;
    dateSrc = labeled[0].slice(0, 60);
  } else {
    const wd = lines.slice(0, 15).map((l) => l.match(/(\d{4})\s*\.\s*(\d{1,2})\s*\.\s*(\d{1,2})\s*\.?\s*\(([월화수목금토일])\)/)).find(Boolean);
    if (wd) {
      date = `${wd[1]}-${pad(wd[2])}-${pad(wd[3])}`;
      dateSrc = wd[0];
    }
  }
  if (date) {
    const [y, m, d] = date.split('-').map(Number);
    if (y < 1990 || m < 1 || m > 12 || d < 1 || d > 31) {
      date = undefined;
      dateSrc = undefined;
    }
  }
  const first = lines[0] ?? '';
  const isMinutes = /회의록/.test(fileName) || lines.slice(0, 5).some((l) => /회의록/.test(l));
  const title = /회의록/.test(first) && first.length <= 60 ? first : undefined;
  return { date, dateSrc, title, isMinutes };
}

const textParas = (t: string): DocParagraph[] =>
  t
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x, i) => ({ id: `p-${i + 1}`, text: x }));

export function DocRegisterModal({ open, onClose, presetWork }: { open: boolean; onClose: () => void; presetWork?: string }) {
  const { s, update, log, toast } = useStore();
  const { nav } = useRouter();
  const ai = useAI();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<DocType>('검토보고서');
  const [writtenAt, setWrittenAt] = useState('');
  const [source, setSource] = useState('');
  const [text, setText] = useState('');
  const [pdfParas, setPdfParas] = useState<DocParagraph[] | null>(null);
  const [fileName, setFileName] = useState<string | undefined>();
  const [fileNote, setFileNote] = useState('');
  const [dateNote, setDateNote] = useState('');
  const [fileWarn, setFileWarn] = useState('');
  const [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [careful, setCareful] = useState(true); // 꼼꼼히 읽기(두 번째 대조 호출, 업무 유니버스 방식)
  const [stage, setStage] = useState<'read' | 'review'>('read');
  const [aiMsg, setAiMsg] = useState('');
  const [mockDoc, setMockDoc] = useState<DocAnalysis | null>(null);
  const [ext, setExt] = useState<Extraction | null>(null);
  const [props, setProps] = useState<Proposal[]>([]);
  const [works, setWorks] = useState<string[]>(presetWork ? [presetWork] : []);
  const [rels, setRels] = useState<string[]>([]);
  const ctl = useRef<AbortController | null>(null);

  const paras = pdfParas ?? textParas(text);

  const reset = () => {
    ctl.current?.abort();
    setTitle('');
    setText('');
    setWrittenAt('');
    setSource('');
    setPdfParas(null);
    setFileName(undefined);
    setFileNote('');
    setFileWarn('');
    setDateNote('');
    setMockDoc(null);
    setExt(null);
    setProps([]);
    setRels([]);
    setAiMsg('');
    setWorks(presetWork ? [presetWork] : []);
  };
  const close = () => {
    reset();
    onClose();
  };
  const invalidate = () => {
    setExt(null);
    setProps([]);
    setMockDoc(null);
  };

  const run = async () => {
    setBusy(true);
    setAiMsg('');
    invalidate();
    const md = analyzeDocument(s, title, paras.map((p) => p.text).join('\n'), writtenAt);
    const def = presetWork ?? md.relatedWorks[0]?.id ?? s.works[0].id;
    let result: Extraction;
    if (ai.engine === 'claude' && ai.client) {
      ctl.current = new AbortController();
      try {
        result = await claudeExtract(ai.client, s, title, paras, def, writtenAt, ctl.current.signal, { review: careful, onStage: setStage });
        if (result.review && !result.review.ok) setAiMsg('꼼꼼히 읽기(두 번째 대조)는 실패해 첫 분석 결과만 보여 줍니다.');
        else if (result.review) setAiMsg(`꼼꼼히 읽기: 빠진 항목 ${result.review.added}건을 더했고, 확인이 필요한 항목 ${result.review.flagged}건을 표시했습니다.`);
        if (result.truncatedInput) setAiMsg('문서가 길어 앞부분(약 6만 자)만 Claude에 보냈습니다. 뒷부분 내용은 반영 제안에 포함되지 않았습니다.');
      } catch (e) {
        const msg = ai.onError(e);
        setAiMsg(`${msg} 이번 분석은 규칙 기반 결과입니다.`);
        result = mockExtract(s, title, paras, def);
      }
    } else {
      result = mockExtract(s, title, paras, def);
    }
    if (!result.keywords.length) result.keywords = md.keywords;
    if (!result.relatedWorks.length) result.relatedWorks = md.relatedWorks;
    setMockDoc(md);
    setExt(result);
    setProps(result.proposals);
    setWorks((w) => [...new Set([...w, def, ...result.relatedWorks.filter((x) => x.score >= 0.5).map((x) => x.id)])]);
    setRels(md.similarDocs.map((d) => d.id));
    setBusy(false);
  };

  const onFile = async (f: File) => {
    setFileWarn('');
    setReading(true);
    invalidate();
    let extracted = '';
    try {
      if (/\.pdf$/i.test(f.name)) {
        const r = await extractPdf(await f.arrayBuffer());
        setPdfParas(r.paragraphs);
        setText(r.text);
        extracted = r.text;
        setFileNote(`${f.name} · ${r.pages}쪽 · ${r.chars.toLocaleString()}자 · 문단 ${r.paragraphs.length}개 추출`);
        if (r.likelyScanned)
          setFileWarn('추출된 글자가 거의 없습니다. 스캔 이미지로 된 PDF일 수 있어 본문 추출이 불완전합니다. OCR 처리 또는 원문 텍스트 확보가 필요합니다(별도 확인 필요).');
      } else {
        const t = /\.hwpx$/i.test(f.name) ? hwpxText(await f.arrayBuffer()) : await f.text();
        setPdfParas(null);
        setText(t);
        extracted = t;
        setFileNote(`${f.name} · ${t.length.toLocaleString()}자 추출`);
      }
      setFileName(f.name);
      const meta = detectMeta(extracted, f.name);
      if (!title) setTitle(meta.title ?? f.name.replace(/\.[^.]+$/, ''));
      if (meta.isMinutes) setType('회의록');
      if (meta.date) {
        setWrittenAt(meta.date);
        setDateNote(`원문 '${meta.dateSrc}'에서 작성일을 자동으로 입력했습니다`);
      } else {
        setDateNote('원문에서 작성일을 찾지 못했습니다 — 직접 입력해 주세요');
      }
    } catch {
      setFileWarn('파일을 읽지 못했습니다. 암호가 걸린 PDF이거나 손상된 파일일 수 있습니다. .pdf · .hwpx · .txt · .md 파일을 사용하세요.');
    } finally {
      setReading(false);
    }
  };

  const approved = props.filter((p) => p.approved);
  const save = () => {
    if (!title.trim() || !ext) return;
    const id = uid('D');
    const now = new Date().toISOString();
    update((d) => {
      const doc: Doc = {
        id,
        title: title.trim(),
        type,
        writtenAt,
        registeredAt: now,
        source: source || '사용자 등록',
        availability: 'original',
        workIds: [...works],
        summary: ext.summary,
        keywords: ext.keywords,
        relations: (mockDoc?.similarDocs ?? []).filter((x) => rels.includes(x.id)).map((x) => ({ targetId: x.id, type: x.type as RelType, basis: x.basis, note: x.note })),
        paragraphs: paras,
        analyzed: true,
        registeredBy: d.currentUserId,
        fileName,
        analyzedBy: ext.engine,
      };
      d.docs.push(doc);
      const pushed = d.docs[d.docs.length - 1];
      works.forEach((w) => log(d, w, '문서 등록', `'${doc.title}' 등록 · ${ext.engine === 'claude' ? 'Claude' : '규칙 기반'} 분석`));
      applyProposals(d, pushed, props, d.currentUserId);
      // 회의록·기타 외 문서는 연결 업무 타임라인에 자동 등록
      const ev = docEventFor(pushed);
      if (ev) {
        d.events.push(ev);
        pushed.workIds.forEach((w) => log(d, w, '타임라인', `'${pushed.title}' 문서를 타임라인에 자동 등록`));
      }
    });
    toast(`문서를 등록했습니다 · 승인 항목 ${approved.length}건 반영`);
    close();
    nav(`/docs/${id}`);
  };

  const engineBadge = ai.engine === 'claude' ? (
    <span className="inline-flex items-center gap-1 rounded bg-brandsoft px-1.5 text-2xs font-semibold text-brand">
      <Bot size={11} />
      Claude 분석
    </span>
  ) : (
    <span className="rounded bg-warnsoft px-1.5 text-2xs font-semibold text-warn">규칙 기반 분석</span>
  );

  return (
    <Modal
      open={open}
      onClose={close}
      wide="x"
      title="문서 등록 및 AI 분석"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">{ext ? `업무 반영 승인 ${approved.length} / 제안 ${props.length}건 — 승인하지 않은 항목은 반영되지 않습니다` : '본문을 넣고 AI 분석을 실행하세요'}</span>
          <Button variant="ghost" onClick={close}>
            취소
          </Button>
          {busy ? (
            <Button onClick={() => ctl.current?.abort()}>
              <Square size={13} />
              분석 중지
            </Button>
          ) : (
            <>
              {ai.engine === 'claude' && (
                <label className="flex items-center gap-1.5 self-center text-xs text-muted" title="두 번째 호출로 빠진 항목을 더하고 의심 항목을 표시합니다(시간이 더 걸림)">
                  <input type="checkbox" checked={careful} onChange={(e) => setCareful(e.target.checked)} data-testid="careful-read" />
                  꼼꼼히 읽기
                </label>
              )}
              <Button onClick={run} disabled={!paras.length || reading}>
                <Sparkles size={14} />
                {ext ? '다시 분석' : 'AI 분석'}
              </Button>
            </>
          )}
          <Button variant="primary" onClick={save} disabled={!ext || !title.trim() || busy}>
            문서 등록{approved.length ? ` · ${approved.length}건 반영` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <div className="min-w-0 space-y-3">
            <label className={cx('flex cursor-pointer items-center gap-2 rounded-md border border-dashed px-3 py-3 text-xs hover:border-brand', fileWarn ? 'border-warn/60' : 'border-line2', 'text-muted')}>
              {reading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
              <span className="flex-1">{reading ? '파일에서 본문 추출 중' : fileNote || '.pdf · .hwpx · .txt · .md 파일 선택 — PDF는 쪽 번호와 문단을 유지해 추출'}</span>
              <input id="dr-file" type="file" accept=".pdf,.hwpx,.txt,.md" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
            </label>
            {fileWarn && (
              <p className="flex items-start gap-2 rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {fileWarn}
              </p>
            )}
            <Field label="문서명 *" htmlFor="dr-title">
              <input id="dr-title" className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="문서 유형" htmlFor="dr-type">
                <select id="dr-type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as DocType)}>
                  {DOC_TYPES.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </Field>
              <Field label="작성일" htmlFor="dr-date">
                <input
                  id="dr-date"
                  type="date"
                  className={inputCls}
                  value={writtenAt}
                  onChange={(e) => {
                    setWrittenAt(e.target.value);
                    setDateNote('');
                  }}
                />
              </Field>
            <Field label="출처" htmlFor="dr-src">
                <input id="dr-src" className={inputCls} value={source} onChange={(e) => setSource(e.target.value)} placeholder="예: 한빛결제원(가상)" />
              </Field>
            </div>
            {dateNote && <p className={cx('-mt-1 text-2xs', /찾지 못/.test(dateNote) ? 'text-warn' : 'text-fact')}>{dateNote}</p>}
            <p className="-mt-1 text-2xs text-muted">
              {EXCLUDED_DOC_TYPES.includes(type)
                ? `'${type}' 유형은 타임라인에 자동 등록되지 않습니다.`
                : `'${type}' 유형은 등록 시 연결 업무의 타임라인에 자동으로 추가됩니다${writtenAt ? '' : ' (작성일이 없으면 등록일 기준으로 놓이며 별도 확인 필요로 표시)'}. 필요 없으면 타임라인에서 삭제할 수 있습니다.`}
            </p>
            <Field label={`본문${pdfParas ? ` (PDF 추출 · ${pdfParas.length}개 문단)` : ''}`} htmlFor="dr-text" hint={pdfParas ? '본문을 직접 고치면 PDF 쪽 번호 정보는 사라지고 줄 단위 문단으로 다시 나뉩니다' : '한 줄이 한 문단(근거 위치 단위)으로 저장됩니다'}>
              <textarea
                id="dr-text"
                className={cx(inputCls, 'min-h-[200px] font-mono text-[12px]')}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setPdfParas(null);
                  invalidate();
                }}
              />
            </Field>
          </div>

          <div className="min-w-0 rounded-lg border border-line bg-sunken/60 p-4">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
              <Sparkles size={15} className="text-infer" />
              AI 문서 분석 결과
              <span className="ml-auto">{engineBadge}</span>
            </div>
            {aiMsg && <p className="mb-3 rounded-md bg-warnsoft px-3 py-2 text-xs text-warn">{aiMsg}</p>}
            {busy && (
              <div className="flex items-start gap-2 py-6 text-[13px] text-muted">
                <Loader2 size={16} className="mt-0.5 animate-spin" />
                <span>
                  {ai.engine === 'claude' ? (stage === 'review' ? '2단계: 꼼꼼히 읽기 — 같은 문서를 한 번 더 읽고 빠진 항목·의심 항목을 찾는 중입니다(최대 1분 30초).' : `1단계: Claude가 문서를 읽고 결정·일정·조치(담당·기한)·개요·주제를 뽑는 중입니다(긴 문서는 최대 2분)${careful ? ' — 다음에 꼼꼼히 읽기가 이어집니다' : ''}.`) : '문장 분리 · 결정/일정/조치 문장 탐지 · 표의 담당·기한 읽기(업무 유니버스 규칙) · 원문 대조 중'}
                </span>
              </div>
            )}
            {!busy && !ext && <p className="text-xs text-muted">분석 결과는 원문 대조를 거쳐 표시합니다. 원문에서 근거 문장을 찾지 못한 항목은 '추가 확인 필요'로 남깁니다.</p>}
            {ext && !busy && (
              <div className="space-y-4 text-[13px]">
                <Block title="문서 3줄 요약" prov="inference">
                  <ol className="list-decimal space-y-1 pl-4">
                    {ext.summary.map((x, i) => (
                      <li key={i}>{x}</li>
                    ))}
                  </ol>
                </Block>
                {ext.core.length > 0 && (
                  <Block title="핵심 내용" prov={ext.engine === 'claude' ? 'inference' : 'fact'}>
                    {ext.core.map((x, i) => (
                      <p key={i}>· {x}</p>
                    ))}
                  </Block>
                )}
                <Block title="연결할 업무" prov="inference">
                  {s.works.map((w) => {
                    const r = ext.relatedWorks.find((x) => x.id === w.id);
                    return (
                      <label key={w.id} className="flex items-center gap-2 py-0.5">
                        <input type="checkbox" className="accent-[rgb(var(--brand))]" checked={works.includes(w.id)} onChange={(e) => setWorks((x) => (e.target.checked ? [...x, w.id] : x.filter((y) => y !== w.id)))} />
                        <span className="flex-1">{w.name}</span>
                        {r && <span className="text-2xs font-semibold text-infer tnum" title={r.reason}>{Math.round(r.score * 100)}%</span>}
                      </label>
                    );
                  })}
                </Block>
                <Block title="유사 · 선행 · 후속 문서" prov="inference">
                  {mockDoc?.similarDocs.length ? (
                    mockDoc.similarDocs.map((d) => (
                      <label key={d.id} className="flex items-start gap-2 py-1">
                        <input type="checkbox" className="mt-1 accent-[rgb(var(--brand))]" checked={rels.includes(d.id)} onChange={(e) => setRels((x) => (e.target.checked ? [...x, d.id] : x.filter((y) => y !== d.id)))} />
                        <span className="min-w-0 flex-1">
                          <span className="mr-1.5 rounded bg-navy px-1 text-2xs font-semibold text-surface">{d.type}</span>
                          <span className="font-medium">{d.title}</span>
                          <span className="block text-2xs text-muted">
                            {d.note} · {d.basis === 'fact' ? '원문 근거' : 'AI 추론'}
                          </span>
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="text-xs text-muted">추천할 관련 문서 없음</p>
                  )}
                </Block>
              </div>
            )}
          </div>
        </div>

        {ext && !busy && <ReflectionPreview props={props} setProps={setProps} paras={paras} works={s.works} users={s.users} />}
      </div>
    </Modal>
  );
}

function Block({ title, prov, children }: { title: string; prov: 'fact' | 'inference' | 'unverified' | 'owner'; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="mb-1 flex items-center gap-2 text-xs font-semibold text-muted">
        <FileText size={12} />
        {title}
        <ProvChip prov={prov} />
      </h4>
      <div className="text-ink">{children}</div>
    </section>
  );
}
