import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const b = await chromium.launch(); const p = await b.newPage();
await p.goto(pathToFileURL(root + 'build/kasirku.html').href);
await p.pdf({path: root + 'Naqdi-Dokumen-Pengajuan.pdf', format:'A4', printBackground:true, margin:{top:'20mm',bottom:'20mm',left:'18mm',right:'18mm'}, displayHeaderFooter:true, headerTemplate:'<span></span>', footerTemplate:'<div style="font-size:8px;color:#777;width:100%;text-align:center"><span class="pageNumber"></span> / <span class="totalPages"></span></div>'});
await b.close();
