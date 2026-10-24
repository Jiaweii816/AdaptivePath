import {test,expect} from "@playwright/test";
const caseIds=()=>{const ids=process.env.ROUND1_CASE_IDS?.split(",").filter(Boolean);if(!ids?.length)throw new Error("ROUND1_CASE_IDS must select visible cases from the isolated copy");return ids;};
async function resetRates(){
  const {execFileSync}=await import("node:child_process");
  const names=execFileSync("docker",["ps","--format","{{.Names}}"],{encoding:"utf8"}).split("\n");
  for(const name of ["docker-ragflow-cpu-1","docker-mysql-1","docker-infinity-1","docker-tei-cpu-1","docker-minio-1","docker-redis-1"])
   if(names.includes(name))throw new Error("Owner must stop conflicting container "+name);
  execFileSync("docker",["compose","--env-file",process.env.ROUND1_ENV_FILE??"/home/iris/round1-data/round1.env","-f","compose.round1.yml","exec","-T","redis","redis-cli","EVAL","local keys=redis.call('KEYS',ARGV[1]); for _,k in ipairs(keys) do redis.call('DEL',k) end; return #keys","0","coach:r1:test:round1-test:rate:*"],{timeout:10000,stdio:"pipe"});
 }
test.beforeAll(resetRates);
const paths=["/api/coach/review","/api/coach/chat","/api/coach/chat/clear","/api/workbench/run","/api/mock-interview/start","/api/mock-interview/respond","/api/mock-interview/send-code","/api/mock-interview/run-code","/api/mock-interview/complete"];
for(const path of paths)test(`real stack routing and Agent validation ${path}`,async({request})=>{
 const response=await request.post(path,{timeout:15000,data:{language:42,sessionId:42,problemId:42,message:42},headers:{"X-Request-ID":"spoof","X-Coach-Internal-Token":"spoof"}});
 expect(response.status()).toBe(400);const body=await response.json();expect(body.ok).toBe(false);expect(body.source).toBeUndefined();expect(response.headers()["x-failure-source"]).toBe("agent");expect(response.headers()["x-request-id"]).toMatch(/^[a-f0-9]{32}$/);
});
test("non-BFF route remains Next",async({request})=>{const r=await request.get("/ui-smoke",{timeout:15000});expect(r.status()).toBe(200);});
test("real Piston Practice Run",async({request})=>{
 const r=await request.post("/api/workbench/run",{timeout:55000,data:{problemSlug:"two-sum",language:"Python",selectedTestCaseIds:caseIds(),code:"class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen: return [seen[target-n], i]\n            seen[n] = i",browserInstanceId:"round1-real-stack",clientOccurredAt:new Date().toISOString()}});
 expect(r.status()).toBe(200);const data=await r.json();expect(data.ok).toBe(true);expect(data.practiceRunLogId).toBeTruthy();expect(data.runResult).toBeTruthy();expect(data.runResult.status).toBe("passed_visible_tests");expect(data.runResult.testResults).toHaveLength(caseIds().length);
});
test("real Review SSE with actual provider",async({request})=>{
 const r=await request.post("/api/coach/review",{timeout:55000,headers:{Accept:"text/event-stream, application/x-ndjson"},data:{problemSlug:"two-sum",language:"Python",selectedTestCaseIds:caseIds(),code:"class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",browserInstanceId:"round1-real-stack",clientOccurredAt:new Date().toISOString()}});
 expect(r.status()).toBe(200);expect(r.headers()["content-type"]).toContain("text/event-stream");const text=await r.text();expect(text).toContain("event: evidence");expect(text).toContain("event: complete");expect(text).not.toContain("event: bff_error");const line=text.split("\n").find(x=>x.startsWith("data: ")&&x.includes('"type":"complete"'));expect(line).toBeTruthy();const result=JSON.parse(line!.slice(6)).result;expect(result.reviewAttemptId).toBeTruthy();expect(result.runResult.status).toBe("failed");expect(result.degraded?.tier).not.toBe(3);expect(result.degraded?.reason ?? "").not.toMatch(/LLM.*unavailable|no_tests/);
});

