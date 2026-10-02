# 업무 유니버스

가상 데이터로 동작하는 업무 지식 그래프 프로토타입.

## 개발

```
npm install
npm test              # 단위 테스트(model·view·rules·llm·app·store)
npm run build         # dist/index.html (스크립트 포함, 파일 하나)
npm run check:browser # Chrome·Edge에서 file:// 점검(P-1·P-3)
```

실행: `dist/index.html`을 더블클릭한다. 서버와 인터넷이 필요 없다. 다른 사람에게는 이 파일 하나만 보내면 된다. 단, 메일에서 HTML 첨부가 차단되는지는 아직 확인하지 않았다(03-plan K-6, T-15 발송 테스트). 차단되면 압축해서 보낸다.
