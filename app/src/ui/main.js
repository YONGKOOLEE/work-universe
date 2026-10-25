// 화면 진입점. 빌드하면 모듈 없는 단일 스크립트(IIFE)가 된다(P-1).

import { createApp } from '../app/app.js';
import { OTHER_TAB_NOTE, baselineSaveAllowed, cleanApiKey, cleanAuthorName, cleanLlmModel, createLlmCache, createStore, loadSettings, openStorage, otherTabChangedUniverse, saveSettings } from '../store/local.js';
import { clearDraftSeen } from '../store/draft-seen.js';
import { createFakeClient } from '../llm/fake-client.js';
import { PREGEN } from '../../data/pregen.js';
import { DEFAULT_PROVIDER, PROVIDERS, createProvider } from '../llm/providers.js';
import { settingsPanel } from './settings.js';
import { mergePanel } from './merge.js';
import { SAMPLES, SAMPLE_GUIDE } from '../../data/index.js';
import { startScreen } from './start.js';
import { currentHoldersText, describeNode, describeUniverse, displayName, eventText, periodStatus } from '../view/describe.js';
import { exposureOf, projectView } from '../view/collapse.js';
import { parseGid, toGid } from '../view/view.js';
import { PANEL, clampPanelWidth, maxPanelWidth } from '../view/panel.js';
import { DRAFT_TARGET_TYPES, MEMO_CATEGORIES, SUBTYPE_HANDOVER_DOC } from '../model/schema.js';
import { BACKUP_NONE_TEXT, WEEKLY_DEFAULT_CATEGORY, backupRows, collabPlan, draftCenterFor, weeklyMemoInput } from '../view/quick-input.js';
import { confirmedDoc, downloadWithNotice, printHtml } from './doc-output.js';
import { el } from './dom.js';
import { createGraph, legendItems } from './graph.js';
import { renderNodeDetail, renderUniverseSummary } from './detail.js';
import { edgeEditForm, edgeForm, eventForm, nodeForm } from './editor.js';
import { draftPanel } from './draft.js';
import { currentDenseN, insightPanel } from './insight.js';
import { issueEntry, issuePanel } from './issues.js';
import { hiddenEntry, hiddenPanel } from './hidden.js';
import { confirmText, doneText, failText, fillBand, hideBand, nodeChangeNote, pointLabeler, revertBlock, rewindEntry, rewindPanel } from './rewind.js';
import { renderBackupNudge } from './backup.js';
import { backupAdvice, userChangeTimes } from '../rules/backup.js';
import { hiddenNodesOf } from '../rules/hidden.js';
import { nowIso, todayLocal } from './time.js';
import { personLoad, repeatPatternsFor, workLoad } from '../rules/insight.js';
import { riskNoteFor } from '../rules/insight-risk.js';
import { TOUR_ONCE, TOUR_ONCE_NOTE, WEEKLY_DATE_MESSAGES, WEEKLY_DATE_MIN, baselineSavedNote, compareRisk, currentOwnersByWork, isEditedSample, lastModifiedDeep, makeBaseline, namesFromInspection, pickBaseline, resumeTarget, saveBaseline, shouldAutoStartTour, startMaps, weeklyDateError } from '../rules/daily-use.js';
import { inspectionInput, soloWorksOf, soloWorksText, teamRiskParts, teamRiskSummary } from '../view/risk-summary.js';
import { monthAsOf, timeMonths } from '../rules/flow.js';
import { splitHint, workFormMissing } from '../rules/form.js';
import { starterSteps } from '../rules/starter-steps.js';
import { josa, messageFor } from './messages.js';
import { exportFileName, importDialog } from './import.js';
import { createFolderLink } from './folder-link.js';
import { EMBED_HASH_PREFIX, embedFileName } from '../view/embed.js';
import { EMBED_WARNINGS, captureAppHtml, createEmbedApp, embedHtmlFor, importEmbedToStorage, readEmbedFromDocument, renderEmbedBanner } from './embed-banner.js';
import { tableDialog } from './table.js';
import { textAddDialog } from './text-add.js';
import { TEXT_GROUPED_NOTE, isGroupedView } from '../rules/text-extract.js';
import { convertDocument } from '../rules/doc-convert.js';
import { convertDocumentWith, extractTextAsync, isLive } from '../llm/connector.js';
import { DOC_EXAMPLE } from '../../data/doc-example.js';
import { filterDisplay, foldedInside, neighborhoodDisplay, personsIn, searchNodes } from '../view/explore.js';
import { EXPLORE, exploreBar } from './explore.js';
import { createTour } from './tour.js';
import { helpPanel } from './help.js';
import { scenarioOf } from '../rules/tour-steps.js';
import { createFieldId, fillMineDefaults } from '../rules/new-universe.js';
import { LEGEND_COLLAPSED_TEXT, OWNER_REQUIRED_TEXT, assignOps, keepDraftPick, mergePendingText, sameMark } from './flow-helpers.js';

// 점검 도구(tools/*-check.mjs)만 주소에 ?check를 붙여 연다. 그때만 점검용 전역 window.__wu를 만든다(D-4-10, 사용자 결정 2026-10-03)
const CHECK_MODE = new URLSearchParams(location.search).has('check');

// 다른 유니버스로 이동: 주소 끝의 #유니버스ID를 바꾸고 다시 연다(file://에서도 동작)
// 내용 포함 HTML을 읽기 전용으로 보는 중이면 주소를 #embed/ID로 둔다(일반 ID에는 '/'가 없어 섞이지 않는다, CR-13 B)
let embedPrefix = '';

// tourId가 있으면 주소 끝에 ~tour=시나리오를 붙인다: 다시 열린 화면이 읽고(takeTourFromHash) 바로 주소에서 지운다(CR-13 A, 저장소를 쓰지 않는다)
// again: 머리글 「?」에서 고른 것이라 「한 번만」(D-2)에 걸리지 않고 언제나 따라 하기가 뜬다(~again)
function openUniverse(id, tourId = '', again = false) {
  location.hash = embedPrefix + id + (tourId ? `~tour=${tourId}${again ? '~again' : ''}` : '');
  location.reload();
}

// 주소 끝의 ~tour=시나리오를 읽고 지운다. 모르는 시나리오 이름이면 null(주소는 지운다)
let tourForced = false; // 주소에 ~again이 붙어 있었음(D-2)
function takeTourFromHash() {
  const m = /~tour=([a-z]+)(~again)?$/.exec(location.hash);
  if (!m) return null;
  tourForced = !!m[2];
  history.replaceState(null, '', location.pathname + location.search + location.hash.slice(0, m.index));
  return scenarioOf(m[1]) ? m[1] : null;
}

// 새 유니버스(R-12): 이름·단위·작성 주체가 필수. 같은 이름·단위가 있으면 확인한다. 시작 화면과 본 화면이 함께 쓴다
// 두 모양: open() = 「새 유니버스 만들기」(예전 그대로), openMine() = 「내 업무 지도 만들기」(첫 업무 칸이 맨 위, 이름·단위·작성 주체는 접힌 「지도 정보」에서 비우면 자동으로 채움, 재검증 N-3)
function wireCreateDialog(app, $, getAuthorName = () => undefined) {
  const dialog = $('create-dialog');
  const form = $('create-form');
  const meta = $('create-meta');
  const starterBox = $('create-starter');
  const info = $('create-info');
  const NORMAL = {
    title: '새 업무 지도 만들기',
    legend: '이 업무 지도에 넣을 첫 업무(선택) — 채우면 작은 지도가 바로 생깁니다',
    intro: '업무 하나부터 시작하세요. 첫 업무를 적으면 업무·담당자·산출물이 이어진 작은 지도가 바로 생깁니다. 비워 두면 빈 업무 지도를 만듭니다.',
    namePh: '예: 가상 교육팀 업무 지도',
    ownerPh: '팀·부서 이름 (예: 가상영업팀)',
  };
  const MINE = {
    title: '내 업무 지도 만들기',
    legend: '내 첫 업무 — 업무 이름만 넣어도 됩니다',
    intro: '맡은 업무 하나부터 적어 보세요. 업무 이름만 넣으면 업무·담당자·산출물이 이어진 작은 지도가 바로 생깁니다. 나머지는 나중에 채워도 됩니다.',
    namePh: '비우면 「업무 이름 + 업무 지도」',
    ownerPh: '비우면 설정의 작성자 이름 또는 「내 팀」',
  };
  let mine = false;
  const setMode = (isMine) => {
    mine = isMine;
    const m = isMine ? MINE : NORMAL;
    $('create-title').textContent = m.title;
    $('create-intro').textContent = m.intro;
    $('create-starter-legend').textContent = m.legend;
    $('create-name').placeholder = m.namePh;
    $('create-owner').placeholder = m.ownerPh;
    if (isMine) {
      info.append(meta); // 이름·단위·작성 주체·설명은 접힌 「지도 정보」 안으로
      info.hidden = false;
      info.open = false;
    } else {
      info.hidden = true;
      form.insertBefore(meta, starterBox); // 예전 모양: 이름·단위·작성 주체 → 첫 업무
    }
  };
  const showError = (message, code, field) => {
    $('create-message').textContent = message;
    $('create-message').dataset.code = code;
    const id = createFieldId(field);
    const input = id ? $(id) : null;
    if (!input) return;
    if (info.contains(input)) info.open = true; // 접힌 「지도 정보」 안의 칸이면 펼쳐서 초점을 준다
    input.focus();
  };
  const show = (isMine) => {
    form.reset();
    setMode(isMine);
    $('create-message').textContent = '';
    delete $('create-message').dataset.code;
    dialog.showModal();
    if (isMine) $('create-start-work').focus(); // 첫 칸에서 바로 입력
  };
  const open = () => show(false);
  const openMine = () => show(true);
  $('create-open').addEventListener('click', open);
  $('create-cancel').addEventListener('click', () => dialog.close());
  form.addEventListener('submit', (evt) => {
    evt.preventDefault();
    let input = { name: $('create-name').value, level: $('create-level').value, owner: $('create-owner').value, description: $('create-description').value };
    const starter = { work: $('create-start-work').value, person: $('create-start-person').value, cycle: $('create-start-cycle').value, due: $('create-start-due').value, artifact: $('create-start-artifact').value };
    if (mine) {
      // 내 업무 모드: 업무 이름은 필수, 비어 있는 이름·단위·작성 주체는 자동으로 채운다(R-12 필수 규칙은 채운 값으로 통과)
      const f = fillMineDefaults({ ...input, starter }, getAuthorName());
      if (!f.ok) {
        showError('업무 이름을 넣어 주세요. 예: 월말 정산 점검', f.code, f.field);
        return;
      }
      input = f.input;
      delete input.starter;
    } else if (!starter.work.trim() && Object.values(starter).some((v) => v.trim())) {
      // 첫 업무(선택): 업무 이름 없이 나머지만 채우면 막는다
      showError('첫 업무 이름을 넣거나 아래 칸을 비우세요.', 'starter-work-required', 'starter_work');
      return;
    }
    if (starter.work.trim()) input.starter = starter;
    const same = input.name.trim() && input.level.trim() ? app.findSameUniverse(input.name, input.level) : null;
    if (same && !window.confirm(`같은 이름·단위의 업무 지도「${same.name}」(${same.level})가 이미 있습니다. 그래도 새로 만들까요?`)) return;
    const r = app.createUniverse(input);
    if (!r.ok) {
      // 작성 주체가 비면 쓸 말을 알려 준다(점검 3회차). 오류 코드(E-REQUIRED)와 만들지 않는 동작은 그대로(R-12 ②)
      const ownerMissing = r.error.code === 'E-REQUIRED' && r.error.field === 'owner';
      showError(ownerMissing ? OWNER_REQUIRED_TEXT : messageFor(r.error), r.error.code, r.error.field);
      return;
    }
    openUniverse(r.doc.universe.id);
  });
  if (app.readOnly) $('create-open').disabled = true;
  return { open, openMine };
}

// 가져오기(T-17): 문서 초벌 변환(CR-5 ②)·JSON 파일 → 미리 보기 → 가져오기. 시작 화면과 본 화면이 함께 쓴다
function wireImportDialog(app, $, getProvider, methodLabel, onExport = null, onReset = null, onExportHtml = null, folder = null) {
  const open = importDialog({
    folder,
    onExport,
    onExportHtml,
    onReset,
    dialog: $('import-dialog'),
    app,
    convert: (text) => convertDocumentWith(text, { provider: getProvider(), now: nowIso, ruleConvert: (t) => convertDocument(t, { now: nowIso() }) }),
    methodLabel,
    example: DOC_EXAMPLE,
    onImported: openUniverse,
  });
  $('import-open').addEventListener('click', open);
  return open;
}

