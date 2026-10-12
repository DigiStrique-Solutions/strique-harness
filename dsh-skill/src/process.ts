import { spawn } from 'node:child_process'
import { lstat, readdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Explicit child environment: no API keys, Git config injection, or credential helpers. */
export function childEnvironment(): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/bin:/bin:/usr/local/bin',
    LANG: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '/usr/bin/false',
    GIT_LFS_SKIP_SMUDGE: '1', PYTHONNOUSERSITE: '1',
  }
}

/** Own the entire process group and await its exit before releasing staged files. */
export async function runProcess(command: string, args: string[], signal: AbortSignal, monitorDir?: string): Promise<void> {
  signal.throwIfAborted()
  const operation = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { env: childEnvironment(), stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let failure: Error | undefined
    let output = 0
    let stderr = ''
    let killTimer: ReturnType<typeof setTimeout> | undefined
    const kill = (mode: NodeJS.Signals) => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, mode) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= new Error('Could not stop child process') }
      }
    }
    const stop = (error: Error) => {
      failure ??= error
      kill('SIGTERM')
      killTimer ??= setTimeout(() => kill('SIGKILL'), 250)
    }
    const abort = () => stop(new Error('Operation cancelled or timed out'))
    operation.addEventListener('abort', abort, { once: true })
    if (operation.aborted) abort()
    for (const stream of [child.stdout, child.stderr]) stream.on('data', (chunk: Buffer) => {
      output += chunk.length
      if (output > 1024 * 1024) stop(new Error('Process output exceeds limit'))
    })
    child.stderr.on('data', (chunk: Buffer) => { if (stderr.length < 2048) stderr += chunk.toString() })
    let checking = false
    const monitor = monitorDir ? setInterval(() => {
      if (checking) return
      checking = true
      void checkDiskBudget(monitorDir).catch(() => stop(new Error('Repository exceeds disk budget'))).finally(() => { checking = false })
    }, 100) : undefined
    child.on('error', () => { failure ??= new Error(`Cannot start ${command}; ensure it is installed`) })
    child.on('close', code => {
      if (monitor) clearInterval(monitor)
      if (killTimer) clearTimeout(killTimer)
      // Descendants may outlive the main child; terminate them before returning.
      kill('SIGKILL')
      operation.removeEventListener('abort', abort)
      if (failure) reject(failure)
      else if (code !== 0) reject(new Error(command === 'python3' ? `Snapshot failed: ${stderr.trim()}` : 'Git could not fetch the repository'))
      else resolve()
    })
  })
  operation.throwIfAborted()
  if (monitorDir) await checkDiskBudget(monitorDir)
}

async function checkDiskBudget(root: string): Promise<void> {
  let bytes = 0
  let entries = 0
  async function walk(path: string, depth: number): Promise<void> {
    if (depth > 24) throw new Error('depth')
    for (const name of await readdir(path).catch(() => [])) {
      const file = join(path, name)
      const info = await lstat(file).catch(() => undefined)
      if (!info) continue
      bytes += info.size
      if (++entries > 8192 || bytes > 64 * 1024 * 1024) throw new Error('budget')
      if (info.isDirectory()) await walk(file, depth + 1)
    }
  }
  await walk(root, 0)
}
