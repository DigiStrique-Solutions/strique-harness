/** Bounded, cancellable child processes; never run user values through a shell. */
import { spawn } from 'node:child_process'
import { access, realpath } from 'node:fs/promises'
import { constants } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'
import { homedir } from 'node:os'

/** Expand an explicit local path without shell evaluation. */
export function expandPath(path) {
  return resolve(path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path)
}

/** Resolve explicit paths first, otherwise PATH and known macOS desktop bundles. */
export async function findExecutable(explicit = '', env = process.env) {
  const candidates = explicit.trim() ? [expandPath(explicit.trim())] : [
    ...(env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(dir =>
      process.platform === 'win32' ? [join(dir, 'codex.exe')] : [join(dir, 'codex')]),
    '/Applications/ChatGPT.app/Contents/MacOS/codex',
    '/Applications/Codex.app/Contents/MacOS/codex',
  ]
  for (const candidate of candidates) {
    try { await access(candidate, constants.X_OK); return await realpath(candidate) }
    catch (error) { if (!['ENOENT', 'EACCES', 'ENOTDIR'].includes(error.code)) throw error }
  }
  throw new Error(explicit.trim() ? 'The configured Codex executable is missing or not executable' : 'Codex CLI was not found; enter its executable path')
}

/** Run a process through close; aborts terminate its process group on POSIX. */
export function runProcess(executable, args, {
  input = '', cwd, env = process.env, signal, timeoutMs = 30000,
  maxBytes = 4 * 1024 * 1024, onStdout, onStderr, onStart,
} = {}) {
  return new Promise((resolveResult, reject) => {
    if (signal?.aborted) { reject(signal.reason ?? new Error('Cancelled')); return }
    const child = spawn(executable, args, { cwd, env, shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = '', size = 0, failure, killTimer
    const kill = sig => {
      try {
        if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, sig)
        else child.kill(sig)
      } catch (error) { if (error.code !== 'ESRCH') failure ??= error }
    }
    const stop = error => {
      if (failure) return
      failure = error
      kill('SIGTERM')
      killTimer = setTimeout(() => kill('SIGKILL'), 1000)
      killTimer.unref()
    }
    const abort = () => stop(signal.reason ?? new Error('Cancelled'))
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => stop(new Error('Codex CLI timed out')), timeoutMs)
    const collect = (stream, chunk) => {
      size += Buffer.byteLength(chunk)
      if (size > maxBytes) { stop(new Error('Codex CLI output exceeded the configured limit')); return }
      if (stream === 'stdout') stdout += chunk
      else stderr += chunk
      try { (stream === 'stdout' ? onStdout : onStderr)?.(chunk) }
      catch (error) { stop(error) }
    }
    child.stdout.setEncoding('utf8').on('data', chunk => collect('stdout', chunk))
    child.stderr.setEncoding('utf8').on('data', chunk => collect('stderr', chunk))
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error) })
    child.on('error', error => { failure ??= error })
    child.on('close', (code, terminationSignal) => {
      clearTimeout(timer); clearTimeout(killTimer)
      signal?.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else resolveResult({ code, terminationSignal, stdout, stderr })
    })
    if (onStart) {
      try { onStart(child) } catch (error) { stop(error) }
    } else child.stdin.end(input)
  })
}

/** Explicit invocation controls used independently of the user's personal config. */
export const HARDENED_CONFIG = [
  'model_provider="openai"', 'approval_policy="never"', 'web_search="disabled"',
  'project_doc_max_bytes=0', 'mcp_servers={}',
  'features.shell_tool=false', 'features.unified_exec=false', 'features.hooks=false',
  'features.apps=false', 'features.plugins=false', 'features.remote_plugin=false',
  'features.multi_agent=false', 'features.memories=false', 'features.goals=false',
  'features.view_image=false', 'features.image_generation=false',
  'features.in_app_browser=false', 'features.skill_search=false',
  'features.sleep_tool=false', 'features.tool_suggest=false',
].flatMap(value => ['-c', value])
