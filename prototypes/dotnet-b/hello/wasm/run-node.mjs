// Runs the published hello WebAssembly under Node (T0.4):
//   node hello/wasm/run-node.mjs hello/wasm/bin/Release/net11.0/publish/wwwroot/_framework
// Expected: "hello, node, from .NET 11.0.0 on browser-wasm" and "sumOfSquares(1000) = 333833500".
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const dir = path.resolve(process.argv[2]);
const { dotnet } = await import(pathToFileURL(path.join(dir, 'dotnet.js')).href);
const { getAssemblyExports, getConfig, runMain } = await dotnet.withDiagnosticTracing(false).create();
const cfg = getConfig();
console.log('mainAssembly:', cfg.mainAssemblyName, 'assets:', cfg.resources ? Object.keys(cfg.resources).join(',') : '?');
const exports = await getAssemblyExports('HelloWasm');
console.log(exports.HelloWasm.HelloExports.Hello('node'));
console.log('sumOfSquares(1000) =', exports.HelloWasm.HelloExports.SumOfSquares(1000));
