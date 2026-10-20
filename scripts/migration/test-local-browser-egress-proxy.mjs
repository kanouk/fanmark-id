import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createServer,createConnection} from 'node:net';
import {createLocalBrowserEgressProxy} from './local-browser-egress-proxy.mjs';

test('proxy forwards only the exact configured loopback tunnel and refuses external/other local destinations',async()=>{
  let accepted=0;const clients=new Set();
  const target=createServer(socket=>{accepted++;clients.add(socket);socket.on('data',data=>socket.write(data));socket.on('error',()=>socket.destroy());socket.on('close',()=>clients.delete(socket));});
  await new Promise(resolve=>target.listen(0,'127.0.0.1',resolve));
  const authority='127.0.0.1:'+target.address().port,denied=[],proxy=await createLocalBrowserEgressProxy('https://'+authority,receipt=>denied.push(receipt));
  const request=(raw,payload='')=>new Promise((resolve,reject)=>{
    const socket=createConnection(proxy.address.port,'127.0.0.1');let data='';socket.setTimeout(3000,()=>{socket.destroy();reject(Error('proxy_test_timeout'));});
    socket.on('error',reject);socket.on('data',bytes=>{data+=bytes;if(!payload||data.includes(payload)){socket.destroy();resolve(data);}});socket.on('connect',()=>socket.write(raw));
  });
  try{
    const valid=await request('CONNECT '+authority+' HTTP/1.1\r\nHost: '+authority+'\r\n\r\npinned-proxy-bytes','pinned-proxy-bytes');assert.ok(valid.endsWith('pinned-proxy-bytes'));assert.match(valid,/^HTTP\/1.1 200/);
    for(const candidate of ['remote.example.invalid:443','127.0.0.1:1','localhost:'+target.address().port,authority+'@remote.example.invalid:443']){
      assert.match(await request('CONNECT '+candidate+' HTTP/1.1\r\nHost: '+candidate+'\r\n\r\n'),/^HTTP\/1.1 403/);
    }
    assert.match(await request('GET http://remote.example.invalid/ HTTP/1.1\r\nHost: remote.example.invalid\r\n\r\n'),/^HTTP\/1.1 403/);
    assert.equal(accepted,1);assert.equal(proxy.stats.allowedConnections,1);assert.equal(denied.length,5);
    assert.ok(proxy.chromeArguments.includes('--proxy-bypass-list=<-loopback>'));
  }finally{await proxy.close();for(const client of clients)client.destroy();await new Promise(resolve=>target.close(resolve));}
});
test('proxy rejects non-loopback, unpinned port and credential-bearing configurations',async()=>{
  for(const origin of ['https://remote.example.invalid:443','https://127.0.0.1','https://user:secret@127.0.0.1:1234','http://127.0.0.1:1234']){
    await assert.rejects(createLocalBrowserEgressProxy(origin),/local_proxy_origin_invalid/);
  }
});