// 내보내기(D-06): 현재 유니버스를 JSON 파일로 내려받는다(file://에서도 동작하는 a[download])
function exportCurrent(app) {
  const url = URL.createObjectURL(new Blob([app.exportJson()], { type: 'application/json' }));
  const a = el('a', { href: url, download: exportFileName(app.doc.universe) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 시작 화면으로: 주소의 #유니버스ID를 지우고 다시 연다
function goStart() {
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

// 주소의 #유니버스ID. 깨진 인코딩(#%E0 등)이면 빈 값으로 보고 시작 화면을 연다
function hashId() {
  try {
    const h = decodeURIComponent(location.hash.slice(1));
    return embedPrefix && h.startsWith(embedPrefix) ? h.slice(embedPrefix.length) : h;
  } catch {
    return '';
  }
}

function start() {
  const tourId = takeTourFromHash(); // 시작 화면의 「인수인계를 앞두고 있어요」·「팀 업무를 한눈에…」가 붙인 따라 하기 시나리오(CR-13 A)
  // 내용 포함 HTML로 내려받을 때 쓸 앱 원본: 화면을 그리기 전에 잡는다(CR-13 B)
  const appHtml = captureAppHtml(document);
  const emb = readEmbedFromDocument(document);
  const embedOk = !!(emb && emb.ok);
  if (embedOk) {
    // 주소에 유니버스가 없으면 담긴 유니버스를 바로 연다. 주소가 #embed/…이면 계속 보기 모드. 그 밖의 주소는 일반 모드(가져온 뒤 등)
    if (location.hash === '' || location.hash === '#') history.replaceState(null, '', `${location.pathname}${location.search}#${EMBED_HASH_PREFIX}${emb.embed.root}`);
    if (location.hash.startsWith(`#${EMBED_HASH_PREFIX}`)) embedPrefix = EMBED_HASH_PREFIX;
  }
  const embedMode = embedPrefix !== '';
  const embedWarning = emb && !emb.ok ? EMBED_WARNINGS[emb.reason] : '';
  const storage = embedMode ? null : openStorage(() => window.localStorage);
  const appDeps = { samples: SAMPLES, currentId: hashId(), now: nowIso };
  const app = embedMode ? createEmbedApp(emb.embed, appDeps) : createApp({
    store: storage ? createStore(storage) : null,
    samples: SAMPLES,
    currentId: hashId(),
    now: nowIso,
    // 확정자·통합 확인 목록 판정(decideIdentity)의 기록 주체(R-22, D-24). 설정은 아래에서 읽으므로 부를 때마다 지금 값을 돌려준다
    authorName: () => settings.authorName,
    clearLlmCache: () => llmCache.clear(), // 가상 데이터 초기화에서 실시간 응답 캐시도 지운다(R10-12)
    // 가상 데이터 초기화에서 이 브라우저에만 남긴 점검 기준·마지막으로 연 지도·초안 「새로」 기준도 지운다(검토10 S-7). 따라 하기를 본 기록(tourDone)은 남긴다
    clearBrowserMemory: () => {
      delete settings.riskBaseline;
      delete settings.lastOpenedId;
      saveSettings(storage, settings);
      clearDraftSeen(storage);
    },
  });

  const $ = (id) => document.getElementById(id);

  // 생성 방식(R-15): 설정에서 고른 공급자. 기본은 사전 생성(12.4)
  const settings = loadSettings(storage, { provider: DEFAULT_PROVIDER }, PROVIDERS.map((p) => p.name));
  // 실시간 Claude API(CR-15): 키는 이 브라우저 설정에만 있고, 키가 있을 때만 실시간 공급자가 만들어진다. fakeLlmClient는 ?check 점검용
  const llmCache = createLlmCache(storage);
  let fakeLlmClient = null;
  const makeProvider = () => createProvider(settings.provider, { pregen: PREGEN, apiKey: settings.apiKey, model: settings.llmModel, client: fakeLlmClient, cache: llmCache });
  let provider = makeProvider();
  const providerLabel = () => (PROVIDERS.find((p) => p.name === settings.provider) || PROVIDERS[0]).label;
  // 내보내기: 파일을 내려받고 마지막 내보내기 시각을 설정에 남긴다(백업 권유 기준, R-21). 저장소가 없으면 시각은 남기지 않는다
  const backupSlot = $('backup-nudge');
  const showBackupNudge = () => {
    const advice = storage && !app.readOnly
      ? backupAdvice({ lastExportAt: settings.lastExportAt, dismissedAt: settings.backupDismissedAt, changeTimes: userChangeTimes(app.doc), now: nowIso() })
      : null;
    renderBackupNudge(backupSlot, advice, {
      onExport: () => doExport(),
      onClose: () => { settings.backupDismissedAt = nowIso(); saveSettings(storage, settings); showBackupNudge(); },
    });
  };
  const doExport = () => {
    exportCurrent(app);
    settings.lastExportAt = nowIso();
    saveSettings(storage, settings);
    if (hashId()) showBackupNudge();
  };
  // 내용 포함 HTML 내려받기(CR-13 B): 지금 유니버스와 하위 유니버스를 앱 HTML에 넣어 한 파일로
  const doExportHtml = (btn) => {
    const html = embedHtmlFor(appHtml, app);
    if (html === null) return;
    const r = downloadWithNotice(btn, embedFileName(exportFileName(app.doc.universe)), html);
    if (r.ok) {
      settings.lastExportAt = nowIso();
      saveSettings(storage, settings);
      if (hashId()) showBackupNudge();
    }
  };
  // 폴더 연결(CR-14 C, R-27, D-32): 브라우저 저장소가 원본, 폴더는 거울. 유니버스를 연 본 화면(내용 포함 HTML 보기 제외)에서만
  // rw(편집 되감기)는 아래에서 선언되지만, 거울 저장은 저장 뒤에만 불리므로 그때는 이미 있다
  const folder = hashId() && !embedMode ? createFolderLink({ app, getAuthor: () => settings.authorName, canMirror: () => !rw && !app.readOnly }) : null;
  const folderSlot = $('folder-note');
  const showFolderNote = () => {
    if (!folder || !folderSlot) return;
    const fs = folder.state;
    const parts = [
      fs.warning ? el('span', { 'data-testid': 'folder-note-warning' }, fs.warning) : null,
      fs.changed ? el('span', { 'data-testid': 'folder-note-changed' }, '폴더에 바뀐 파일이 있습니다 — ') : null,
      fs.changed ? el('button', { type: 'button', 'data-testid': 'folder-note-refresh', onclick: () => folder.refresh() }, '새로 고침') : null,
    ].filter(Boolean);
    folderSlot.replaceChildren(...parts);
    folderSlot.hidden = parts.length === 0;
  };
  if (folder) {
    folder.subscribe(showFolderNote);
    folder.init().catch(() => {});
  }
  // 다른 탭이 같은 지도 문서를 바꾸면 화면 위쪽에 경고 한 줄(RV10S-1). 자동으로 새로 고치거나 합치지 않는다(이 탭에서 저장하면 덮어쓴다)
  if (storage && hashId() && !embedMode && backupSlot) {
    const tabNote = el('p', { id: 'other-tab-note', class: 'notice', role: 'alert', style: 'margin:0;border-radius:0;padding:6px 16px;font-size:14px', 'data-testid': 'other-tab-warning', hidden: true }, OTHER_TAB_NOTE);
    backupSlot.before(tabNote);
    window.addEventListener('storage', (ev) => { if (otherTabChangedUniverse(ev, storage, currentId())) tabNote.hidden = false; });
  }
  const openImport = wireImportDialog(app, $, () => provider, providerLabel, hashId() ? doExport : null, doReset, hashId() ? doExportHtml : null, folder);

  // 주소에 유니버스가 없으면(더블클릭으로 처음 열었을 때) 시작 화면을 보여 준다(R-08)
  if (!hashId()) { // 깨진 인코딩(#%E0)도 시작 화면(hashId의 주석대로, 여섯 번째 검토 C-16)
    document.body.classList.add('start-mode');
    const create = wireCreateDialog(app, $, () => settings.authorName);
    // 내 업무 지도(D-1): 내가 만든 지도 + 고친 샘플 + 마지막으로 연 지도를 마지막 수정일과 함께, 맨 위에 「지난번 지도 이어서 보기」
    const startUniverses = app.universes();
    const mapInfo = {};
    for (const u of startUniverses) {
      const d = typeof app.docOf === 'function' ? app.docOf(u.id) : null;
      // 묶은 지도(팀·부서)는 하위 지도의 마지막 수정까지 본다(일상 사용 2회차 M4: 「수정한 적 없음」으로 나오던 것)
      mapInfo[u.id] = { modified: lastModifiedDeep(d, typeof app.docOf === 'function' ? (id) => app.docOf(id) : null), edited: isEditedSample(d) };
    }
    $('start-screen').replaceChildren(startScreen({
      universes: startUniverses,
      maps: startMaps(startUniverses, mapInfo, settings.lastOpenedId || '', settings.riskBaseline || null),
      resume: resumeTarget(startUniverses, settings.lastOpenedId || ''),
      guide: SAMPLE_GUIDE,
      warnings: [...app.warnings.map((w) => messageFor(w)), ...(embedWarning ? [embedWarning] : [])],
      readOnly: app.readOnly,
      onOpen: (id) => openUniverse(id),
      onTour: (id) => openUniverse(scenarioOf(id).universeId, id),
      onCreate: create.open,
      onCreateMine: create.openMine,
      onImport: openImport,
    }));
    if (CHECK_MODE) window.__wu = { start: true, readOnly: app.readOnly };
    return;
  }
  let selected = null; // 선택한 항목의 전역 ID
  let editing = null; // 편집 중인 양식: {kind:'node'|'edge'|'event'|'edge-edit', edgeId?}
  let drafting = null; // 인수인계 초안 화면: {target}
  let insight = null; // 인사이트 화면: {work, kind}
  let issues = null; // 미해결 이슈 목록 화면(R-20): {target}
  let hiddenOpen = false; // 숨긴 항목 목록 화면(R-21)
  let rwGraphSnap = null; // 편집 되감기에 들어가기 전 그래프 배치·배율(FU5-7)
  let rw = null; // 편집 되감기 중이면 {at}(CR-14 A). 옛 지도를 읽기 전용으로 본다. 저장하지 않는다
  let rwPast = null; // 되감기 중인 시점의 app.viewAt 결과 {doc, view, diff, limits}
  // 따라 하기(CR-13 A): 완료 조건에 쓰는 표시. 따라 하기를 시작할 때 지운다
  let draftShown = false; // 초안 결과가 그려졌음
  let draftDomLive = false; // 지금 화면 패널에 이 drafting의 초안 창이 그려져 있음(다시 그리기 전에 고른 값을 읽을 수 있다)
  let draftRecords = null; // 초안 창을 마지막으로 그린 때의 기록 판 표지(문서 객체·되감기 시점·항목·연결·이력 수). 기록이 바뀌었는지 가린다(R11-5)
  let draftShell = null; // 같은 때의 화면 조건 표지(기준일·읽기 전용·생성 방식·오늘). 바뀌면 창만 다시 그린다
  let evidenceUsed = false; // 초안의 근거 칩을 눌렀음
  let foundGid = null; // 「항목 찾기」로 고른 항목
  let tourSaved = false; // 따라 하기를 시작한 뒤 저장이 한 번 성공했음(handover 5단계 안내용)
  let tour = null;
  const tourHook = () => { if (tour) tour.check(); };
  // 미해결·숨긴 노드·인사이트 패널(U-3): 열 때 「닫기」에 포커스, 닫으면 연 단추로 돌아간다(표 대화상자와 같게)
  let focusPanelClose = false;
  let panelOpener = null; // 연 단추의 data-testid
  const rememberOpener = () => {
    const a = document.activeElement;
    panelOpener = a && a.dataset && a.dataset.testid ? a.dataset.testid : null;
    focusPanelClose = true;
  };
  const focusClose = (testid) => {
    if (!focusPanelClose) return;
    focusPanelClose = false;
    const b = $('detail').querySelector(`[data-testid="${testid}"]`);
    if (b) b.focus();
  };
  const restoreOpener = () => {
    const id = panelOpener;
    panelOpener = null;
    const b = id ? $('detail').querySelector(`[data-testid="${id}"]`) : null;
    if (b) b.focus();
  };
  // 세 패널 중 열려 있는 것을 닫는다(Esc와 「닫기」 공통). 닫았으면 true
  function closeSidePanel() {
    if (issues) issues = null;
    else if (hiddenOpen) hiddenOpen = false;
    else if (insight) insight = null;
    else return false;
    renderPanel();
    graph.highlight(selected);
    restoreOpener();
    return true;
  }
  let viewDate = null; // 시간 슬라이더로 고른 기준일(YYYY-MM-DD). null이면 오늘
  let settingsOpen = false;
  let merging = false; // 통합 확인 목록(T-10)
  const asOf = () => viewDate || todayLocal();
  const expanded = new Set(); // 펼친 하위 유니버스
  // 큰 화면 탐색(T-18, R-17): 주변만 보기 {center, depth} | null, 거르기 조건, 막대에 잠깐 보일 알림. 저장하지 않는다(D-17, 새로 열면 풀림)
  let nbhd = null;
  let filterState = { types: [], person: null };
  let exploreNote = null;
  let baselineNote = ''; // 「이번 점검 저장」 직후의 알림 한 줄(FU5-2). 다른 항목을 고르면 사라진다
  let view = app.view;
  let display = projectView(view, { expanded });

  // 경고 배너(W-STORAGE 등)
  const banner = $('banner');
  if (app.warnings.length) {
    banner.textContent = app.warnings.map(messageFor).join(' ');
    banner.dataset.code = app.warnings.map((w) => w.code).join(' ');
    banner.hidden = false;
  }
  if (embedWarning) {
    banner.textContent = [banner.textContent, embedWarning].filter(Boolean).join(' ');
    banner.hidden = false;
  }
  if (embedMode) {
    // 읽기 전용 보기: 안내 줄과 「내 유니버스로 가져오기」. 저장소를 쓸 수 없으면 단추를 막고 이유를 보인다
    const probe = openStorage(() => window.localStorage);
    const slot = $('embed-banner');
    const rootName = (emb.embed.docs.find((d) => d.universe.id === emb.embed.root) || emb.embed.docs[0]).universe.name;
    renderEmbedBanner(slot, {
      name: rootName,
      canImport: !!probe,
      reason: probe ? '' : '이 브라우저의 저장소를 쓸 수 없어 가져올 수 없습니다.',
      onImport: () => {
        const r = importEmbedToStorage(emb.embed, { samples: SAMPLES, now: nowIso });
        if (r.ok) {
          embedPrefix = '';
          location.hash = emb.embed.root;
          location.reload();
          return;
        }
        slot.querySelector('[data-testid=embed-message]').textContent = r.message;
      },
    });
  }

  $('home').addEventListener('click', goStart);
  const picker = $('universe-picker');
  for (const u of app.universes()) {
    picker.append(el('option', { value: u.id, selected: u.id === app.doc.universe.id }, `${u.name} (${u.level})`));
  }
  picker.title = picker.selectedOptions[0] ? picker.selectedOptions[0].textContent : ''; // 좁은 화면에서 잘린 이름 전체(재검증)
  picker.addEventListener('change', () => openUniverse(picker.value));

  const graph = createGraph($('graph'), { onSelect: select, onToggle: toggle, getFilter: (d) => filterDisplay(d, filterState), onFlow: (on) => $('flowlayout').setAttribute('aria-pressed', String(on)) });

  function renderLegend() {
    $('legend').replaceChildren(
      ...[
        ...legendItems(display).map((i) => el('li', {}, el('span', { class: 'dot', style: `background:${i.color}` }), i.label)),
        display.collapsed.size
          ? el('li', { class: 'legend-note' }, el('span', { class: 'dot collapsed' }), LEGEND_COLLAPSED_TEXT)
          : null,
        // 노드가 많은 화면(부서 등)은 글자가 작다: 확대·이동 방법을 범례 끝에 알린다(재검증 5-2)
        display.nodes.some((n) => n.merged_from && n.merged_from.length)
          ? el('li', { class: 'legend-note', 'data-testid': 'legend-merged' }, '숫자 없는 이중 테두리: 같은 사람으로 합친 항목')
          : null,
        el('li', { class: 'legend-note', 'data-testid': 'legend-zoom' }, '마우스 휠: 확대·축소 · 빈 곳 끌기: 이동'),
      ].filter(Boolean),
    );
  }

  // 층별 보기 조작(CR-4 시제품): 하위 유니버스 꼭지면 펼치기·이동·빼기, 그 밖의 노드면 위로 드러내기
  function layerControls(gid) {
    const node = view.getNode(gid);
    if (!node) return null;
    const box = el('div', { class: 'layer', 'data-testid': 'layer' });
    const isChildRoot = node.core_type === 'root' && node.universe_id !== app.doc.universe.id;
    if (isChildRoot) {
      // 주변만 보기 화면(display)에는 접힘 정보가 없으므로 펼침 목록으로 판정한다. 누르면 주변만 보기를 끝내고 펼치거나 접는다(toggle)
      const info = nbhd ? (expanded.has(node.universe_id) ? null : { hidden_count: null }) : display.collapsed.get(node.universe_id);
      const infoText = !info ? '펼쳐져 있음' : info.hidden_count == null ? '접혀 있음(펼치면 주변만 보기를 끝내고 전체 그래프에서 펼칩니다)' : `접혀 있음: 세부 항목 ${info.hidden_count}개가 가려져 있습니다.`;
      box.append(
        el('p', { class: 'muted small' }, infoText),
        el('div', { class: 'row' },
          el('button', { type: 'button', 'data-testid': 'toggle', onclick: () => toggle(node.universe_id) }, info ? '펼치기' : '접기'),
          el('button', { type: 'button', onclick: () => openUniverse(node.universe_id) }, '이 업무 지도 열기'),
          app.hasChild(node.universe_id)
            ? el('button', { type: 'button', disabled: app.readOnly, onclick: () => removeChild(node.universe_id, node.label) }, '묶음에서 빼기')
            : null,
        ),
      );
      return box;
    }
    if (node.core_type === 'root') return null;
    if (node.hidden || node.deleted) return null; // 숨긴·삭제한 항목은 고칠 수 없으므로 「위층에 드러내기」 체크칸을 보이지 않는다(검토 R13 재검증 5)
    const { universe_id: uid, local_id: lid } = parseGid(gid);
    const own = uid === app.doc.universe.id;
    // 이 유니버스를 묶은 상위 유니버스가 없으면 "드러내기"는 뜻이 없으므로 보이지 않는다(검토5 U-4)
    const parents = own ? app.parentsOf(uid) : [];
    if (own && parents.length === 0) return null;
    const exp = exposureOf(view, gid);
    const cb = el('input', { type: 'checkbox', checked: exp.exposed, disabled: app.readOnly, 'data-testid': 'exposed' });
    cb.addEventListener('change', () => {
      const r = app.updateNode(uid, lid, { exposed: cb.checked });
      if (!r.ok) return window.alert(messageFor(r.error));
      refresh();
    });
    // 다른 유니버스의 노드면 바꾼 값이 그 노드의 원래 유니버스에 저장된다(CR-4, D2-4 가)
    const owner = own ? null : (view.universes.get(uid) || { name: uid }).name;
    const where = own ? `「${parents.map((p) => p.name).join('」·「')}」` : '상위 업무 지도';
    // el()은 null 자식을 걸러 내므로 box.append(…, null)처럼 "null" 글자가 들어가지 않는다(검토5 U-1)
    box.append(el('div', {},
      el('label', { class: 'check' }, cb, ` ${where} 화면에서도 이 항목 보이기`),
      el('div', { class: 'muted small' }, `지금 적용: ${exp.explicit ? '직접 지정' : '기본 규칙'}(${exp.reason})`),
      own ? el('div', { class: 'muted small' }, `${where}${josa(where, '은/는')} 이 업무 지도를 묶은 상위 업무 지도입니다.`) : null,
      owner ? el('div', { class: 'muted small', 'data-testid': 'exposed-owner' }, `바꾸면 원본 업무 지도 「${owner}」에 저장됩니다.`) : null,
    ));
    return box;
  }

  // ── 자료 편집(R-02, T-06) ───────────────────────────────────────────
  const currentId = () => app.doc.universe.id;
  const isOwn = (gid) => !!gid && parseGid(gid).universe_id === currentId();
  const localNode = (gid) => app.findNode(parseGid(gid).local_id);
  // 양식에서 고를 수 있는 이 유니버스의 노드(숨김 제외)
  const ownNodes = () => view.nodes.filter((n) => n.universe_id === currentId() && !n.hidden);

  function afterSave(result, nextSelected = selected) {
    if (!result.ok) return result;
    tourSaved = true;
    editing = null;
    selected = nextSelected;
    refresh();
    if (folder) folder.mirror(); // 저장은 끝났다. 폴더에 거울로 내보낸다(실패해도 되돌리지 않고 머리글에 알린다)
    return result;
  }

  function draftButton(gid) {
    const node = view.getNode(gid);
    if (!node || !DRAFT_TARGET_TYPES.includes(node.core_type)) return null;
    return el('button', { type: 'button', class: 'primary', 'data-testid': 'btn-draft', onclick: () => openDraft(node.gid) }, '인수인계 초안 만들기');
  }

  // 사람 상세의 「이 사람 일 인수인계 초안」(FU-30, CR-18 D-5): 대상 = 이 사람이 진행 중으로 맡은 업무가 있는 지도의 지도 중심(묶은 지도에서는 맡은 업무가 가장 많은 하위 지도, 같으면 화면 순서 앞쪽).
  // 맡은 업무가 없으면 예전처럼 지금 지도 전체. 보내는 사람 = 이 사람, 받는 사람은 비워 둔다. 읽기 전용이면 그리지 않는다
  function personDraftButton(node) {
    if (!node || node.core_type !== 'person' || app.readOnly) return null;
    const mapRoot = app.rootGid();
    const center = draftCenterFor(view, node.gid, { asOf: todayLocal() });
    const targetGid = center ? center.root_gid : mapRoot;
    const centerName = center && targetGid !== mapRoot ? (view.getNode(targetGid) || {}).label : '';
    const title = centerName
      ? `이 사람이 진행 중으로 맡은 업무가 있는 「${centerName}」 지도를 대상으로, 이 사람을 보내는 사람으로 미리 골라 초안 창을 엽니다`
      : '이 지도 전체를 대상으로, 이 사람을 보내는 사람으로 미리 골라 초안 창을 엽니다';
    return el('button', { type: 'button', class: 'link', 'data-testid': 'btn-person-draft', 'data-target': targetGid, title, onclick: () => openDraft(targetGid, { target: targetGid, from: node.label, from_gid: view.canonical(node.gid), to: '' }) }, '이 사람 일 인수인계 초안');
  }

  // 사람 상세의 「이 사람 일, 누가 대신할 수 있나」(CR-18 D-6): 이 사람이 진행 중으로 맡은 업무마다 유사 경험자 계산(rules/insight.js similarExperts)의 상위 후보를 한 표로. 기본 접힘
  function backupNote(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || node.core_type !== 'person') return null;
    const rows = backupRows(view, node.gid, { asOf: asOf() });
    if (!rows.length) return null;
    const cell = (r) => (r.candidates.length
      ? el('ul', { class: 'backup-cands' }, ...r.candidates.map((c) => el('li', { 'data-testid': 'person-backup-cand', 'data-state': c.state },
        el('button', { type: 'button', class: 'link', 'data-testid': 'person-backup-name', onclick: () => focus(c.gid) }, c.label), ' ',
        // 상태(직접 해 봄·지금 담당 중·끝남)는 c.text 앞머리에 이미 있다 — 칩을 따로 달면 같은 말이 두 번 보였다
        el('span', { class: 'muted small' }, c.text + (c.note ? ` · ${c.note}` : '')))))
      : el('span', { class: 'muted small', 'data-testid': 'person-backup-none' }, BACKUP_NONE_TEXT));
    return el('details', { class: 'person-backup', 'data-testid': 'person-backup' },
      el('summary', {}, '이 사람 일, 누가 대신할 수 있나'),
      el('p', { class: 'muted small' }, `${asOf()} 기준으로 진행 중인 업무마다 「유사 경험자」 계산의 상위 후보입니다(업무당 최대 3명, 그 업무를 직접 해 본 사람이 먼저). 후보의 이름을 누르면 그 사람이 선택됩니다.`),
      el('table', { class: 'backup-table', 'data-testid': 'person-backup-table' },
        el('thead', {}, el('tr', {}, el('th', {}, '맡은 업무'), el('th', {}, '대신할 수 있는 후보'))),
        el('tbody', {}, ...rows.map((r) => el('tr', { 'data-testid': 'person-backup-row' }, el('td', {}, r.work.label), el('td', {}, cell(r)))))));
  }

  // 업무 상세의 「협업자 추가」(CR-18 D-8): 이름·소속·연락처 세 칸으로 사람 노드 + 이 업무와의 「참조」 연결을 한 번의 묶음 명령(applyBatch)으로 저장한다. 같은 이름의 사람이 있으면 연결만
  function collabBox(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || node.core_type !== 'work' || !isOwn(gid) || app.readOnly || rw) return null;
    const field = (testid, label, placeholder) => el('label', { class: 'small' }, `${label} `, el('input', { type: 'text', maxlength: 100, autocomplete: 'off', placeholder, 'data-testid': testid, 'aria-label': label }));
    const nameIn = field('collab-name', '이름', '예: 오하늘');
    const affIn = field('collab-affiliation', '소속(선택)', '예: 가상결제팀');
    const conIn = field('collab-contact', '연락처(선택)', '예: 내선 1234');
    // 주고받는 것(T5): 만드는 「참조」 연결의 메모(연결의 기존 note 필드)에 들어간다. 「연결된 항목」의 그 연결 줄에 보인다
    const noteIn = field('collab-note', '주고받는 것(선택)', '예: 대사 결과 공유');
    const msg = el('span', { class: 'error-text', role: 'alert', 'data-testid': 'collab-msg' });
    const submit = () => {
      const work = localNode(gid);
      const persons = ownNodes().filter((n) => n.core_type === 'person');
      const val = (box) => box.querySelector('input').value;
      const plan = collabPlan(persons, { name: val(nameIn), affiliation: val(affIn), contact: val(conIn) }, work ? work.id : '');
      msg.textContent = '';
      delete msg.dataset.code;
      const exchange = val(noteIn).trim();
      if (plan.ok && exchange) { // 「참조」 연결 명령(묶음의 마지막 addEdge)에 메모를 더한다
        const edgeOp = [...plan.ops].reverse().find((o) => o.op === 'addEdge');
        if (edgeOp) edgeOp.input = { ...edgeOp.input, note: exchange };
      }
      if (!plan.ok) {
        msg.textContent = plan.reason === 'empty' ? '협업자 이름을 넣으세요.' : plan.reason === 'ambiguous' ? '같은 이름의 사람이 둘 이상입니다. 「연결 추가」에서 직접 고르세요.' : '이 조합으로는 연결할 수 없습니다.';
        msg.dataset.code = plan.reason;
        return;
      }
      const b = app.applyBatch(plan.ops);
      if (!b.ok) {
        const e0 = b.errors && b.errors.length ? b.errors[0] : null;
        const err = e0 ? e0.error : b.error;
        const edgeRow = e0 && e0.row === plan.ops.length;
        msg.textContent = edgeRow && err && err.code === 'E-DUP' ? `이미 이 업무에 참조로 이어진 사람입니다.${exchange ? ' 주고받는 것은 「연결된 항목」의 그 연결 줄 「연결 수정」의 메모에서 고치세요.' : ''}` : messageFor(err, { kind: edgeRow ? 'edge' : 'node', relation: 'references' });
        msg.dataset.code = (err && err.code) || '';
        return;
      }
      const name = plan.label;
      const extra = plan.existing
        ? `같은 이름의 사람이 이미 있어 새로 만들지 않고 연결만 했습니다${plan.ignored ? ' (입력한 소속·연락처는 반영하지 않았습니다 — 그 사람의 「수정」에서 고치세요)' : ''}.`
        : `새 사람으로 만들었습니다.${b.warnings.map((w) => ` ${messageFor(w)}`).join('')}`;
      afterSave(b, gid); // refresh()가 상세를 다시 그린다(연결된 항목에 협업자가 보인다)
      $('detail').prepend(el('p', { class: 'ok-notice', role: 'status', 'data-testid': 'collab-done' }, `「${name}」${josa(name, '을/를')} 이 업무의 협업자로 이었습니다(참조). ${extra}${exchange ? ` 주고받는 것(연결 메모): ${exchange}` : ''}`));
    };
    for (const box of [nameIn, affIn, conIn, noteIn]) box.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('details', { class: 'collab-quick', 'data-testid': 'collab-quick' },
      el('summary', { title: '다른 팀 사람처럼 이 업무와 함께 일하는 사람을 이름·소속·연락처만 적어 한 번에 넣습니다' }, '협업자 추가'),
      el('div', { class: 'row' }, nameIn, affIn, conIn, noteIn, el('button', { type: 'button', 'data-testid': 'collab-add', onclick: submit }, '추가')),
      el('p', { class: 'muted small' }, '사람을 새로 만들고 이 업무와 「참조」로 잇습니다. 같은 이름의 사람이 이미 있으면 연결만 합니다. 인수인계 초안의 「관계자·연락처」에 나옵니다. 「주고받는 것」은 그 「참조」 연결의 메모로 남습니다(「연결된 항목」에서 보입니다).'),
      msg);
  }

  // 지도 중심 상세(와 개요)의 「이번 주 기록」(CR-18 D-10): 업무 고르기·분류·내용 한 줄. 기존 이력 추가의 메모와 같은 경로(app.addEvent)로 오늘 날짜의 메모 하나. 고칠 수 없는 화면에서는 그리지 않는다
  // date·day: 날짜 칸(T4). 주말에 한 주를 몰아 넣을 때 같은 날짜로 이어 넣을 수 있게, 오늘이 아닌 날짜는 같은 날(day) 안에서만 기억한다(다음 날 열면 다시 오늘)
  let weeklyLast = { workId: '', category: WEEKLY_DEFAULT_CATEGORY, date: '', day: '' };
  function weeklyBox() {
    if (app.readOnly || rw) return null;
    const works = ownNodes().filter((n) => n.core_type === 'work');
    if (!works.length) return null;
    const workSel = el('select', { 'data-testid': 'weekly-work', 'aria-label': '업무' }, el('option', { value: '' }, '업무를 고르세요'), ...works.map((w) => el('option', { value: w.id, selected: w.id === weeklyLast.workId }, w.label)));
    const catSel = el('select', { 'data-testid': 'weekly-category', 'aria-label': '분류' }, ...Object.entries(MEMO_CATEGORIES).map(([k, v]) => el('option', { value: k, selected: k === weeklyLast.category }, v)));
    const noteIn = el('input', { type: 'text', maxlength: 2000, autocomplete: 'off', placeholder: '예: 대사 불일치 2건 정리, 다음 주 재확인', 'data-testid': 'weekly-note', 'aria-label': '내용' });
    const today = todayLocal();
    const dateIn = el('input', { type: 'date', value: weeklyLast.day === today && weeklyLast.date && weeklyLast.date <= today ? weeklyLast.date : today, min: WEEKLY_DATE_MIN, max: today, 'data-testid': 'weekly-date', 'aria-label': '날짜(기본 오늘)', title: '기본은 오늘입니다. 주말에 한 주를 몰아 넣을 때는 요일별 날짜를 고르세요(오늘보다 뒤 날짜는 기록할 수 없습니다)' });
    const msg = el('span', { class: 'error-text', role: 'alert', 'data-testid': 'weekly-msg' });
    const submit = () => {
      msg.textContent = '';
      delete msg.dataset.code;
      weeklyLast = { workId: workSel.value, category: catSel.value, date: dateIn.value, day: todayLocal() };
      // 날짜 검사(T4): 비었거나 읽을 수 없거나 오늘 뒤면 저장하지 않는다
      const dateErr = weeklyDateError(dateIn.value, todayLocal());
      if (dateErr) {
        msg.textContent = WEEKLY_DATE_MESSAGES[dateErr];
        msg.dataset.code = `date-${dateErr}`;
        return;
      }
      const m = weeklyMemoInput({ workId: workSel.value, category: catSel.value, note: noteIn.value, date: dateIn.value.trim() });
      if (!m.ok) {
        msg.textContent = m.field === 'work_id' ? '기록할 업무를 고르세요.' : messageFor({ code: 'E-REQUIRED', field: 'note' });
        msg.dataset.code = m.field;
        return;
      }
      const r = app.addEvent(m.input);
      if (!r.ok) {
        msg.textContent = messageFor(r.error, { kind: 'event' });
        msg.dataset.code = (r.error && r.error.code) || '';
        return;
      }
      const label = (works.find((w) => w.id === workSel.value) || {}).label || '';
      afterSave(r, selected);
      // 오늘이 아닌 날짜로 넣었으면 그 날짜를 알린다(몰아 넣을 때 날짜가 맞는지 바로 보이게)
      const when = m.input.occurred_at === todayLocal() ? '' : `(${m.input.occurred_at}) `;
      $('detail').prepend(el('p', { class: 'ok-notice', role: 'status', 'data-testid': 'weekly-done' }, `「${label}」에 ${when}기록했습니다 — [${MEMO_CATEGORIES[m.input.payload.category] || m.input.payload.category}] ${m.input.note}`));
    };
    noteIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('div', { class: 'weekly-quick', 'data-testid': 'weekly-quick' },
      el('p', { class: 'small' }, el('strong', {}, '이번 주 기록'), ' ', el('span', { class: 'muted' }, '업무 이력에 메모를 남깁니다(날짜는 기본 오늘 — 주말에 몰아 넣을 때는 요일별로 고르세요). 「진행 중」·「이슈」 기록은 「미해결」에 잡히니, 끝나면 「해결로 표시」하세요')),
      el('div', { class: 'row' }, workSel, catSel, el('label', { class: 'small' }, '날짜 ', dateIn), noteIn, el('button', { type: 'button', 'data-testid': 'weekly-add', onclick: submit }, '기록')),
      msg);
  }

  // 「가져오기·내보내기」 창의 「폴더 연결」 탭을 바로 연다(import.js의 열기 함수는 탭 인자가 없어, 창을 연 뒤 탭 단추를 누른다)
  function openFolderTab() {
    openImport();
    const tab = document.querySelector('[data-testid=import-tab-folder]');
    if (tab) tab.click();
  }

  // 유니버스 개요의 폴더 연결 입구(9차 검토 R9-3): 탭이 창 안쪽에 있어 못 찾는 문제. 폴더를 쓸 수 없는 브라우저·읽기 전용·되감기 중에는 숨긴다
  function folderEntry() {
    if (!folder || !folder.state.supported || rw || app.readOnly) return null;
    return el('p', { class: 'muted small', 'data-testid': 'folder-entry' },
      '폴더로 함께 쓰기 — 공유 폴더에 두면 동료 지도와 묶입니다 ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-folder-entry', onclick: openFolderTab }, '「폴더 연결」'));
  }

  // preset(선택, FU-30): 초안 창에 미리 고를 {target, from, to}(draft.js의 preset 옵션과 같은 모양: target은 gid나 이름, from·to는 사람 이름)
  function openDraft(targetGid, preset) {
    settingsOpen = false;
    merging = false;
    editing = null;
    insight = null;
    issues = null;
    drafting = preset ? { target: targetGid, preset } : { target: targetGid };
    draftShown = false;
    draftDomLive = false; // 새로 여는 초안 창: 이전 화면의 칸 값을 읽지 않는다
    renderPanel();
  }

  function openIssues(targetGid) {
    rememberOpener();
    settingsOpen = false;
    merging = false;
    editing = null;
    drafting = null;
    insight = null;
    issues = { target: targetGid };
    renderPanel();
  }

  // 미해결 n건(R-20): 업무 상세에서는 그 업무 범위, 유니버스 개요에서는 화면에 모인 모든 메모
  function issueNote(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || node.core_type !== 'work') return null;
    return issueEntry(view, node.gid, { onOpen: () => openIssues(node.gid) });
  }

  // 지난 점검 대비(D-3): 기준(숫자·저장 시각)은 이 브라우저 설정에만 지도별로 둔다. 문서·내보내기·백업에는 들어가지 않는다
  // 지도마다 기준을 최근 둘까지 둔다(일상 사용 2회차 M1): 같은 날 다시 저장하면 그날 것을 바꾸고, 날이 바뀌면 새로 더한다. 비교는 오늘보다 앞선 날의 가장 최근 기준과 한다
  const riskEntryOf = () => (settings.riskBaseline || {})[currentId()] || null;
  const riskPick = () => pickBaseline(riskEntryOf(), todayLocal());
  const canSaveBaseline = () => baselineSaveAllowed({ storage, readOnly: app.readOnly, rewinding: !!rw }); // 읽기 전용·내용 포함 파일·되감기 중에는 저장 단추를 끈다(보기는 된다)
  function riskCompareFor(nums, names) {
    const pick = riskPick();
    const cmp = compareRisk(nums, pick.base, names, { savedToday: pick.savedToday });
    return {
      text: cmp.has || cmp.savedToday || canSaveBaseline() ? cmp.text : '아직 저장한 점검 없음(이 화면에서는 저장할 수 없습니다)',
      has: cmp.has,
      canSave: canSaveBaseline(),
      changes: cmp.changes && cmp.changes.length ? cmp.changes : null,
      ownerChanges: cmp.ownerChanges && cmp.ownerChanges.length ? cmp.ownerChanges : null, // 담당이 바뀐 업무(M6)
      savedNote: baselineNote,
      onSummary: openCheckSummary, // 「점검 요약 보기」(M2)
      onSave: () => {
        const at = nowIso();
        const row = makeBaseline(nums, { at, asOf: asOf(), names, owners: names && names.owners });
        const saved = saveBaseline(riskEntryOf(), row);
        settings.riskBaseline = { ...(settings.riskBaseline || {}), [currentId()]: saved.entry };
        saveSettings(storage, settings);
        baselineNote = baselineSavedNote(at, { replaced: saved.replaced });
        renderPanel();
      },
    };
  }
  // 위험 요약의 「점검 요약 보기」(M2): 인사이트(인수인계 위험 탭)를 열고 위쪽의 「점검 요약」 줄로 간다
  function openCheckSummary() {
    openInsight('', 'risk');
    const bar = document.querySelector('[data-testid=summary-bar]');
    if (bar && typeof bar.scrollIntoView === 'function') bar.scrollIntoView({ block: 'start' });
    const first = bar && bar.querySelector('[data-testid=summary-copy]');
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
  }

  function openInsight(workGid, kind = 'similar') {
    rememberOpener();
    settingsOpen = false;
    merging = false;
    editing = null;
    drafting = null;
    issues = null;
    // D-6: 업무를 고른 채 열면 그 업무를 「유사 경험자」 탭에서 미리 골라 둔다
    const picked = !workGid && selected ? view.getNode(view.canonical(selected)) : null;
    insight = { work: workGid || (picked && !picked.hidden && picked.core_type === 'work' ? picked.gid : ''), kind };
    renderPanel();
    $('detail').parentElement.scrollTop = 0; // 「닫기」에 초점을 주며 패널이 아래로 내려간 채 열리지 않게 맨 위부터 보인다(FU-5)
  }

  // 업무 노드에만 보이는 "유사 경험자" 버튼
  function insightButton(gid) {
    const node = view.getNode(gid);
    if (!node || node.core_type !== 'work') return null;
    return el('button', { type: 'button', 'data-testid': 'btn-similar', onclick: () => openInsight(node.gid) }, '유사 경험자');
  }

  // 사람 노드: 지금 맡은 업무 수와 밀집 기준 해당 여부. 누르면 인사이트의 밀집·공백 탭이 열린다
  function loadNote(gid) {
    const load = personLoad(view, gid, { asOf: asOf(), n: currentDenseN() });
    // 담당 기록이 한 번도 없는 사람(조직관리의 사람 등)에게는 표시하지 않는다
    if (!load || !view.edges.some((e) => !e.hidden && e.core_type === 'performs' && e.source === view.canonical(gid))) return null;
    const when = viewDate ? `${viewDate} 기준` : '지금';
    const text = load.count === 0 ? `${when} 맡은 업무 없음` : `${when} 맡은 업무 ${load.count}개 — ${load.dense ? `밀집 기준(${load.n}개 이상)에 해당` : `밀집 기준(${load.n}개 이상) 아래`}`;
    return el('p', { class: load.dense ? 'notice' : 'muted small', 'data-testid': 'person-load' }, text, ' ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-person-density', onclick: () => openInsight('', 'density') }, '밀집·공백 보기'));
  }

  // 업무 노드: 현재 담당 또는 공백 종류. 누르면 밀집·공백 탭
  function workNote(gid) {
    const w = workLoad(view, gid, { asOf: asOf() });
    if (!w) return null;
    const text = w.work_ended ? '기간이 끝난 업무'
      : w.work_scheduled ? `시작 전 업무(${w.work_start}부터)`
      : w.kind === 'covered' ? `${viewDate ? `${viewDate} 기준 담당` : '현재 담당'}: ${currentHoldersText(view, gid, asOf(), w.current, { past: !!viewDate })}`
      : w.kind === 'scheduled' ? `공백 — 시작 예정 담당자만 있음(${w.next_person.label}, ${w.next_start}부터)`
      : w.kind === 'ended' ? `공백 — 이전 담당자만 있음(${w.last_person.label}, ${w.last_end}까지). 끝난 업무인지 확인`
      : '공백 — 담당 기록 없음';
    const gap = !w.work_ended && !w.work_scheduled && w.kind !== 'covered';
    return el('p', { class: gap ? 'notice' : 'muted small', 'data-testid': 'work-load' }, text, ' ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-work-density', onclick: () => openInsight('', 'density') }, '밀집·공백 보기'));
  }

  // 표준 양식(R-16): 업무의 권장 항목이 비어 있으면 한 줄(막지 않음). 다 채웠으면 아무것도 보이지 않는다
  function formNote(gid) {
    const missing = workFormMissing(view, gid);
    if (!missing || !missing.length) return null;
    // 항목 이름을 누르면 그 항목을 채우는 길이 열린다(FU-16): 설명은 설명 칸, 나머지는 그 속성 칸(없으면 줄을 더해서)에 초점이 가는 수정 화면.
    // 담당은 이 업무 상세 안의 작은 칸 「담당자 이름 [ ] 넣기」(점검 3회차: 사람↔업무를 「관련」으로 이으려다 막히던 길). 고칠 수 없는 화면에서는 글자만
    const canEdit = isOwn(gid) && !app.readOnly && !rw;
    const box = canEdit && missing.includes('담당') ? assignBox(gid) : null;
    const items = missing.flatMap((m, i) => [i ? ', ' : null, canEdit
      ? el('button', { type: 'button', class: 'link', 'data-testid': 'form-missing-item', 'data-field': m, title: m === '담당' ? '이 업무의 담당자 이름을 넣는 칸을 엽니다' : m === RELATED_DOC_ITEM ? '「사람·업무·문서 추가」를 유형 「산출물」로 열고, 이 업무와 「산출」로 잇도록 미리 골라 둡니다(초안의 「산출물·문서 위치」는 이 연결을 읽습니다)' : `「${m}」 칸을 채우는 수정 화면을 엽니다`,
        onclick: () => {
          if (m === RELATED_DOC_ITEM) { openRelatedDocForm(gid); return; }
          if (m !== '담당') { editing = { kind: 'node', focus: m }; renderPanel(); return; }
          box.hidden = !box.hidden;
          if (!box.hidden) box.querySelector('[data-testid=form-assign-name]').focus();
        } }, m)
      : m]);
    const line = el('p', { class: 'muted small', 'data-testid': 'form-missing', title: '업무를 넣는 표준 양식(절차·주기·마감·주의사항·관련 문서·담당·설명)과 비교한 결과입니다. 저장은 막지 않습니다' },
      `표준 양식: 권장 항목 ${missing.length}개 비어 있음 — `, ...items);
    return box ? el('div', {}, line, box) : line;
  }

  // 권장 항목 「관련 문서」(R11-14): 인수인계 초안의 「산출물·문서 위치」는 속성 「관련 문서」가 아니라 업무에서 「산출」로 이은 산출물을 읽는다.
  // 그래서 속성 칸이 아니라 「노드 추가」를 유형 「산출물」, 함께 이을 노드 = 이 업무, 관계 「산출」(업무 → 새 산출물)로 미리 골라 연다. 저장은 사람이 「추가」를 눌러야 한다
  const RELATED_DOC_ITEM = '관련 문서';
  function openRelatedDocForm(workGid) {
    const work = localNode(workGid);
    const slot = $('add-slot');
    const typeSelect = slot.querySelector('[data-testid=node-type]');
    if (!work || !typeSelect || ![...typeSelect.options].some((o) => o.value === 'artifact')) return;
    const details = document.querySelector('details.add');
    if (details) details.open = true;
    typeSelect.value = 'artifact';
    typeSelect.dispatchEvent(new Event('change'));
    const form = slot.querySelector('[data-testid=node-form-add]');
    if (form && typeof form.refreshCandidates === 'function') form.refreshCandidates(); // 방금 고른 업무가 후보 목록에 들어 있게
    const other = slot.querySelector('[data-testid=node-link-other]');
    if (other && [...other.options].some((o) => o.value === work.id)) {
      other.value = work.id;
      other.dispatchEvent(new Event('change'));
      const rel = slot.querySelector('[data-testid=node-link-type]');
      const dir = slot.querySelector('[data-testid=node-link-direction]');
      if (rel && [...rel.options].some((o) => o.value === 'produces' && !o.disabled)) rel.value = 'produces';
      if (dir) dir.value = 'in'; // 상대(이 업무) → 새 산출물
    }
    const label = slot.querySelector('[data-testid=node-label]');
    if (label) {
      label.focus();
      if (typeof label.scrollIntoView === 'function') label.scrollIntoView({ block: 'nearest' });
    }
  }

  // 권장 항목 「담당」의 이름 넣기 칸(처음엔 숨김). 같은 이름의 사람이 이 지도에 있으면 그 사람을, 없으면 새 사람을 만들어 이 업무에 「수행」으로 잇는다.
  // 표의 담당자 칸과 같은 명령 경로(applyBatch assign)라 이력·검증이 같고, 시작일은 오늘이다
  function assignBox(gid) {
    const input = el('input', { type: 'text', maxlength: 100, autocomplete: 'off', placeholder: '예: 김가상', 'data-testid': 'form-assign-name', 'aria-label': '담당자 이름' });
    const msg = el('span', { class: 'error-text', role: 'alert', 'data-testid': 'form-assign-msg' });
    const submit = () => {
      const work = localNode(gid);
      const persons = ownNodes().filter((n) => n.core_type === 'person');
      const plan = assignOps(persons, input.value, work ? work.id : '');
      msg.textContent = '';
      delete msg.dataset.code;
      if (!plan.ok) {
        msg.textContent = plan.reason === 'empty' ? '담당자 이름을 넣으세요.' : '같은 이름의 사람이 둘 이상입니다. 「연결 추가」에서 직접 고르세요.';
        msg.dataset.code = plan.reason;
        return;
      }
      const name = input.value.trim();
      const b = app.applyBatch(plan.ops);
      if (!b.ok) {
        const err = b.errors && b.errors.length ? b.errors[0].error : b.error;
        msg.textContent = messageFor(err);
        msg.dataset.code = (err && err.code) || '';
        return;
      }
      afterSave(b, gid); // refresh()가 상세를 다시 그린다(담당이 채워져 권장 항목에서 빠진다)
      $('detail').prepend(el('p', { class: 'ok-notice', role: 'status', 'data-testid': 'assign-done' }, `「${name}」${josa(name, '을/를')} 이 업무의 담당으로 넣었습니다${plan.existing ? '' : ' (새 사람으로 만들었습니다)'}.`));
    };
    const add = el('button', { type: 'button', 'data-testid': 'form-assign-add', onclick: submit }, '넣기');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('div', { class: 'row', hidden: true, 'data-testid': 'form-assign' }, el('label', { class: 'small' }, '담당자 이름 ', input), add, msg);
  }

  // 업무 상세의 접힌 상자 「담당 바꾸기」(일상 사용 2회차 M3): 지금 담당 → 새 담당(목록에서 고르거나 이름을 넣음), 날짜 기본 오늘.
  // 한 번의 기록(app.changeAssignee — 기존 담당 종료·시작 명령 묶음, 되감기 한 점)으로 보내는 사람의 진행 중 수행을 끝내고 받는 사람의 수행을 시작한다.
  // 「인수인계 기록도 남기기」를 켜면 인수인계 이력도 같은 저장에 남긴다. 읽기 전용·되감기 중에는 그리지 않고, 다른 업무 지도의 업무는 「…」 열기 안내만 보인다
  function assigneeBox(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || node.core_type !== 'work' || app.readOnly || rw) return null;
    if (!isOwn(gid)) {
      return el('details', { class: 'assignee-change', 'data-testid': 'assignee-change' },
        el('summary', {}, '담당 바꾸기'),
        el('p', { class: 'muted small', 'data-testid': 'assignee-other-map' }, '다른 업무 지도의 업무입니다. 담당을 바꾸려면 그 지도를 열어서 하세요. ',
          el('button', { type: 'button', class: 'link', 'data-testid': 'assignee-open-map', onclick: () => openUniverse(node.universe_id) }, `「${node.universe_name}」 열기`)));
    }
    const wg = view.canonical(gid);
    // 지금 이 지도에서 진행 중으로 담당하는 사람(끝 날짜 없는 수행 연결)
    const holders = [];
    for (const e of view.edges) {
      if (e.hidden || e.core_type !== 'performs' || e.target !== wg || (e.period && e.period.end) || !isOwn(e.source)) continue;
      const p = localNode(e.source);
      if (p && p.core_type === 'person' && !p.hidden && !holders.some((h) => h.id === p.id)) holders.push(p);
    }
    const summary = el('summary', { title: '지금 담당을 끝내고 새 담당을 시작하는 두 기록을 한 번에 남깁니다' }, '담당 바꾸기');
    if (!holders.length) {
      return el('details', { class: 'assignee-change', 'data-testid': 'assignee-change' }, summary,
        el('p', { class: 'muted small', 'data-testid': 'assignee-none' }, '지금 담당 중인(진행 중인 수행 연결이 있는) 사람이 없습니다. 담당을 넣으려면 「이력 추가」의 「담당 시작」을 쓰세요.'));
    }
    const persons = ownNodes().filter((n) => n.core_type === 'person');
    const fromSel = el('select', { 'data-testid': 'assignee-from', 'aria-label': '지금 담당' }, ...holders.map((h) => el('option', { value: h.id }, h.label)));
    const toSel = el('select', { 'data-testid': 'assignee-to', 'aria-label': '새 담당(목록에서 고르기)' }, el('option', { value: '' }, '새 담당을 고르세요'), ...persons.map((p) => el('option', { value: p.id }, p.label)));
    const toName = el('input', { type: 'text', maxlength: 100, autocomplete: 'off', placeholder: '또는 이름 넣기(새 사람)', 'data-testid': 'assignee-to-name', 'aria-label': '새 담당 이름(목록에 없을 때)' });
    const today = todayLocal();
    const dateIn = el('input', { type: 'date', value: today, min: WEEKLY_DATE_MIN, max: today, 'data-testid': 'assignee-date', 'aria-label': '바뀐 날짜(기본 오늘)' });
    const handoverChk = el('input', { type: 'checkbox', 'data-testid': 'assignee-handover' });
    const msg = el('span', { class: 'error-text', role: 'alert', 'data-testid': 'assignee-msg' });
    const fail = (text, code) => { msg.textContent = text; msg.dataset.code = code; };
    const submit = () => {
      msg.textContent = '';
      delete msg.dataset.code;
      const name = toName.value.trim();
      if (toSel.value && name) return fail('새 담당은 목록에서 고르거나 이름을 넣거나, 둘 중 하나만 하세요.', 'both');
      if (!toSel.value && !name) return fail('새 담당을 고르거나 이름을 넣으세요.', 'to-empty');
      const dateErr = weeklyDateError(dateIn.value, todayLocal());
      if (dateErr) return fail(WEEKLY_DATE_MESSAGES[dateErr], `date-${dateErr}`);
      const work = localNode(gid);
      const fromNode = app.findNode(fromSel.value);
      const r = app.changeAssignee({ workId: work ? work.id : '', fromId: fromSel.value, toId: toSel.value || undefined, toName: name, date: dateIn.value.trim(), handover: handoverChk.checked });
      if (!r.ok) {
        const err = r.error || {};
        fail(err.reason === 'ambiguous' ? '같은 이름의 사람이 둘 이상입니다. 목록에서 고르세요.' : err.future ? WEEKLY_DATE_MESSAGES.future : messageFor(err, { kind: 'event' }), err.code || '');
        return;
      }
      const from = fromNode ? fromNode.label : '';
      const to = r.to.label;
      const when = dateIn.value.trim();
      afterSave(r, gid); // refresh()가 상세를 다시 그린다(「현재 담당」이 바뀐다)
      $('detail').prepend(el('p', { class: 'ok-notice', role: 'status', 'data-testid': 'assignee-done' },
        `「${node.label}」의 담당을 ${from} → ${to}${josa(to, '으로/로')} 바꿨습니다(${when}). ${from}의 수행은 ${when}에 끝나고 ${to}의 수행은 ${when}부터 시작됩니다.${r.created ? ` 「${to}」${josa(to, '은/는')} 새 사람으로 만들었습니다.` : ''}${r.handover ? ' 인수인계 기록도 남겼습니다.' : ''}`));
    };
    const apply = el('button', { type: 'button', 'data-testid': 'assignee-apply', onclick: submit }, '담당 바꾸기');
    toName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('details', { class: 'assignee-change', 'data-testid': 'assignee-change' }, summary,
      el('div', { class: 'row' },
        el('label', { class: 'small' }, '지금 담당 ', fromSel), el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
        el('label', { class: 'small' }, '새 담당 ', toSel), toName,
        el('label', { class: 'small' }, '날짜 ', dateIn)),
      el('div', { class: 'row' },
        el('label', { class: 'check' }, handoverChk, ' 인수인계 기록도 남기기'),
        apply),
      el('p', { class: 'muted small' }, '한 번의 기록으로 지금 담당의 수행을 끝내고(그 날짜까지) 새 담당의 수행을 시작합니다(그 날짜부터). 인수인계 초안을 확정하는 것과는 별개입니다 — 문서까지 남기려면 「인수인계 초안 만들기」의 「담당도 넘기기」를 쓰세요.'),
      msg);
  }

  // 업무·주제 노드가 반복 비효율 패턴에 들어 있으면 한 줄
  function repeatNote(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || !['work', 'topic'].includes(node.core_type)) return null;
    const hits = repeatPatternsFor(view, gid, asOf()); // 오늘 보기에서도 오늘 기준(검토5 I-2)
    if (!hits.length) return null;
    const kinds = [...new Set(hits.map((p) => (p.kind === 'handover_chain' ? '인수인계 반복' : '주제 반복')))].join('·');
    return el('p', { class: 'notice', 'data-testid': 'repeat-note' }, `반복 비효율 패턴 ${hits.length}건에 포함(${kinds}) `,
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-repeat-note', onclick: () => openInsight('', 'repeat') }, '반복 비효율 보기'));
  }

  // 업무를 해 본 사람이 한 명뿐이고 인수인계 기록이 없으면 한 줄(CR-14 B, R-26 ⑤)
  function riskNote(gid) {
    const hit = riskNoteFor(view, gid, asOf());
    if (!hit) return null;
    return el('p', { class: 'notice', 'data-testid': 'risk-note' }, `지식 집중 위험 높음 — ${hit.person.label}만 해 봤고 인수인계 기록이 없습니다 `,
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-risk-note', onclick: () => openInsight('', 'risk') }, '인수인계 위험 보기'));
  }

  // 사람 노드: 이 사람 한 명만 해 본 업무(FU-12). 인수인계 위험 탭 ① 목록과 같은 계산이다. 0개면 그리지 않는다
  function soloWorksNote(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || node.core_type !== 'person') return null;
    const text = soloWorksText(soloWorksOf(view, gid, asOf()));
    // 「이 사람 일 인수인계 초안」은 도구줄(R7-2: 수정·연결 추가·이력 추가·이력으로)이 아니라 이 줄에 둔다 — "이 사람이 빠지면"의 맥락
    const draftLink = personDraftButton(node);
    if (!text) return draftLink ? el('p', { class: 'muted small', 'data-testid': 'person-draft-line' }, draftLink) : null;
    return el('p', { class: 'notice', 'data-testid': 'person-solo-works' }, text, ' ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-person-solo', onclick: () => openInsight('', 'risk') }, '인수인계 위험 보기'),
      draftLink ? ' · ' : null, draftLink);
  }

  // 하위 유니버스를 묶은 유니버스의 개요: 통합 확인 목록으로 가는 버튼(대기 건수)
  function mergeButton() {
    const plan = app.mergePlan();
    if (!plan) return null;
    return el('p', { class: plan.counts.pending ? 'notice' : 'muted small', 'data-testid': 'merge-hint' },
      mergePendingText(plan.counts),
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-merge', onclick: () => { merging = true; insight = null; issues = null; drafting = null; editing = null; settingsOpen = false; renderPanel(); } }, '통합 확인 목록'));
  }

  // 어느 노드를 골랐든 전체 인사이트로 갈 수 있게(검토5 U-2: 시작 화면 3단계가 노드 선택 상태에서 끊기지 않도록)
  const insightAllButton = () => el('button', { type: 'button', 'data-testid': 'btn-insight', onclick: () => openInsight('', 'risk') }, '인사이트 보기');

  // 확정한 인수인계서(산출물 「인수인계서」)의 내려받기·인쇄(R-19)
  function docButtons(node) {
    if (node.core_type !== 'artifact' || node.subtype !== SUBTYPE_HANDOVER_DOC) return [];
    return [
      el('button', { type: 'button', 'data-testid': 'doc-download', onclick: (e) => { const x = confirmedDoc(node); downloadWithNotice(e.currentTarget, x.name, x.html); } }, '내려받기'),
      el('button', { type: 'button', 'data-testid': 'doc-print', onclick: () => printHtml(confirmedDoc(node).html) }, '인쇄'),
    ];
  }

  // 자주 쓰는 단추만 한 줄에 두고 나머지는 「더 보기」(details)로 접는다(R7-2). details는 키보드(Tab·Enter·Space)로 열린다
  function historyJumpButton() {
    return el('button', { type: 'button', 'data-testid': 'btn-history-jump', title: '이 항목의 이력 목록으로 내려갑니다', onclick: () => {
      const h = document.querySelector('[data-testid="history-heading"]');
      if (!h) return;
      h.scrollIntoView({ block: 'start' });
      h.focus({ preventScroll: true });
    } }, '이력으로');
  }

  function moreTools(items) {
    const list = items.filter(Boolean);
    if (!list.length) return null;
    return el('details', { class: 'more-tools', 'data-testid': 'more-tools' },
      el('summary', { title: '숨기기·유사 경험자·인사이트 보기·주변만 보기 같은 나머지 단추' }, '더 보기'),
      el('div', { class: 'row toolbar-more' }, ...list));
  }

  function toolbar(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden) return null;
    const nb = nbhdButtons(gid) || [];
    // D8-3: 확정한 인수인계서의 「내려받기」「인쇄」는 첫 줄로, 그래프 노드가 많으면(NBHD_PROMOTE_ABOVE 초과) 「주변만 보기」도 첫 줄로.
    // 이미 주변만 보기 중이면 지금처럼 「더 보기」 안에 둔다
    const docs = docButtons(node);
    const promoteNb = !nbhd && display.nodes.length > EXPLORE.NBHD_PROMOTE_ABOVE;
    const first = [...docs, ...(promoteNb ? nb : [])];
    const nbMore = promoteNb ? [] : nb;
    if (!isOwn(gid)) {
      return el('div', {}, el('div', { class: 'row toolbar' }, draftButton(gid), historyJumpButton(), ...first),
        moreTools([insightButton(gid), insightAllButton(), ...nbMore]),
        el('p', { class: 'muted small' }, '다른 업무 지도의 항목입니다. 고치려면 ',
          el('button', { type: 'button', class: 'link', onclick: () => openUniverse(node.universe_id) }, `「${node.universe_name}」 열기`), '.'));
    }
    if (app.readOnly) {
      return el('div', {}, el('div', { class: 'row toolbar' }, draftButton(gid), historyJumpButton(), ...first),
        moreTools([insightButton(gid), insightAllButton(), ...nbMore]));
    }
    const btn = (label, kind, testid) => el('button', { type: 'button', 'data-testid': testid, onclick: () => { editing = { kind }; renderPanel(); } }, label);
    return el('div', {},
      el('div', { class: 'row toolbar' },
        btn('수정', 'node', 'btn-edit'),
        btn('연결 추가', 'edge', 'btn-edge'),
        btn('이력 추가', 'event', 'btn-event'),
        draftButton(gid),
        historyJumpButton(),
        ...first),
      moreTools([
        node.core_type === 'root' ? null : el('button', { type: 'button', class: 'danger', 'data-testid': 'btn-hide', onclick: () => hideSelected(node) }, '숨기기'),
        node.core_type !== 'root' && app.canDeleteNow(node.id).ok ? el('button', { type: 'button', class: 'danger', 'data-testid': 'btn-delete', onclick: () => deleteSelected(node) }, '삭제') : null,
        insightButton(gid),
        insightAllButton(),
        ...nbMore,
      ]));
  }

  function hideSelected(node) {
    if (!window.confirm(`「${node.label}」${josa(node.label, '을/를')} 숨깁니다. 그래프에서 사라지지만 이력과 근거로서의 내용은 남습니다. 다시 보이게 하려면 업무 지도 개요(아무것도 고르지 않은 화면)의 「숨긴 항목」에서 「되살리기」를 누르세요.`)) return;
    const r = app.hideNode(node.id);
    if (!r.ok) return window.alert(messageFor(r.error));
    afterSave(r, null);
  }

  // 연결·이력이 없는 노드(막 만든 실수 노드)는 바로 지운다. 그 밖의 노드는 숨긴 뒤 「숨긴 노드」 목록에서 완전히 삭제한다(CR-13 D)
  function deleteSelected(node) {
    if (!window.confirm(`「${node.label}」${josa(node.label, '을/를')} 지웁니다. 연결·이력이 없는 항목이라 바로 지워지고 되돌릴 수 없습니다.`)) return;
    const r = app.deleteNodeNow(node.id);
    if (!r.ok) return window.alert(messageFor(r.error));
    afterSave(r, null);
  }

  function linkTools(link) {
    if (app.readOnly || link.synthetic || !isOwn(link.edge_gid)) return null;
    const edgeId = parseGid(link.edge_gid).local_id;
    const title = `${link.relation} ${link.other.label}`;
    return el('div', { class: 'row link-tools' },
      el('button', { type: 'button', class: 'small-btn', title: '관계·상대·기간·메모 고치기', onclick: () => { editing = { kind: 'edge-edit', edgeId, title }; renderPanel(); } }, '연결 수정'),
      el('button', { type: 'button', class: 'small-btn danger', onclick: () => {
        if (!window.confirm(`연결 「${title}」${josa(title, '을/를')} 숨깁니다. 기록은 남습니다.`)) return;
        const r = app.hideEdge(edgeId);
        if (!r.ok) return window.alert(messageFor(r.error, { kind: 'edge' }));
        afterSave(r);
      } }, '숨기기'),
    );
  }

  function editorFor(gid) {
    const node = localNode(gid);
    const cancel = () => { editing = null; renderPanel(); };
    const focusLocal = (id) => { editing = null; focus(toGid(currentId(), id)); };
    switch (editing.kind) {
      case 'node':
        return nodeForm({ mode: 'edit', node, focusField: editing.focus, subtypes: app.subtypes(), onAddSubtype: (t, nm) => app.addSubtype(t, nm), onCancel: cancel, onFocusLocal: focusLocal,
          onSubmit: (values) => afterSave(app.updateNode(currentId(), node.id, values)) });
      case 'edge':
        return edgeForm({ node, subtypes: app.subtypes(), onAddSubtype: (t, nm) => app.addSubtype(t, nm), candidates: ownNodes().filter((n) => n.id !== node.id), onCancel: cancel,
          onSubmit: (values) => afterSave(app.addEdge(values)) });
      case 'edge-edit': {
        const edge = app.findEdge(editing.edgeId);
        return edgeEditForm({ edge, node, candidates: ownNodes(), title: editing.title, onCancel: cancel,
          onSubmit: (values) => afterSave(values.replace ? app.replaceEdge(edge.id, values.input) : app.updateEdge(edge.id, values)) });
      }
      case 'event': {
        const handovers = view.events
          .filter((e) => e.universe_id === currentId() && e.type === 'handover')
          .map((e) => ({ id: e.id, occurred_at: e.occurred_at, text: eventText(view, e) }));
        return eventForm({ node, nodes: ownNodes(), handovers, onCancel: cancel, onSubmit: (values) => {
          // 「이미 끝난 일(해결됨으로 기록)」(D-12): 이슈 메모 + 해결됨 메모를 한 번의 저장으로
          const { also_resolved: alsoResolved, ...input } = values;
          if (!alsoResolved) return afterSave(app.addEvent(input));
          const r = afterSave(app.addMemoResolved(input));
          if (r.ok) $('detail').prepend(el('p', { class: 'ok-notice', role: 'status', 'data-testid': 'past-resolved-done' }, '이슈와 그것을 닫는 해결됨 메모를 함께 남겼습니다 — 미해결에 쌓이지 않습니다.'));
          return r;
        } });
      }
      default:
        return null;
    }
  }

  // 그래프에 없는 노드(접힌 하위 유니버스 안)면 그 유니버스와 위쪽 유니버스를 펼친다. 펼쳤으면 true
  function reveal(gid) {
    const g = view.canonical(gid);
    // 주변만 보기 밖의 노드로 가면 전체 화면으로 돌아간다
    if (nbhd && graph.cy.getElementById(g).empty()) leaveNbhd();
    if (!graph.cy.getElementById(g).empty()) return false;
    const node = view.getNode(g);
    if (!node || node.hidden) return false;
    const parentOf = new Map(view.ref_links.map((l) => [l.child, l.parent]));
    let changed = false;
    for (let u = node.universe_id; u && u !== app.doc.universe.id; u = parentOf.get(u)) {
      if (!expanded.has(u)) {
        expanded.add(u);
        changed = true;
      }
    }
    if (!changed) return false;
    display = projectView(view, { expanded });
    graph.render(display, selected);
    renderLegend();
    applyTime();
    renderExploreStatus(); // 거르기 「n/전체 또렷」 숫자를 펼친 화면에 맞춘다
    graph.relayout();
    tourHook(); // 그래프를 다시 그렸으므로 짚기를 다시 한다
    return true;
  }

  // 초안의 근거를 누르면 패널은 그대로 두고 그래프에서 그 노드를 보여 준다(접혀 있으면 펼친다)
  function showInGraph(gid) {
    const g = view.canonical(gid);
    reveal(g);
    graph.highlight(g);
    const node = graph.cy.getElementById(g);
    if (!node.empty()) graph.cy.animate({ center: { eles: node } }, { duration: 200 });
    if (drafting) evidenceUsed = true; // 따라 하기: 초안의 근거 칩을 눌렀음
    tourHook();
  }

  // 화면 오른쪽 패널을 그린 뒤 따라 하기에 알린다(완료 조건 확인·대상 다시 짚기)
  function renderPanel() {
    renderPanelBody();
    tourHook();
  }

  // 초안 창이 열린 채 다시 그려질 때(노드 추가·수정, 연결, 시간 이동 등) 고른 대상·보내는·받는 사람을 drafting.preset에 적어 둔다.
  // 새 창이 같은 선택으로 열리고, 초안을 한 번 만든 뒤였으면 draft.js가 rerun으로 같은 선택의 초안을 다시 만든다(점검 3회차)
  function keepDraftSelection() {
    const sel = (id) => document.querySelector('#detail [data-testid=' + id + ']');
    if (!drafting || !draftDomLive || !sel('draft-target')) return;
    const val = (id) => { const s = sel(id); return s ? s.value : ''; };
    const nameOf = (gid) => { const n = gid ? view.getNode(gid) : null; return n ? n.label : ''; };
    const k = keepDraftPick(drafting, { target: val('draft-target'), from: val('draft-from'), to: val('draft-to') }, nameOf);
    drafting.target = k.target;
    drafting.preset = k.preset;
  }

  function renderPanelBody() {
    const panel = $('detail');
    if (drafting) keepDraftSelection();
    else draftDomLive = false;
    if (rw && rwPast && !selected) { // 편집 되감기: 시점 막대·목록
      const nodeById = new Map(rwPast.doc.nodes.map((n) => [n.id, n]));
      const nowNode = (id) => app.findNode(id);
      panel.replaceChildren(rewindPanel({
        points: app.editPoints(), at: rw.at, diff: rwPast.diff, limits: rwPast.limits,
        isNode: (id) => nodeById.has(id),
        labelOf: (id) => { const n = nodeById.get(id) || nowNode(id); return n ? (n.deleted ? displayName(n) : n.label) : ''; }, // 완전히 삭제된 자리표시는 화면 이름 「(삭제된 항목)」으로(R15-5)
        gidOf: (id) => toGid(currentId(), id),
        onPick: pickRewind,
        onSelect: (g) => { reveal(g); select(view.canonical(g)); },
      }));
      return;
    }
    // 다른 화면(설정·통합 확인·이슈·인사이트·초안)이 열리면 숨긴 노드 목록은 닫는다
    if (settingsOpen || merging || issues || insight || drafting) hiddenOpen = false;
    if (hiddenOpen) {
      const labelOf = (id) => (app.findNode(id) || { label: '' }).label;
      panel.replaceChildren(hiddenPanel({
        nodes: hiddenNodesOf(app.doc), readOnly: app.readOnly, labelOf,
        onClose: closeSidePanel,
        // 완전히 삭제: 되돌릴 수 없으므로 확인을 받는다. 지운 뒤에도 목록을 연 채로 둔다(남은 숨긴 노드를 이어서 정리)
        onPurge: (id) => {
          const node = app.findNode(id);
          const n = hiddenNodesOf(app.doc).find((h) => h.id === id);
          const label = node ? node.label : '';
          const msg = app.canDeleteNow(id).ok
            ? `「${label}」${josa(label, '을/를')} 완전히 지웁니다. 연결·이력이 없는 항목이라 되돌릴 수 없습니다.`
            : `「${label}」${josa(label, '을/를')} 완전히 지웁니다. 연결 ${n ? n.edge_count : 0}개도 함께 지워지고 되돌릴 수 없습니다. 이 항목을 언급한 이력은 남고 「(삭제된 항목)」으로 보입니다.`;
          if (!window.confirm(msg)) return { ok: true, cancelled: true };
          const r = app.purgeNode(id);
          if (r.ok) afterSave(r, selected);
          return r;
        },
        // 되살리면 그 노드를 고른 상태로 연다(연결·이력이 바로 보인다). 같은 이름의 노드가 있으면 E-DUP로 거부된다
        onRestore: (id) => {
          const r = app.restoreNode(id);
          if (r.ok) {
            hiddenOpen = false;
            afterSave(r, toGid(currentId(), id));
          }
          return r;
        },
      }));
      focusClose('hidden-close');
      return;
    }
    if (settingsOpen) {
      panel.replaceChildren(settingsPanel({
        current: settings.provider,
        persisted: !!storage,
        authorName: settings.authorName || '',
        onAuthorName: (v) => {
          const name = cleanAuthorName(v);
          if (name) settings.authorName = name;
          else delete settings.authorName;
          saveSettings(storage, settings);
        },
        showCheckTools: CHECK_MODE,
        onChange: (name) => {
          settings.provider = name;
          provider = makeProvider();
          saveSettings(storage, settings);
          renderSettingsButton();
        },
        apiKey: settings.apiKey || '',
        llmModel: settings.llmModel || '',
        onApiKey: (v) => {
          const key = cleanApiKey(v);
          if (key) settings.apiKey = key;
          else {
            delete settings.apiKey;
            llmCache.clear(); // 키 칸을 비워 지워도 「키 지우기」와 같이 응답 캐시를 남기지 않는다(R10-12)
          }
          provider = makeProvider();
          saveSettings(storage, settings);
          renderSettingsButton();
        },
        onLlmModel: (v) => {
          const model = cleanLlmModel(v);
          if (model) settings.llmModel = model;
          else delete settings.llmModel;
          provider = makeProvider();
          saveSettings(storage, settings);
        },
        onClearKey: () => {
          delete settings.apiKey;
          llmCache.clear();
          provider = makeProvider();
          saveSettings(storage, settings);
          renderSettingsButton();
        },
        onClose: () => { settingsOpen = false; renderPanel(); },
      }));
      return;
    }
    if (merging) {
      const plan = app.mergePlan();
      if (plan) {
        panel.replaceChildren(mergePanel({
          view, plan, links: app.doc.identity_links || [], provider, readOnly: app.readOnly,
          onDecide: (item, status) => {
            const r = app.decideIdentity({ a: item.a, b: item.b, kind: item.kind, status, reason: item.reason, score: item.score });
            if (!r.ok) return window.alert(messageFor(r.error));
            refresh();
          },
          onApplyAuto: () => {
            const r = app.applyAutoLinks();
            if (!r.ok) return window.alert(messageFor(r.error));
            refresh();
          },
          onFocus: showInGraph,
          onClose: () => { merging = false; renderPanel(); graph.highlight(selected); },
        }));
        return;
      }
      merging = false;
    }
    if (issues) {
      panel.replaceChildren(issuePanel({
        view, targetGid: issues.target, rootGid: app.rootGid(), universeId: app.doc.universe.id, readOnly: app.readOnly,
        onFocus: showInGraph,
        onClose: closeSidePanel,
        // 해결 표시는 메모가 있는 유니버스 문서에 저장한다(묶음 화면의 하위 유니버스 메모 포함). 이미 닫힌 메모면 아무것도 더하지 않는다
        onResolve: (gid, note) => {
          const r = app.resolveMemo(gid, todayLocal(), note);
          if (r.ok || (r.error && r.error.already_resolved)) refresh();
          return r;
        },
      }));
      focusClose('issue-close');
      return;
    }
    if (insight) {
      panel.replaceChildren(insightPanel({ view, provider, mapName: app.doc.universe.name, baseline: riskPick().base, baselineToday: riskPick().savedToday, work: insight.work, kind: insight.kind, asOf: asOf(), today: todayLocal(), onTime: setViewDate, onKind: (k) => { insight.kind = k; tourHook(); }, onWork: (w) => { insight.work = w; }, onFocus: showInGraph, onClose: closeSidePanel }));
      focusClose('insight-close');
      return;
    }
    if (drafting) {
      // 기록도 화면 조건도 그대로인 다시 그리기(예: 주변만 보기 중 그 밖 노드의 근거 칩 → 전체 보기로 돌아옴)는 초안 창을 그대로 둔다 —
      // 결과·근거 글 한 줄·스크롤 위치가 사라지지 않게(R11-5). 기록이 바뀐 때만 창을 다시 그리고, 만든 초안이 있었으면 같은 선택으로 다시 만든다
      const records = { doc: app.doc, rw: rw ? rw.at : null, nodes: view.nodes.length, edges: view.edges.length, events: view.events.length };
      const shell = { viewDate, readOnly: app.readOnly, provider, today: todayLocal() };
      if (draftDomLive && panel.querySelector('.draft') && sameMark(draftRecords, records) && sameMark(draftShell, shell)) return;
      const recordsChanged = !sameMark(draftRecords, records);
      draftRecords = records;
      draftShell = shell;
      panel.replaceChildren(draftPanel({ seenStorage: storage, view, provider, target: drafting.target, preset: drafting.preset || (tour ? tour.preset() : undefined), rerun: draftShown, rerunNote: recordsChanged, onDraft: () => { draftShown = true; tourHook(); }, asOf: todayLocal(), viewDate, readOnly: app.readOnly, onFocus: showInGraph, onClose: () => { drafting = null; renderPanel(); graph.highlight(selected); },
        // 확정(R-03 ③, CR-8): 저장되면 초안 화면을 닫고 새 인수인계서를 연다
        onConfirm: (input) => {
          const r = app.confirmHandover(input);
          if (!r.ok) return r;
          drafting = null;
          const saved = afterSave(r, r.artifact);
          // 확정 직후(여섯 번째 검토 U-3): 초안 화면의 스크롤이 남지 않게 패널 맨 위로 올리고, 무엇이 생겼는지 한 줄로 알리며, 새 인수인계서를 그래프 가운데로 옮긴다
          const node = view.getNode(r.artifact);
          const wlabel = r.works.map((w) => (view.getNode(w) || { label: w }).label).join('·');
          const alabel = node ? node.label : '인수인계서';
          // 담당 넘김 여부(CR-18-6): 켜고 확정했으면 무엇을 넘겼는지, 껐으면 예전처럼 직접 넘기는 방법
          const nameOf = (g) => (view.getNode(g) || { label: g }).label;
          const listOf = (ws) => ws.map((w) => `「${nameOf(w)}」`).join('·');
          const tr = r.transfer;
          const handoverTail = !tr
            ? '현재 담당은 그대로입니다 — 담당을 넘기려면 업무를 누르고 「연결된 항목」에서 보내는 사람의 「수행」 줄 옆 「연결 수정」으로 끝 날짜를 넣고, 받는 사람은 「연결 추가」에서 「수행」으로 이으세요.'
            : [
              tr.moved.length
                ? `담당도 넘겼습니다: ${tr.moved.map((w) => `「${nameOf(w)}」 ${nameOf(input.draft.from)} → ${nameOf(input.draft.to)}(오늘부터)`).join(' · ')}`
                : '담당은 넘기지 않았습니다(넘길 업무가 없었습니다).',
              tr.already.length ? `받는 사람이 이미 맡고 있어 건너뜀: ${listOf(tr.already)}` : '',
              tr.elsewhere.length ? `다른 업무 지도의 연결이라 넘기지 못함: ${listOf(tr.elsewhere)}` : '',
            ].filter(Boolean).join(' · ');
          $('detail').prepend(el('p', { class: 'ok-notice', role: 'status', 'data-testid': 'confirm-done' }, `인수인계서로 저장했습니다 — 「${alabel}」${josa(alabel, '이/가')} 「${wlabel}」의 산출물과 이력에 남았습니다. ${handoverTail}`));
          $('detail').parentElement.scrollTop = 0;
          graph.zoomTo(view.canonical(r.artifact));
          return saved;
        } }));
      draftDomLive = true;
      return;
    }
    if (!selected) {
      const summary = describeUniverse(view);
      // 묶은 지도(하위 유니버스가 있는 꼭지)만 위험 요약 한 줄(FU-10). 인사이트 탭과 같은 기준일·같은 밀집 기준의 같은 계산이다
      const grouped = (view.ref_links || []).length > 0;
      const riskNums = grouped ? teamRiskSummary(view, { asOf: asOf(), n: currentDenseN() }) : null;
      // 이름 목록(FU5-1): 저장할 때 같이 남기고 지난 점검과 비교한다. 숫자와 같은 기준일·밀집 기준의 같은 계산이라 숫자와 어긋나지 않는다
      // owners(M6): 업무별 지금 담당 이름. 기준에 함께 저장하고 「담당이 바뀐 업무」를 가린다
      const riskNames = grouped ? { ...namesFromInspection(inspectionInput(view, { asOf: asOf(), n: currentDenseN(), mapName: '' })), owners: currentOwnersByWork(view, asOf()) } : null;
      const riskSummary = grouped ? { parts: teamRiskParts(riskNums), onMore: () => openInsight('', 'risk'), compare: riskCompareFor(riskNums, riskNames) } : null;
      renderUniverseSummary(panel, summary, display.nodes.length, { split: splitHint(app.doc), starter: starterSteps(app.doc, view), onOpenFolder: folder && folder.state.supported && !rw && !app.readOnly ? openFolderTab : null, riskSummary, universeId: app.doc.universe.id, onSelect: (g) => { reveal(g); select(view.canonical(g)); } });
      // 꼭지만 있으면 「노드 추가」를 펼쳐 둔다(검토5 U-5). 안내 문구(detail.js)와 같은 기준: 하위 유니버스를 묶은 화면은 노드가 있으므로 건드리지 않는다
      if (summary.node_total <= 1 && !app.readOnly) document.querySelector('details.add').open = true;
      const rootGid = app.rootGid();
      panel.append(...[issueEntry(view, app.rootGid(), { rootGid: app.rootGid(), onOpen: () => openIssues(app.rootGid()) }),
        hiddenEntry(hiddenNodesOf(app.doc), { onOpen: () => { rememberOpener(); hiddenOpen = true; renderPanel(); } }),
        // 묶은 지도에서는 되감기를 쓰지 않는다(D-30) — 입구가 통째로 사라져 헷갈리지 않게 글로 추가처럼 안내 한 줄
        app.rewindAvailable() ? rewindEntry({ points: app.editPoints(), onOpen: enterRewind }) : el('p', { class: 'muted small', 'data-testid': 'rewind-grouped-note' }, '편집 되감기: 묶은 지도에서는 쓸 수 없습니다 — 팀·업무 지도를 열어 되감으세요'),
        el('div', { class: 'row' },
        el('button', { type: 'button', class: 'primary', 'data-testid': 'btn-draft-universe', onclick: () => openDraft(rootGid) }, '인수인계 초안 만들기'),
        el('button', { type: 'button', 'data-testid': 'btn-insight-universe', onclick: () => openInsight('', 'risk') }, '인사이트 보기')),
        weeklyBox(),
        mergeButton(),
        folderEntry(),
        el('p', { class: 'muted small', 'data-testid': 'insight-hint' }, '인사이트(인수인계 위험 탭부터 열림): 인수인계 위험(혼자만 아는 업무, 준비도, 파급 영향) · 유사 경험자 · 반복 비효율 · 밀집·공백(일이 몰린 사람, 담당자 없는 업무) · 흐름 변화')].filter(Boolean)); // append(null)은 "null" 글자를 넣으므로 거른다
      return;
    }
    if (editing && isOwn(selected) && localNode(selected)) {
      const form = editorFor(selected);
      panel.replaceChildren(el('h2', {}, localNode(selected).label), form);
      if (form && form.focusStart) form.focusStart(); // 표준 양식의 빈 항목을 눌러 열었으면 그 칸에 초점(FU-16)
      return;
    }
    const selNode = view.getNode(selected);
    const rootWeekly = selNode && selNode.core_type === 'root' && isOwn(selected) ? weeklyBox() : null; // 지도 중심 상세의 「이번 주 기록」(D-10)
    const notes = [loadNote(selected), soloWorksNote(selected), backupNote(selected), workNote(selected), issueNote(selected), formNote(selected), collabBox(selected), assigneeBox(selected), repeatNote(selected), riskNote(selected), rootWeekly].filter(Boolean);
    const tools = toolbar(selected);
    const detail = renderNodeDetail(panel, describeNode(view, selected, { asOf: asOf(), past: !!viewDate }), {
      onFocus: focus,
      extra: layerControls(selected),
      toolbar: notes.length || tools ? el('div', {}, ...[...notes, tools].filter(Boolean)) : null,
      linkTools,
    });
    if (rw && rwPast) { // 편집 되감기: 그때 값임을 알리고, 지금과 다른 칸을 보인다
      const local = isOwn(selected) ? parseGid(selected).local_id : null;
      const change = local ? rwPast.diff.changed.find((c) => c.id === local && c.kind === 'node') || (rwPast.diff.hidden.includes(local) ? { fields: ['hidden'] } : null) : null;
      const note = change ? nodeChangeNote({ change, pastNode: rwPast.doc.nodes.find((n) => n.id === local), currentNode: app.findNode(local) }) : null;
      panel.prepend(...[el('button', { type: 'button', class: 'small-btn', 'data-testid': 'btn-rewind-list', onclick: () => select(null) }, '← 시점 목록으로'), note].filter(Boolean));
    } else {
      // 노드를 고르면 지도 전체 화면(「인수인계 초안 만들기」·「인사이트 보기」)이 사라지므로 맨 위에서 돌아갈 수 있게 한다(FU-6). Esc와 같은 동작: 선택만 푼다
      panel.prepend(el('div', { class: 'detail-back' }, el('button', { type: 'button', class: 'small-btn', 'data-testid': 'detail-back-universe', title: '항목 선택을 풀고 지도 전체 화면으로 돌아갑니다(Esc와 같음)', onclick: () => select(null) }, '← 지도 전체 보기')));
    }
    return detail;
  }

  function select(gid) {
    if (gid !== selected) { editing = null; baselineNote = ''; }
    settingsOpen = false;
    merging = false;
    drafting = null;
    insight = null;
    issues = null;
    hiddenOpen = false;
    selected = gid;
    graph.highlight(gid);
    renderPanel();
    if (exploreNote) { // 「찾음」·「이어진 항목 없음」 알림은 다른 항목을 고르면 지운다
      exploreNote = null;
      renderExploreStatus();
    }
  }

  // 상세 패널의 연결된 노드를 눌렀을 때: 그래프에서도 그 노드로 이동한다(접혀 있으면 펼친다)
  function focus(gid) {
    reveal(gid);
    select(view.canonical(gid));
    const node = graph.cy.getElementById(view.canonical(gid));
    if (!node.empty()) graph.cy.animate({ center: { eles: node } }, { duration: 200 });
  }

  // ── 시간 슬라이더(02-design 탐색 화면, R-14) ──
  // 고른 달의 마지막 날(이번 달이면 오늘, 고르지 않으면 오늘)을 기준일로, 그때 유효하지 않은 담당·소속 연결은 그래프에서 빼고
  // 기간 밖의 노드, 그때 맡은 일이 없는 사람은 흐리게 한다(D7, 사용자 2026-10-25 "진행" — 끝난 선이 남아 정신없음).
  // 선만 빼고 이력·연결 데이터는 그대로다(상세의 연결 목록·이력에 기간과 함께 보인다). 상세·인사이트·초안도 같은 기준일을 쓴다.
  function timeOffIds() {
    const D = viewDate || todayLocal();
    const off = [];
    const shown = new Set(display.nodes.map((n) => n.gid));
    for (const e of display.edges) {
      // 여러 연결을 하나로 모은 것(count > 1)은 기간이 하나가 아니라 흐리지 않는다
      if (e.synthetic || e.count > 1 || !['performs', 'belongs_to'].includes(e.core_type)) continue;
      if (periodStatus(e.period, D) !== 'current') off.push(e.gid);
    }
    for (const n of display.nodes) {
      if (n.period && periodStatus(n.period, D) !== 'current') { off.push(n.gid); continue; }
      if (n.core_type !== 'person') continue;
      const mine = view.edges.filter((e) => !e.hidden && e.core_type === 'performs' && e.source === n.gid);
      if (mine.length && !mine.some((e) => periodStatus(e.period, D) === 'current')) off.push(n.gid);
    }
    return off.filter((id) => shown.has(id) || display.edges.some((e) => e.gid === id));
  }

  function applyTime() {
    renderTimebar();
    graph.setTimeOff(timeOffIds());
  }

  function setViewDate(date) {
    const today = todayLocal();
    viewDate = date && date < today ? date : null;
    applyTime();
    // 초안(오늘 기준)과 편집 양식은 기준일과 무관하니 입력을 지우지 않도록 다시 그리지 않는다(검토3 UI-3)
    if (drafting || editing || settingsOpen || merging) return;
    renderPanel();
  }

  // 막대 요소는 한 번만 만들고 값만 바꾼다. 다시 만들면 끌던 슬라이더가 DOM에서 빠져 끌기·화살표 키가 끊긴다(검토3 UI-1)
  let tb = null;
  let tbMonths = [];
  function renderTimebar() {
    const bar = $('timebar');
    const today = todayLocal();
    tbMonths = timeMonths(view, today);
    if (!tb) {
      const range = el('input', { type: 'range', min: '0', step: '1', 'data-testid': 'time-range', 'aria-label': '기준 달' });
      range.addEventListener('input', () => {
        const i = Number(range.value);
        setViewDate(i === tbMonths.length - 1 ? null : monthAsOf(tbMonths[i], todayLocal()));
      });
      tb = {
        range,
        first: el('span', { class: 'muted small' }),
        last: el('span', { class: 'muted small' }),
        when: el('span', { class: 'when', 'data-testid': 'time-when' }),
        today: el('button', { type: 'button', class: 'small-btn', 'data-testid': 'time-today', onclick: () => setViewDate(null) }, '오늘로'),
        note: el('span', { class: 'small' }, '이 날짜에 유효하지 않은 담당·소속 선은 빠지고 사람·조직은 흐리게 보입니다. 상세·인사이트도 이 날짜 기준(초안은 오늘 기준)'),
      };
      bar.replaceChildren(el('span', {}, '시간 보기'), tb.first, tb.range, tb.last, tb.when, tb.today, tb.note);
    }
    // 이력 기간이 한 달뿐이면 끌 곳이 없으므로 막대와 양끝 달을 숨기고 글로만 알린다(검토5 U-10)
    const single = tbMonths.length <= 1;
    tb.range.hidden = single;
    tb.first.hidden = single;
    tb.last.hidden = single;
    const current = viewDate ? tbMonths.indexOf(viewDate.slice(0, 7)) : tbMonths.length - 1;
    tb.range.max = String(tbMonths.length - 1);
    const want = String(current < 0 ? tbMonths.length - 1 : current);
    if (tb.range.value !== want) tb.range.value = want;
    tb.first.textContent = tbMonths[0];
    tb.last.textContent = tbMonths[tbMonths.length - 1];
    tb.when.textContent = viewDate ? `${viewDate} 기준` : single ? `이력 기간 1개월(${tbMonths[0]}) · 오늘(${today})` : `오늘(${today})`;
    tb.today.hidden = !viewDate;
    tb.note.hidden = !viewDate;
    bar.classList.toggle('past', !!viewDate);
    graph.cy.resize(); // 막대 높이가 바뀌면 그래프 영역도 바뀐다
  }

  // ── 큰 화면 탐색: 찾기·거르기·주변만 보기(T-18, R-17, D-17). 계산은 view/explore.js, 여기서는 화면만 바꾼다 ──
  const bar = exploreBar({
    container: $('explore-bar'),
    advanced: $('tools-more'), // 거르기는 「도구 더 보기」 줄로(CR-13 A). 「설명·속성까지」는 찾기 칸 옆
    search: (q, opts) => searchNodes(view, q, opts),
    onPick: goTo,
    types: (chosen) => legendItems(display, chosen).filter((t) => t.key !== 'root' && t.key !== 'unknown'),
    // 고른 사람이 지금 화면에 없어도(접기·주변만 보기·숨김 뒤) 목록에 남겨 풀 수 있게 한다(C-11)
    persons: (chosen) => {
      const list = personsIn(display);
      if (chosen && !list.some((p) => p.gid === chosen)) list.push({ gid: chosen, label: `${(view.getNode(chosen) || { label: chosen }).label} (지금 화면에 없음)` });
      return list;
    },
    onFilter: (f) => {
      filterState = f;
      exploreNote = null;
      renderExploreStatus(); // 상태 줄 높이를 먼저 바꾼 뒤 맞춘다
      graph.applyFilter();
      graph.highlight(selected);
    },
  });

  // 찾은 노드로 이동(R-17 ①②⑧): 주변만 보기 중이면 전체로, 접힌 하위 유니버스 안이면 펼친 뒤 가운데로·확대하고 상세를 연다.
  // 키보드로 고른 경우 상세 패널 제목으로 초점을 옮겨 Tab으로 이어서 읽을 수 있게 한다
  function goTo(gid) {
    const g = view.canonical(gid);
    foundGid = g; // 따라 하기: 항목 찾기로 골랐음(select가 화면을 그리며 알리므로 먼저 둔다)
    reveal(g);
    select(g);
    exploreNote = { text: `찾음: 「${(view.getNode(g) || { label: g }).label}」` };
    renderExploreStatus(); // 상태 줄 높이를 먼저 바꾼 뒤 가운데로 옮긴다
    graph.zoomTo(g);
    const h = $('detail').querySelector('h2');
    if (h) {
      h.tabIndex = -1;
      h.focus({ preventScroll: true });
    }
  }

  function enterNbhd(gid, depth) {
    const d = neighborhoodDisplay(view, gid, depth);
    if (!d) return;
    if (d.neighbor_count === 0) {
      // 이웃이 없으면 화면은 그대로 두고 알린다(R-17 ④)
      exploreNote = { text: `이어진 항목 없음: 「${view.getNode(gid).label}」${josa(view.getNode(gid).label, '은/는')} 연결된 항목이 없어 주변만 보기를 할 수 없습니다.`, warn: true };
      return renderExploreStatus();
    }
    nbhd = { center: d.center, depth };
    selected = d.center;
    exploreNote = null;
    refresh();
    graph.relayout();
  }

  function leaveNbhd() {
    if (!nbhd) return;
    nbhd = null;
    exploreNote = null;
    refresh();
    graph.relayout();
  }

  function nbhdButtons(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden) return null;
    const on = nbhd && nbhd.center === view.canonical(gid);
    return [on && nbhd.depth === 1 ? null : el('button', { type: 'button', 'data-testid': 'btn-nbhd', title: '이 항목과 바로 이어진 항목만 남겨 다시 배치합니다(데이터는 바뀌지 않음)', onclick: () => enterNbhd(gid, 1) }, '주변만 보기'),
        on && nbhd.depth === 2 ? null : el('button', { type: 'button', 'data-testid': 'btn-nbhd2', title: '두 단계 떨어진 항목까지 남깁니다', onclick: () => enterNbhd(gid, 2) }, '주변 2단계'),
        nbhd ? el('button', { type: 'button', 'data-testid': 'btn-nbhd-exit', onclick: leaveNbhd }, '전체 보기로') : null].filter(Boolean);
  }

  function renderExploreStatus() {
    const parts = [];
    const f = filterDisplay(display, filterState);
    if (f) {
      const names = filterState.types.map((t) => (legendItems(display, filterState.types).find((i) => i.key === t) || { label: t }).label);
      const who = filterState.person ? (view.getNode(filterState.person) || { label: '?' }).label : null;
      parts.push(el('span', { class: 'grp' }, el('span', { class: 'on', 'data-testid': 'filter-on' }, `거르기 중: ${[names.length ? names.join('·') : null, who ? `${who}의 담당 업무(지난 담당 포함)` : null].filter(Boolean).join(' / ')} — ${f.shown}/${f.total}개 또렷`),
        el('button', { type: 'button', class: 'small-btn', 'data-testid': 'filter-clear', onclick: () => bar.clear() }, '거르기 풀기')));
    }
    if (nbhd) {
      parts.push(el('span', { class: 'grp' }, el('span', { class: 'on', 'data-testid': 'nbhd-on' }, `주변만 보기: 「${(view.getNode(nbhd.center) || { label: '?' }).label}」 ${nbhd.depth}단계 — 항목 ${display.nodes.length}개`),
        el('button', { type: 'button', class: 'small-btn', 'data-testid': 'nbhd-depth', onclick: () => enterNbhd(nbhd.center, nbhd.depth === 1 ? 2 : 1) }, nbhd.depth === 1 ? '2단계로' : '1단계로'),
        el('button', { type: 'button', class: 'small-btn', 'data-testid': 'nbhd-exit', onclick: leaveNbhd }, '전체 보기로')));
    }
    if (exploreNote) parts.push(el('span', { class: exploreNote.warn ? 'on' : 'ok', 'data-testid': exploreNote.testid || 'explore-note', role: 'status' }, exploreNote.text));
    bar.setStatus(...parts);
    graph.cy.resize(); // 상태 줄이 두 줄이 되면 그래프 영역 높이가 바뀐다
  }

  // ── 편집 되감기(CR-14 A, R-25): 옛 시점의 지도를 읽기 전용으로 보고, 필요하면 그 시점으로 되돌린다 ──
  // 지금과 달라진 노드(바뀜·그 뒤 숨김)를 그래프에서 표시할 전역 ID
  function rwMarkGids() {
    if (!rw || !rwPast) return [];
    const nodeIds = new Set(rwPast.doc.nodes.map((n) => n.id));
    const ids = [...rwPast.diff.changed.filter((c) => c.kind === 'node').map((c) => c.id), ...rwPast.diff.hidden].filter((id) => nodeIds.has(id));
    return ids.map((id) => toGid(currentId(), id));
  }

  // 머리 띠(그래프 위): 시점·숫자·「이 시점으로 되돌리기」·「지금으로 돌아가기」
  function renderRewindBand() {
    const band = $('rewind-band');
    if (!rw || !rwPast) return hideBand(band);
    const pv = app.rewindPreview(rw.at);
    const reason = revertBlock({ baseReadOnly: app.baseReadOnly, nothing: !pv.ok || pv.ops.length === 0 });
    fillBand(band, { at: rw.at, diff: rwPast.diff, canRevert: !reason, reason, onRevert: revertRewind, onBack: leaveRewind, labelOf: pointLabeler(app.editPoints()) });
  }

  // 되감기를 켜고 끌 때 한 번: 편집으로 이어지는 머리 단추와 노드 추가 칸을 읽기 전용 상태에 맞춘다
  function syncRewindShell() {
    document.body.classList.toggle('rewinding', !!rw);
    $('create-open').disabled = !!rw || app.baseReadOnly;
    $('group-open').disabled = !!rw || app.baseReadOnly;
    renderAddForm();
  }

  function enterRewind() {
    const points = app.editPoints();
    if (!app.rewindAvailable() || points.length < 2) return;
    rwGraphSnap = graph.snapshot(); // FU5-7: 나올 때 이 배치·배율로 되돌린다
    nbhd = null;
    editing = null;
    drafting = null;
    insight = null;
    issues = null;
    hiddenOpen = false;
    merging = false;
    settingsOpen = false;
    selected = null;
    rw = { at: points[points.length - 2].at };
    app.setRewinding(true);
    syncRewindShell();
    refresh();
    graph.relayout();
  }

  function pickRewind(at) {
    if (!rw) return;
    rw.at = at;
    refresh();
  }

  function leaveRewind() {
    rw = null;
    rwPast = null;
    app.setRewinding(false);
    syncRewindShell();
    refresh();
    graph.restore(rwGraphSnap); // FU5-7: 들어가기 전 배치·배율(그 사이 생긴 항목은 render가 놓은 자리 그대로)
    rwGraphSnap = null;
  }

  function revertRewind() {
    if (!rw) return;
    const at = rw.at;
    const labelOf = pointLabeler(app.editPoints()); // 같은 분의 시점은 초까지 보인다(되돌리면 시점이 늘어나므로 되돌리기 전에 만든다)
    const pv = app.rewindPreview(at);
    if (!pv.ok || !pv.ops.length) return window.alert(failText({ nothing: true }));
    if (!window.confirm(confirmText(pv, at, labelOf))) return;
    const r = app.rewindTo(at);
    if (!r.ok) return window.alert(failText(r.error));
    rwGraphSnap = null; // 되돌리면 지도 내용이 바뀌므로 들어가기 전 배치로 돌리지 않는다
    rw = null;
    rwPast = null;
    app.setRewinding(false);
    selected = null;
    syncRewindShell();
    refresh();
    $('detail').prepend(el('p', { class: 'ok-notice', role: 'status', 'data-testid': 'rewind-done' }, doneText(at, r.counts, (r.skipped || []).length, labelOf)));
  }

  // 「노드 추가」 양식은 한 번 그려 두고 쓰므로, 화면이 바뀔 때마다 「함께 이을 노드」 목록만 지금 이름으로 다시 만든다(점검 3회차)
  function refreshAddCandidates() {
    const slot = $('add-slot');
    const form = slot ? slot.querySelector('[data-testid=node-form-add]') : null;
    if (form && typeof form.refreshCandidates === 'function') form.refreshCandidates();
  }

  function refresh() {
    if (rw) {
      rwPast = app.viewAt(rw.at);
      if (!rwPast.ok) { // 시점을 읽지 못하면 되감기를 끝낸다
        rw = null;
        rwPast = null;
        app.setRewinding(false);
        syncRewindShell();
      }
    }
    view = rw ? rwPast.view : app.view;
    if (rw && selected && !view.getNode(selected)) selected = null; // 그 시점에 없던 항목
    renderRewindBand();
    // 주변만 보기 중이면 그 노드와 이웃만. 가운데 노드가 사라졌거나(숨김) 고른 노드가 주변 밖이면(주변 밖에 노드 추가 등) 전체로 돌아가 다시 배치한다
    let nd = nbhd ? neighborhoodDisplay(view, nbhd.center, nbhd.depth) : null;
    if (nd && selected && !nd.nodes.some((n) => n.gid === view.canonical(selected))) nd = null;
    if (nd && nd.neighbor_count === 0) { // 이웃을 숨겨 혼자 남으면 들어갈 때(이어진 항목 없음)와 같은 규칙으로 전체로
      nd = null;
      exploreNote = { text: '이어진 항목이 없어져 전체 그래프로 돌아갔습니다.', warn: true };
    }
    const left = !!nbhd && !nd;
    if (left) nbhd = null;
    if (nbhd) nbhd.center = nd.center; // 통합 확인으로 가운데 항목이 다른 항목에 합쳐지면 대표 ID로
    display = nd || projectView(view, { expanded });
    // 시간 막대를 먼저 그려 그래프 영역 높이가 정해진 뒤 배치·맞춤을 한다(아래쪽 노드가 잘리지 않게)
    renderTimebar();
    renderExploreStatus();
    graph.render(display, selected);
    graph.setRewindMarks(rwMarkGids());
    renderLegend();
    graph.setTimeOff(timeOffIds());
    refreshAddCandidates();
    renderPanel();
    showBackupNudge(); // 변경이 쌓일 때마다 기준을 다시 본다
    if (left) graph.relayout(); // 주변만 보기의 고리 배치를 그대로 두면 나머지 항목이 한 줄로 쌓인다
  }

  function toggle(universeId) {
    if (universeId === app.doc.universe.id) return;
    nbhd = null; // 주변만 보기 중 펼치기·접기(더블클릭 포함)는 전체 그래프에서 한다
    const opening = !expanded.has(universeId);
    if (opening) expanded.add(universeId);
    else expanded.delete(universeId);
    exploreNote = null; // 앞선 안내(펼침·찾음)는 다음 조작 때 사라진다
    if (opening) {
      // CR-18-1: 펼친 묶음 안에 접힌 묶음이 또 있으면 한 겹씩 펼쳐진다고 알린다
      const inner = foldedInside(view, projectView(view, { expanded }), universeId);
      if (inner.length) {
        const name = (view.universes.get(universeId) || { name: universeId }).name;
        const note = { text: `「${name}」${josa(name, '을/를')} 펼쳤습니다. 안에 접힌 묶음 ${inner.length}개가 더 있습니다(＋숫자 — 두 번 누르면 한 겹씩 펼침)`, testid: 'expand-note' };
        exploreNote = note;
        setTimeout(() => {
          if (exploreNote !== note) return;
          exploreNote = null;
          renderExploreStatus();
        }, EXPLORE.EXPAND_NOTE_MS);
      }
    }
    refresh();
    graph.relayout();
  }

  function removeChild(childId, label) {
    if (!window.confirm(`「${label}」${josa(label, '을/를')} 이 묶음에서 뺍니다. 원래 업무 지도는 그대로 남습니다.`)) return;
    const r = app.removeChild(childId);
    if (!r.ok) return window.alert(messageFor(r.error));
    expanded.delete(childId);
    selected = null;
    refresh();
    graph.relayout();
  }

  // 「전체 보기」: 주변만 보기 중이면 전체 그래프로 돌아가고(R-17 ④), 아니면 화면에 맞춘다
  // 원인(FU5-6): 항목을 하나 고르면(접힌 묶음을 눌러 펼칠 때도 그 항목이 선택됨) 그 항목과 이웃만 또렷하고 나머지는 흐려지는데, 「전체 보기」는 화면 배율만 맞추고
  // 선택을 풀지 않아 흐림이 남았다. 「전체 보기」는 이름대로 전체가 또렷이 보이게 선택도 푼다(Esc·「← 지도 전체 보기」와 같은 동작).
  // 편집 양식·초안·통합·인사이트·설정 등 패널 작업이 열려 있으면 그 작업이 사라지지 않게 배율만 맞춘다(선택 강조는 작업을 닫으면 풀 수 있다)
  $('fit').addEventListener('click', () => {
    if (nbhd) { leaveNbhd(); return; }
    if (selected && !rw && !editing && !drafting && !merging && !settingsOpen && !insight && !issues && !hiddenOpen) select(null);
    graph.fit();
  });

  // Esc: 노드 선택 해제(R-17 ⑧). 입력 칸·대화상자·펼친 메뉴 안에서는 그쪽이 먼저 처리한다(찾기 칸은 stopPropagation)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target;
    if (t && (t.closest('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    // Esc는 노드 상세에서만 선택을 푼다. 편집 양식·초안은 입력이, 통합 확인·인사이트·설정은 고른 탭·작업이 사라지므로
    // Esc로 닫지 않는다(각 화면의 「취소」·「닫기」를 쓴다. 검토: 선택 여부에 따라 같은 패널이 닫히기도 하던 불일치)
    // 미해결·숨긴 노드·인사이트 패널은 Esc로 닫고 연 단추로 돌아간다(U-3)
    if (closeSidePanel()) return;
    if (!selected || editing || drafting || merging || settingsOpen) return;
    select(null);
  });
  $('relayout').addEventListener('click', () => graph.relayout());
  $('flowlayout').addEventListener('click', () => graph.flowLayout());

  // 패널 넓게 보기(U-5): 눌러서 바꾸고, 그래프 영역이 줄거나 늘면 화면에 다시 맞춘다. 저장하지 않는다
  const wideBtn = $('wide-toggle');
  const panelMain = document.querySelector('main');
  const panelAside = document.querySelector('aside');
  const resizer = $('panel-resizer');
  const narrowMq = window.matchMedia('(max-width: 800px)');
  // 패널 폭(끌기 손잡이): 저장값(settings.panelWidth)은 그대로 두고 화면에서만 범위로 자른다. 넓게 보기·세로 배치에서는 인라인 폭을 쓰지 않는다
  const applyPanelWidth = () => {
    const free = !narrowMq.matches && !panelMain.classList.contains('wide');
    panelAside.style.width = free && settings.panelWidth ? `${clampPanelWidth(settings.panelWidth, window.innerWidth)}px` : '';
    resizer.setAttribute('aria-valuemin', String(PANEL.MIN));
    resizer.setAttribute('aria-valuemax', String(maxPanelWidth(window.innerWidth)));
    resizer.setAttribute('aria-valuenow', String(Math.round(panelAside.getBoundingClientRect().width)));
  };
  const setWide = (on) => {
    panelMain.classList.toggle('wide', on);
    wideBtn.setAttribute('aria-pressed', String(on));
    wideBtn.textContent = on ? '패널 좁게 보기' : '패널 넓게 보기';
  };
  const savePanelWidth = (w) => {
    if (w == null) delete settings.panelWidth;
    else settings.panelWidth = w;
    saveSettings(storage, settings); // 저장소가 없거나 실패하면 조용히 건너뛴다(이번 화면에서만 유지)
  };
  // 패널 폭이 바뀌면 그래프 영역이 좁아지거나 넓어진다. cy.resize()는 캔버스 크기만 다시 재고 그린 내용은 제자리에 두므로
  // 오른쪽이 패널에 가려진다(사용자 지적 2026-10-23). 폭이 바뀐 만큼 절반을 밀어 보던 가운데를 그대로 유지한다
  // 배율도 폭 비율만큼 따라간다(사용자 지적 2026-10-23 "노드 크기가 패널과 상관없이 작아져 있거나 커져 있음"): 넓어지면 노드가 커지고 좁아지면 작아져,
  // 보이던 범위가 그대로 보인다. 기준점은 그래프 가운데(cytoscape가 minZoom·maxZoom 안으로 자른다)
  let lastGraphW = null;
  const resizeGraphKeepCenter = () => {
    const cy = graph.cy;
    const el = cy.container();
    const w = el.clientWidth;
    if (lastGraphW === null || w === lastGraphW || lastGraphW <= 0) {
      cy.resize();
      lastGraphW = w;
      return;
    }
    const oldZoom = cy.zoom();
    const oldPan = cy.pan();
    const h = el.clientHeight;
    // 바뀌기 전 화면 가운데가 가리키던 모델 좌표
    const model = { x: (lastGraphW / 2 - oldPan.x) / oldZoom, y: (h / 2 - oldPan.y) / oldZoom };
    cy.resize();
    const zoom = Math.min(cy.maxZoom(), Math.max(cy.minZoom(), oldZoom * (w / lastGraphW)));
    cy.viewport({ zoom, pan: { x: w / 2 - model.x * zoom, y: h / 2 - model.y * zoom } });
    lastGraphW = w;
  };
  let resizeRaf = 0;
  const resizeGraphSoon = () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => { resizeRaf = 0; resizeGraphKeepCenter(); });
  };
  // 현재 화면 폭을 기준으로 새 폭을 정해 적용(저장은 호출한 쪽이 한다)
  const setPanelWidth = (w) => {
    if (panelMain.classList.contains('wide')) setWide(false);
    settings.panelWidth = clampPanelWidth(w, window.innerWidth);
    applyPanelWidth();
    resizeGraphSoon();
  };
  const currentPanelWidth = () => Math.round(panelAside.getBoundingClientRect().width);
  wideBtn.addEventListener('click', () => {
    setWide(!panelMain.classList.contains('wide'));
    applyPanelWidth();
    graph.cy.resize();
    graph.fit();
    lastGraphW = graph.cy.container().clientWidth;
  });
  resizer.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || narrowMq.matches) return;
    e.preventDefault();
    resizer.setPointerCapture(e.pointerId);
    resizer.classList.add('dragging');
    document.body.classList.add('resizing');
  });
  resizer.addEventListener('pointermove', (e) => {
    if (!resizer.hasPointerCapture(e.pointerId)) return;
    setPanelWidth(window.innerWidth - e.clientX); // aside는 오른쪽 끝에 붙어 있다
  });
  const endDrag = (e) => {
    if (!resizer.hasPointerCapture(e.pointerId)) return;
    resizer.releasePointerCapture(e.pointerId);
    resizer.classList.remove('dragging');
    document.body.classList.remove('resizing');
    savePanelWidth(settings.panelWidth);
    resizeGraphKeepCenter();
  };
  resizer.addEventListener('pointerup', endDrag);
  resizer.addEventListener('pointercancel', endDrag);
  resizer.addEventListener('dblclick', () => {
    if (panelMain.classList.contains('wide')) setWide(false);
    savePanelWidth(null);
    applyPanelWidth();
    resizeGraphKeepCenter();
  });
  resizer.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const base = settings.panelWidth && !panelMain.classList.contains('wide') ? clampPanelWidth(settings.panelWidth, window.innerWidth) : currentPanelWidth();
    setPanelWidth(base + (e.key === 'ArrowLeft' ? PANEL.KEY_STEP : -PANEL.KEY_STEP)); // 패널이 오른쪽에 있으므로 ←는 넓히기
    savePanelWidth(settings.panelWidth);
    resizeGraphKeepCenter();
  });
  window.addEventListener('resize', applyPanelWidth);
  narrowMq.addEventListener('change', () => { applyPanelWidth(); graph.cy.resize(); });
  applyPanelWidth();

  // 유니버스 묶기(R-11 ①, CR-4 시제품): 사용자가 하위 유니버스와 이름·단위를 고른다
  const dialog = $('group-dialog');
  // 생성 방식 버튼: 지금 방식을 이름에 보인다(R-15 "생성 방식 표시")
  function renderSettingsButton() {
    $('settings-open').title = `생성 방식(지금: ${providerLabel().replace(/\s*\(.*\)$/, '')}${provider && provider.live ? '(실시간)' : ''})과 작성자 이름을 정합니다`;
  }
  renderSettingsButton();
  $('settings-open').addEventListener('click', () => {
    settingsOpen = true;
    merging = false;
    insight = null;
    issues = null;
    drafting = null;
    editing = null;
    renderPanel();
  });

  $('group-open').addEventListener('click', () => {
    const list = $('group-children');
    list.replaceChildren(
      ...app.universes().map((u) =>
        el('label', { class: 'check' }, el('input', { type: 'checkbox', value: u.id }), ` ${u.name} (${u.level})`),
      ),
    );
    $('group-message').textContent = '';
    dialog.showModal();
  });
  $('group-cancel').addEventListener('click', () => dialog.close());
  $('group-form').addEventListener('submit', (evt) => {
    evt.preventDefault();
    const childIds = [...$('group-children').querySelectorAll('input:checked')].map((i) => i.value);
    const r = app.groupUniverses({ name: $('group-name').value, level: $('group-level').value, owner: $('group-owner').value, childIds });
    if (!r.ok) {
      $('group-message').textContent =
        r.error.field === 'child_universe_ids' ? '업무 지도를 2개 이상 고르세요.' : messageFor(r.error);
      return;
    }
    openUniverse(r.doc.universe.id);
  });
  if (app.readOnly) $('group-open').disabled = true;

  const createDialog = wireCreateDialog(app, $, () => settings.authorName);

  // 표로 추가·고치기(T-19): 한 번의 묶음 저장. 끝나면 마지막 새 노드를 고른다
  const openTable = tableDialog({
    dialog: $('table-dialog'),
    app,
    onSaved: (r) => {
      const last = r.created[r.created.length - 1] || r.updated[r.updated.length - 1];
      afterSave(r, last ? toGid(currentId(), last.id) : selected);
      renderAddForm(r.summary || `표에서 ${r.created.length}개를 추가하고 ${r.updated.length}개를 고쳤습니다.`); // 연결 칸을 썼으면 연결 요약(CR-13 C)
    },
  });

  // 글로 추가(CR-19): 줄글 → 미리 보기(항목·연결) → 체크·수정 → 한 번의 묶음 저장. 「Claude로 읽기」는 키가 있어 실시간 공급자가 만들어졌을 때만 있다
  const openTextAdd = textAddDialog({
    dialog: $('text-add-dialog'),
    app,
    getView: () => view,
    aiReady: () => isLive(provider) && typeof provider.extract === 'function',
    readAi: (text) => extractTextAsync(text, { provider, view }),
    onSaved: (r) => {
      const last = r.created[r.created.length - 1];
      afterSave(r, last ? toGid(currentId(), last.id) : selected);
      renderAddForm(r.summary);
    },
  });

  // 노드 추가(R-02 ①): 저장하면 바로 그래프에 나타나고 선택된다
  // CR-18-5: 양식으로 저장에 성공하면 「사람·업무·문서 추가」를 접고 이 한 줄만 남긴다(양식 위쪽에서 패널이 길어지지 않게). 펼치면 사라진다
  function addFoldNote() {
    let p = document.querySelector('[data-testid=add-folded]');
    if (!p) {
      const details = document.querySelector('details.add');
      p = el('p', { class: 'ok-text add-folded', role: 'status', hidden: true, 'data-testid': 'add-folded' });
      details.before(p);
      details.addEventListener('toggle', () => { if (details.open) p.hidden = true; });
    }
    return p;
  }
  // 「하나 더」: 양식을 다시 펼치고 유형·이을 항목(관계·방향)은 방금 값으로 두며 이름 칸에 초점
  function addAnother(keep) {
    renderAddForm();
    const slot = $('add-slot');
    const details = document.querySelector('details.add');
    details.open = true;
    const typeSelect = slot.querySelector('[data-testid=node-type]');
    if (typeSelect && [...typeSelect.options].some((o) => o.value === keep.type)) {
      typeSelect.value = keep.type;
      typeSelect.dispatchEvent(new Event('change'));
    }
    const other = slot.querySelector('[data-testid=node-link-other]');
    if (keep.link && other && [...other.options].some((o) => o.value === keep.link.other_id)) {
      other.value = keep.link.other_id;
      other.dispatchEvent(new Event('change'));
      const rel = slot.querySelector('[data-testid=node-link-type]');
      const dir = slot.querySelector('[data-testid=node-link-direction]');
      if (rel && [...rel.options].some((o) => o.value === keep.link.core_type && !o.disabled)) rel.value = keep.link.core_type;
      if (dir) dir.value = keep.link.out ? 'out' : 'in';
    }
    const label = slot.querySelector('[data-testid=node-label]');
    if (label) {
      label.focus();
      if (typeof label.scrollIntoView === 'function') label.scrollIntoView({ block: 'nearest' });
    }
  }
  function foldAddForm(node, keep) {
    const note = addFoldNote();
    note.replaceChildren(
      `「${node.label}」${josa(node.label, '을/를')} 넣었습니다 · `,
      el('button', { type: 'button', class: 'link', 'data-testid': 'add-another', onclick: () => addAnother(keep) }, '하나 더'),
    );
    note.hidden = false;
    document.querySelector('details.add').open = false;
  }
  const ADD_TOOLS_NOTE = '표로 추가: 스프레드시트에서 복사한 표를 붙여 넣어 여러 개를 한 번에 · 글로 추가: 몇 문장짜리 글을 붙여 넣으면 사람·업무·산출물과 연결을 찾아 미리 보여 줍니다 · 표로 고치기: 지금 항목을 표로 펼쳐 한꺼번에 고침';
  function renderAddForm(doneText) {
    const slot = $('add-slot');
    addFoldNote().hidden = true;
    if (app.readOnly) {
      slot.replaceChildren(el('p', { class: 'muted small' }, '읽기 전용이라 추가할 수 없습니다.'));
      return;
    }
    const grouped = isGroupedView(view);
    slot.replaceChildren(
      ...(doneText ? [el('p', { class: 'ok-text', 'data-testid': 'add-done' }, doneText)] : []),
      el('div', { class: 'row' },
        el('button', { type: 'button', 'data-testid': 'btn-table-add', title: '스프레드시트에서 복사한 표를 붙여 넣거나 칸에 써서 항목 여러 개를 한 번에 추가합니다', onclick: () => openTable('add') }, '표로 추가'),
        // 묶은 지도(하위 지도를 묶은 지도)에서는 새 항목을 이 문서에만 만들 수 있어 글로 추가 단추 대신 안내 한 줄(R16-11)
        grouped
          ? el('span', { class: 'muted small', 'data-testid': 'text-add-grouped-note', title: TEXT_GROUPED_NOTE }, '글로 추가: 팀·업무 지도를 열어 넣으세요')
          : el('button', { type: 'button', 'data-testid': 'btn-text-add', title: '몇 문장짜리 글을 붙여 넣으면 사람·업무·산출물과 연결을 찾아 미리 보여 줍니다. 체크하고 고친 뒤 저장합니다', onclick: () => openTextAdd() }, '글로 추가'),
        el('button', { type: 'button', 'data-testid': 'btn-table-edit', title: '지금 업무 지도의 항목을 표로 펼쳐 한꺼번에 고칩니다', onclick: () => openTable('edit') }, '표로 고치기')),
      // 단추 설명을 눈에 보이는 글로(일상 사용 2회차 T6): 예전에는 마우스를 올려야 보이는 말풍선(title)에만 있어 읽히지 않았다. 말풍선도 그대로 둔다
      el('p', { class: 'muted small', 'data-testid': 'add-tools-note' }, ADD_TOOLS_NOTE),
      nodeForm({
        mode: 'add',
        subtypes: app.subtypes(),
        onAddSubtype: (t, nm) => app.addSubtype(t, nm),
        onFocusLocal: (id) => focus(toGid(currentId(), id)),
        getCandidates: ownNodes,
        onSubmit: (values) => {
          const { attach_root: attachRoot, link, ...input } = values;
          // 노드·꼭지 연결(포함)·함께 이을 연결을 한 묶음으로 저장한다(D-18): 연결만 실패해 노드만 남는 일이 없다.
          // 새 노드는 묶음 안 1행이므로 연결 쪽 끝은 '@1'로 가리킨다
          const ops = [{ op: 'addNode', row: 1, input, attachRoot: !!attachRoot }];
          if (link) {
            ops.push({ op: 'addEdge', row: 2, input: { core_type: link.core_type, source: link.out ? '@1' : link.other_id, target: link.out ? link.other_id : '@1' } });
          }
          const b = app.applyBatch(ops);
          if (!b.ok) {
            if (!(b.errors && b.errors.length)) return b;
            return { ok: false, error: b.errors[0].error, edge_error: b.errors[0].row === 2 };
          }
          const node = b.created[0];
          const r = { ...b, node };
          afterSave(r, toGid(currentId(), node.id));
          renderAddForm(`추가했습니다: ${node.label}${b.warnings.map((w) => ` ${messageFor(w)}`).join('')}`);
          foldAddForm(node, { type: input.core_type, link: link || null });
          if (drafting) $('detail').parentElement.scrollTop = 0; // 초안 창이 열려 있으면 추가 뒤 양식이 접히므로 초안 창 맨 위가 그대로 보이게 한다(FU-7 「＋ 사람 추가」 복귀, CR-18-5)
          addReturnToTop = false;
          return r;
        },
      }),
    );
  }
  renderAddForm();

  // 다른 화면(초안 창의 「＋ 사람 추가」)이 보내는 요청(FU-7 계약: document의 CustomEvent 'wu:add-node', detail {type:'person'}):
  // 아래 「노드 추가」를 펼쳐 유형을 미리 고르고 이름 칸에 초점. 읽기 전용(되감기·보기 모드)이면 무시한다.
  // 초안 창이 열려 있었으면 추가가 끝난 뒤 패널 맨 위의 초안 창으로 돌아가 보여 준다(초안 창은 닫히지 않고 새 사람이 받는 사람 목록에 들어간다)
  let addReturnToTop = false;
  // 이름(detail.label)이 함께 오면(FU-36 계약: detail { type:'person', label, attrs? }) 창을 열지 않고 바로 사람 노드를 만든다(연결 없음)
  function addPersonDirect(detail) {
    const input = { core_type: 'person', label: detail.label };
    if (detail.attrs && typeof detail.attrs === 'object' && Object.keys(detail.attrs).length) input.attrs = detail.attrs;
    // 노드 추가 양식의 저장과 같은 명령(applyBatch addNode)을 쓴다 — 이력·검증이 같다
    const b = app.applyBatch([{ op: 'addNode', row: 1, input, attachRoot: false }]);
    if (!b.ok) {
      const err = b.errors && b.errors.length ? b.errors[0].error : b.error;
      const text = messageFor(err);
      const m = drafting ? document.querySelector('#detail [data-testid=draft-message]') : null;
      if (!m) return window.alert(text);
      m.className = 'form-message error';
      m.dataset.code = (err && err.code) || '';
      m.textContent = text;
      if (typeof m.scrollIntoView === 'function') m.scrollIntoView({ block: 'nearest' });
      return;
    }
    afterSave(b); // refresh()가 초안 창을 다시 그린다(새 사람이 받는 사람 목록에 들어간다). 고른 대상·보내는·받는 사람은 renderPanelBody의 keepDraftSelection이 유지한다
  }

  document.addEventListener('wu:add-node', (e) => {
    if (rw || app.readOnly) return;
    const want = e && e.detail && e.detail.type;
    if (want === 'person' && e.detail.label) return addPersonDirect(e.detail);
    const typeSelect = $('add-slot').querySelector('[data-testid=node-type]');
    if (!typeSelect || ![...typeSelect.options].some((o) => o.value === want)) return;
    document.querySelector('details.add').open = true;
    typeSelect.value = want;
    typeSelect.dispatchEvent(new Event('change'));
    addReturnToTop = !!drafting;
    const label = $('add-slot').querySelector('[data-testid=node-label]');
    if (label) label.focus();
  });

  // 초안 창 끝의 「혼자만 아는 일 보기」·「← 지도 전체 보기」 링크가 보내는 요청(W6 계약, 점검 3회차):
  // wu:open-insight {kind} = 지도 전체를 대상으로 인사이트를 연다(기본 탭 인수인계 위험), wu:overview = 노드 선택을 풀고 지도 전체 화면으로(「← 지도 전체 보기」와 같은 동작)
  document.addEventListener('wu:open-insight', (e) => {
    const kind = e && e.detail && e.detail.kind;
    openInsight('', typeof kind === 'string' && kind ? kind : 'risk');
  });
  document.addEventListener('wu:overview', () => select(null));

  // 가상 데이터 초기화: 「가져오기·내보내기」 창 맨 아래 위험 구역에서 부른다(R7-4). 문서만 읽기 전용이면 초기화로 복구할 수 있게 둔다
  function doReset() {
    // 직접 만들거나 가져온 유니버스도 지워지므로 몇 개인지 알리고 먼저 내보내라고 안내한다(여섯 번째 검토 U-9)
    const mine = app.universes().filter((u) => !SAMPLES.some((s) => s.universe.id === u.id));
    const mineText = mine.length ? `

직접 만들거나 가져온 업무 지도 ${mine.length}개(${mine.map((u) => `「${u.name}」`).join(', ')})도 지워집니다. 남기려면 먼저 「가져오기·내보내기」에서 내보내세요.` : '';
    if (!window.confirm(`모든 가상 데이터를 초기 샘플로 되돌립니다. 샘플에 추가한 항목과 직접 묶은 업무 지도는 사라집니다.${mineText}`)) return;
    const r = app.resetAll();
    if (r && !r.ok) return window.alert(messageFor(r.error));
    $('import-dialog').close();
    openUniverse(app.doc.universe.id);
  }

  // 「도구 더 보기」(CR-13 A): 흐름 정렬·거르기를 처음엔 접어 둔다. 한 번 펼치면 설정(moreTools)에 기억한다. 저장에 실패하면 이번 화면에서만 유지
  let toolsOpen = settings.moreTools === true;
  const applyTools = (open, persist) => {
    toolsOpen = open;
    $('tools-more').hidden = !open;
    $('tools-toggle').setAttribute('aria-expanded', String(open));
    if (persist) {
      if (open) settings.moreTools = true;
      else delete settings.moreTools;
      saveSettings(storage, settings);
    }
    graph.cy.resize(); // 줄이 늘거나 줄면 그래프 영역 높이가 바뀐다
  };
  applyTools(toolsOpen, false);
  $('tools-toggle').addEventListener('click', () => applyTools(!toolsOpen, true));

  // 따라 하기(CR-13 A): 읽기 전용(내용 포함 파일)에서는 쓰지 않는다
  const tourState = () => ({
    universeId: currentId(),
    selected,
    draftOpen: !!drafting,
    draftShown: !!drafting && draftShown,
    evidenceUsed,
    expandedCount: expanded.size,
    foundGid,
    nbhd: !!nbhd,
    insightOpen: !!insight,
    insightKind: insight ? insight.kind : null,
    editing: !!editing && editing.kind === 'node', // 항목 수정 양식이 열려 있음
    saved: tourSaved,
    rewinding: !!rw,
    readOnly: app.readOnly,
  });
  if (embedMode) $('tour-open').hidden = true;
  else {
    tour = createTour({
      slot: $('tour-slot'),
      getState: tourState,
      getCy: () => graph.cy,
      universeId: currentId,
      onOpenUniverse: (universeId, scenario) => openUniverse(universeId, scenario, true), // 「?」에서 고른 시나리오는 언제나 뜬다(D-2)
      onFinish: (scenario) => { // 끝 카드에 이르렀거나 건너뜀: 이 브라우저 설정에만 남긴다(D-2)
        settings.tourDone = { ...(settings.tourDone || {}), [scenario]: nowIso() };
        saveSettings(storage, settings);
      },
      onStart: () => { draftShown = false; evidenceUsed = false; foundGid = null; tourSaved = false; },
      onMake: () => createDialog.openMine(),
      canMake: !app.readOnly,
      toolsHint: () => !toolsOpen,
    });
    // 머리글 「?」(FU-9): 작은 도움말 상자를 연다. 「따라 하기 다시 보기」가 예전 「?」 동작(tour.openHelp)이다. Esc로도 닫힌다(dialog 기본)
    const helpBox = $('help-dialog');
    $('tour-open').addEventListener('click', () => {
      helpBox.replaceChildren(helpPanel({
        onTour: () => { helpBox.close(); tour.openHelp(); },
        onClose: () => helpBox.close(),
      }));
      if (!helpBox.open) helpBox.showModal();
    });
  }

  // 마지막으로 연 지도(D-1): 이 브라우저 설정에만 둔다. 내용 포함 HTML 보기에서는 저장소를 쓰지 않으므로 남기지 않는다
  if (!embedMode && storage && settings.lastOpenedId !== currentId()) {
    settings.lastOpenedId = currentId();
    saveSettings(storage, settings);
  }
  refresh();
  if (tour && tourId && scenarioOf(tourId).universeId === currentId()) {
    // D-2: 한 번 끝내거나 건너뛴 따라 하기는 시작 화면 카드로 다시 들어와도 자동으로 뜨지 않는다. 대신 상태 줄에 다시 보는 길을 알린다
    if (shouldAutoStartTour({ tourOnce: TOUR_ONCE, done: settings.tourDone, scenario: tourId, forced: tourForced })) tour.start(tourId);
    else {
      exploreNote = { text: TOUR_ONCE_NOTE, testid: 'tour-once-note' };
      renderExploreStatus();
    }
  }

  // 개발 점검 도구(tools/browser-check.mjs)가 그래프 좌표와 상태를 읽기 위한 연결점(?check일 때만)
  if (CHECK_MODE) window.__wu = {
    cy: graph.cy,
    firstViewInfo: () => graph.firstViewInfo(),
    select,
    toggle,
    get doc() {
      return app.doc;
    },
    get view() {
      return view;
    },
    get display() {
      return display;
    },
    get selected() {
      return selected;
    },
    // CR-13 A 점검용: 따라 하기 상태(mode·scenario·index)와 「도구 더 보기」 펼침
    get tour() {
      return tour ? tour.info() : null;
    },
    get toolsOpen() {
      return toolsOpen;
    },
    // CR-15 점검용: 가짜 Claude 클라이언트 주입. 'ok'·'badquote'·'garbage'·'auth'·'timeout' 같은 모드 이름이면 llm/fake-client.js의 가짜를 만들고,
    // 객체면 그것을 그대로 쓴다. 키를 설정에 넣어야 실시간 경로가 켜진다. 만든 가짜(mode·delayMs·calls를 바꿀 수 있음)를 돌려준다
    useFakeLlm(fake = 'ok') {
      fakeLlmClient = typeof fake === 'string' ? createFakeClient({ mode: fake }) : fake;
      provider = makeProvider();
      renderSettingsButton();
      return fakeLlmClient;
    },
    get fakeLlm() {
      return fakeLlmClient;
    },
    // T-18 점검용: 주변만 보기·거르기 상태
    get nbhd() {
      return nbhd;
    },
    get filter() {
      return filterState;
    },
    get readOnly() {
      return app.readOnly;
    },
    // CR-14 C 점검용: 가짜 폴더 손잡이(메모리)를 연결된 상태로 둔다
    useFolderHandle: (handle) => (folder ? folder.useHandle(handle) : Promise.resolve()),
    // CR-14 A 점검용: 편집 되감기 상태
    get rewind() {
      return rw ? { at: rw.at } : null;
    },
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
