import { followFile } from './transcriptFollow'
import { followShellTask, shellTaskDescription } from './shellTaskFollow'

// `npm run build:mcp` -> out/mcp/follow-transcript.cjs. Uygulama baslarken userData/mcp altina
// kopyalar; izleme sekmesi ELECTRON_RUN_AS_NODE=1 ile calistirir (bkz. agentTasks.followCommand).
const file = process.argv[2]
if (!file) {
  process.stderr.write('usage: follow-transcript <transcript.jsonl>\n')
  process.exit(2)
}
if (process.argv[3] === '--shell') {
  void shellTaskDescription(file).then((command) => {
    if (command) process.stdout.write(`Command: ${command.replace(/\x1b/g, '')}\r\n\r\n`)
    followShellTask(file, (text) => process.stdout.write(text))
  })
} else {
  followFile(file, (text) => process.stdout.write(text))
}
// Electron exe'si GUI alt sistemi: sekme kapaninca konsolla birlikte olmez, ust kabuk gidince kendimiz cikariz.
setInterval(() => { try { process.kill(process.ppid, 0) } catch { process.exit(0) } }, 2000)
