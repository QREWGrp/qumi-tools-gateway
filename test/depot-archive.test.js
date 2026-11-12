import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('../scripts/extract-depot.sh',import.meta.url));
function fixture(memberPaths){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'gateway-depot-archive-'));
  const input=path.join(base,'input');fs.mkdirSync(input);
  for(const name of memberPaths){
    const p=path.join(input,name);fs.mkdirSync(path.dirname(p),{recursive:true});
    fs.writeFileSync(p,'#!/bin/sh\necho depot test 2.103.12\n',{mode:0o755});
  }
  const archive=path.join(base,'release.tar.gz');
  execFileSync('tar',['-czf',archive,'-C',input,...memberPaths]);
  return {base,archive,out:path.join(base,'out'),cleanup:()=>fs.rmSync(base,{force:true,recursive:true})};
}
for(const [label,entry] of [['root binary','depot'],['nested binary','release/depot']]){
  test(`depot release extraction supports ${label}`,()=>{
    const f=fixture([entry]);try{
      const result=spawnSync('sh',[script,f.archive,f.out],{encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      const out=execFileSync(path.join(f.out,'depot'),[],{encoding:'utf8'});
      assert.match(out,/depot test/);
    }finally{f.cleanup();}
  });
}
test('extractor refuses archives with no depot entry',()=>{
  const f=fixture(['not-depot']);try{
    const result=spawnSync('sh',[script,f.archive,f.out],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/No depot executable/);
  }finally{f.cleanup();}
});
test('extractor refuses multiple depot candidates',()=>{
  const f=fixture(['depot','nested/depot']);try{
    const result=spawnSync('sh',[script,f.archive,f.out],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Expected exactly one/);
  }finally{f.cleanup();}
});
