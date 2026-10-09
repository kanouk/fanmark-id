import {createServer} from 'node:http';
import {createConnection} from 'node:net';

/** A disposable proxy tunnels only to one pinned loopback HTTPS server. Never resolves requested hosts. */
export async function createLocalBrowserEgressProxy(origin, onDenied = () => {}) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) throw Error('local_proxy_origin_invalid');
  const authority = url.host, sockets = new Set(), stats = {allowedConnections:0, deniedConnections:0};
  const remember = socket => {sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>socket.destroy());};
  const deny = (request, socket) => {
    stats.deniedConnections++;
    let hostname='invalid-authority',port='';
    try {const target=new URL(request.method==='CONNECT'?'https://'+request.url:request.url);hostname=target.hostname;port=target.port;}catch{}
    onDenied({hostname,port,method:request.method});
    socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');
  };
  const server = createServer((request,response)=>{
    stats.deniedConnections++;
    let hostname='invalid-authority';try{hostname=new URL(request.url).hostname;}catch{}
    onDenied({hostname,port:'',method:request.method});response.writeHead(403,{'content-length':'0','connection':'close'});response.end();
  });
  server.on('connection',remember);
  server.on('connect',(request,socket,head)=>{
    if(request.url!==authority){deny(request,socket);return;}
    // The destination is captured from validated configuration, never request input.
    const upstream=createConnection({host:'127.0.0.1',port:Number(url.port)});remember(upstream);
    upstream.once('connect',()=>{
      if(socket.destroyed){upstream.destroy();return;}
      stats.allowedConnections++;socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head.length)upstream.write(head);socket.pipe(upstream);upstream.pipe(socket);
    });
    socket.once('close',()=>upstream.destroy());upstream.once('close',()=>socket.destroy());
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let closed=false;
  return {stats,chromeArguments:[`--proxy-server=http://127.0.0.1:${server.address().port}`,'--proxy-bypass-list=<-loopback>','--disable-quic'],
    address:server.address(),async close(){if(closed)return;closed=true;for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
