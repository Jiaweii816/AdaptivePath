import {test,expect} from "@playwright/test";
test("real upstream early validation error retains Agent SSE event",async({request})=>{
 const r=await request.post("/api/coach/review",{timeout:15000,headers:{Accept:"text/event-stream, application/x-ndjson"},data:{language:42,problemId:42}});
 expect(r.status()).toBe(200);const text=await r.text();expect(text).toContain("event: error");expect(text).not.toContain("bff_error");
});
test("BFF unknown path and method envelopes",async({request})=>{
 const unknown=await request.post("/api/coach/unknown",{timeout:10000,data:{}});expect(unknown.status()).toBe(404);expect((await unknown.json()).source).toBe("bff");
 const method=await request.get("/api/coach/chat",{timeout:10000});expect(method.status()).toBe(405);expect((await method.json()).code).toBe("METHOD_NOT_ALLOWED");
});

test("private direct Next dual Accept stays NDJSON",async()=>{
 const {execFileSync}=await import("node:child_process");const names=execFileSync("docker",["ps","--format","{{.Names}}"],{encoding:"utf8"}).split("\n");
 for(const name of ["docker-ragflow-cpu-1","docker-mysql-1","docker-infinity-1","docker-tei-cpu-1","docker-minio-1","docker-redis-1"])if(names.includes(name))throw new Error("Owner must stop "+name);
 const code="fetch('http://next:3000/api/coach/review',{method:'POST',headers:{'Content-Type':'application/json',Accept:'text/event-stream, application/x-ndjson','X-Coach-Internal-Token':process.env.BFF_INTERNAL_TOKEN},body:JSON.stringify({language:42,problemId:42})}).then(async r=>console.log(JSON.stringify({status:r.status,type:r.headers.get('content-type'),events:(await r.text()).trim().split('\\n').map(line=>JSON.parse(line).type)})))";
 const output=execFileSync("docker",["compose","--env-file",process.env.ROUND1_ENV_FILE??"/home/iris/round1-data/round1.env","-f","compose.round1.yml","exec","-T","next","node","-e",code],{encoding:"utf8",timeout:15000});
 const result=JSON.parse(output);expect(result.status).toBe(200);expect(result.type).toContain("application/x-ndjson");expect(result.events).toEqual(["error"]);
});
