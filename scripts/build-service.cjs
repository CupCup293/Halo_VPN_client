// Сборка службы-помощника service/HaloService.cs → resources/service/halo-service.exe.
// Компилятор csc.exe входит в .NET Framework 4, который есть в любой Windows 10/11 — ничего ставить не нужно.
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const src = path.join(root, 'service', 'HaloService.cs');
const out = path.join(root, 'resources', 'service', 'halo-service.exe');
const fw = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319');
const csc = path.join(fw, 'csc.exe');

if (process.platform !== 'win32' || !fs.existsSync(csc)) {
  console.warn('build-service: csc.exe не найден, служба не пересобрана');
  process.exit(0);
}
if (fs.existsSync(out) && fs.statSync(out).mtimeMs >= fs.statSync(src).mtimeMs) process.exit(0);

fs.mkdirSync(path.dirname(out), { recursive: true });
execFileSync(
  csc,
  [
    '/nologo',
    '/optimize+',
    '/codepage:65001',
    '/target:exe',
    '/platform:anycpu',
    `/out:${out}`,
    '/r:System.ServiceProcess.dll',
    '/r:System.Core.dll',
    `/r:${path.join(fw, 'System.Web.Extensions.dll')}`,
    src,
  ],
  { stdio: 'inherit' },
);
console.log(`build-service: ${path.relative(root, out)}`);
