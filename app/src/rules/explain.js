// 인사이트 설명 요청(역할 b, 12.3 insight_explain). 화면과 사전 생성 도구가 같은 함수를 써야 조회 키가 맞는다.
// 각 함수는 {target, evidence_ids, rule} 또는 null(결과가 없거나 데이터 부족이면 설명하지 않음)을 돌려준다.
// rule은 LLM 없이 만든 설명 문장(규칙 기반)이고, 문장마다 근거 ID가 붙는다. 순수 함수(12.7 rules).

const uniq = (ids) => [...new Set(ids)].sort();

/** 유사 경험자 결과(similarExperts) */
export function similarExplain(result, workGid) {
  if (!result || result.status !== 'ok') return null;
  const direct = result.direct || [];
  const roles = result.roles || [];
  const people = result.people; // 직접 해 본 사람도 비슷한 일을 했으면 여기에 센다(점수가 있다)
  const top = people.slice(0, 3);
  const rule = [];
  // CR-17 B: 직접 해 본 사람 → 비슷한 일을 해 본 사람 → 역할 이름(사람 미확인) 순서
  if (direct.length) {
    rule.push({
      text: `이 업무를 직접 해 본 사람은 ${direct.length}명입니다: ${direct.map((p) => `${p.label}(${p.direct_works[0].period})`).join(', ')}.`,
      evidence_ids: uniq(direct.flatMap((p) => p.direct_works.flatMap((d) => d.evidence_ids))),
    });
  }
  if (people.length) {
    rule.push({
      text: `비슷한 업무를 해 본 사람은 ${people.length}명입니다. 점수가 높은 순서로 ${top.map((p) => `${p.label}(${p.score}점)`).join(', ')}입니다.`,
      evidence_ids: uniq(top.flatMap((p) => p.evidence_ids)),
    });
  }
  if (roles.length) {
    rule.push({
      text: `사람 이름이 아니라 역할 이름만 있는 항목이 ${roles.length}개 있습니다: ${roles.map((p) => p.label).join(', ')}. 실제 담당자는 확인이 필요합니다.`,
      // 역할 노드와 그가 맡은 업무만 근거로 든다(공유 주제 노드는 글이 짧아 원문 인용 검증에 쓰기 어렵고, 이 문장은 주제가 아니라 역할 이름을 말한다)
      evidence_ids: uniq(roles.flatMap((p) => [p.gid, ...p.works.map((w) => w.gid)])),
    });
  }
  return { target: `similar|${workGid}`, evidence_ids: uniq([...direct, ...people, ...roles].flatMap((p) => p.evidence_ids)), rule };
}

/** 반복 비효율 결과(repeatInefficiency) */
export function repeatExplain(result, universeId) {
  if (!result || result.status !== 'ok') return null;
  const rule = result.patterns.map((p) => ({ text: p.summary, evidence_ids: uniq(p.evidence_ids) }));
  return { target: `repeat|${universeId}`, evidence_ids: uniq(result.patterns.flatMap((p) => p.evidence_ids)), rule };
}

/** 밀집·공백 결과(densityGaps) */
export function densityExplain(result, universeId) {
  if (!result || result.status !== 'ok') return null;
  const rule = [];
  if (result.gaps.length) {
    rule.push({ text: `담당자가 없는 업무가 ${result.gaps.length}개입니다.`, evidence_ids: uniq(result.gaps.flatMap((g) => g.evidence_ids)) });
  }
  if (result.dense.length) {
    rule.push({ text: `업무를 ${result.n}개 이상 맡은 사람이 ${result.dense.length}명입니다: ${result.dense.map((p) => `${p.label}(${p.count}개)`).join(', ')}.`, evidence_ids: uniq(result.dense.flatMap((p) => p.evidence_ids)) });
  }
  if (!rule.length) return null;
  return { target: `density|${universeId}|n=${result.n}`, evidence_ids: uniq(rule.flatMap((s) => s.evidence_ids)), rule };
}

/** 흐름 변화 결과(flowChange) */
export function flowExplain(result, universeId) {
  if (!result || result.status !== 'ok') return null;
  const live = result.periods.filter((p) => !p.no_data);
  const busiest = [...live].sort((a, b) => b.counts.total - a.counts.total || (a.key < b.key ? -1 : 1))[0];
  const rule = [];
  if (busiest && busiest.counts.total) {
    rule.push({ text: `기록이 가장 많은 기간은 ${busiest.key}(${busiest.counts.total}건)입니다.`, evidence_ids: uniq(busiest.evidence_ids) });
  }
  const last = live[live.length - 1];
  if (result.no_data_periods && last) {
    rule.push({ text: `마지막 입력(${result.last_input}) 뒤 ${result.no_data_periods}개 기간은 기록이 없어 판단하지 않습니다.`, evidence_ids: uniq(last.evidence_ids.length ? last.evidence_ids.slice(-1) : []) });
  }
  const withEvidence = rule.filter((s) => s.evidence_ids.length);
  if (!withEvidence.length) return null;
  return { target: `flow|${universeId}|${result.unit}`, evidence_ids: uniq(live.flatMap((p) => p.evidence_ids)), rule: withEvidence };
}
