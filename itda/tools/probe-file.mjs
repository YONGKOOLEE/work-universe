import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { launch, sleep } from './cdp.mjs';
const [file, port = 9821, shot] = process.argv.slice(2);
const b = await launch({ port: Number(port), profile: 'C:/AI/work-universe/.tmp/itda-prof-' + port });
try {
  await b.cdp.send('Page.navigate', { url: pathToFileURL(file).href });
  await sleep(3000);
  console.log(JSON.stringify({ title: await b.ev('document.title'), text: await b.ev('document.body.innerText.slice(0,200)'), logs: b.logs }, null, 1));
  if (shot) { const { data } = await b.cdp.send('Page.captureScreenshot', { format: 'png' }); await writeFile(shot, Buffer.from(data, 'base64')); }
} finally { await b.close(); }
