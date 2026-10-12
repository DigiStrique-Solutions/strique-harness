#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv.includes('--help')) {
  console.log('Usage: node export-source.mjs NEW_OUTPUT_DIRECTORY\nCopies current Git-tracked source files for Harness and the eight active plugins.');
  process.exit(0);
}
if (process.argv.length !== 3) throw new Error('Provide one new output directory; use --help for usage.');
const output = path.resolve(process.argv[2]);
const root = path.dirname(here);
if (output === root || output.startsWith(root + path.sep)) throw new Error('Export outside the source workspace.');
if (fs.existsSync(output)) throw new Error('Output already exists; choose a new directory.');
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
const projects = [manifest.harness, ...manifest.plugins];
const copies = [];
for (const project of projects) {
  const source = path.join(root, project.dir);
  const result = spawnSync('git', ['ls-files', '-z'], { cwd: source, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Cannot enumerate tracked files in ${project.dir}: ${result.error?.message || result.stderr}`);
  const untracked = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: source, encoding: 'utf8' });
  if (untracked.status !== 0) throw new Error(`Cannot check untracked files in ${project.dir}`);
  if (untracked.stdout) throw new Error(`${project.dir} has untracked files. Track the files needed for transfer, or remove unrelated files before exporting.`);
  for (const relative of result.stdout.split('\0').filter(Boolean)) {
    // Configuration and authentication are supplied separately on the target.
    if (relative.split(/[\\/]/).some(part => /^\.env(?:\.|$)/.test(part) || ['.npmrc', '.dsh', '.aws', '.codex', '.git', 'node_modules'].includes(part))) continue;
    const file = path.join(source, relative);
    if (!fs.existsSync(file)) continue; // Preserve current tracked deletions.
    const real = fs.realpathSync(file);
    if (!real.startsWith(fs.realpathSync(source) + path.sep)) throw new Error(`Tracked link points outside its project: ${project.dir}/${relative}`);
    // Materialize file symlinks so Windows does not require symlink privileges.
    const stat = fs.statSync(file);
    if (stat.isDirectory() && fs.lstatSync(file).isSymbolicLink()) {
      console.log(`Omitting directory alias ${project.dir}/${relative}; its tracked target is exported separately.`);
      continue;
    }
    if (!stat.isFile()) throw new Error(`Export only supports tracked files or file symlinks: ${project.dir}/${relative}`);
    copies.push({ file, destination: path.join(output, project.dir, relative), mode: stat.mode });
  }
}
fs.mkdirSync(output, { recursive: true });
for (const { file, destination, mode } of copies) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(file, destination);
  fs.chmodSync(destination, mode);
}
fs.cpSync(here, path.join(output, 'setup'), { recursive: true });
const attributes = path.join(here, 'standalone/source.gitattributes');
if (fs.existsSync(attributes)) fs.copyFileSync(attributes, path.join(output, '.gitattributes'));
for (const name of ['platform-release.yml', 'windows-release.yml']) {
  const workflow = path.join(here, 'standalone', name);
  if (!fs.existsSync(workflow)) continue;
  const workflows = path.join(output, '.github/workflows');
  fs.mkdirSync(workflows, { recursive: true });
  fs.copyFileSync(workflow, path.join(workflows, name));
}
console.log(`Exported ${copies.length} tracked files to ${output}. Review the source for embedded secrets before transferring it. Git history, dependencies, home configuration, and login state are excluded.`);
