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
import { DRAFT_TARGET_TYPES, MEMO_CATEGORIES, SUBTYPE_HANDOVER_DOC, pairKey } from '../model/schema.js';
import { validateDocument } from '../model/validate.js';
import { BACKUP_NONE_TEXT, backupRows, collabPlan, draftCenterFor } from '../view/quick-input.js';
import { addNodeOps, extraNames, extraSummary, groupedStrip, memoRecordInput, closeTargetWord, resolveCloseCount, successNotice, transferBranchPlan, canInlineEmpNo, BRANCH_DOC, BRANCH_LABELS, BRANCH_ONLY, BRANCH_WHAT, BRIEF_HANDOVER_HINT, HANDOVER_CHECK_WHAT } from '../view/record-form.js';
import { gateWrap, memoParts } from './memo-form.js';
import { createNotices } from './notice.js';
import { confirmedDoc, downloadWithNotice, printHtml } from './doc-output.js';
import { el } from './dom.js';
import { createGraph, legendItems } from './graph.js';
import { renderNodeDetail, renderUniverseSummary } from './detail.js';
import { ALERT_LABEL } from './card.js';
import { historyTablePanel } from './history-table.js';
import { actionPlan, cardData, historyRows } from '../view/card.js';
import { edgeEditForm, edgeForm, eventForm, nodeForm } from './editor.js';
import { draftPanel } from './draft.js';
import { currentDenseN, insightPanel } from './insight.js';
import { issueEntry, issuePanel, issuesFor } from './issues.js';
import { openMemos } from '../rules/issues.js';
import { hiddenEntry, hiddenPanel } from './hidden.js';
import { confirmText, doneText, failText, fillBand, hideBand, nodeChangeNote, pointLabeler, revertBlock, rewindEntry, rewindPanel } from './rewind.js';
import { renderBackupNudge } from './backup.js';
import { backupAdvice, userChangeTimes } from '../rules/backup.js';
import { hiddenNodesOf } from '../rules/hidden.js';
import { nowIso, todayLocal } from './time.js';
import { personLoad, repeatPatternsFor, workLoad } from '../rules/insight.js';
import { riskNoteFor } from '../rules/insight-risk.js';
import { TOUR_ONCE, TOUR_ONCE_NOTE, WEEKLY_DATE_MESSAGES, WEEKLY_DATE_MIN, baselineSavedNote, compareRisk, currentOwnersByWork, isEditedSample, lastModifiedDeep, makeBaseline, namesFromInspection, pickBaseline, resumeTarget, saveBaseline, shouldAutoStartTour, startMaps, weeklyDateError } from '../rules/daily-use.js';
import { inspectionInput, soloWorksOf, soloWorksText, teamRiskParts, teamRiskRows, teamRiskSummary, teamRowText } from '../view/risk-summary.js';
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
import { docAttachDialog } from './doc-attach.js';
// 문서로 더한 뒤 배치를 다시 계산하는 조건: 새 항목이 minAdded개 이상이고 지도가 maxNodes개 이하일 때
const DOC_ATTACH_RELAYOUT = { minAdded: 1, maxNodes: 80 };
import { TEXT_GROUPED_NOTE, isGroupedView } from '../rules/text-extract.js';
import { convertDocument } from '../rules/doc-convert.js';
import { convertDocumentAsync, convertDocumentWith, extractTextAsync, isLive } from '../llm/connector.js';
import { DOC_EXAMPLE } from '../../data/doc-example.js';
import { DOC_ATTACH_EXAMPLE } from '../../data/doc-attach-example.js';
import { filterDisplay, foldedInside, neighborhoodDisplay, offPeriodEdgeIds, personsIn, searchNodes } from '../view/explore.js';
import { EXPLORE, exploreBar } from './explore.js';
import { createTour } from './tour.js';
import { helpPanel } from './help.js';
import { scenarioOf } from '../rules/tour-steps.js';
import { createFieldId, fillMineDefaults } from '../rules/new-universe.js';
import { LEGEND_COLLAPSED_TEXT, LEGEND_LINES_TEXT, OWNER_REQUIRED_TEXT, assignOps, keepDraftPick, mergePendingText, sameMark } from './flow-helpers.js';
import { FEATURE_WORK_LIMIT, commonFeatures, searchFeatures, searchMapItems } from '../view/feature-index.js';
import { spaceMarks } from '../view/space-marks.js';
import { WORKSPACES, cleanWorkspace, denseRows, followScreens, gapWorkRows, panelParts, planSwitch, recentHandoverDocs, soloRows, spaceBadges } from '../view/workspace.js';
import { RECENT_RECORDS, RECORD_SEARCH, mapHistoryRows, recentRecords, searchRecords } from '../view/recent-records.js';
import { createMemoKeep, memoKeepKey } from '../view/memo-keep.js';
import { DONE_KEY, doneMarkAuto, doneMarkMatches, makeDoneMark } from '../view/done-mark.js';
import { flash, recentList } from './overview.js';
import { denseBox, docsBox, gapBox, renderWorkspaceNav, soloBox } from './workspace.js';
import { featureFind } from './feature-find.js';

// 점검 도구(tools/*-check.mjs)만 주소에 ?check를 붙여 연다. 그때만 점검용 전역 window.__wu를 만든다(D-4-10, 사용자 결정 2026-10-03)
const CHECK_MODE = new URLSearchParams(location.search).has('check');

// 다른 유니버스로 이동: 주소 끝의 #유니버스ID를 바꾸고 다시 연다(file://에서도 동작)
// 내용 포함 HTML을 읽기 전용으로 보는 중이면 주소를 #embed/ID로 둔다(일반 ID에는 '/'가 없어 섞이지 않는다, CR-13 B)
let embedPrefix = '';

// tourId가 있으면 주소 끝에 ~tour=시나리오를 붙인다: 다시 열린 화면이 읽고(takeTourFromHash) 바로 주소에서 지운다(CR-13 A, 저장소를 쓰지 않는다)
// again: 머리글 「?」에서 고른 것이라 「한 번만」(D-2)에 걸리지 않고 언제나 따라 하기가 뜬다(~again)
function openUniverse(id, tourId = '', again = false, done = '', auto = 0) {
  if (done) { // 일회용 표지(R11 RV11S-1): 주소의 ~done만 믿지 않게 이 탭의 sessionStorage에도 남긴다. 쓸 수 없으면 남기지 않아 알림이 생략된다
    try {
      const mark = makeDoneMark(done, id, Date.now(), auto);
      if (mark) window.sessionStorage.setItem(DONE_KEY, mark);
    } catch { /* 저장소를 쓸 수 없으면 알림만 생략 */ }
  }
  location.hash = embedPrefix + id + (tourId ? `~tour=${tourId}${again ? '~again' : ''}` : '') + (done ? `~done=${done}` : '');
  location.reload();
}

