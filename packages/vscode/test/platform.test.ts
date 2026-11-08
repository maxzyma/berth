import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executionHostSupported } from '@berthdev/berth';

test('execution support follows the extension host rather than the client OS', () => {
  assert.equal(executionHostSupported('darwin'), true);
  assert.equal(executionHostSupported('linux'), true);
  for (const os of ['win32', 'freebsd', 'web']) assert.equal(executionHostSupported(os), false);
});

test('packaged Windows activation shows guidance before accessing Unix state', () => {
  const bundle = fileURLToPath(new URL('../../dist/extension.cjs', import.meta.url));
  const source = `
    const assert=require('node:assert/strict'),Module=require('node:module');
    Object.defineProperty(process,'platform',{value:'win32'});
    const commands=new Map(), notices=[];let view;
    const disposable={dispose(){}};
    const stub={ThemeIcon:class{},ThemeColor:class{},
      workspace:{onDidChangeConfiguration:()=>disposable},
      commands:{registerCommand:(id,fn)=>{commands.set(id,fn);return disposable;}},
      window:{registerWebviewViewProvider:(id,value)=>{view=value;return disposable;},
        showInformationMessage:async text=>{notices.push(text);}},
    };
    const original=Module._load;
    Module._load=function(id,...args){return id==='vscode'?stub:original.call(this,id,...args);};
    const context={extensionUri:{},subscriptions:[],extension:{packageJSON:{contributes:{
      commands:[{command:'berth.new'},{command:'berth.checkSetup'}]
    }}},get globalStorageUri(){throw Error('Unix state must not be accessed');}};
    require(${JSON.stringify(bundle)}).activate(context).then(async()=>{
      assert.match(view.error,/WSL/);assert.equal(commands.size,2);
      await commands.get('berth.new')();assert.match(notices[0],/Linux execution host/);
    }).catch(error=>{console.error(error);process.exitCode=1;});
  `;
  const result = spawnSync(process.execPath, ['-e', source], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
});
