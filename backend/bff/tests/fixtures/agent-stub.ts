import { createServer } from "node:http";
/** Transport fixture only; no database, provider or learner evidence claims. */
export function agentStub() {
 const seen: Array<{path:string,body:string}> = [];
 const server=createServer(async(req,res)=>{
  let body="";for await(const chunk of req)body+=chunk;seen.push({path:req.url??"",body});
  if(req.headers.accept?.includes("x-ndjson")){
   res.writeHead(200,{"Content-Type":"application/x-ndjson"});
   res.write('{"type":"evidence","evidence":{"fixture":true}}\n');
   res.end('{"type":"complete","result":{"ok":true}}\n');
  }else {res.writeHead(200,{"Content-Type":"application/json"});res.end('{"ok":true,"fixture":true}');}
 });return {server,seen};
}
