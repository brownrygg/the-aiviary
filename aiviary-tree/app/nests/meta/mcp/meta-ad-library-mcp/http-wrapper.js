#!/usr/bin/env node

const http = require('http');
const { spawn } = require('child_process');

const PORT = process.env.PORT || 3007;
const CREDENTIAL_RECEIVER_URL = process.env.CREDENTIAL_RECEIVER_URL || 'http://localhost:3006';

console.log('Starting Meta Ad Library MCP HTTP wrapper...');
console.log('Credential Receiver URL:', CREDENTIAL_RECEIVER_URL);

// Spawn the MCP server
const mcpServer = spawn('node', ['server.js'], {
  env: {
    ...process.env,
    CREDENTIAL_RECEIVER_URL
  }
});

let mcpReady = false;
const pendingRequests = new Map();
let outputBuffer = '';

// Handle MCP server stdout
mcpServer.stdout.on('data', (data) => {
  outputBuffer += data.toString();

  // Parse complete JSON objects
  const lines = outputBuffer.split('\n');
  outputBuffer = lines.pop(); // Keep incomplete line in buffer

  lines.forEach(line => {
    if (!line.trim()) return;

    try {
      const response = JSON.parse(line);
      console.log('MCP response:', JSON.stringify(response).substring(0, 200));

      const requestId = response.id;
      if (requestId !== undefined && pendingRequests.has(requestId)) {
        const { res } = pendingRequests.get(requestId);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(response));
        pendingRequests.delete(requestId);
      }
    } catch (err) {
      console.error('Error parsing line:', line.substring(0, 100), err.message);
    }
  });
});

// Handle MCP server stderr
mcpServer.stderr.on('data', (data) => {
  const message = data.toString();
  console.error('MCP stderr:', message);

  if (!mcpReady && message.includes('running on stdio')) {
    mcpReady = true;
    console.log('MCP server is ready!');
  }
});

// Handle MCP server exit
mcpServer.on('close', (code) => {
  console.log(`MCP server exited with code ${code}`);
  pendingRequests.forEach(({ res }) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'MCP server closed unexpectedly' }));
  });
  pendingRequests.clear();
});

// HTTP server
const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'meta-ad-library-mcp',
      mcpReady,
      pendingRequests: pendingRequests.size
    }));
    return;
  }

  // List tools (convenience endpoint)
  if (req.method === 'GET' && req.url === '/tools') {
    const requestId = Date.now() + Math.random();
    const jsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/list',
      params: {}
    };

    pendingRequests.set(requestId, { res });

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        res.writeHead(408, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Request timeout' }));
        pendingRequests.delete(requestId);
      }
    }, 30000);

    mcpServer.stdin.write(JSON.stringify(jsonRpcRequest) + '\n');
    return;
  }

  // Call tool (convenience endpoint)
  if (req.method === 'POST' && req.url === '/call') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { tool, arguments: args } = JSON.parse(body);

        if (!tool) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing "tool" parameter' }));
          return;
        }

        const requestId = Date.now() + Math.random();
        const jsonRpcRequest = {
          jsonrpc: '2.0',
          id: requestId,
          method: 'tools/call',
          params: {
            name: tool,
            arguments: args || {}
          }
        };

        pendingRequests.set(requestId, { res });

        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            res.writeHead(408, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Request timeout' }));
            pendingRequests.delete(requestId);
          }
        }, 30000);

        mcpServer.stdin.write(JSON.stringify(jsonRpcRequest) + '\n');

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Invalid JSON: ${err.message}` }));
      }
    });
    return;
  }

  // JSON-RPC endpoint (for full MCP protocol support)
  if (req.method === 'POST' && req.url === '/mcp') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const jsonRpcRequest = JSON.parse(body);
        console.log('Received request:', JSON.stringify(jsonRpcRequest).substring(0, 200));

        const requestId = jsonRpcRequest.id !== undefined ? jsonRpcRequest.id : Date.now();
        if (jsonRpcRequest.id === undefined) {
          jsonRpcRequest.id = requestId;
        }

        pendingRequests.set(requestId, { res });

        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            console.error('Request timeout for ID:', requestId);
            res.writeHead(408, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              jsonrpc: '2.0',
              id: requestId,
              error: { code: -32000, message: 'Request timeout' }
            }));
            pendingRequests.delete(requestId);
          }
        }, 30000);

        mcpServer.stdin.write(JSON.stringify(jsonRpcRequest) + '\n');

      } catch (err) {
        console.error('Error processing request:', err);
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON-RPC request' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found. Use GET /health, GET /tools, POST /call, or POST /mcp' }));
});

server.listen(PORT, () => {
  console.log(`Meta Ad Library MCP HTTP wrapper listening on port ${PORT}`);
  console.log('Waiting for MCP server to be ready...');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  mcpServer.kill();
  server.close();
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  mcpServer.kill();
  server.close();
});
