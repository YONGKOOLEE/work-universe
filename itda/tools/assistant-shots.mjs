// AI 비서 화면 촬영(CR-25): node tools/assistant-shots.mjs [밝기 light|dark|both] [너비들 쉼표, 기본 1440,390,2560] [포트]
// dist-single/index.html(npx vite build --mode single)을 file://로 열어 주요 화면을 .tmp/itda-assistant/ 에 저장한다.
// 앱 소스는 고치지 않는다. 외부 통신은 막혀 있다(launch 기본값). 자기 임시 프로필로 띄운 Chrome만 정리한다.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch, sleep, waitFor } from './cdp.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '../.tmp/itda-assistant');
const themeArg = process.argv[2] || 'both';
const widths = (process.argv[3] || '1440,390,2560').split(',').map(Number);
const port0 = Number(process.argv[4] || 9881);
const themes = themeArg === 'both' ? ['light', 'dark'] : [themeArg];
await mkdir(OUT, { recursive: true });

const HELP = `(() => {
  const norm = (s) => (s || '').replace(/\\s+/g, ' ').trim();
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  window.__h = {
    click(sel, text) { const e = [...document.querySelectorAll(sel)].filter(vis).find((x) => !text || norm(x.textContent).includes(text)); if (!e) return false; e.click(); return true; },
    id(t) { const e = document.querySelector('[data-testid="' + t + '"]'); if (!e) return false; e.click(); return true; },
    setVal(el, v) { const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); },
    setId(t, v) { const e = document.querySelector('[data-testid="' + t + '"]'); if (!e) return false; this.setVal(e, v); return true; },
  };
})()`;

let n = 0;
for (const theme of themes) {
  for (const width of widths) {
    const height = width < 600 ? 1400 : width > 2000 ? 1500 : 1300;
    const b = await launch({ port: port0 + n++, profile: `C:/AI/work-universe/.tmp/itda-asst-shots-${port0 + n}`, width, height });
    const { cdp, ev } = b;
    const tag = `${theme}-${width}`;
    const shot = async (name) => {
      await sleep(350);
      await ev(`document.getElementById('main-scroll')?.scrollTo(0, 0); true`);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      await writeFile(resolve(OUT, `${tag}-${name}.png`), Buffer.from(data, 'base64'));
      console.log('찍음', tag, name);
    };
    const go = async (hash, ms = 700) => { await ev(`location.hash = ${JSON.stringify(hash)}; true`); await sleep(ms); };
    const esc = async () => { await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(250); };
    try {
      await cdp.send('Page.navigate', { url: pathToFileURL(resolve(ROOT, 'dist-single/index.html')).href });
      await waitFor(ev, 'document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);
      await ev(`localStorage.clear(); localStorage.setItem('itda-theme', '${theme}'); true`);
      await cdp.send('Page.reload');
      await sleep(500);
      await waitFor(ev, 'document.readyState === "complete" && !!document.getElementById("user-switch")', 15000);
      await ev(HELP);

      await go('#/assistant'); await shot('01-오늘');
      await go('#/assistant/customers'); await shot('02-고객-목록');
      await ev(`window.__h.id('asst-layout-card')`); await sleep(300); await shot('03-고객-카드');
      await ev(`window.__h.id('asst-cust-add')`); await sleep(400); await shot('04-고객-등록창');
      await esc();
      await go('#/assistant/customers/CU-001'); await shot('05-상세-개요');
      await go('#/assistant/customers/CU-001?tab=prefs'); await shot('06-상세-선호');
      await go('#/assistant/customers/CU-001?tab=history'); await shot('07-상세-히스토리');
      await go('#/assistant/customers/CU-001?tab=requests'); await shot('08-상세-요청');
      await go('#/assistant/customers/CU-001?tab=events'); await shot('09-상세-경조사');
      await go('#/assistant/customers/CU-001?tab=changes'); await shot('10-상세-변경이력(없음)');
      // 값 하나 고치고 변경 이력
      await go('#/assistant/customers/CU-001');
      await ev(`window.__h.id('asst-edit-open')`); await sleep(400);
      await ev(`window.__h.setId('asst-f-foodDislikes', '해산물, 매운 음식')`); await sleep(200); await shot('11-수정창');
      await ev(`window.__h.id('asst-cust-save')`); await sleep(400);
      await go('#/assistant/customers/CU-001?tab=changes'); await shot('12-상세-변경이력');
      await go('#/assistant/customers/CU-001?briefing=1', 900); await shot('13-브리핑');
      await esc();
      await go('#/assistant/customers/CU-001?tab=history');
      const fu = await ev(`(() => { const b = document.querySelector('[data-testid="asst-fu-open"]'); if (!b) return false; b.click(); return true; })()`);
      await sleep(600); if (fu) await shot('14-미팅후질문');
      await go('#/assistant/activities'); await shot('15-활동');
      await go('#/assistant/activities?sec=reqs'); await shot('16-요청');
      await go('#/assistant/activities?sec=anns'); await shot('17-경조사');
      await go('#/assistant/analyze'); await shot('18-대화분석-입력');
      await ev(`window.__h.id('asst-an-sample')`); await sleep(500); await shot('19-대화분석-예시승인');
      await go('#/assistant/ask'); await ev(`window.__h.click('[data-testid="asst-ask-ex"]', '골프')`); await sleep(800); await shot('20-묻기');
      await go('#/assistant/ask'); await ev(`window.__h.setId('asst-ask-input', '해산물 못 드시는 분'); window.__h.id('asst-ask-submit')`); await sleep(800); await shot('21-묻기-해산물');
      await go('#/assistant'); await ev(`window.__h.id('asst-settings-open')`); await sleep(400); await shot('22-설정');
      await esc();
      // 읽기 전용(이서연)
      await ev(`(() => { const s = document.getElementById('user-switch'); const o = [...s.options].find((x) => x.textContent.includes('이서연')); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
      await go('#/assistant/customers/CU-001'); await sleep(300); await shot('23-읽기전용');
      // 검토 반영(2026-10-30): 담당 고객이 없는 사용자의 오늘 화면, 고객 등록 오류 위치
      await go('#/assistant'); await sleep(300); await shot('24-담당고객없음');
      await ev(`window.__h.id('asst-scope-goall')`); await sleep(500); await shot('25-전체보기');
      await go('#/assistant/customers?new=1', 900);
      await ev(`window.__h.setId('asst-f-email', 'abc'); window.__h.setId('asst-f-name', '오류시험')`); await sleep(100);
      await ev(`window.__h.id('asst-cust-save')`); await sleep(500); await shot('26-고객-등록오류');
      await esc();
    } catch (e) {
      console.log('실패', tag, String(e.message || e).slice(0, 200));
    } finally {
      await b.close();
    }
  }
}
console.log('폴더:', OUT);