// Success fixtures use only the already selected external test stack.
test.describe("real JSON action successes",()=>{
 let sessionId:string;
 test.beforeAll(resetRates);
 test("chat provider success",async({request})=>{
  const r=await request.post("/api/coach/chat",{timeout:55000,data:{problemSlug:"two-sum",message:"Briefly explain the hash map invariant for Two Sum.",browserInstanceId:"round1-real-stack",clientOccurredAt:new Date().toISOString()}});
  expect(r.status()).toBe(200);const data=await r.json();expect(data.ok).toBe(true);expect(data.coachReply).toBeTruthy();
 });
 test("clear unchanged JSON success",async({request})=>{const r=await request.post("/api/coach/chat/clear",{timeout:15000,data:{problemSlug:"two-sum"}});expect(r.status()).toBe(200);expect((await r.json()).ok).toBe(true);});
 test("start existing mock-interview via real provider",async({request})=>{const r=await request.post("/api/mock-interview/start",{timeout:55000,data:{problemSlug:"two-sum",language:"Python",responseLanguage:"en"}});expect(r.status()).toBe(200);const data=await r.json();expect(data.ok).toBe(true);expect(data.firstTurn).toBeTruthy();sessionId=data.session.id;});
 test("respond unchanged JSON",async({request})=>{expect(sessionId).toBeTruthy();const r=await request.post("/api/mock-interview/respond",{timeout:55000,data:{sessionId,message:"I will store visited values in a hash map and check the complement before inserting.",responseLanguage:"en"}});expect(r.status()).toBe(200);expect((await r.json()).ok).toBe(true);});
 test("send-code unchanged JSON",async({request})=>{expect(sessionId).toBeTruthy();const r=await request.post("/api/mock-interview/send-code",{timeout:55000,data:{sessionId,language:"Python",code:"class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i,n in enumerate(nums):\n            if target-n in seen: return [seen[target-n],i]\n            seen[n]=i",selectedTestCaseIds:caseIds()}});expect(r.status()).toBe(200);expect((await r.json()).ok).toBe(true);});
 test("run-code actual Piston",async({request})=>{expect(sessionId).toBeTruthy();const r=await request.post("/api/mock-interview/run-code",{timeout:55000,data:{sessionId,language:"Python",code:"class Solution:\n    def twoSum(self, nums, target):\n        seen = {}\n        for i,n in enumerate(nums):\n            if target-n in seen: return [seen[target-n],i]\n            seen[n]=i",selectedTestCaseIds:caseIds()}});expect(r.status()).toBe(200);const data=await r.json();expect(data.ok).toBe(true);expect(data.runResult.status).toBe("passed_visible_tests");});
 test("complete unchanged feedback JSON",async({request})=>{expect(sessionId).toBeTruthy();const r=await request.post("/api/mock-interview/complete",{timeout:55000,data:{sessionId,responseLanguage:"en"}});expect(r.status()).toBe(200);const data=await r.json();expect(data.ok).toBe(true);expect(data.feedbackId).toBeTruthy();});
});

test("real Review flushes evidence before terminal",async()=>{
 const started=Date.now();const r=await fetch((process.env.ROUND1_BASE_URL??"http://127.0.0.1:8088")+"/api/coach/review",{method:"POST",signal:AbortSignal.timeout(55000),headers:{"Content-Type":"application/json",Accept:"text/event-stream, application/x-ndjson"},body:JSON.stringify({problemSlug:"two-sum",language:"Python",selectedTestCaseIds:caseIds(),code:"class Solution:\n    def twoSum(self, nums, target):\n        return [0, 1]",browserInstanceId:"round1-real-flush",clientOccurredAt:new Date().toISOString()})});
 expect(r.status).toBe(200);const reader=r.body!.getReader();const decoder=new TextDecoder();let text="",evidenceMs:number|undefined,terminalMs:number|undefined;
 while(true){const {done,value}=await reader.read();if(done)break;text+=decoder.decode(value,{stream:true});if(evidenceMs===undefined&&text.includes("event: evidence"))evidenceMs=Date.now()-started;if(terminalMs===undefined&&text.includes("event: complete"))terminalMs=Date.now()-started;}
 expect(text).not.toContain("bff_error");expect(evidenceMs).toBeDefined();expect(terminalMs).toBeDefined();expect(evidenceMs!).toBeLessThan(terminalMs!);console.log(`real SSE timing: evidence=${evidenceMs}ms terminal=${terminalMs}ms`);
});
