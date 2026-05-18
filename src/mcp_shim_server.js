#!/usr/bin/env node
'use strict';
// Thin opt-in MCP stdio server. Exits immediately unless enabled, so the
// default install path is the CLI plus skills, not an MCP connector.
const {shouldRun, listTools, handleCall, listAccounts} = require('./mcp_shim');

if (!shouldRun(process.env)) {
  process.stderr.write('stripe-shim disabled (set enable_mcp_shim to true to use it)\n');
  process.exit(0);
}

let buf = '';
process.stdin.on('data', (d) => {
  buf += d;
  let nl;
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl);
    buf = buf.slice(nl + 1);
    if (line.trim()) {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        process.stderr.write('stripe-shim: skipping malformed JSON-RPC line\n');
        continue;
      }
      handle(msg);
    }
  }
});

async function handle(msg) {
  function reply(result) {
    process.stdout.write(JSON.stringify({jsonrpc: '2.0', id: msg.id, result: result}) + '\n');
  }
  if (msg.method === 'initialize') {
    return reply({protocolVersion: '2024-11-05', capabilities: {tools: {}}, serverInfo: {name: 'stripe-shim', version: '0.1.0'}});
  }
  if (msg.method === 'tools/list') {
    return reply({tools: listTools()});
  }
  if (msg.method === 'tools/call') {
    if (msg.params && msg.params.name === 'stripe_accounts') {
      return reply({content: [{type: 'text', text: JSON.stringify(listAccounts(process.env), null, 2)}], isError: false});
    }
    const r = await handleCall((msg.params && msg.params.arguments) || {}, {});
    return reply({content: [{type: 'text', text: r.stdout}], isError: r.exitCode !== 0});
  }
  reply({});
}
