import { createInterface } from 'node:readline';
const input = createInterface({ input: process.stdin });
const tools = [{ name: 'inspect', description: 'Synthetic fixture inspection', inputSchema: { type: 'object', properties: {} } }];
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } };
  if (request.method === 'tools/list') result = { tools };
  if (request.method === 'tools/call') result = { content: [], structuredContent: { inherited: process.env.DEEPSEEK_API_KEY ?? null, dshHome: process.env.DSH_HOME ?? null, explicit: process.env.FIXTURE_KEY ?? null } };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
