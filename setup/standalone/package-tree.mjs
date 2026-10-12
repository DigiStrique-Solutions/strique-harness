import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

function manifest(dir) { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); }
export function findPackage(name, from) {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
    if (dir === path.dirname(dir)) return undefined;
  }
}

// Preserve actual installed versions; hoist only when the resolved package agrees.
// Conflicting versions get real nested directories, never platform-dependent links.
export function assemblePackages(roots, output, { workspace = new Map(), pluginRoots = new Set() } = {}) {
  fs.mkdirSync(output, { recursive: true });
  const installed = new Map();
  const queue = [];
  const records = [];
  const identities = new Map();
  function dependencySource(name, source, pkg) {
    const spec = pkg.dependencies?.[name] || pkg.optionalDependencies?.[name] || pkg.peerDependencies?.[name] || '';
    const peerOnly = !pkg.dependencies?.[name] && !pkg.optionalDependencies?.[name];
    if (workspace.has(name) && (spec.startsWith('workspace:') || (peerOnly && pluginRoots.has(pkg.name)) || spec.startsWith('link:'))) return workspace.get(name);
    return findPackage(name, source);
  }
  function identity(source, pkg) {
    if (identities.has(source)) return identities.get(source);
    const digest = createHash('sha256');
    digest.update(JSON.stringify({ name: pkg.name, version: pkg.version, exports: pkg.exports, main: pkg.main, dsh: pkg.dsh }));
    const names = new Set([...Object.keys(pkg.dependencies || {}), ...Object.keys(pkg.optionalDependencies || {}), ...Object.keys(pkg.peerDependencies || {})]);
    for (const name of [...names].sort()) {
      const dependency = dependencySource(name, source, pkg);
      digest.update(`${name}:${dependency ? manifest(dependency).version : 'absent'}\n`);
    }
    for (const relative of packageFiles(source, pkg).sort()) {
      if (relative === 'package.json') continue;
      digest.update(relative); digest.update(fs.readFileSync(path.join(source, relative)));
    }
    const value = digest.digest('hex'); identities.set(source, value); return value;
  }
  function place(source, parent) {
    source = fs.realpathSync(source);
    const pkg = manifest(source);
    const key = identity(source, pkg);
    let destination;
    for (let dir = parent; dir.startsWith(path.dirname(output)); dir = path.dirname(dir)) {
      const candidate = path.join(dir, 'node_modules', pkg.name);
      if (installed.get(candidate) === key) return candidate;
      if (installed.has(candidate)) break;
      if (dir === path.dirname(dir)) break;
    }
    const root = path.join(output, pkg.name);
    destination = installed.has(root) ? path.join(parent, 'node_modules', pkg.name) : root;
    if (installed.has(destination)) {
      if (installed.get(destination) !== key) throw new Error(`Conflicting package placement: ${pkg.name}`);
      return destination;
    }
    installed.set(destination, key);
    fs.mkdirSync(destination, { recursive: true });
    copyPackage(source, destination, pkg);
    records.push({ name: pkg.name, version: pkg.version, directory: path.relative(path.dirname(output), destination).split(path.sep).join('/') });
    queue.push({ source, destination, pkg });
    return destination;
  }
  for (const source of roots) place(source, path.dirname(output));
  for (let i = 0; i < queue.length; i++) {
    const { source, destination, pkg } = queue[i];
    const required = new Set(Object.keys(pkg.dependencies || {}));
    const optional = new Set(Object.keys(pkg.optionalDependencies || {}));
    for (const name of Object.keys(pkg.peerDependencies || {})) {
      if (pkg.peerDependenciesMeta?.[name]?.optional) optional.add(name);
      else required.add(name);
    }
    for (const name of new Set([...required, ...optional])) {
      const resolved = dependencySource(name, source, pkg);
      if (!resolved) {
        if (optional.has(name)) continue;
        throw new Error(`${pkg.name} is missing installed runtime dependency ${name}`);
      }
      const dependency = manifest(resolved);
      const supports = (list, value) => !list || ((!list.filter(x => !x.startsWith('!')).length || list.includes(value)) && !list.includes(`!${value}`));
      if (!supports(dependency.os, process.platform) || !supports(dependency.cpu, process.arch)) {
        if (optional.has(name)) continue;
        throw new Error(`${name} does not support this build target`);
      }
      place(resolved, destination);
    }
  }
  return records;
}

function packageFiles(source, pkg) {
  const forbidden = relative => relative.split(/[\\/]/).some(part =>
    ['node_modules', '.git', '.aws', '.codex', '.dsh', '.npmrc'].includes(part) || /^\.env(?:\.|$)/.test(part));
  let files;
  if (Array.isArray(pkg.files)) {
    const include = pkg.files.filter(p => !p.startsWith('!'));
    const exclude = pkg.files.filter(p => p.startsWith('!')).map(p => p.slice(1));
    files = [...fs.globSync(include.flatMap(p => [p, `${p}/**`, `${p}/**/.*`, `${p}/**/.*/**`]), { cwd: source, exclude })];
    files.push('package.json');
    if (pkg.main) files.push(pkg.main.replace(/^\.\//, ''));
    const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin || {});
    files.push(...bins.map(p => p.replace(/^\.\//, '')));
    files.push(...fs.readdirSync(source).filter(p => /^(license|licence|notice|copying|readme)(\.|$)/i.test(p)));
  } else {
    files = [...fs.globSync(['**/*', '**/.*', '**/.*/**'], { cwd: source, exclude: ['node_modules/**', '.git/**'] })];
    files.push('package.json');
  }
  const selected = [];
  for (const relative of new Set(files)) {
    if (forbidden(relative) || relative.endsWith('.map')) continue;
    const file = path.resolve(source, relative);
    if (!file.startsWith(source + path.sep)) throw new Error(`Package path escapes source: ${relative}`);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    const real = fs.realpathSync(file);
    if (!real.startsWith(source + path.sep)) throw new Error(`Package asset links outside package: ${pkg.name}/${relative}`);
    selected.push(relative);
  }
  return selected;
}
function copyPackage(source, destination, pkg) {
  for (const relative of packageFiles(source, pkg)) {
    const file = path.join(source, relative);
    const target = path.join(destination, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    fs.chmodSync(target, fs.statSync(file).mode);
  }
}

export function inventory(root) {
  const result = [];
  for (const file of fs.globSync(['**/*', '**/.*', '**/.*/**'], { cwd: root })) {
    const full = path.join(root, file);
    if (!fs.lstatSync(full).isFile()) continue;
    result.push({ file: file.split(path.sep).join('/'), bytes: fs.statSync(full).size,
      sha256: createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
  }
  return result.sort((a, b) => a.file.localeCompare(b.file));
}
