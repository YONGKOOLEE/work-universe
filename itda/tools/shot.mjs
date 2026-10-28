// 화면 한 장: node tools/shot.mjs <html> <hash> <out.png> [port] [js-before-shot]
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { launch, sleep } from './cdp.mjs';
const [file, hash, out, port = 9823, js] = process.argv.slice(2);
const b = await launch({ port: Number(port), profile: 'C:/AI/work-universe/.tmp/itda-prof-' + port });
try {
  await b.cdp.send('Page.navigate', { url: pathToFileURL(file).href + (hash || '') });
  await sleep(2500);
  if (js) { console.log('js:', JSON.stringify(await b.ev(js))); await sleep(1500); }
  const { data } = await b.cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(out, Buffer.from(data, 'base64'));
  console.log(JSON.stringify(b.logs.filter((l) => l.kind !== 'log').slice(0, 5)));
} finally { await b.close(); }
