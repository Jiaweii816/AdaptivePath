import {test,expect} from "@playwright/test";
for(const [status,code,words] of [[409,"AI_BUSY","already running"],[429,"RATE_LIMITED","Too many requests"],[503,"REDIS_UNAVAILABLE","gateway is unavailable"],[504,"TIMEOUT","processing may still finish"]] as const){
 test(`UI ${status} BFF error via mocked transport`,async({page})=>{
  let count=0;await page.route("**/api/coach/chat",async route=>{count++;await route.fulfill({status,contentType:"application/json",body:JSON.stringify({ok:false,source:"bff",code,error:"safe",status,requestId:"a".repeat(32)})});});
  await page.goto("/workbench?problem=two-sum");await page.getByRole("textbox",{name:"Coach follow-up message"}).fill("test transport");await page.getByRole("button",{name:"Send coach message"}).click();
  await expect(page.getByText(words,{exact:false})).toBeVisible();await expect(page.getByText("Request-ID:",{exact:false})).toBeVisible();expect(count).toBe(1);
 });
}