// 주소 끝의 ~done=group|import를 읽고 지운다(CR-22 F: 묶은 직후 띠·가져온 직후 알림). 저장소를 쓰지 않는다
function takeDoneFromHash() {
  const m = /~done=(group|import)$/.exec(location.hash);
  if (!m) return '';
  history.replaceState(null, '', location.pathname + location.search + location.hash.slice(0, m.index));
  return m[1];
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
    if (same && !window.confirm(`같은 이름·단위의 「${same.name}」(${same.level}) 업무 지도가 이미 있습니다. 그래도 새로 만들까요?`)) return;
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
function wireImportDialog(app, $, getProvider, methodLabel, onExport = null, onReset = null, onExportHtml = null, folder = null, docAttach = null) {
  const open = importDialog({
    folder,
    docAttach, // {can, open}: 지금 연 지도에 문서를 더하는 「문서로 더하기」로 가는 길(조력자 의견 2026-10-28). 시작 화면이면 null
    onExport,
    onExportHtml,
    onReset,
    dialog: $('import-dialog'),
    app,
    convert: (text) => convertDocumentWith(text, { provider: getProvider(), now: nowIso, ruleConvert: (t) => convertDocument(t, { now: nowIso() }) }),
    methodLabel,
    example: DOC_EXAMPLE,
    onImported: (id) => openUniverse(id, '', false, 'import'),
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
  const doneHash = takeDoneFromHash();
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
  // 「문서로 더하기」는 아래에서 만들어진다: 가져오기 창에서는 누를 때 찾는다
  const docAttachHook = { can: () => false, open: () => {} };
  const openImport = wireImportDialog(app, $, () => provider, providerLabel, hashId() ? doExport : null, doReset, hashId() ? doExportHtml : null, folder, hashId() ? docAttachHook : null);

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
  const adminButtons = ['create-open', 'group-open', 'import-open'].map((id) => $(id)); // 머리글에서 「지도 관리」 공간으로 옮긴 단추(CR-22 W). 한 번 만든 그대로 쓴다
  const adminStash = $('ws-admin-stash');
  let selected = null; // 선택한 항목의 전역 ID
  // 성공 알림 자리(CR-22 F): 패널 맨 위에 붙는 알림 줄 하나. 문구·대상은 view/record-form.js successNotice
  const notices = createNotices($('notice-slot'), {
    onGo: (g) => goNotice(g),
    topOffset: () => { const t = $('tour-slot'); return t && !t.hidden ? t.offsetHeight : 0; },
  });
  const notify = (kind, data, extra = {}) => notices.show({ ...successNotice(kind, data), ...extra });
  let space = cleanWorkspace(settings.workspace); // 왼쪽 작업 공간(CR-22 W). 메뉴로 고른 값은 이 브라우저 설정에 기억한다
  let addPinned = false; // 「사람·업무·문서 추가」를 지도 관리 밖에서 불러 열어 둠(카드의 「관련 문서」·초안의 「＋ 사람 추가」). 공간을 바꾸면 풀림
  let lastNodeTotal = 0; // 마지막으로 그린 공간 첫 화면의 항목 수(꼭지만 있는 빈 지도면 추가 칸을 지도 보기에서도 보인다)
  let editing = null; // 편집 중인 양식: {kind:'node'|'edge'|'event'|'edge-edit', edgeId?}
  let drafting = null; // 인수인계 초안 화면: {target}
  let insight = null; // 인사이트 화면: {work, kind}
  let issues = null; // 미해결 이슈 목록 화면(R-20): {target}
  let histTable = null; // 기록(이력) 표 화면(CR-22 K): {gid, state:{group,period,q,page}, wasWide} — 카드의 「모두 보기 →」로 연다
  // 항목 카드의 접힘·「모두 n개」 기억(CR-22 K). 접힘은 항목 종류(업무·사람 …)별로 이 탭 메모리에만 기억한다 — 저장소에 쓰지 않는다(사용자 의견 10-26 저녁: 카드 첫 화면은 요약만, 한 번 연 묶음은 같은 종류 카드에서 열려 있음).
  // 「모두 n개」는 예전처럼 다른 항목을 고르면 지운다. 기본값과 다르게 바꾼 것만 담는다
  const cardState = { gid: null, type: null, byType: new Map(), open: new Map(), all: new Set(),
    isOpen(key, dflt) { return this.open.has(key) ? this.open.get(key) : dflt; },
    setOpen(key, open, dflt) { if (open === dflt) this.open.delete(key); else this.open.set(key, open); },
    isAll(key) { return this.all.has(key); },
    setAll(key) { this.all.add(key); },
    reset(gid, type = '') {
      if (this.gid !== gid) { this.gid = gid; this.all.clear(); }
      if (this.type !== type) {
        this.type = type;
        if (!this.byType.has(type)) this.byType.set(type, new Map());
        this.open = this.byType.get(type);
      }
    } };
  let hiddenOpen = false; // 숨긴 항목 목록 화면(R-21)
  let nbhdBack = null; // 주변만 보기에 들어가기 전 {expanded, snap}(FU9-9)
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
  let baselineSaved = false; // 따라 하기를 시작한 뒤 「이번 점검 저장」을 눌렀음(team 단계 완료 조건)
  let summaryUsed = false; // 따라 하기를 시작한 뒤 「점검 요약 보기」를 눌렀음(team 단계 완료 조건)
  let tour = null;
  const tourHook = () => { if (tour) tour.check(); };
  // 미해결·숨긴 노드·인사이트 패널(U-3): 열 때 「닫기」에 포커스, 닫으면 연 단추로 돌아간다(표 대화상자와 같게)
  let focusPanelClose = false;
  let panelOpener = null; // 연 단추의 data-testid
  // 연 단추를 기억만 한다(초안·통합 확인·설정처럼 열 때 「닫기」로 초점을 옮기지 않는 화면용)
  const noteOpener = () => {
    const a = document.activeElement;
    panelOpener = a && a.dataset && a.dataset.testid ? a.dataset.testid : (a && a.id ? `#${a.id}` : null); // 머리글 단추처럼 시험 이름이 없으면 id로
  };
  const rememberOpener = () => {
    noteOpener();
    focusPanelClose = true;
  };
  const focusClose = (testid) => {
    if (!focusPanelClose) return;
    focusPanelClose = false;
    const b = $('detail').querySelector(`[data-testid="${testid}"]`);
    if (b) b.focus();
  };
  // 닫은 뒤 초점: 연 단추(머리글의 「설정」 포함). 연 단추가 없어졌거나 안 보이면 공간 제목으로
  const restoreOpener = () => {
    const id = panelOpener;
    panelOpener = null;
    let b = id ? document.querySelector(id.startsWith('#') ? id : `[data-testid="${id}"]`) : null;
    if (b && (b.disabled || b.getClientRects().length === 0)) b = null;
    if (!b) {
      b = $('detail').querySelector('[data-testid=ws-title]') || $('detail').querySelector('h2');
      if (b && !b.hasAttribute('tabindex')) b.tabIndex = -1;
    }
    if (b) b.focus({ preventScroll: true });
  };
  // 패널 보기 중 열려 있는 것을 닫는다(Esc와 「닫기」 공통, CR-22 F: 미해결·숨긴 항목·인사이트·이력 표·통합 확인·설정·초안). 닫았으면 true
  // 「인수인계서까지」에서 이름으로 먼저 만든 사람(RV11C-2): 초안을 확정하지 않고 닫으면, 아직 연결이 하나도 없고 이력이 만들 때 것뿐일 때만 숨긴다
  function dropUnusedPerson(id) {
    if (!id || app.readOnly || rw) return;
    const g = toGid(currentId(), id);
    const linked = view.edges.some((e) => !e.hidden && (e.source === g || e.target === g));
    const used = view.events.some((e) => e.type !== 'created' && e.node_gids.includes(g));
    if (linked || used) return;
    const r = app.hideNode(id);
    // 숨긴 뒤에는 평소 저장 뒤와 같은 후처리(afterSave와 같은 refresh + 폴더 거울) — 그래프·카드에 숨긴 사람이 남지 않게(R12 RV12C-2). 따라 하기의 「저장함」 표시(tourSaved)는 건드리지 않는다
    if (r && r.ok) {
      refresh();
      if (folder) folder.mirror();
    }
  }
  // 초안 화면이 끝나는 모든 길의 공통 정리(R12 RV12C-1): 닫기·Esc 말고 다른 항목 고르기·공간 메뉴·인사이트/미해결/통합 확인/설정/되감기 열기 같은 길에서도
  // 「인수인계서까지」로 먼저 만든 사람(확정 안 함)이 연결 0개로 남지 않게 한다. 확정(onConfirm)은 사람이 쓰이므로 이 함수를 쓰지 않는다
  function closeDraft() {
    if (!drafting) return;
    const id = drafting.createdPerson;
    drafting = null;
    dropUnusedPerson(id);
  }
  function closeSidePanel() {
    if (histTable) closeHistTable();
    else if (issues) issues = null;
    else if (hiddenOpen) hiddenOpen = false;
    else if (insight) insight = null;
    else if (merging) merging = false;
    else if (settingsOpen) settingsOpen = false;
    else if (drafting) closeDraft();
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
  // 지도 고르기(FU8-31): 키보드 ↑↓로 훑는 동안은 바꾸지 않고, Enter를 누르거나 칸을 떠날 때 확정한다. 마우스로 고르면 바로
  let pickerByKey = false;
  picker.addEventListener('keydown', (e) => { if (e.key === 'Enter') { pickerByKey = false; if (picker.value !== app.doc.universe.id) { e.preventDefault(); openUniverse(picker.value); } } else if (['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key) || e.key.length === 1) pickerByKey = true; });
  picker.addEventListener('mousedown', () => { pickerByKey = false; });
  picker.addEventListener('change', () => { if (pickerByKey && document.activeElement === picker) return; pickerByKey = false; if (picker.value !== app.doc.universe.id) openUniverse(picker.value); });
  picker.addEventListener('blur', () => { if (pickerByKey) { pickerByKey = false; if (picker.value !== app.doc.universe.id) openUniverse(picker.value); } });

  const graph = createGraph($('graph'), { onSelect: select, onToggle: toggle, getFilter: (d) => filterDisplay(d, filterState), onFlow: (on) => $('flowlayout').setAttribute('aria-pressed', String(on)) });

  // 범례에 더할 강조 줄({key, label, color, ring?}): 지금 공간의 그래프 강조 뜻(view/space-marks.js, CR-22 G2). 강조 없는 공간은 빈 배열
  let curMarks = [];
  function legendMarks() {
    return curMarks;
  }
  // 공간·기준일·그려진 항목이 바뀔 때마다 그래프 강조를 다시 계산한다(주변만 보기에서는 접힌 팀 안 개수를 붙이지 않음)
  function syncSpaceMarks() {
    const m = spaceMarks(space, view, { asOf: asOf(), shown: new Set(display.nodes.map((n) => n.gid)), note: !nbhd });
    graph.setSpaceMarks({ cls: m.cls, gids: m.gids, dim: space === 'handover' });
    curMarks = m.marks;
    renderLegend();
  }

  function renderLegend() {
    $('legend').replaceChildren(
      ...[
        // 유형은 색과 모양을 함께(CR-22 G 3). 강조 줄(mark)은 공간 기능이 넘긴다: 색만, 또는 ring이면 겹테두리
        ...legendItems(display, [], legendMarks()).map((i) => el('li', { 'data-testid': i.mark ? `legend-mark-${i.key}` : `legend-type-${i.key}` }, el('span', { class: `dot sh-${i.shape || 'ellipse'}${i.ring ? ' ring' : ''}${i.ring === 'solid' ? ' solid' : ''}`, style: i.ring ? `border-color:${i.color}` : `background:${i.color}` }), i.label)),
        display.collapsed.size
          ? el('li', { class: 'legend-note' }, el('span', { class: 'dot collapsed' }), LEGEND_COLLAPSED_TEXT)
          : null,
        // 노드가 많은 화면(부서 등)은 글자가 작다: 확대·이동 방법을 범례 끝에 알린다(재검증 5-2)
        display.nodes.some((n) => n.merged_from && n.merged_from.length)
          ? el('li', { class: 'legend-note', 'data-testid': 'legend-merged' }, '숫자 없는 이중 테두리: 같은 사람으로 합친 항목')
          : null,
        // 모양·크기·선 읽는 법(CR-22 G 8)
        // 한 줄로 두고 모자라면 줄임표(…)로 줄인다: 줄이 늘고 줄면 그래프 칸 높이가 바뀌어 폭을 바꿀 때 보던 가운데가 어긋난다
        // 선 이름의 뜻(R13 FU8-3·18): 선 위 글자(수행·산출…)가 낯설다는 지적. 한 줄 ellipsis, 전부는 마우스를 올리면 title
        el('li', { class: 'legend-note legend-visual', 'data-testid': 'legend-lines', title: LEGEND_LINES_TEXT }, el('span', {}, LEGEND_LINES_TEXT)),
        el('li', { class: 'legend-note legend-visual', 'data-testid': 'legend-visual', title: '크기 = 연결 수 · 화살표 = 시작 → 대상 · 흐린 점선 = 기준일에 맡은 일 없음 · 아주 옅은 선 = 지도 중심에 포함 · 휠 확대·축소, 빈 곳 끌기 이동' }, el('span', {}, '크기 = 연결 수 · 화살표 = 시작 → 대상 · 흐린 점선 = 맡은 일 없음')),
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
    const where = own ? `「${parents.map((p) => p.name).join('」·「')}」` : '이 지도를 묶은 팀·부서 지도';
    // el()은 null 자식을 걸러 내므로 box.append(…, null)처럼 "null" 글자가 들어가지 않는다(검토5 U-1)
    box.append(el('div', {},
      el('label', { class: 'check' }, cb, ` ${where} 화면에서도 이 항목 보이기`),
      el('div', { class: 'muted small' }, `지금 적용: ${exp.explicit ? '직접 지정' : '기본 규칙'}(${exp.reason})`),
      own ? el('div', { class: 'muted small' }, `${where}${josa(where, '은/는')} 이 업무 지도를 묶은 팀·부서 지도입니다.`) : null,
      owner ? el('div', { class: 'muted small', 'data-testid': 'exposed-owner' }, `바꾸면 원본 업무 지도 「${owner}」에 저장됩니다.`) : null,
    ));
    return box;
  }

  // ── 자료 편집(R-02, T-06) ───────────────────────────────────────────
  const currentId = () => app.doc.universe.id;
  const EVENT_TYPE_LABELS = { handover: '인수인계', assign_start: '담당 시작', assign_end: '담당 종료', affiliation_change: '소속 변경', memo: '메모' };
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

  // ── 쓴 것 바로 보이기(CR-21 B) ──
  // 방금 기록한 이력 줄(이벤트 전역 ID들). 상세의 이력 목록이 그 줄에 data-just-added를 달아 강조하고, 몇 초 뒤 강조만 지운다
  let justAdded = null;
  // picked: 실제로 방금 기록한 것이 아니라 「지금 볼 것」·찾기·최근 기록에서 골라 간 줄(FU8-4: 강조만 하고 「방금 기록한 줄」 글은 붙이지 않는다)
  function markJustAdded(gids, picked = false) {
    if (justAdded) clearTimeout(justAdded.timer);
    if (!gids.length) {
      justAdded = null;
      return;
    }
    const mine = { gids, picked, timer: setTimeout(() => {
      if (justAdded !== mine) return;
      justAdded = null;
      for (const li of document.querySelectorAll('[data-just-added]')) li.removeAttribute('data-just-added');
      for (const g of document.querySelectorAll('[data-testid=history-gap]')) g.remove(); // 방금 기록한 줄 표지도 강조와 함께 사라진다
    }, RECENT_RECORDS.JUST_ADDED_MS) };
    justAdded = mine;
  }
  // 저장 결과가 돌려준 새 이벤트(담당 시작·종료는 두 개, 이미 끝난 일은 이슈+해결됨 두 개)의 전역 ID
  const evGidsOf = (r, universeId = currentId()) => [r.event, r.endEvent, r.resolvedEvent].filter(Boolean).map((e) => toGid(universeId, e.id));
  function scrollJustAdded() {
    const li = $('detail').querySelector('[data-just-added="1"]');
    if (li && typeof li.scrollIntoView === 'function') li.scrollIntoView({ block: 'center' });
  }
  // 그 업무를 고르고 상세 이력의 방금 기록한 줄로 간다(알림의 「이력에서 보기」·개요 「최근 기록」의 「보기」)
  function showHistory(nodeGid, gids, picked = false) {
    markJustAdded(gids, picked);
    focus(nodeGid);
    scrollJustAdded();
  }

  function draftButton(gid, label = '인수인계 초안 만들기') {
    const node = view.getNode(gid);
    if (!node || !DRAFT_TARGET_TYPES.includes(node.core_type)) return null;
    return el('button', { type: 'button', class: 'primary', 'data-testid': 'btn-draft', onclick: () => openDraft(node.gid) }, label);
  }

  // 사람 상세의 「이 사람 일 인수인계 초안」(FU-30, CR-18 D-5): 대상 = 이 사람이 진행 중으로 맡은 업무가 있는 지도의 지도 중심(묶은 지도에서는 맡은 업무가 가장 많은 하위 지도, 같으면 화면 순서 앞쪽).
  // 맡은 업무가 없으면 예전처럼 지금 지도 전체. 보내는 사람 = 이 사람, 받는 사람은 비워 둔다. 읽기 전용이면 그리지 않는다
  function personDraftButton(node, asButton = false) {
    if (!node || node.core_type !== 'person' || app.readOnly) return null;
    const mapRoot = app.rootGid();
    const center = draftCenterFor(view, node.gid, { asOf: todayLocal() });
    const targetGid = center ? center.root_gid : mapRoot;
    const centerName = center && targetGid !== mapRoot ? (view.getNode(targetGid) || {}).label : '';
    const title = centerName
      ? `이 사람이 진행 중으로 맡은 업무가 있는 「${centerName}」 지도를 대상으로, 이 사람을 보내는 사람으로 미리 골라 초안 창을 엽니다`
      : '이 지도 전체를 대상으로, 이 사람을 보내는 사람으로 미리 골라 초안 창을 엽니다';
    return el('button', { type: 'button', class: asButton ? '' : 'link', 'data-testid': 'btn-person-draft', 'data-target': targetGid, title, onclick: () => openDraft(targetGid, { target: targetGid, from: node.label, from_gid: view.canonical(node.gid), to: '' }) }, '이 사람 일 인수인계 초안');
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
    // 다른 묶음(카드의 접는 묶음)과 같은 모양: 제목 · 개수 · 한 줄 미리 보기(R13 FU8-22)
    const withCands = rows.filter((r) => r.candidates.length).length;
    return el('details', { class: 'card-group', 'data-testid': 'person-backup', 'data-group': 'person-backup' },
      el('summary', {}, el('b', { class: 'cg-title' }, '이 사람 일, 누가 대신할 수 있나'), el('span', { class: 'cg-count' }, String(rows.length)), el('span', { class: 'cg-preview' }, withCands ? `후보 있는 업무 ${withCands}건` : '후보 없음')),
      el('div', { class: 'cg-body' },
        el('p', { class: 'muted small' }, `${asOf()} 기준으로 진행 중인 업무마다 「유사 경험자」 계산의 상위 후보입니다(업무당 최대 3명, 그 업무를 직접 해 본 사람이 먼저). 후보의 이름을 누르면 그 사람이 선택됩니다.`),
        el('table', { class: 'backup-table', 'data-testid': 'person-backup-table' },
          el('thead', {}, el('tr', {}, el('th', {}, '맡은 업무'), el('th', {}, '대신할 수 있는 후보'))),
          el('tbody', {}, ...rows.map((r) => el('tr', { 'data-testid': 'person-backup-row' }, el('td', {}, r.work.label), el('td', {}, cell(r))))))));
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
      notify('collab', { name, extra, exchange, workGid: gid });
    };
    for (const box of [nameIn, affIn, conIn, noteIn]) box.querySelector('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('details', { class: 'collab-quick', 'data-testid': 'collab-quick' },
      el('summary', { title: '다른 팀 사람처럼 이 업무와 함께 일하는 사람을 이름·소속·연락처만 적어 한 번에 넣습니다' }, '협업자 추가'),
      el('div', { class: 'row' }, nameIn, affIn, conIn, noteIn, el('button', { type: 'button', 'data-testid': 'collab-add', onclick: submit }, '추가')),
      el('p', { class: 'muted small' }, '사람을 새로 만들고 이 업무와 「참조」로 잇습니다. 같은 이름의 사람이 이미 있으면 연결만 합니다. 인수인계 초안의 「관계자·연락처」에 나옵니다. 「주고받는 것」은 그 「참조」 연결의 메모로 남습니다(「연결된 항목」에서 보입니다).'),
      msg);
  }

  // 「이번 주 기록」(CR-18 D-10, CR-22 F 메모 양식 하나): 업무·분류 칩·날짜·내용·관련 주제. 카드의 「기록 남기기」(메모)와 같은 부품(ui/memo-form.js).
  // 분류는 처음엔 고르지 않는다 — 고르지 않으면 「기록」이 막힌다. 기존 이력 추가의 메모와 같은 경로(app.addEvent / 이미 끝난 일은 app.addMemoResolved). 고칠 수 없는 화면에서는 그리지 않는다
  // date·day: 날짜 칸(T4). 주말에 한 주를 몰아 넣을 때 같은 날짜로 이어 넣을 수 있게, 오늘이 아닌 날짜는 같은 날(day) 안에서만 기억한다(다음 날 열면 다시 오늘)
  let weeklyLast = { workId: '', date: '', day: '' };
  // 쓰던 메모(FU6-3): 업무별 글·분류를 이 탭의 메모리에만 보관한다(저장소에는 쓰지 않음). 「기록」 성공 때 지운다
  const memoKeep = createMemoKeep();
  // 「이번 주 기록」 양식을 그릴 수 있는 화면인가(읽기 전용·되감기·업무 없는 지도·묶은 지도는 아님)
  const canWeekly = () => !app.readOnly && !rw && ownNodes().some((n) => n.core_type === 'work');
  function weeklyBox() {
    if (!canWeekly()) return null;
    const works = ownNodes().filter((n) => n.core_type === 'work');
    const workSel = el('select', { 'data-testid': 'weekly-work', 'aria-label': '업무' }, el('option', { value: '' }, '업무를 고르세요'), ...works.map((w) => el('option', { value: w.id, selected: w.id === weeklyLast.workId }, w.label)));
    let addBtn = null;
    let dateIn = null; // 날짜 칸(아래에서 만든다). 해결됨 미리 알림이 이 날짜로 닫히는 건수를 센다(R11 RV11C-1)
    const parts = memoParts({
      prefix: 'weekly',
      topics: ownNodes().filter((n) => n.core_type === 'topic'),
      closeCount: () => (workSel.value ? resolveCloseCount(view, toGid(currentId(), workSel.value), dateIn ? dateIn.value : '') : 0),
      onChange: (ok) => { if (addBtn) addBtn.disabled = !ok; },
    });
    const noteIn = el('input', { type: 'text', maxlength: 2000, autocomplete: 'off', placeholder: '예: 대사 불일치 2건 정리, 다음 주 재확인', 'data-testid': 'weekly-note', 'aria-label': '내용' });
    // 쓰던 글·분류 보관(FU6-3): 업무마다 따로. 업무를 바꿀 때 그 업무에 쓰던 글이 있으면 채우고, 없으면 지금 칸의 글을 새 업무로 옮긴다(글을 쓴 뒤 업무를 고르는 순서도 지켜진다)
    const keyFor = (workId) => memoKeepKey('weekly', currentId(), workId);
    let heldKey = keyFor(workSel.value);
    const hold = () => memoKeep.set(heldKey, { category: parts.category(), note: noteIn.value });
    const restore = (d) => { noteIn.value = d ? d.note : ''; parts.setCategory(d ? d.category : ''); };
    restore(memoKeep.get(heldKey));
    noteIn.addEventListener('input', hold);
    parts.select.addEventListener('change', hold);
    workSel.addEventListener('change', () => {
      weeklyLast.workId = workSel.value; // 다시 그려도 고른 업무를 유지(쓰던 글 보관의 열쇠)
      const next = keyFor(workSel.value);
      const had = memoKeep.get(next);
      if (had) restore(had);
      else {
        memoKeep.clear(heldKey); // 쓰던 글을 새로 고른 업무로 옮긴다
        heldKey = next;
        hold();
      }
      heldKey = next;
      parts.refresh();
    });
    const today = todayLocal();
    dateIn = el('input', { type: 'date', value: weeklyLast.day === today && weeklyLast.date && weeklyLast.date <= today ? weeklyLast.date : today, min: WEEKLY_DATE_MIN, max: today, 'data-testid': 'weekly-date', 'aria-label': '날짜(기본 오늘)', title: '기본은 오늘입니다. 주말에 한 주를 몰아 넣을 때는 요일별 날짜를 고르세요(오늘보다 뒤 날짜는 기록할 수 없습니다)' });
    dateIn.addEventListener('change', () => parts.refresh());
    parts.refresh();
    const msg = el('span', { class: 'error-text', role: 'alert', 'data-testid': 'weekly-msg' });
    const submit = () => {
      msg.textContent = '';
      delete msg.dataset.code;
      const workId = workSel.value;
      weeklyLast = { workId, date: dateIn.value, day: todayLocal() };
      // 날짜 검사(T4): 비었거나 읽을 수 없거나 오늘 뒤면 저장하지 않는다
      const dateErr = weeklyDateError(dateIn.value, todayLocal());
      if (dateErr) {
        msg.textContent = WEEKLY_DATE_MESSAGES[dateErr];
        msg.dataset.code = `date-${dateErr}`;
        return;
      }
      const m = memoRecordInput({ workId, category: parts.category(), note: noteIn.value, date: dateIn.value.trim(), topicIds: parts.topicIds(), pastDone: parts.pastChecked() });
      if (!m.ok) {
        msg.textContent = m.field === 'work_id' ? '기록할 업무를 고르세요.' : m.field === 'category' ? '분류를 고르세요.' : messageFor({ code: 'E-REQUIRED', field: 'note' });
        msg.dataset.code = m.field;
        return;
      }
      const r = m.alsoResolved ? app.addMemoResolved(m.input) : app.addEvent(m.input);
      if (!r.ok) {
        msg.textContent = messageFor(r.error, { kind: 'event' });
        msg.dataset.code = (r.error && r.error.code) || '';
        return;
      }
      const label = (works.find((w) => w.id === workId) || {}).label || '';
      const workGid = toGid(currentId(), workId);
      memoKeep.clear(keyFor(workId)); // 기록했으니 쓰던 글 보관은 지운다
      memoKeep.clear(heldKey);
      afterSave(r, selected);
      if (m.alsoResolved) notify('record-past', { workGid, evGids: evGidsOf(r) });
      else notify('record', { label, date: m.input.occurred_at, today: todayLocal(), category: m.input.payload.category, note: m.input.note, workGid, evGids: evGidsOf(r) });
    };
    noteIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    addBtn = el('button', { type: 'button', 'data-testid': 'weekly-add', onclick: submit }, '기록하기'); // 왼쪽 메뉴의 「기록」(공간)과 구별(R13 FU8-7)
    addBtn.disabled = !parts.category();
    const addWrap = gateWrap(addBtn, () => parts.needCategory()); // 분류를 안 골라 막힌 「기록」을 눌러도 칩 줄을 짚어 준다(FU6-5)
    const row = (label, ...kids) => el('div', { class: 'memo-row' }, el('span', {}, label), ...kids);
    return el('div', { class: 'weekly-quick', 'data-testid': 'weekly-quick' },
      el('p', { class: 'small' }, el('strong', {}, '이번 주 기록'), ' ', el('span', { class: 'muted' }, '업무 이력에 메모를 남깁니다(날짜는 기본 오늘 — 주말에 몰아 넣을 때는 요일별로 고르세요). 「진행 중」·「이슈」 기록은 「미해결」에 잡히니, 끝나면 「해결로 표시」하세요')),
      row('업무', workSel),
      row('분류', parts.hint, parts.chipRow, parts.gate, parts.select),
      parts.warn,
      el('div', { class: 'row' }, el('label', { class: 'small' }, '날짜 ', dateIn)),
      row('내용', noteIn),
      parts.topics ? row('관련 주제(선택)', parts.topics) : null,
      parts.pastBox,
      el('div', { class: 'row' }, addWrap),
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
  function openDraft(targetGid, preset, extra = {}) {
    if (!drafting) noteOpener();
    settingsOpen = false;
    merging = false;
    editing = null;
    insight = null;
    issues = null;
    drafting = preset ? { target: targetGid, preset, ...extra } : { target: targetGid, ...extra };
    draftShown = false;
    draftDomLive = false; // 새로 여는 초안 창: 이전 화면의 칸 값을 읽지 않는다
    renderPanel();
  }

  // opts.open: 펼쳐 둘 업무 묶음(업무 gid, 대상 없는 주제 묶음은 'topics'), opts.item: 눌러 온 메모 한 건(그 줄을 강조) — 카드의 「지금 볼 것」에서 올 때(FU8-14·15)
  function openIssues(targetGid, opts = null) {
    rememberOpener();
    settingsOpen = false;
    merging = false;
    editing = null;
    closeDraft();
    insight = null;
    issues = { target: targetGid, open: (opts && opts.open) || null, item: (opts && opts.item) || null };
    renderPanel();
    if (issues && issues.item) { // 눌러 온 줄로 스크롤하고 잠깐 강조
      const li = [...$('detail').querySelectorAll('[data-testid=issue-item]')].find((x) => x.getAttribute('data-gid') === issues.item);
      if (li) { if (typeof li.scrollIntoView === 'function') li.scrollIntoView({ block: 'center' }); flash(li); }
    }
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
        baselineSaved = true;
        renderPanel();
      },
    };
  }
  // 위험 요약의 「점검 요약 보기」(M2): 인사이트(인수인계 위험 탭)를 열고 위쪽의 「점검 요약」 줄로 간다
  function openCheckSummary() {
    summaryUsed = true;
    openInsight('', 'risk');
    const bar = document.querySelector('[data-testid=summary-bar]');
    if (bar && typeof bar.scrollIntoView === 'function') bar.scrollIntoView({ block: 'start' });
    const pv = bar && bar.querySelector('[data-testid=summary-preview]'); // 「점검 요약 보기」는 요약을 보러 온 길이라 미리 보기를 펼친다(R11 FU6-14)
    if (pv && !pv.open) pv.open = true;
    const first = bar && bar.querySelector('[data-testid=summary-copy]');
    if (first && typeof first.focus === 'function') first.focus({ preventScroll: true });
  }

  function openInsight(workGid, kind = 'similar') {
    rememberOpener();
    settingsOpen = false;
    merging = false;
    editing = null;
    closeDraft();
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
    const text = load.count === 0 ? `${when} 맡은 업무 없음` : `${when} 맡은 업무 ${load.count}개 — ${load.dense ? `일이 몰림(밀집 기준 ${load.n}개 이상)` : `몰리지 않음(밀집 기준 ${load.n}개 이상)`}`;
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
          if (!box.hidden) { openCardGroups(box); box.querySelector('[data-testid=form-assign-name]').focus(); } // 이 줄이 든 「내용」 묶음이 접혀 있어도 칸이 보이게
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
    addPinned = true; // 카드에서 불렀으므로 「지도 관리」가 아니어도 추가 칸을 보인다
    syncAdd();
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
      notify('assign', { name, existing: plan.existing, workGid: gid });
    };
    const add = el('button', { type: 'button', 'data-testid': 'form-assign-add', onclick: submit }, '넣기');
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('div', { class: 'row', hidden: true, 'data-testid': 'form-assign' }, el('label', { class: 'small' }, '담당자 이름 ', input), add, msg);
  }

  // 업무 상세의 접힌 상자 「담당 넘기기」(일상 사용 2회차 M3, CR-22 F 한 입구): 지금 담당 → 새 담당(목록에서 고르거나 이름을 넣음), 날짜 기본 오늘.
  // 그다음 "무엇을 남길까요?" 두 갈래.
  //  ○ 담당만 바꾸기: 한 번의 기록(app.changeAssignee — 기존 담당 종료·시작 명령 묶음, 되감기 한 점)으로 보내는 사람의 진행 중 수행을 끝내고 받는 사람의 수행을 시작한다.
  //    「인수인계 기록도 남기기」를 켜면 인수인계 이력도 같은 저장에 남긴다.
  //  ○ 인수인계서까지: 초안 화면을 열고 보내는 사람·받는 사람·대상을 채우고 「담당도 넘기기」를 켜 둔다(날짜는 초안 규칙대로 오늘). 저장은 초안 확정 때 한 번.
  // 읽기 전용·되감기 중에는 그리지 않고, 다른 업무 지도의 업무는 「…」 열기 안내만 보인다
  function assigneeBox(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || node.core_type !== 'work' || app.readOnly || rw) return null;
    if (!isOwn(gid)) {
      return el('details', { class: 'assignee-change', 'data-testid': 'assignee-change' },
        el('summary', {}, '담당 넘기기'),
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
    const summary = el('summary', { title: '지금 담당을 끝내고 새 담당을 시작합니다. 이력만 남길지, 인수인계서까지 남길지 고릅니다' }, '담당 넘기기');
    if (!holders.length) {
      return el('details', { class: 'assignee-change', 'data-testid': 'assignee-change' }, summary,
        el('p', { class: 'muted small', 'data-testid': 'assignee-none' }, '지금 이 업무를 맡은 사람이 없습니다. 담당을 넣으려면 「기록 남기기」의 「담당 시작」을 쓰세요.'));
    }
    const persons = ownNodes().filter((n) => n.core_type === 'person');
    const fromSel = el('select', { 'data-testid': 'assignee-from', 'aria-label': '지금 담당' }, ...holders.map((h) => el('option', { value: h.id }, h.label)));
    const toSel = el('select', { 'data-testid': 'assignee-to', 'aria-label': '새 담당(목록에서 고르기)' }, el('option', { value: '' }, '새 담당을 고르세요'), ...persons.map((p) => el('option', { value: p.id }, p.label)));
    const toName = el('input', { type: 'text', maxlength: 100, autocomplete: 'off', placeholder: '또는 이름 넣기(새 사람)', 'data-testid': 'assignee-to-name', 'aria-label': '새 담당 이름(목록에 없을 때)' });
    const today = todayLocal();
    const dateIn = el('input', { type: 'date', value: today, min: WEEKLY_DATE_MIN, max: today, 'data-testid': 'assignee-date', 'aria-label': '바뀐 날짜(기본 오늘)' });
    const handoverChk = el('input', { type: 'checkbox', 'data-testid': 'assignee-handover' });
    const handoverRow = el('label', { class: 'check', 'data-testid': 'assignee-handover-row' }, handoverChk, ' 인수인계 기록도 남기기');
    const handoverWhat = el('p', { class: 'muted small', 'data-testid': 'assignee-handover-what' }, HANDOVER_CHECK_WHAT); // R13 FU8-11: 체크가 무엇을 남기는지
    const handoverLine = el('div', { class: 'row handover-line', 'data-testid': 'assignee-handover-line' }, handoverRow, handoverWhat);
    const msg = el('span', { class: 'error-text', role: 'alert', 'data-testid': 'assignee-msg' });
    const fail = (text, code) => { msg.textContent = text; msg.dataset.code = code; };
    // 무엇을 남길까요? — 담당만(이력만) / 인수인계서까지. 처음은 담당만(지금 담당 바꾸기 동작 그대로)
    const group = `assignee-branch-${node.id}`;
    const rOnly = el('input', { type: 'radio', name: group, value: BRANCH_ONLY, checked: true, 'data-testid': 'assignee-branch-only' });
    const rDoc = el('input', { type: 'radio', name: group, value: BRANCH_DOC, 'data-testid': 'assignee-branch-doc' });
    const branch = () => (rDoc.checked ? BRANCH_DOC : BRANCH_ONLY);
    const docNote = el('p', { class: 'muted small', hidden: true, 'data-testid': 'assignee-doc-note' }, '초안 화면에서 이어 갑니다 — 보내는 사람·받는 사람·대상이 채워지고 「담당도 넘기기」가 켜진 채 열립니다. 날짜는 초안 규칙대로 오늘이고, 저장은 초안을 확정할 때 한 번에 됩니다. 단, 목록에 없는 이름을 넣으면 그 사람은 초안을 열기 전에 먼저 만들어 둡니다(연결 없음) — 확정하지 않고 초안을 닫으면 그 사람은 숨깁니다.');
    const apply = el('button', { type: 'button', 'data-testid': 'assignee-apply' }, '담당 넘기기');
    const syncBranch = () => {
      const doc = branch() === BRANCH_DOC;
      handoverRow.hidden = doc;
      handoverLine.hidden = doc;
      handoverWhat.hidden = doc;
      dateIn.disabled = doc;
      docNote.hidden = !doc;
      apply.textContent = doc ? '인수인계 초안으로' : '담당 넘기기';
    };
    rOnly.addEventListener('change', syncBranch);
    rDoc.addEventListener('change', syncBranch);
    const submitDoc = (name) => {
      const fromNode = app.findNode(fromSel.value);
      const plan = transferBranchPlan({ branch: BRANCH_DOC, workGid: wg, from: { gid: toGid(currentId(), fromSel.value), label: fromNode ? fromNode.label : '' }, toId: toSel.value, toName: name, persons });
      if (!plan.ok) return fail(plan.reason === 'ambiguous' ? '같은 이름의 사람이 둘 이상입니다. 목록에서 고르세요.' : plan.reason === 'same' ? '보내는 사람과 받는 사람이 같습니다.' : '새 담당을 고르거나 이름을 넣으세요.', plan.reason);
      let preset = plan.preset;
      let createdPerson = '';
      if (plan.createPerson) { // 이 지도에 없는 이름: 사람을 먼저 만든다(연결 없음). 담당 연결은 초안 확정 때 「담당도 넘기기」가 한다
        const b = app.applyBatch([{ op: 'addNode', row: 1, input: { core_type: 'person', label: plan.createPerson }, attachRoot: false }]);
        if (!b.ok) {
          const err = b.errors && b.errors.length ? b.errors[0].error : b.error;
          return fail(messageFor(err), (err && err.code) || '');
        }
        afterSave(b, gid);
        preset = { ...preset, to_gid: toGid(currentId(), b.created[0].id) };
        createdPerson = b.created[0].id; // 확정 없이 초안을 닫으면 정리한다(R11 RV11C-2)
      }
      openDraft(node.gid, preset, { transfer: true, autoMake: true, createdPerson });
      return undefined;
    };
    const submit = () => {
      msg.textContent = '';
      delete msg.dataset.code;
      const name = toName.value.trim();
      if (toSel.value && name) return fail('새 담당은 목록에서 고르거나 이름을 넣거나, 둘 중 하나만 하세요.', 'both');
      if (!toSel.value && !name) return fail('새 담당을 고르거나 이름을 넣으세요.', 'to-empty');
      if (branch() === BRANCH_DOC) return submitDoc(name);
      const dateErr = weeklyDateError(dateIn.value, todayLocal());
      if (dateErr) return fail(WEEKLY_DATE_MESSAGES[dateErr], `date-${dateErr}`);
      const work = localNode(gid);
      const fromNode = app.findNode(fromSel.value);
      const r = app.changeAssignee({ workId: work ? work.id : '', fromId: fromSel.value, toId: toSel.value || undefined, toName: name, date: dateIn.value.trim(), handover: handoverChk.checked });
      if (!r.ok) {
        const err = r.error || {};
        fail(err.reason === 'ambiguous' ? '같은 이름의 사람이 둘 이상입니다. 목록에서 고르세요.' : err.future ? WEEKLY_DATE_MESSAGES.future : messageFor(err, { kind: 'event' }), err.code || '');
        return undefined;
      }
      const from = fromNode ? fromNode.label : '';
      const to = r.to.label;
      const when = dateIn.value.trim();
      afterSave(r, gid); // refresh()가 상세를 다시 그린다(「현재 담당」이 바뀐다)
      notify('assignee', { work: node.label, from, to, when, today: todayLocal(), created: r.created, handover: r.handover, workGid: gid });
      return undefined;
    };
    apply.addEventListener('click', submit);
    toName.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    return el('details', { class: 'assignee-change', 'data-testid': 'assignee-change' }, summary,
      el('div', { class: 'row' },
        el('label', { class: 'small' }, '지금 담당 ', fromSel), el('span', { class: 'arrow', 'aria-hidden': 'true' }, '→'),
        el('label', { class: 'small' }, '새 담당 ', toSel), toName,
        el('label', { class: 'small' }, '날짜 ', dateIn)),
      el('div', { class: 'branch-pick', role: 'radiogroup', 'aria-label': '무엇을 남길까요?', 'data-testid': 'assignee-branch' },
        el('p', { class: 'small' }, el('strong', {}, '무엇을 남길까요?')),
        el('label', {}, rOnly, ` ${BRANCH_LABELS[BRANCH_ONLY]}`),
        el('p', { class: 'muted small branch-what', 'data-testid': 'assignee-what-only' }, BRANCH_WHAT[BRANCH_ONLY]),
        el('label', {}, rDoc, ` ${BRANCH_LABELS[BRANCH_DOC]}`),
        el('p', { class: 'muted small branch-what', 'data-testid': 'assignee-what-doc' }, BRANCH_WHAT[BRANCH_DOC])),
      docNote,
      handoverLine,
      el('div', { class: 'row' }, apply, msg),
      // 잠깐 맡기는 경우(휴가·부재·출장)는 담당을 넘기지 않고 협업자로 둔다(R13 FU8-10)
      el('p', { class: 'muted small', 'data-testid': 'assignee-brief' }, `${BRIEF_HANDOVER_HINT} `,
        el('button', { type: 'button', class: 'link', 'data-testid': 'assignee-brief-collab', onclick: () => openFormBox('collab-quick') }, '협업자 추가'), '를 쓰세요.'),
      // 긴 설명은 접어 둔다(FU8 남은 것: 버튼을 설명 위로)
      el('details', { class: 'small', 'data-testid': 'assignee-more' }, el('summary', {}, '자세히'),
        el('p', { class: 'muted small' }, '「담당만 바꾸기」는 한 번의 기록으로 지금 담당자의 담당을 그 날짜까지로 끝내고 새 담당자가 그 날짜부터 맡게 합니다. 문서까지 남기려면 「인수인계서까지」를 고르세요 — 초안 화면의 「담당도 넘기기」와 같은 일입니다.')));
  }

  // 카드 「지금 볼 것」의 「반복 비효율」: 알림 칸을 거치지 않고 인사이트의 「반복 비효율」 탭을 열고, 이 업무가 든 패턴 줄을 강조한다(FU8-5)
  function openRepeatFor(gid) {
    const node = view.getNode(gid);
    openInsight('', 'repeat');
    const label = node ? displayName(node) : '';
    const li = label ? [...$('detail').querySelectorAll('[data-testid=repeat-patterns] > li')].find((x) => x.textContent.includes(label)) : null;
    if (li) { if (typeof li.scrollIntoView === 'function') li.scrollIntoView({ block: 'center' }); flash(li); }
  }

  // 업무·주제 노드가 반복 비효율 패턴에 들어 있으면 한 줄
  function repeatNote(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || !['work', 'topic'].includes(node.core_type)) return null;
    const hits = repeatPatternsFor(view, gid, asOf()); // 오늘 보기에서도 오늘 기준(검토5 I-2)
    if (!hits.length) return null;
    const kinds = [...new Set(hits.map((p) => (p.kind === 'handover_chain' ? '인수인계 반복' : '주제 반복')))].join('·');
    return el('p', { class: 'notice', 'data-testid': 'repeat-note' }, `같은 설명·문제가 되풀이되는 곳(반복 비효율) ${hits.length}건에 포함(${kinds}) `,
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-repeat-note', onclick: () => openInsight('', 'repeat') }, '반복 비효율 보기'));
  }

  // 업무를 해 본 사람이 한 명뿐이고 인수인계 기록이 없으면 한 줄(CR-14 B, R-26 ⑤)
  function riskNote(gid) {
    const hit = riskNoteFor(view, gid, asOf());
    if (!hit) return null;
    return el('p', { class: 'notice', 'data-testid': 'risk-note' }, `혼자만 아는 일(위험 높음) — ${hit.person.label}만 해 봤고 인수인계 기록이 없습니다 `,
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-risk-note', onclick: () => openInsight('', 'risk') }, '인수인계 위험 보기'));
  }

  // 사람 노드: 이 사람 한 명만 해 본 업무(FU-12). 인수인계 위험 탭 ① 목록과 같은 계산이다. 0개면 그리지 않는다
  function soloWorksNote(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden || node.core_type !== 'person') return null;
    const text = soloWorksText(soloWorksOf(view, gid, asOf()));
    // 「이 사람 일 인수인계 초안」은 사람 카드의 동작 줄(cardActions)에 있다(CR-22 K)
    if (!text) return null;
    return el('p', { class: 'notice', 'data-testid': 'person-solo-works' }, text, ' ',
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-person-solo', onclick: () => openInsight('', 'risk') }, '인수인계 위험 보기'));
  }

  // FU9-19: 통합 확인의 「지금까지 고른 답」 중 샘플 데이터에 처음부터 들어 있던 답(이 브라우저에서 사람이 고른 것이 아님).
  // 기준: 내장 샘플의 판정 기록과 id·두 항목·답·방법·고른 사람·고른 시각이 모두 같은 것. 사람이 다시 묻고 고르면 고른 사람·시각이 달라져 이 표시가 빠진다. 판정 기록은 바꾸지 않고 표시만 한다
  const isSampleAnswer = (l) => SAMPLES.some((s) => (s.identity_links || []).some((x) => x.id === l.id && x.a === l.a && x.b === l.b && x.status === l.status && x.method === l.method && (x.decided_by || '') === (l.decided_by || '') && (x.decided_at || '') === (l.decided_at || '')));

  function openMerge() {
    noteOpener();
    merging = true; insight = null; issues = null; closeDraft(); editing = null; settingsOpen = false;
    renderPanel();
  }

  // 하위 유니버스를 묶은 유니버스의 개요: 통합 확인 목록으로 가는 버튼(대기 건수)
  function mergeButton() {
    const plan = app.mergePlan();
    if (!plan) return null;
    return el('p', { class: plan.counts.pending ? 'notice' : 'muted small', 'data-testid': 'merge-hint' },
      mergePendingText(plan.counts),
      el('button', { type: 'button', class: 'link', 'data-testid': 'btn-merge', onclick: openMerge }, '통합 확인 목록'));
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
    return el('button', { type: 'button', 'data-testid': 'btn-history-jump', title: '이 항목의 기록(이력) 목록으로 내려갑니다', onclick: (e) => {
      const h = document.querySelector('[data-testid="history-heading"]');
      if (!h) return;
      const box = h.closest('details');
      if (box) box.open = true; // 접혀 있으면 펼쳐서 보인다
      const menu = e.currentTarget.closest('details.more-tools');
      if (menu) menu.open = false;
      h.scrollIntoView({ block: 'start' });
      h.focus({ preventScroll: true });
    } }, '기록(이력)으로');
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
        btn('기록 남기기', 'event', 'btn-event'),
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

  // ── 항목 카드(CR-22 K): 고정 동작 줄 하나·접는 묶음. 값은 view/card.js, 그리기는 ui/card.js ──
  // 카드 안에 숨겨 둔 양식 칸(담당 넘기기=담당 바꾸기 상자, 협업자 추가)을 연다. 칸이 없으면 null
  function openFormBox(testid) {
    const slot = $('detail').querySelector('[data-testid=card-forms]');
    if (!slot) return null;
    slot.hidden = false;
    let hit = null;
    for (const box of slot.children) {
      const on = box.getAttribute('data-testid') === testid;
      box.hidden = !on;
      if (on) hit = box;
    }
    const menu = $('detail').querySelector('details.more-tools');
    if (menu) menu.open = false;
    if (hit) {
      hit.open = true;
      if (typeof hit.scrollIntoView === 'function') hit.scrollIntoView({ block: 'nearest' });
      const first = hit.querySelector('select, input');
      if (first) first.focus({ preventScroll: true });
    }
    return hit;
  }

  // 유형에 맞는 동작 단추만 만든다(view/card.js actionPlan이 정한 것). primary는 고정 줄, more는 「⋯」 메뉴
  function cardActions(gid) {
    const node = view.getNode(gid);
    if (!node) return { primary: [], more: [] };
    const own = isOwn(gid);
    const editable = own && !app.readOnly && !rw;
    const plan = actionPlan({
      coreType: node.core_type, own, readOnly: app.readOnly || !!rw, hidden: !!node.hidden,
      handoverDoc: node.core_type === 'artifact' && node.subtype === SUBTYPE_HANDOVER_DOC,
      canDelete: editable && node.core_type !== 'root' && app.canDeleteNow(node.id).ok,
    });
    const edit = (label, kind, testid, cls = '') => el('button', { type: 'button', class: cls, 'data-testid': testid, onclick: () => { editing = { kind }; renderPanel(); } }, label);
    const docs = node.core_type === 'artifact' ? docButtons(node) : [];
    const draft = draftButton(gid, '인수인계 초안');
    if (draft) draft.classList.remove('primary');
    const make = {
      record: () => edit('기록 남기기', 'event', 'btn-event', 'primary'),
      assign: () => el('button', { type: 'button', 'data-testid': 'btn-assign', onclick: () => openFormBox('assignee-change') }, '담당 넘기기'),
      draft: () => draft,
      personDraft: () => personDraftButton(node, true),
      download: () => docs[0],
      print: () => docs[1],
      edit: () => edit('수정', 'node', 'btn-edit'),
      edge: () => edit('연결 추가', 'edge', 'btn-edge'),
      collab: () => el('button', { type: 'button', 'data-testid': 'btn-collab', onclick: () => openFormBox('collab-quick') }, '협업자 추가'),
      docAttach: () => (isGroupedView(view) ? null : el('button', { type: 'button', 'data-testid': 'btn-doc-attach-card', title: '회의록·매뉴얼 같은 문서를 이 업무에 붙여 문서·할 일·메모로 지도를 키웁니다', onclick: () => openDocAttach(node.id) }, '이 업무에 문서 더하기')),
      history: () => historyJumpButton(),
      similar: () => insightButton(gid),
      insight: () => insightAllButton(),
      nbhd: () => nbhdButtons(gid),
      hide: () => el('button', { type: 'button', class: 'danger', 'data-testid': 'btn-hide', onclick: () => hideSelected(node) }, '숨기기'),
      delete: () => el('button', { type: 'button', class: 'danger', 'data-testid': 'btn-delete', onclick: () => deleteSelected(node) }, '삭제'),
    };
    const build = (keys) => keys.flatMap((k) => [make[k]()]).flat().filter(Boolean);
    return { primary: build(plan.primary), more: build(plan.more) };
  }

  // 「해결」/「해결로 표시」: 메모 한 건을 해결로 표시하고 알림 한 줄(CR-21 B-1)을 남긴다. 미해결 목록·카드의 「지금 볼 것」·이력 표가 같이 쓴다
  function resolveMemoNow(gid, note = '') {
    const ev = view.events.find((x) => x.gid === gid);
    const r = app.resolveMemo(gid, todayLocal(), note);
    if (r.ok || (r.error && r.error.already_resolved)) refresh();
    if (r.ok && ev) {
      const target = ev.payload.target_id ? view.canonical(toGid(ev.universe_id, ev.payload.target_id)) : null;
      const name = target && view.getNode(target) ? `「${displayName(view.getNode(target))}」의 ` : '';
      notify('resolve', { label: target && view.getNode(target) ? displayName(view.getNode(target)) : '', nodeGid: target, evGids: evGidsOf(r, ev.universe_id) });
    }
    return r;
  }

  // 기록(이력) 표 화면을 닫는다. 연 뒤 패널을 넓혔으면 원래 폭으로
  function closeHistTable() {
    if (!histTable) return;
    const t = histTable;
    histTable = null;
    if (!t.wasWide) setWideKeep(false);
  }

  // 지도 전체의 기록 표(R11 FU6-4): 「기록」 공간 「최근 기록」의 「모두 보기 →」·기능 찾기의 「기록 표에서 모두 보기」. 이력 표 화면(ui/history-table.js)을 지도 범위로 다시 쓴다.
  // 카드·작업 화면은 먼저 닫고 「기록」 공간에서 연다. q: 찾기 칸에 미리 넣을 낱말
  function openMapHistTable(q = '') {
    goSpace('record');
    panelOpener = 'recent-all';
    focusPanelClose = true;
    const wasWide = document.querySelector('main').classList.contains('wide');
    histTable = { gid: null, scope: 'map', state: { group: '전체', period: '전체', q, page: 1 }, wasWide };
    setWideKeep(true);
    renderPanel();
    const root = $('detail').parentElement;
    if (root) root.scrollTop = 0;
  }

  function openHistTable() {
    if (!selected) return;
    panelOpener = 'history-all';
    focusPanelClose = true;
    const wasWide = document.querySelector('main').classList.contains('wide');
    histTable = { gid: selected, state: { group: '전체', period: '전체', q: '', page: 1 }, wasWide };
    setWideKeep(true);
    renderPanel();
    const root = $('detail').parentElement;
    if (root) root.scrollTop = 0;
  }

  // 카드 하나를 그리는 데 필요한 값·요소(ui/card.js의 renderCard로 넘어간다)
  function cardOptions(gid, d) {
    const node = view.getNode(gid);
    cardState.reset(gid, node ? node.core_type : '');
    const own = isOwn(gid);
    const editable = own && !app.readOnly && !rw && !(node && node.hidden); // 숨긴 항목 카드에는 「수정에서…」 안내를 두지 않는다(R12 RV12C-7)
    const data = cardData(view, gid, { asOf: asOf(), past: !!viewDate, rootGid: app.rootGid(), n: currentDenseN(), history: d.history });
    const alerts = [];
    const addAlert = (testid, elmt, chip = false) => { if (elmt) alerts.push({ testid, label: ALERT_LABEL[testid], el: elmt, chip }); };
    const workEl = workNote(gid);
    const loadEl = loadNote(gid);
    const notes = { backup: backupNote(gid), form: formNote(gid) };
    if (workEl) { if (data && data.gap) addAlert('work-load', workEl); else notes.workLoad = workEl; }
    if (loadEl) { if (data && data.dense) addAlert('person-load', loadEl); else notes.personLoad = loadEl; }
    addAlert('person-solo-works', soloWorksNote(gid));
    addAlert('repeat-note', repeatNote(gid), true);
    addAlert('risk-note', riskNote(gid), true);
    notes.alerts = alerts;
    const forms = editable ? [assigneeBox(gid), collabBox(gid)].filter(Boolean) : [];
    forms.forEach((f) => { f.hidden = true; });
    return {
      data, state: cardState, actions: cardActions(gid), forms, notes, layer: layerControls(gid), editable,
      // 다른 업무 지도의 항목: 고칠 수 없고 그 지도를 열어서 한다. 업무는 담당 바꾸기 안내(예전 assignee-other-map)와 같은 말
      afterActions: own || !node || node.hidden ? [] : [node.core_type === 'work' && !app.readOnly && !rw
        ? el('p', { class: 'muted small', 'data-testid': 'assignee-other-map' }, '다른 업무 지도의 업무입니다. 담당을 바꾸려면 그 지도를 열어서 하세요. ',
          el('button', { type: 'button', class: 'link', 'data-testid': 'assignee-open-map', onclick: () => openUniverse(node.universe_id) }, `「${node.universe_name}」 열기`))
        : el('p', { class: 'muted small', 'data-testid': 'foreign-note' }, '다른 업무 지도의 항목입니다. 고치려면 ',
          el('button', { type: 'button', class: 'link', onclick: () => openUniverse(node.universe_id) }, `「${node.universe_name}」 열기`), '.')],
      canResolve: editable,
      onResolve: (g) => resolveMemoNow(g),
      // 카드에서 미해결 목록으로 오면 이 업무 묶음을 펼친 채(FU8-14·15). 「지금 볼 것」 줄에서는 그 줄의 묶음·줄(opts)
      onOpenIssues: (opts) => openIssues(gid, opts && typeof opts === 'object' && opts.constructor === Object ? opts : { open: gid }),
      justPicked: !!(justAdded && justAdded.picked),
      onRepeat: () => openRepeatFor(gid),
      onHistoryAll: () => openHistTable(),
      onShowRecord: (evGid) => showHistory(gid, [evGid], true), // 「지금 볼 것」 줄: 처음 3건 밖의 기록 줄로(방금 기록한 줄과 같은 강조)
      onDraft: () => { const n = view.getNode(gid); if (n) openDraft(n.gid); }, // 「인수인계 기록 없음 — 인수인계서 만들기」
    };
  }

  function hideSelected(node) {
    if (!window.confirm(`「${node.label}」${josa(node.label, '을/를')} 숨길까요? 그래프에서 사라지지만 기록과 내용은 남습니다. 다시 보이게 하려면 「지도 관리」 공간의 「숨긴 항목」에서 「되살리기」를 누르세요.`)) return;
    const r = app.hideNode(node.id);
    if (!r.ok) return window.alert(messageFor(r.error));
    afterSave(r, null);
    if (exploreNote) { exploreNote = null; renderExploreStatus(); } // 숨긴 항목을 가리키던 「찾음: …」 표시는 지운다(FU9-8)
    notify('hidden-done', { label: node.label });
  }

  // 연결·이력이 없는 노드(막 만든 실수 노드)는 바로 지운다. 그 밖의 노드는 숨긴 뒤 「숨긴 노드」 목록에서 완전히 삭제한다(CR-13 D)
  function deleteSelected(node) {
    if (!window.confirm(`「${node.label}」${josa(node.label, '을/를')} 지울까요? 연결·이력이 없는 항목이라 바로 지워지고 되돌릴 수 없습니다.`)) return;
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
        if (!window.confirm(`연결 「${title}」${josa(title, '을/를')} 숨길까요? 기록은 남습니다.`)) return;
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
        return eventForm({ node, nodes: ownNodes(), handovers, memoChips: true, closeCount: (date) => resolveCloseCount(view, gid, date), closeWord: closeTargetWord(node && node.core_type),
          keep: { get: () => memoKeep.get(memoKeepKey('card', currentId(), node.id)), set: (d) => memoKeep.set(memoKeepKey('card', currentId(), node.id), d), clear: () => memoKeep.clear(memoKeepKey('card', currentId(), node.id)) }, onCancel: cancel, onSubmit: (values) => {
          // 「이미 끝난 일(해결됨으로 기록)」(D-12): 이슈 메모 + 해결됨 메모를 한 번의 저장으로
          // 저장 직후 방금 기록한 이력 줄을 강조한다(CR-21 B-1): 이벤트 ID를 표시해 두고 상세를 다시 그린 뒤 그 줄로 스크롤
          const { also_resolved: alsoResolved, ...input } = values;
          if (!alsoResolved) {
            const saved = app.addEvent(input);
            if (saved.ok) markJustAdded(evGidsOf(saved));
            const done = afterSave(saved);
            if (done.ok) {
              scrollJustAdded();
              const label = (node && node.label) || '';
              if (input.type === 'memo') notify('record', { label, date: input.occurred_at, today: todayLocal(), category: input.payload.category, note: input.note, workGid: gid, evGids: evGidsOf(saved) });
              else notify('record-event', { label, typeLabel: EVENT_TYPE_LABELS[input.type], workGid: gid, evGids: evGidsOf(saved) });
            }
            return done;
          }
          const saved = app.addMemoResolved(input);
          if (saved.ok) markJustAdded(evGidsOf(saved));
          const r = afterSave(saved);
          if (r.ok) {
            notify('record-past', { workGid: gid, evGids: evGidsOf(saved) });
            scrollJustAdded();
          }
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
    renderPanelQuiet();
    tourHook();
  }
  // 따라 하기가 공간을 바꾸는 중에는 따라 하기를 다시 부르지 않는다(카드를 그리는 도중 다시 그려지는 것을 막는다)
  function renderPanelQuiet() {
    followOpenScreens(); // 작업 화면이 열려 있으면 메뉴가 그 공간으로
    renderPanelBody();
    renderNav();
    syncAdd();
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

  // 긴 작업(초안·인사이트·통합 확인)을 열면 패널을 자동으로 넓히고, 닫으면 원래 폭으로(CR-22 F). 이미 넓게 보고 있었으면 닫아도 그대로
  const autoWide = { on: false, was: false };
  function syncAutoWide() {
    const want = !!(drafting || insight || merging) && !rw && !histTable;
    if (want && !autoWide.on) {
      autoWide.on = true;
      autoWide.was = document.querySelector('main').classList.contains('wide');
      if (!autoWide.was) setWideKeep(true);
    } else if (!want && autoWide.on) {
      autoWide.on = false;
      if (!autoWide.was && !histTable) setWideKeep(false);
    }
  }

  function renderPanelBody() {
    const panel = $('detail');
    adminStash.append(...adminButtons); // 「지도 관리」의 단추 3개는 패널을 지우기 전에 보관함으로(없어지지 않게)
    document.querySelector('.aside-tools').append($('wide-toggle')); // 항목 카드가 가져가 둔 「패널 넓게 보기」도 제자리로(CR-22 K)
    // 기록(이력) 표 화면은 그 항목이 그대로 골라져 있고 다른 작업 화면·양식이 없을 때만 남는다
    // 지도 전체 표(scope map)는 고른 항목이 없을 때 열려 있다
    if (histTable && ((histTable.scope === 'map' ? !!selected : (!selected || histTable.gid !== selected)) || editing || drafting || insight || issues || merging || settingsOpen || hiddenOpen || rw)) closeHistTable();
    syncAutoWide();
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
            ? `「${label}」${josa(label, '을/를')} 완전히 지울까요? 연결·이력이 없는 항목이라 되돌릴 수 없습니다.`
            : `「${label}」${josa(label, '을/를')} 완전히 지울까요? 연결 ${n ? n.edge_count : 0}개도 함께 지워지고 되돌릴 수 없습니다. 이 항목을 언급한 이력은 남고 「(삭제된 항목)」으로 보입니다.`;
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
            const back = app.findNode(id);
            afterSave(r, toGid(currentId(), id));
            notify('confirm', { text: `「${back ? back.label : ''}」${josa(back ? back.label : '', '을/를')} 되살렸습니다.`, nodeGid: toGid(currentId(), id) }); // FU9-8
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
        // 「사번 없음」 줄마다 하위 지도 전체를 검사하지 않도록, 이 화면을 한 번 그리는 동안 지도별 결과를 한 번만 계산한다(R12 RV12C-10, 판정은 같음)
        const ownerCheck = new Map();
        const ownerState = (universeId) => {
          if (!ownerCheck.has(universeId)) {
            const ownerDoc = universeId === currentId() ? app.doc : app.docOf(universeId);
            ownerCheck.set(universeId, { ownerDoc, ownerReadOnly: !!ownerDoc && validateDocument(ownerDoc).readOnly });
          }
          return ownerCheck.get(universeId);
        };
        panel.replaceChildren(mergePanel({
          view, plan, links: app.doc.identity_links || [], provider, readOnly: app.readOnly, asOf: asOf(), isSampleAnswer: isSampleAnswer,
          // 「다시 묻기」(R13 FU8-25): 그 연결을 아직 답하지 않은 상태(pending)로 되돌린다. 새 명령 없이 decideIdentity(status 'pending') — 이벤트 updated(before/after)가 남아 편집 되감기에 보인다
          onReask: (l) => {
            const r = app.decideIdentity({ a: l.a, b: l.b, kind: l.kind, status: 'pending', reason: l.reason, score: l.score });
            if (!r.ok) return window.alert(messageFor(r.error));
            refresh();
            const nm = (g) => { const x = view.rawNode(g); return x ? `「${x.label}」` : ''; };
            // RV13-1: 후보 규칙상 목록에 다시 오르는 쌍이면 「위 후보 목록」, 아니면(같은 지도 업무끼리 등) 「다시 물어볼 답」 묶음에서 고른다
            const plan2 = app.mergePlan();
            const inList = !!plan2 && [...plan2.works, ...plan2.persons].some((x) => x.b && pairKey(x.a, x.b) === pairKey(l.a, l.b));
            notify('plain', { testid: 'identity-reask-done', text: `${nm(l.a)}${nm(l.a) ? ' · ' : ''}${nm(l.b)} — 고른 답을 지웠습니다. ${inList ? '위 후보 목록' : '「다시 물어볼 답」 묶음(지금까지 고른 답 위)'}에서 다시 고를 수 있습니다.`, nodeGid: l.a });
            return undefined;
          },
          onDecide: (item, status) => {
            const r = app.decideIdentity({ a: item.a, b: item.b, kind: item.kind, status, reason: item.reason, score: item.score });
            if (!r.ok) return window.alert(messageFor(r.error));
            refresh();
            const nm = (g) => { const x = view.rawNode(g); return x ? `「${x.label}」` : ''; };
            notify('identity', { a: nm(item.a), b: nm(item.b), same: status === 'confirmed', kind: item.kind, nodeGid: item.a });
            return undefined;
          },
          onApplyAuto: () => {
            const r = app.applyAutoLinks();
            if (!r.ok) return window.alert(messageFor(r.error));
            refresh();
          },
          onFocus: showInGraph,
          onClose: closeSidePanel,
          // 「사번 없음」 줄의 사번 넣기: 그 사람이 있는 하위 지도가 이 브라우저 저장소에 있을 때만(CR-22 F)
          canEmpNo: (p) => {
            const n = view.rawNode(p.a);
            if (!n) return false;
            const { ownerDoc, ownerReadOnly } = ownerState(n.universe_id);
            return canInlineEmpNo(p, { readOnly: app.readOnly || !!rw, ownerDoc, ownerReadOnly });
          },
          onEmpNo: (p, value) => {
            const n = view.rawNode(p.a);
            const r = n ? app.updateNode(n.universe_id, n.id, { emp_no: value }) : { ok: false, error: { code: 'E-SCHEMA' } };
            if (!r.ok) return { ok: false, text: messageFor(r.error, { kind: 'node' }) };
            refresh();
            notify('plain', { testid: 'empno-done', text: `「${n.label}」의 사번을 넣었습니다(${n.universe_name}). 다음 통합 확인에서 같은 사번이면 자동으로 이어집니다.`, nodeGid: n.gid });
            return { ok: true };
          },
        }));
        return;
      }
      merging = false;
    }
    if (issues) {
      panel.replaceChildren(issuePanel({
        view, targetGid: issues.target, openKey: issues.open || null, rootGid: app.rootGid(), universeId: app.doc.universe.id, readOnly: app.readOnly,
        onFocus: showInGraph,
        onClose: closeSidePanel,
        // 해결 표시는 메모가 있는 유니버스 문서에 저장한다(묶음 화면의 하위 유니버스 메모 포함). 이미 닫힌 메모면 아무것도 더하지 않는다
        onResolve: resolveMemoNow,
      }));
      focusClose('issue-close');
      return;
    }
    if (insight) {
      panel.replaceChildren(insightPanel({ view, provider, mapName: app.doc.universe.name, baseline: riskPick().base, baselineToday: riskPick().savedToday, work: insight.work, kind: insight.kind, asOf: asOf(), today: todayLocal(), onTime: setViewDate, onKind: (k) => { insight.kind = k; tourHook(); }, onWork: (w) => { insight.work = w; }, onFocus: showInGraph, onCard: (g) => { reveal(g); select(view.canonical(g)); }, onClose: closeSidePanel }));
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
      panel.replaceChildren(draftPanel({ authorName: (settings.authorName || '').trim(), seenStorage: storage, view, provider, target: drafting.target, preset: drafting.preset || (tour ? tour.preset() : undefined), rerun: draftShown, rerunNote: recordsChanged, onDraft: () => { draftShown = true; tourHook(); }, autoMake: !!drafting.autoMake && !draftShown, presetTransfer: !!drafting.transfer, onTransferChange: (v) => { drafting.transfer = v; }, asOf: todayLocal(), viewDate, readOnly: app.readOnly, onFocus: showInGraph, onClose: closeSidePanel,
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
          notify('confirm', { text: `인수인계서로 저장했습니다 — 「${alabel}」${josa(alabel, '이/가')} 「${wlabel}」의 산출물과 이력에 남았습니다. ${handoverTail}`, nodeGid: view.canonical(r.artifact) }, { goLabel: '인수인계서 보기', long: true });
          $('detail').parentElement.scrollTop = 0;
          graph.zoomTo(view.canonical(r.artifact));
          return saved;
        } }));
      draftDomLive = true;
      return;
    }
    if (!selected && histTable && histTable.scope === 'map') { // 지도 전체의 기록 표(R11 FU6-4)
      const openGids = new Set(openMemos(view).map((ev) => ev.gid));
      panel.replaceChildren(historyTablePanel({
        title: '지도 전체', rows: historyRows(mapHistoryRows(view), openGids), today: todayLocal(), state: histTable.state, readOnly: app.readOnly || !!rw,
        onClose: closeSidePanel,
        onResolve: (g) => resolveMemoNow(g),
        canResolve: (r) => isOwn(r.target_gid),
        onOpenRow: (r) => { closeHistTable(); showHistory(r.target_gid, [r.gid], true); },
      }));
      focusClose('history-table-close');
      return;
    }
    if (!selected) {
      renderSpaceHome(panel);
      return;
    }
    if (histTable) { // 기록(이력) 표(CR-22 K P1): 카드 대신 넓은 표 화면. 닫기·Esc로 카드로 돌아간다
      const d = describeNode(view, selected, { asOf: asOf(), past: !!viewDate });
      const openGids = new Set(openMemos(view).map((ev) => ev.gid));
      panel.replaceChildren(historyTablePanel({
        title: d.title, rows: historyRows(d.history, openGids), today: todayLocal(), state: histTable.state, readOnly: app.readOnly || !!rw || !isOwn(selected),
        onClose: closeSidePanel,
        onResolve: (g) => resolveMemoNow(g),
      }));
      focusClose('history-table-close');
      return;
    }
    if (editing && isOwn(selected) && localNode(selected)) {
      const form = editorFor(selected);
      panel.replaceChildren(el('h2', {}, localNode(selected).label), form);
      if (form && form.focusStart) form.focusStart(); // 표준 양식의 빈 항목을 눌러 열었으면 그 칸에 초점(FU-16)
      return;
    }
    const selNode = view.getNode(selected);
    const d = describeNode(view, selected, { asOf: asOf(), past: !!viewDate });
    let detail;
    if (selNode && selNode.core_type !== 'root') {
      // 항목 카드(CR-22 K): 사람·업무·산출물·주제·조직
      detail = renderNodeDetail(panel, d, { onFocus: focus, linkTools, justAdded: justAdded ? justAdded.gids : null, card: cardOptions(selected, d) });
    } else {
      // 지도 중심(과 다른 지도의 꼭지)은 예전 모양 그대로(공간 패널과 겹치는 부분이라 이번에 건드리지 않는다)
      const rootWeekly = selNode && selNode.core_type === 'root' && isOwn(selected) ? weeklyBox() : null; // 지도 중심 상세의 「이번 주 기록」(D-10)
      const notes = [loadNote(selected), soloWorksNote(selected), backupNote(selected), workNote(selected), issueNote(selected), formNote(selected), collabBox(selected), assigneeBox(selected), repeatNote(selected), riskNote(selected), rootWeekly].filter(Boolean);
      const tools = toolbar(selected);
      detail = renderNodeDetail(panel, d, {
        onFocus: focus,
        extra: layerControls(selected),
        toolbar: notes.length || tools ? el('div', {}, ...[...notes, tools].filter(Boolean)) : null,
        linkTools,
        justAdded: justAdded ? justAdded.gids : null,
        mapOwner: selNode && selNode.core_type === 'root' ? ((view.universes.get(selNode.universe_id) || {}).owner || '') : '', // 지도 중심 상세에 「작성 주체」 읽기 전용 줄
      });
    }
    if (rw && rwPast) { // 편집 되감기: 그때 값임을 알리고, 지금과 다른 칸을 보인다
      const local = isOwn(selected) ? parseGid(selected).local_id : null;
      const change = local ? rwPast.diff.changed.find((c) => c.id === local && c.kind === 'node') || (rwPast.diff.hidden.includes(local) ? { fields: ['hidden'] } : null) : null;
      const note = change ? nodeChangeNote({ change, pastNode: rwPast.doc.nodes.find((n) => n.id === local), currentNode: app.findNode(local) }) : null;
      panel.prepend(...[el('button', { type: 'button', class: 'small-btn', 'data-testid': 'btn-rewind-list', onclick: () => select(null) }, '← 시점 목록으로'), note].filter(Boolean));
    } else {
      // 노드를 고르면 지도 전체 화면(「인수인계 초안 만들기」·「인사이트 보기」)이 사라지므로 맨 위에서 돌아갈 수 있게 한다(FU-6). Esc와 같은 동작: 선택만 푼다
      // 항목 카드에서는 같은 줄 오른쪽에 「패널 넓게 보기」를 옮겨 둔다(위쪽 한 줄을 아끼려고). 다른 화면으로 가면 다시 제자리로 돌려놓는다
      const isCard = !!(selNode && selNode.core_type !== 'root');
      const back = el('div', { class: 'detail-back' }, el('button', { type: 'button', class: 'small-btn', 'data-testid': 'detail-back-universe', title: '항목 선택을 풀고 지도 전체 화면으로 돌아갑니다(Esc와 같음)', onclick: () => select(null) }, isCard ? '← 지도 전체' : '← 지도 전체 보기'));
      if (isCard) {
        back.classList.add('card-top');
        back.append($('wide-toggle'));
      }
      panel.prepend(back);
    }
    return detail;
  }

  // ── 작업 공간(CR-22 W): 왼쪽 메뉴 5개. 항목을 고르지 않았을 때 오른쪽 패널은 고른 공간의 첫 화면이다 ──
  // 지금 열려 있는 작업 화면 이름들(view/workspace.js의 WORK_SCREENS)
  const openScreens = () => [drafting && 'draft', insight && 'insight', merging && 'merge', issues && 'issues', settingsOpen && 'settings', hiddenOpen && 'hidden', rw && 'rewind'].filter(Boolean);

  // 작업 화면을 열면 메뉴가 그 공간으로 따라 바뀐다(초안 → 인수인계 …). 설정은 공간을 바꾸지 않는다
  function followOpenScreens() {
    const f = followScreens(space, openScreens());
    if (f !== space) {
      space = f;
      addPinned = false;
    }
  }

  // 메뉴 배지: 기록 = 미해결 수, 매주 점검 = 혼자만 아는 일 수(둘 다 기존 계산, 셀 수 없거나 0이면 배지 없음)
  function renderNav() {
    syncSpaceMarks(); // 공간이 바뀌었을 수 있다(그래프 강조·범례)
    const rootGid = app.rootGid();
    const risk = teamRiskSummary(view, { asOf: asOf(), n: currentDenseN() });
    renderWorkspaceNav($('workspace-nav'), {
      current: space,
      badges: spaceBadges({ issues: issuesFor(view, rootGid, rootGid).length, solo: risk.solo }),
      onPick: (k, byKey = false) => {
        if (tour) tour.cancelPendingSpace(); // 직접 고른 공간을 따라 하기가 되돌리지 않게(R11 RV11C-5)
        if (rw && k === space) return; // 되감기 중 지금 공간을 다시 눌러도 되감기는 끝나지 않는다(R11 RV11C-9)
        goSpace(k);
        // 키보드로 골랐으면 초점을 공간 제목으로(R12 FU7-8: 메뉴에 남으면 바뀐 화면을 읽으려고 Tab을 여러 번 눌러야 했다). 마우스는 그대로
        if (byKey) focusSoft($('detail').querySelector('[data-testid=ws-title]') || $('detail').querySelector('h2'));
      },
    });
  }

  // 「사람·업무·문서 추가」 칸은 「지도 관리」 공간에서만 보인다. 카드·초안이 불러 열었거나(addPinned) 꼭지만 있는 빈 지도의 「지도 보기」에서는 첫 업무를 넣을 수 있게 보인다
  function syncAdd() {
    const emptyMap = space === 'map' && !selected && lastNodeTotal <= 1 && !openScreens().length;
    document.querySelector('aside').classList.toggle('add-off', !(space === 'edit' || addPinned || emptyMap));
    // 「지도 관리」 첫 화면에서는 위의 「사람·업무·문서 추가」 단추가 입구이고 아래 접힌 상자의 제목줄은 숨긴다(두 번 보이지 않게, CR-22 K). 단추를 다시 누르면 접힌다
    document.querySelector('aside').classList.toggle('add-by-btn', space === 'edit' && !selected && !openScreens().length);
  }

  /**
   * 공간을 바꾼다. 열린 작업 화면(초안·인사이트·통합 확인·미해결·설정·숨긴 항목·되감기)과 항목 카드는 닫고 그 공간의 첫 화면을 그린다
   * (R11 FU6-1: 카드를 둔 채 강조만 바뀌면 「메뉴가 안 먹는다」로 보였다 — 시작 화면의 「왼쪽에서 고르면 오른쪽이 바뀝니다」와 맞춘다).
   * opts.keepCard: 카드를 둔 채 공간만 바꾼다(기능 찾기가 고른 항목에 일을 시키는 길·따라 하기 단계 이동). opts.tour: 따라 하기가 단계에 맞춰 바꾸는 중(기억하지 않고, 따라 하기를 다시 부르지 않음)
   */
  function goSpace(key, opts = {}) {
    const plan = planSwitch({ to: key, open: openScreens() });
    if (histTable) closeHistTable(); // 기록 표 화면도 닫고 카드로
    space = plan.space;
    addPinned = false;
    if (!opts.tour && opts.persist !== false && settings.workspace !== space) {
      settings.workspace = space; // 고른 공간은 이 브라우저에 기억(지도를 바꿔도 유지)
      saveSettings(storage, settings);
    }
    if (selected && !opts.keepCard && !opts.tour) {
      selected = null; // 카드 닫기(select(null)와 같은 정리)
      editing = null;
      baselineNote = '';
      notices.clear();
      if (exploreNote) {
        exploreNote = null;
        renderExploreStatus();
      }
    }
    if (plan.closeScreens.includes('draft')) closeDraft();
    if (plan.closeScreens.includes('insight')) insight = null;
    if (plan.closeScreens.includes('merge')) merging = false;
    if (plan.closeScreens.includes('issues')) issues = null;
    if (plan.closeScreens.includes('settings')) settingsOpen = false;
    if (plan.closeScreens.includes('hidden')) hiddenOpen = false;
    if (plan.closeScreens.includes('rewind')) leaveRewind(); // 되감기를 끝내며 화면을 다시 그린다
    if (opts.tour) renderPanelQuiet();
    else renderPanel();
    graph.highlight(selected);
    if (!selected) $('detail').parentElement.scrollTop = 0; // 공간 첫 화면은 맨 위부터
  }

  // 공간 첫 화면. 공간마다 위에서부터 view/workspace.js의 panelParts가 정한 조각을 그린다(없는 조각·막힌 조각은 빼고)
  function renderSpaceHome(panel) {
    const summary = describeUniverse(view);
    lastNodeTotal = summary.node_total;
    // 묶은 지도(하위 유니버스가 있는 꼭지)만 위험 요약 한 줄(FU-10). 인사이트 탭과 같은 기준일·같은 밀집 기준의 같은 계산이다
    const grouped = (view.ref_links || []).length > 0;
    const rootGid = app.rootGid();
    const pickGid = (g) => { reveal(g); select(view.canonical(g)); };
    const starter = space === 'map' ? starterSteps(app.doc, view) : null;
    const split = space === 'map' ? splitHint(app.doc) : null;
    const parts = panelParts(space, {
      grouped, readOnly: app.readOnly, rewinding: !!rw, starter: !!starter, split: !!split, empty: summary.node_total <= 1,
      folder: !!(folder && folder.state.supported && !rw && !app.readOnly), conflicts: summary.empno_conflicts.length > 0, stale: summary.stale_links.length > 0,
    });
    const asOfDate = asOf();
    const n = currentDenseN();
    const insightRow = () => [
      el('div', { class: 'row' }, el('button', { type: 'button', 'data-testid': 'btn-insight-universe', onclick: () => openInsight('', 'risk') }, '인사이트 보기')),
      el('p', { class: 'muted small', 'data-testid': 'insight-hint' }, '인사이트는 기록을 세어 손볼 곳을 보여 줍니다(인수인계 위험 탭부터 열림): 인수인계 위험(혼자만 아는 업무, 넘길 준비, 막히면 퍼지는 영향) · 유사 경험자(비슷한 일을 해 본 사람) · 반복 비효율(되풀이되는 설명) · 밀집·공백(일이 몰린 사람, 담당자 없는 업무) · 흐름 변화(기간별 변화)'),
    ];
    // 조각 이름 → 요소(들). 여기서 null이면 그 조각은 그리지 않는다
    const build = {
      issues: () => issueEntry(view, rootGid, { rootGid, onOpen: () => openIssues(rootGid) }),
      weekly: () => weeklyBox(),
      recent: () => recentBox(),
      draft: () => el('div', { class: 'row' }, el('button', { type: 'button', class: 'primary', 'data-testid': 'btn-draft-universe', onclick: () => openDraft(rootGid) }, '인수인계 초안 만들기')),
      // 묶은 지도에서는 담당을 넘길 수 없다(업무가 하위 지도에 있다) — 그 지도를 열어서 하라고 안내(R11 RV11-5)
      'assignee-hint': () => el('p', { class: 'muted small', 'data-testid': 'handover-assignee-hint' }, grouped ? '담당을 넘기려면 그 업무가 있는 팀·업무 지도를 열어서 하세요' : '업무 하나의 담당만 바꾸려면 그래프에서 업무를 고른 뒤 「담당 넘기기」'),
      gaps: () => gapBox(gapWorkRows(view, { asOf: asOfDate, n }), pickGid, () => openInsight('', 'density')),
      solo: () => soloBox(soloRows(view, { asOf: asOfDate }), pickGid, () => openInsight('', 'risk')),
      docs: () => docsBox(recentHandoverDocs(view), pickGid),
      // 묶은 지도 「매주 점검」 → 통합 확인 대기가 있으면 「지도 관리」로 가는 한 줄(FU7-12). 배지 규칙은 그대로
      'merge-link': () => {
        const plan = app.mergePlan();
        if (!plan || !plan.counts.pending) return null;
        return el('p', { class: 'notice small', 'data-testid': 'check-merge-link' }, `통합 확인할 것 ${plan.counts.pending}건 `,
          // FU9-20: 「지도 관리」 첫 화면이 아니라 통합 확인 목록을 바로 연다(기능 찾기의 「같은 사람」과 같은 동작)
          el('button', { type: 'button', class: 'link', 'data-testid': 'check-merge-go', title: '통합 확인 목록을 바로 엽니다(「지도 관리」 공간)', onclick: () => { goSpace('edit'); if (app.mergePlan() && !rw) openMerge(); } }, '→ 통합 확인 열기'));
      },
      'map-risk': () => [singleDenom(), soloBox(soloRows(view, { asOf: asOfDate }), pickGid, () => openInsight('', 'risk')), denseBox(denseRows(view, { asOf: asOfDate, n }), pickGid, () => openInsight('', 'density')), gapBox(gapWorkRows(view, { asOf: asOfDate, n }), pickGid, () => openInsight('', 'density'))],
      'group-hint': () => el('p', { class: 'muted small', 'data-testid': 'check-ungrouped-note' }, '지난 점검과 비교하고 저장하는 매주 점검은 팀·부서로 묶은 지도에서 합니다 → 「지도 관리」의 「업무 지도 묶기」'),
      insight: () => insightRow(),
      'add-open': () => el('div', { class: 'row' }, el('button', { type: 'button', 'data-testid': 'goal-add-open', title: '화면 아래의 「사람·업무·문서 추가」를 펼칩니다', onclick: openAddForm }, '사람·업무·문서 추가'), el('span', { class: 'muted small' }, '하나씩 · 표로 · 글로 추가')),
      admin: () => adminBlock(),
      // 묶은 지도에서는 되감기를 쓰지 않는다(D-30) — 입구가 통째로 사라져 헷갈리지 않게 글로 추가처럼 안내 한 줄
      rewind: () => (app.rewindAvailable() ? rewindEntry({ points: app.editPoints(), onOpen: enterRewind }) : el('p', { class: 'muted small', 'data-testid': 'rewind-grouped-note' }, '편집 되감기: 묶은 지도에서는 쓸 수 없습니다 — 팀·업무 지도를 열어 되감으세요')),
      hidden: () => hiddenEntry(hiddenNodesOf(app.doc), { onOpen: () => { rememberOpener(); hiddenOpen = true; renderPanel(); } }),
      merge: () => mergeButton(),
      folder: () => folderEntry(),
    };
    // FU9-17: 묶지 않은 지도의 「매주 점검」 첫 줄 — 아래 세 상자 숫자의 분모(기준일에 진행 중인 업무 수)
    const singleDenom = () => {
      const r = teamRiskSummary(view, { asOf: asOfDate, n });
      return r.works > 0 ? el('p', { class: 'risk-summary', 'data-testid': 'check-denom' }, el('strong', {}, `업무 ${r.works}개 중`), ` ${teamRiskParts(r).join(' · ')}`) : null;
    };
    const listOf = () => parts.flatMap((k) => (build[k] ? [build[k]()].flat() : [])).filter(Boolean);
    const riskNums = space === 'check' && grouped ? teamRiskSummary(view, { asOf: asOfDate, n }) : null;
    // 이름 목록(FU5-1): 저장할 때 같이 남기고 지난 점검과 비교한다. 숫자와 같은 기준일·밀집 기준의 같은 계산이라 숫자와 어긋나지 않는다
    // owners(M6): 업무별 지금 담당 이름. 기준에 함께 저장하고 「담당이 바뀐 업무」를 가린다
    const riskNames = riskNums ? { ...namesFromInspection(inspectionInput(view, { asOf: asOfDate, n, mapName: '' })), owners: currentOwnersByWork(view, asOfDate) } : null;
    const denseNow = riskNums && riskNums.dense ? denseRows(view, { asOf: asOfDate, n }) : null;
    const riskSummary = riskNums ? { denom: riskNums.works > 0 ? `업무 ${riskNums.works}개 중` : null, teams: teamRiskRows(view, { asOf: asOfDate, n }).map((r) => ({ id: r.id, text: teamRowText(r) })), parts: teamRiskParts(riskNums), onMore: () => openInsight('', 'risk'), compare: riskCompareFor(riskNums, riskNames), dense: denseNow && denseNow.rows.length ? { rows: denseNow.rows, total: denseNow.total, onPick: pickGid } : null } : null;
    renderUniverseSummary(panel, summary, display.nodes.length, {
      space, split, starter, universeId: app.doc.universe.id, riskSummary,
      onOpenFolder: folder && folder.state.supported && !rw && !app.readOnly ? openFolderTab : null,
      onGoStep: goStep,
      [space]: space === 'map' ? undefined : listOf(),
    });
    // 꼭지만 있으면 「노드 추가」를 펼쳐 둔다(검토5 U-5). 안내 문구(detail.js)와 같은 기준: 하위 유니버스를 묶은 화면은 노드가 있으므로 건드리지 않는다
    if (summary.node_total <= 1 && !app.readOnly) document.querySelector('details.add').open = true;
  }

  // 「지도 관리」 공간: 머리글에서 옮겨 온 「새 업무 지도」·「업무 지도 묶기」·「가져오기·내보내기」. 단추는 한 번 만든 그대로(id·동작 유지)이고, 패널을 다시 그릴 때마다 보관함에서 꺼내 끼운다
  function adminBlock() {
    return el('div', { class: 'ws-admin', 'data-testid': 'ws-admin' },
      el('p', { class: 'small' }, el('strong', {}, '업무 지도')),
      el('p', { class: 'muted small', 'data-testid': 'ws-map-owner' }, `이 지도: ${view.universe.name} · 작성 주체 ${view.universe.owner}`),
      el('div', { class: 'row' }, ...adminButtons),
      el('p', { class: 'muted small' }, '새 업무 지도를 만들거나, 지도를 팀·부서로 묶거나, 파일로 가져오고 내보냅니다'));
  }

  // 「처음 할 일」 줄을 누르면 그 일을 하는 공간으로 가서 해당 자리를 잠깐 강조한다
  function goStep(st) {
    goSpace(st.space);
    if (st.space === 'edit') document.querySelector('details.add').open = true; // 「지도 관리」의 추가 칸은 단추가 입구라 닫혀 있다 — 처음 할 일에서 왔으면 바로 펼친다(CR-22 K)
    const t = $('detail').querySelector(st.space === 'record' ? '[data-testid=weekly-quick]' : '[data-testid=goal-add-open]');
    if (t) {
      if (typeof t.scrollIntoView === 'function') t.scrollIntoView({ block: 'start' });
      flash(t);
    }
  }

  function select(gid) {
    const changed = gid !== selected;
    if (changed) { editing = null; baselineNote = ''; notices.clear(); }
    settingsOpen = false;
    merging = false;
    closeDraft();
    insight = null;
    issues = null;
    hiddenOpen = false;
    selected = gid;
    graph.highlight(gid);
    renderPanel();
    // 새 항목 카드는 늘 맨 위(이름·상태 줄이 보이게)에서 연다(FU6-2). 관련 칸으로 데려가는 길(기능 찾기·거기로 가기)은 이 뒤에 스스로 스크롤한다
    if (changed && $('detail').parentElement) $('detail').parentElement.scrollTop = 0;
    if (exploreNote) { // 「찾음」·「이어진 항목 없음」 알림은 다른 항목을 고르면 지운다
      exploreNote = null;
      renderExploreStatus();
    }
  }

  // 성공 알림의 「거기로 가기」(CR-22 F): 이력 줄 / 항목 / 공간(통합 확인)
  function goNotice(g) {
    if (g.type === 'history') showHistory(g.nodeGid, g.gids);
    else if (g.type === 'node') focus(g.nodeGid);
    else if (g.type === 'hidden') { rememberOpener(); hiddenOpen = true; renderPanel(); } // 숨긴 항목 목록(되살리기)
    else if (g.type === 'space') {
      goSpace(g.space);
      if (g.merge && app.mergePlan()) openMerge();
    }
  }

  // 상세 패널의 연결된 노드를 눌렀을 때: 그래프에서도 그 노드로 이동한다(접혀 있으면 펼친다)
  function focus(gid) {
    reveal(gid);
    select(view.canonical(gid));
    const node = graph.cy.getElementById(view.canonical(gid));
    if (!node.empty()) graph.cy.animate({ center: { eles: node } }, { duration: 200 });
  }

  // ── 길 찾기(CR-21 B·A, CR-22 W): 최근 기록·기능 찾기 ──
  // 개요 「최근 기록」(B-2): 계산은 view/recent-records.js. 「보기」는 알림의 「이력에서 보기」와 같은 이동
  function recentBox() {
    return recentList(recentRecords(view), (row) => showHistory(row.target_gid, [row.gid], true), { onAll: () => openMapHistTable(), canRecord: canWeekly() });
  }

  // 화면 아래 「사람·업무·문서 추가」를 펼치고 거기로 간다(개요 「지도 고치기」의 단추)
  function openAddForm() {
    const details = document.querySelector('details.add');
    if (details.open && document.querySelector('aside').classList.contains('add-by-btn')) {
      details.open = false;
      return;
    }
    details.open = true;
    if (typeof details.scrollIntoView === 'function') details.scrollIntoView({ block: 'start' });
    flash(details.querySelector('summary'));
    const first = $('add-slot').querySelector('[data-testid=node-type]');
    if (first) first.focus({ preventScroll: true });
  }

  // 기능 찾기(A): 결과의 동작 키(view/feature-index.js의 go)를 푼다. 못 쓰는 기능(blocked)은 목록이 흐리게 보이고 여기까지 오지 않는다
  const featureCtx = () => ({ readOnly: app.readOnly, rewinding: !!rw, grouped: isGroupedView(view), folderOk: !!(folder && folder.state.supported), tourOk: !!tour });
  const MISSING_TARGET_REASON = {
    'weekly-quick': '「이번 주 기록」 양식이 없는 화면입니다 — 읽기 전용이거나 업무가 없는 지도(묶은 지도 포함)입니다. 업무가 있는 팀·업무 지도를 열어서 쓰세요',
    'hidden-count': '숨긴 항목이 없습니다',
    'merge-hint': '통합 확인은 팀·부서로 묶은 지도에서 씁니다',
    'team-risk-compare': '지난 점검과 비교하는 매주 점검은 팀·부서로 묶은 지도에서 합니다',
  };
  // 그 기능이 있는 공간으로 바꾼 뒤, 선택·열린 패널을 풀어 공간 첫 화면을 그리고 그 요소(없으면 공간 제목)를 강조한다
  function showInOverview(testid, toSpace) {
    if (toSpace) goSpace(toSpace);
    select(null);
    const root = $('detail');
    const hit = root.querySelector(`[data-testid=${testid}]`);
    const target = hit || root.querySelector('[data-testid=check-ungrouped-note]') || root.querySelector('[data-testid=ws-title]');
    if (!hit) { // 가려는 자리가 이 화면에 없다: 공간 제목만 강조되면 왜인지 모르므로 이유 한 줄(R11 RV11C-10)
      exploreNote = { text: MISSING_TARGET_REASON[testid] || '지금 이 화면에는 그 자리가 없습니다', testid: 'feature-missing-note', warn: true };
      renderExploreStatus();
    }
    if (!target) return;
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'start' });
    flash(target);
  }
  // 카드의 접힌 묶음 안 요소로 데려갈 때는 그 묶음을 먼저 펼친다(기능 찾기·「거기로 가기」)
  function openCardGroups(node) {
    for (let g = node && node.parentElement ? node.parentElement.closest('details.card-group') : null; g; g = g.parentElement ? g.parentElement.closest('details.card-group') : null) g.open = true;
  }
  // 고른 항목의 상세에서 접힌 상자(담당 바꾸기·협업자 추가)를 펼쳐 강조한다
  function openDetailBox(testid) {
    const box = openFormBox(testid) || $('detail').querySelector(`[data-testid=${testid}]`);
    if (!box) return;
    openCardGroups(box);
    box.open = true;
    if (typeof box.scrollIntoView === 'function') box.scrollIntoView({ block: 'center' });
    flash(box);
  }
  function runNodeFeature(action) {
    if (action === 'assignee') return openDetailBox('assignee-change');
    if (action === 'collab') return openDetailBox('collab-quick');
    if (action === 'hide') { // 「⋯」 메뉴를 열어 「숨기기」를 강조한다(FU9-24)
      const menu = $('detail').querySelector('details.more-tools');
      if (menu) menu.open = true;
      const btn = $('detail').querySelector('[data-testid=btn-hide]');
      if (btn) { flash(btn); focusSoft(btn); }
      return undefined;
    }
    editing = { kind: action === 'event' ? 'event' : action === 'edge' ? 'edge' : 'node' };
    renderPanel();
    $('detail').parentElement.scrollTop = 0;
  }
  // 창 안의 요소로 데려간다: 접힌 상자(details)가 둘러싸고 있으면 모두 펼치고, 그 자리로 스크롤해 잠깐 강조한다(예: 「고급」 안의 「가상 데이터 초기화」)
  function revealInDialog(dialog, testid) {
    const target = dialog && testid ? dialog.querySelector(`[data-testid=${testid}]`) : null;
    if (!target) return;
    for (let d = target.parentElement ? target.parentElement.closest('details') : null; d; d = d.parentElement ? d.parentElement.closest('details') : null) d.open = true;
    if (typeof target.scrollIntoView === 'function') target.scrollIntoView({ block: 'center' });
    flash(target);
    focusSoft(target);
  }
  function openDialogFeature(name, arg, anchor) {
    if (name === 'import') {
      openImport();
      const tab = document.querySelector(`[data-testid=import-tab-${arg}]`);
      if (tab) tab.click();
      revealInDialog($('import-dialog'), anchor);
    } else if (name === 'group') $('group-open').click();
    else if (name === 'create') $('create-open').click();
    else if (name === 'settings') $('settings-open').click();
    else if (name === 'help') $('tour-open').click();
    else if (name === 'table-add') openTable('add');
    else if (name === 'table-edit') openTable('edit');
    else if (name === 'text-add') openTextAdd();
    else if (name === 'doc-attach') openDocAttach(selectedWorkId());
  }
  // 업무(또는 항목)를 먼저 골라야 하는 기능: 지금 고른 것이 맞으면 바로, 아니면 업무 이름 목록을 돌려줘 고르게 한다
  function goNodeFeature(r) {
    const action = r.go.split(':')[1];
    const sel = selected ? view.getNode(view.canonical(selected)) : null;
    const fits = sel && !sel.hidden && isOwn(sel.gid) && (r.needs !== 'work' || sel.core_type === 'work');
    if (fits) return runNodeFeature(action);
    const works = ownNodes().filter((n) => n.core_type === 'work').slice(0, FEATURE_WORK_LIMIT).map((n) => ({ gid: n.gid, label: n.label }));
    return { pick: { works } };
  }
  // 묶은 지도에서 「메모 남기기」: 메모는 업무가 있는 하위 업무 지도에서 쓴다 — 그래프 위 구석 안내 대신 「어느 업무 지도에 쓸까요?」 목록(담당 넘기기의 업무 먼저 고르기와 같은 모양, FU8-28)
  function childMapsToWrite() {
    const ids = [...new Set((view.ref_links || []).map((l) => l.child))];
    return ids.map((id) => ({ id, name: (view.nodes.find((n) => n.universe_id === id) || {}).universe_name, works: view.nodes.some((n) => n.universe_id === id && n.core_type === 'work' && !n.hidden) }))
      .filter((m) => m.name && m.works).map((m) => ({ gid: m.id, label: m.name }));
  }
  function goFeature(r) {
    const [kind, arg, arg2, arg3] = r.go.split(':');
    if (kind === 'ov' && arg === 'weekly-quick' && isGroupedView(view) && !app.readOnly && !rw && !$('detail').querySelector('[data-testid=weekly-quick]')) {
      const maps = childMapsToWrite();
      if (maps.length) return { pick: { works: maps, note: '어느 업무 지도에 쓸까요? 메모는 업무가 있는 지도에서 남깁니다. 고르면 그 지도를 열고 「기록」 공간으로 갑니다.', onPick: (id) => { goSpace('record'); openUniverse(id); } } };
    }
    if (kind === 'ov') return showInOverview(arg, r.space);
    // 그 기능이 있는 공간으로 먼저 바꾼다(되감기 중 창만 여는 기능은 되감기를 끝내지 않도록 그대로 둔다)
    if (r.space && !(rw && kind === 'dlg')) goSpace(r.space, { keepCard: true }); // 고른 항목에 일을 시키는 길이라 카드는 둔다(FU6-1)
    if (kind === 'node') return goNodeFeature(r);
    if (kind === 'dlg') return openDialogFeature(arg, arg2, arg3);
    if (kind === 'insight') {
      openInsight('', arg);
      return undefined;
    }
    if (kind === 'summary') return openCheckSummary();
    if (kind === 'merge') { // 「같은 사람」 등: 공간까지만이 아니라 통합 확인 목록 화면을 바로 연다(FU8-23). 묶은 지도가 아니면 왜 못 여는지 알려 주는 자리로
      if (app.mergePlan() && !rw) { openMerge(); return undefined; }
      return showInOverview('merge-hint', r.space);
    }
    if (kind === 'time') {
      flash($('timebar'));
      if (!tb.range.hidden) tb.range.focus();
    } else if (kind === 'find') {
      const input = document.querySelector('[data-testid=find-input]');
      flash(input);
      if (input) input.focus();
    } else if (kind === 'tools') {
      applyTools(true, true);
      flash($('tools-more'));
    }
    return undefined;
  }
  // 초점을 안전하게 옮긴다: 초점을 받을 수 없는 요소(제목·줄)는 tabindex -1을 달고, 접힌 상자(details)는 제목줄(summary)로
  function focusSoft(node) {
    const t = node && node.tagName === 'DETAILS' ? node.querySelector('summary') || node : node;
    if (!t || typeof t.focus !== 'function') return;
    if (!t.matches('button, a[href], input, select, textarea, summary, [tabindex]')) t.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  }
  // 기능 찾기 결과를 골라 이동한 뒤 초점이 body로 빠지지 않게(R12 FU7-7): 이동한 곳의 강조 요소 → 방금 기록한 이력 줄 → 패널 제목 순서
  function focusAfterFeature() {
    const a = document.activeElement;
    if (a && a !== document.body && !$('feature-box').contains(a)) return; // 이동하면서 이미 어딘가로 옮겼다(양식 칸·창 등)
    focusSoft(document.querySelector('.goal-flash') || $('detail').querySelector('[data-just-added="1"]') || $('detail').querySelector('[data-testid=ws-title]') || $('detail').querySelector('h2'));
  }
  const goFeatureFocused = (r) => {
    const out = goFeature(r);
    if (!out || !out.pick) focusAfterFeature();
    return out;
  };
  featureFind({
    container: $('feature-box'),
    search: (q) => searchFeatures(q, featureCtx()),
    common: () => commonFeatures(featureCtx()), // 빈 칸을 누르면 보이는 「자주 하는 일」
    items: (q) => searchMapItems(view, q), // 지도 안 항목 이름(그래프 「항목 찾기」와 같은 찾기 함수)
    onItem: (row) => { goTo(row.gid); },
    onGo: goFeatureFocused,
    onPick: (gid, r) => { focus(gid); runNodeFeature(r.go.split(':')[1]); focusAfterFeature(); },
    // 쓴 것 찾기(R11 FU6-4): 기능 결과가 없거나 적으면 아래에 「기록에서 낱말 n건」(읽기만, 최대 8건)
    records: (q) => searchRecords(view, q),
    recordFew: RECORD_SEARCH.FEATURE_FEW,
    onRecord: (row) => { showHistory(row.target_gid, [row.gid], true); focusAfterFeature(); },
    onRecordsAll: (q) => { openMapHistTable(q); focusAfterFeature(); },
  });

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

  // 주변만 보기(CR-22 G)가 따라가지 않을 연결: timeOffIds와 같은 기준(기준일에 유효하지 않은 담당·소속)
  function nbhdSkip() {
    return offPeriodEdgeIds(view.visible().edges, viewDate || todayLocal(), periodStatus);
  }

  function applyTime() {
    renderTimebar();
    graph.setTimeOff(timeOffIds());
    syncSpaceMarks(); // 기준일이 바뀌면 지금 담당·혼자만 아는 일이 달라진다
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
        note: el('span', { class: 'small' }, '이 날짜에 맡고 있지 않던 담당·소속 선은 빠지고 사람·조직은 흐리게 보입니다. 카드·인사이트도 이 날짜 기준(초안은 오늘 기준)'),
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
    let d = neighborhoodDisplay(view, gid, depth, { skipEdges: nbhdSkip() });
    if (!d) return;
    // 지난 담당만 있는 사람처럼 오늘 유효한 연결이 없어 0이 되면 지난 연결까지 포함해 보여 주고 한 줄 알린다(R11 RV11C-3)
    let all = false;
    if (d.neighbor_count === 0) {
      const wide = neighborhoodDisplay(view, gid, depth);
      if (wide && wide.neighbor_count > 0) {
        d = wide;
        all = true;
      }
    }
    if (d.neighbor_count === 0) {
      // 이웃이 없으면 화면은 그대로 두고 알린다(R-17 ④)
      exploreNote = { text: `이어진 항목 없음: 「${view.getNode(gid).label}」${josa(view.getNode(gid).label, '은/는')} 연결된 항목이 없어 주변만 보기를 할 수 없습니다.`, warn: true };
      return renderExploreStatus();
    }
    // FU9-9: 처음 들어갈 때(깊이만 바꾸는 때는 말고) 접힘 상태·항목 자리·배율·위치를 기억해 두었다가 「전체 보기로 돌아가기」에서 되돌린다
    if (!nbhd) nbhdBack = { expanded: new Set(expanded), snap: graph.snapshot() };
    nbhd = { center: d.center, depth, all };
    selected = d.center;
    exploreNote = all ? { text: '오늘 유효한 연결이 없어 지난 담당까지 보여 줍니다', testid: 'nbhd-past-note' } : null;
    refresh();
    graph.relayout();
  }

  function leaveNbhd() {
    if (!nbhd) return;
    nbhd = null;
    exploreNote = null;
    // FU9-9: 들어가기 전 접힘 상태로 되돌리고, 그때 있던 항목만 그려지면 그 자리·배율·위치를 그대로 되살린다(없던 항목이 끼면 새로 배치)
    const back = nbhdBack;
    nbhdBack = null;
    if (back) {
      expanded.clear();
      for (const u of back.expanded) expanded.add(u);
    }
    refresh();
    if (back && graph.cy.nodes().every((n) => back.snap.pos.has(n.id()))) graph.restore(back.snap);
    else graph.relayout();
  }

  function nbhdButtons(gid) {
    const node = view.getNode(gid);
    if (!node || node.hidden) return null;
    const on = nbhd && nbhd.center === view.canonical(gid);
    return [on && nbhd.depth === 1 ? null : el('button', { type: 'button', 'data-testid': 'btn-nbhd', title: '이 항목과 바로 이어진 항목만 남겨 다시 배치합니다(데이터는 바뀌지 않음)', onclick: () => enterNbhd(gid, 1) }, '주변만 보기'),
        on && nbhd.depth === 2 ? null : el('button', { type: 'button', 'data-testid': 'btn-nbhd2', title: '두 단계 떨어진 항목까지 남깁니다', onclick: () => enterNbhd(gid, 2) }, '주변 2단계'),
        nbhd ? el('button', { type: 'button', 'data-testid': 'btn-nbhd-exit', onclick: leaveNbhd }, '전체 보기로 돌아가기') : null].filter(Boolean);
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
        el('button', { type: 'button', class: 'small-btn', 'data-testid': 'nbhd-exit', onclick: leaveNbhd }, '전체 보기로 돌아가기')));
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
    closeDraft();
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
    notify('plain', { testid: 'rewind-done', text: doneText(at, r.counts, (r.skipped || []).length, labelOf) });
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
    let nd = nbhd ? neighborhoodDisplay(view, nbhd.center, nbhd.depth, { skipEdges: nbhd.all ? null : nbhdSkip() }) : null;
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
    if (opening) graph.showOpened(universeId); // CR-22 G 7: 펼친 항목에 맞춰 화면을 맞추고 잠시 강조
  }

  function removeChild(childId, label) {
    if (!window.confirm(`「${label}」${josa(label, '을/를')} 이 묶음에서 뺄까요? 원래 업무 지도는 그대로 남습니다.`)) return;
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

  // 카드 안의 작은 양식(담당 넘기기·협업자 추가)은 Esc로 닫고 초점은 「⋯」로(R12 FU7-13). 입력 칸 안의 Esc도 여기서 먼저 처리한다(한글 조합 중에는 건너뜀)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return;
    const slot = e.target && e.target.closest ? e.target.closest('[data-testid=card-forms]') : null;
    if (!slot) return;
    e.preventDefault();
    for (const box of slot.children) {
      if (box.open) box.open = false;
      box.hidden = true;
    }
    slot.hidden = true;
    const sm = $('detail').querySelector('details.more-tools > summary');
    if (sm) sm.focus({ preventScroll: true });
  });

  // Esc: 노드 선택 해제(R-17 ⑧). 입력 칸·대화상자·펼친 메뉴 안에서는 그쪽이 먼저 처리한다(찾기 칸은 stopPropagation)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    const t = e.target;
    if (t && (t.closest('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    // Esc는 노드 상세에서만 선택을 푼다. 편집 양식·초안은 입력이, 통합 확인·인사이트·설정은 고른 탭·작업이 사라지므로
    // Esc로 닫지 않는다(각 화면의 「취소」·「닫기」를 쓴다. 검토: 선택 여부에 따라 같은 패널이 닫히기도 하던 불일치)
    // 열려 있는 「⋯」 메뉴가 있으면 그것만 닫고 메뉴 단추로(CR-22 F)
    const openMenu = document.querySelector('details.more-tools[open]');
    if (openMenu) {
      openMenu.open = false;
      const sm = openMenu.querySelector('summary');
      if (sm) sm.focus();
      return;
    }
    // 패널 보기(미해결·숨긴 항목·인사이트·이력 표·통합 확인·설정·초안)는 Esc로 닫고 연 단추로 돌아간다(U-3, CR-22 F)
    if (closeSidePanel()) return;
    if (!selected || editing || drafting || merging || settingsOpen) return;
    select(null);
  });
  // 「⋯」 메뉴 안에서 ↑ ↓ 로 항목(맨 앞은 「⋯」 단추)을 옮긴다. 열기·닫기는 Enter·Space·Esc (X-42)
  document.addEventListener('keydown', (e) => {
    if ((e.key !== 'ArrowDown' && e.key !== 'ArrowUp') || e.defaultPrevented) return;
    const menu = e.target && e.target.closest ? e.target.closest('details.more-tools[open]') : null;
    if (!menu || ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    const items = [menu.querySelector('summary'), ...menu.querySelectorAll('button:not([disabled]), a[href]')].filter(Boolean);
    const i = items.indexOf(e.target);
    if (i < 0) return;
    e.preventDefault();
    items[Math.min(items.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))].focus();
  });
  // 「⋯」 메뉴: 바깥을 눌러도 닫힌다(CR-22 F)
  document.addEventListener('click', (e) => {
    for (const d of document.querySelectorAll('details.more-tools[open]')) if (!d.contains(e.target)) d.open = false;
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
  // 이전 폭(lastGraphW)은 처음부터 알고 있어야 한다. 처음 한 번 기준이 없으면(null) 배율·가운데를 못 맞춘 채 새 폭만 적고,
  // 나중에 되돌릴 때 한 번도 줄이지 않은 배율을 폭 비율만큼 키워 그래프가 어긋난다(촬영 콘티 2026-10-26: 넓은 패널 뒤 지도 보기).
  // cy.width()는 resize 뒤 처음 읽을 때 지금 칸 크기를 적어 이전 폭으로 못 쓴다. 그래서 칸 크기 관찰기가 늘 마지막 폭을 따라간다
  // (패널을 바꾸는 코드는 관찰기보다 먼저 이 함수를 불러 이전 폭을 쓴다)
  let lastGraphW = graph.cy.container().clientWidth;
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { lastGraphW = graph.cy.container().clientWidth; }).observe(graph.cy.container());
  const resizeGraphKeepCenter = () => {
    const cy = graph.cy;
    const el = cy.container();
    const w = el.clientWidth;
    if (!(lastGraphW > 0) || !(w > 0) || w === lastGraphW) {
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
  // 코드에서 폭을 바꿀 때(기록 표 화면): 단추를 눌렀을 때와 같되 그래프 보던 자리는 그대로 둔다
  const setWideKeep = (on) => {
    setWide(on);
    applyPanelWidth();
    resizeGraphKeepCenter();
  };
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
    noteOpener();
    settingsOpen = true;
    merging = false;
    insight = null;
    issues = null;
    closeDraft();
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
    openUniverse(r.doc.universe.id, '', false, 'group', r.auto_linked || 0);
  });
  if (app.readOnly) $('group-open').disabled = true;

  const createDialog = wireCreateDialog(app, $, () => settings.authorName);

  // 표로 추가·고치기(T-19): 한 번의 묶음 저장. 끝나면 마지막 새 노드를 고른다
  const openTable = tableDialog({
    dialog: $('table-dialog'),
    app,
    onSaved: (r) => {
      const last = r.created[r.created.length - 1] || r.updated[r.updated.length - 1];
      // 새로 넣은 표는 마지막 항목 카드 대신 지도 전체(선택 없음)로 두고 알림에 개수를 알린다(FU9-12)
      afterSave(r, r.created.length ? null : (last ? toGid(currentId(), last.id) : selected));
      renderAddForm(r.summary || `표에서 ${r.created.length}개를 추가하고 ${r.updated.length}개를 고쳤습니다.`); // 연결 칸을 썼으면 연결 요약(CR-13 C)
      const lastNew = r.created[r.created.length - 1];
      if (lastNew) notify('table-saved', { count: r.created.length, summary: r.summary || '' });
      else notify('table-edit', { summary: r.summary || `표에서 ${r.updated.length}개를 고쳤습니다.`, nodeGid: last ? toGid(currentId(), last.id) : '' });
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
      if (last) notify('table-add', { count: r.created.length, summary: r.summary || '', nodeGid: toGid(currentId(), last.id), core: last.core_type });
    },
  });

  // 문서로 더하기(CR-23): 문서 글 → 미리 보기(문서·할 일 업무·메모) → 체크 → 한 번의 묶음 저장. 대상 업무 하나가 미리 골라진 채 열릴 수 있다(카드의 「이 업무에 문서 더하기」)
  const selectedWorkId = () => {
    const n = selected && isOwn(selected) ? view.getNode(view.canonical(selected)) : null;
    return n && !n.hidden && n.core_type === 'work' ? n.id : '';
  };
  const openDocAttach = docAttachDialog({
    dialog: $('doc-attach-dialog'),
    example: DOC_ATTACH_EXAMPLE,
    app,
    getView: () => view,
    aiReady: () => isLive(provider) && typeof provider.convert === 'function',
    // 「Claude로 읽기」: 문서 읽기(AI 변환과 같은 읽기 + 붙일 업무·지도 정보 + 검토)의 결과를 규칙 결과 대신 보인다. 문서 전체를 한 번에 보낸다(덩어리 나눔 없음)
    convertAi: (text, opt) => convertDocumentAsync(text, { provider, ...opt }),
    today: todayLocal,
    onSaved: (r, ctx) => {
      afterSave(r, toGid(currentId(), ctx.targetId)); // 대상 업무 카드를 연다
      // 문서로 더하기는 한 번에 항목을 여럿 늘린다: 작은 지도에서는 기존 자리에 덧붙이면 역할이 한 줄로 늘어지고 업무 이름이 가려져
      // 배치를 다시 계산한다(「다시 정렬」과 같음). 큰 지도는 익숙한 자리를 지키도록 그대로(메인 2026-10-28 C 캡처 확인)
      if (r.ok && (r.created || []).length >= DOC_ATTACH_RELAYOUT.minAdded && app.doc.nodes.filter((n) => !n.hidden).length <= DOC_ATTACH_RELAYOUT.maxNodes) graph.relayout();
      renderAddForm(ctx.notice);
      notify('doc-attach', { testid: 'doc-attach-notice', text: ctx.notice, nodeGid: toGid(currentId(), ctx.targetId) }, { long: true, goLabel: '업무 보기' });
    },
  });

  docAttachHook.can = () => !app.readOnly && !isGroupedView(view);
  docAttachHook.open = () => openDocAttach(selectedWorkId());

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
  const ADD_TOOLS_NOTE = '표로 추가: 스프레드시트에서 복사한 표를 붙여 넣어 여러 개를 한 번에 · 글로 추가: 몇 문장짜리 글을 붙여 넣으면 사람·업무·산출물과 연결을 찾아 미리 보여 줍니다 · 문서로 더하기: 회의록·매뉴얼 같은 문서를 업무 하나에 붙여 문서·할 일·메모로 지도를 키웁니다 · 표로 고치기: 지금 항목을 표로 펼쳐 한꺼번에 고침';
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
        grouped
          ? el('span', { class: 'muted small', 'data-testid': 'doc-attach-grouped-note', title: '묶은 지도에서는 문서로 더하기를 쓸 수 없습니다 — 팀·업무 지도를 열어 넣으세요' }, '문서로 더하기: 팀·업무 지도를 열어 넣으세요')
          : el('button', { type: 'button', 'data-testid': 'btn-doc-attach', title: '회의록·매뉴얼·메모 같은 문서를 붙여 넣으면 업무 하나에 문서·할 일·메모로 더할 것을 미리 보여 줍니다. 체크한 것만 더합니다', onclick: () => openDocAttach(selectedWorkId()) }, '문서로 더하기'),
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
          const { attach_root: attachRoot, link, extra_names: rawNames, ...input } = values;
          // 노드·꼭지 연결(포함)·함께 이을 연결을 한 묶음으로 저장한다(D-18): 연결만 실패해 노드만 남는 일이 없다.
          // 새 노드는 묶음 안 1행이므로 연결 쪽 끝은 '@1'로 가리킨다
          // 업무면 담당자·산출물·다음 업무 이름 칸(선택)도 같은 묶음에(표로 추가의 한 행 처리, CR-22 F)
          const names = extraNames(input.core_type, rawNames || {});
          const ops = addNodeOps({ input, attachRoot, link, names, doc: app.doc });
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
          notify('add-one', { count: b.created.length, label: node.label, extra: extraSummary(names), nodeGid: toGid(currentId(), node.id), core: node.core_type });
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
    addPinned = true; // 초안의 「＋ 사람 추가」처럼 다른 공간에서 불렀으면 추가 칸을 보인다
    syncAdd();
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
    if (!window.confirm(`모든 가상 데이터를 처음 샘플 상태로 되돌릴까요? 샘플에 추가한 항목과 직접 묶은 업무 지도는 사라집니다.${mineText}`)) return;
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
    space,
    baselineSaved,
    canSaveBaseline: canSaveBaseline(),
    summaryUsed,
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
      onStart: () => { draftShown = false; evidenceUsed = false; foundGid = null; tourSaved = false; baselineSaved = false; summaryUsed = false; },
      onSpace: (key, opt = {}) => {
        if (opt.deselect && selected && !openScreens().some((x) => x !== 'settings')) select(null); // 그 단계는 지도 전체 화면에서 시작(CR-22)
        if (opt.home) { goSpace(key, { tour: true }); return true; }
        if (key === space) return true;
        if (openScreens().some((x) => x !== 'settings')) return false; // 읽고 있는 초안 같은 작업 화면은 닫지 않는다 — 닫히면 따라 하기가 다시 바꾼다
        goSpace(key, { tour: true });
        return true;
      }, // 단계에 맞는 공간으로(CR-22 W). 이미 그 공간이면 열린 초안 같은 작업 화면을 닫지 않는다. 기억하지 않고 따라 하기를 다시 부르지 않는다
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
      // 처음 열면 맨 위부터 읽게 하고 초점은 제목에 둔다(FU9-27: 아래 단추에 초점이 가 중간부터 열리던 것)
      helpBox.scrollTop = 0;
      const title = helpBox.querySelector('#help-title');
      if (title) title.focus({ preventScroll: true });
    });
  }

  // 마지막으로 연 지도(D-1): 이 브라우저 설정에만 둔다. 내용 포함 HTML 보기에서는 저장소를 쓰지 않으므로 남기지 않는다
  if (!embedMode && storage && settings.lastOpenedId !== currentId()) {
    settings.lastOpenedId = currentId();
    saveSettings(storage, settings);
  }
  refresh();
  // 묶은 직후 띠·가져온 직후 알림(CR-22 F): 화면을 다시 열었으므로 주소의 일회용 표시로 안다.
  // 주소만 믿지 않는다(R11 RV11S-1): 묶기·가져오기를 한 탭이 남긴 sessionStorage 표지(지도 id + 종류)가 주소와 맞을 때만 띄우고, 표지는 어느 경우에도 지운다
  let doneFlag = '';
  let doneAuto = 0;
  try {
    const raw = window.sessionStorage.getItem(DONE_KEY);
    window.sessionStorage.removeItem(DONE_KEY);
    if (doneHash && doneMarkMatches(raw, doneHash, currentId())) {
      doneFlag = doneHash;
      doneAuto = doneMarkAuto(raw);
    }
  } catch { /* 저장소를 쓸 수 없으면 알림 생략 */ }
  if (doneFlag === 'group') {
    const strip = groupedStrip(app.mergePlan(), { name: app.doc.universe.name, auto: doneAuto });
    notify('group', { text: strip.text, pending: strip.pending });
  } else if (doneFlag === 'import') {
    // FU9-5: 가져온 판은 이미 파일이 있는 판이므로 아직 받아 두지 않은 변경은 가져온 뒤부터 0건으로 센다
    if (storage && !app.readOnly) { settings.backupDismissedAt = nowIso(); saveSettings(storage, settings); showBackupNudge(); }
    notify('import', { name: app.doc.universe.name, nodes: describeUniverse(view).node_total });
  }
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
    labelStats: () => graph.labelStats(), // CR-22 G 점검용: 이름 계산 결과 {zoom, shown, total}
    refreshLabels: () => graph.refreshLabels(), // 확대 뒤 지연 계산을 기다리지 않고 지금 계산(시간 재기)
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
    // CR-22 W 점검용: 작업 공간
    get space() {
      return space;
    },
    goSpace: (key, persist = true) => goSpace(key, { persist }), // persist=false: 설정에 기억하지 않는다(점검 도구가 위치 때문에 옮길 때)
    // CR-14 A 점검용: 편집 되감기 상태
    get rewind() {
      return rw ? { at: rw.at } : null;
    },
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
