# 업무 유니버스

가상 데이터로 동작하는 업무 지식 그래프 프로토타입.

## 개발

```
npm install
npm test              # 단위 테스트(model·view·rules·llm·app·store)
npm run build         # dist/index.html (스크립트 포함, 파일 하나)
npm run check:browser # Chrome·Edge에서 file:// 점검(P-1·P-3)
npm run package       # 제출 압축(release/)
npm run check:submit  # 제출 점검(빌드·테스트·비밀값·R-06·압축·풀어서 브라우저 점검)
npm run check:secrets # 비밀값 형식 검색(dist 포함). 0건이어야 함
npm run check:guide   # 실행 안내 "5분 둘러보기"를 실제 마우스·키보드로 따라가기
node tools/virtual-data-check.mjs   # 가상 데이터 형식 점검(R-06)
node tools/convert-snapshot.mjs     # 변환기 경계 사례 108개의 차이 보기(규칙을 일부러 바꿨으면 차이 확인 뒤 --write)
node tools/pregen-dump.mjs          # 사전 생성 문장 작성용 근거 덤프
```

실행: `dist/index.html`을 더블클릭한다. 서버와 인터넷이 필요 없다. 제출·공유는 `npm run package`로 만든 압축(index.html, 실행안내.html, 라이선스 고지)을 보낸다. 메일에서 첨부가 차단되는지는 아직 확인하지 않았다(03-plan K-6).
