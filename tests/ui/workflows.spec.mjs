import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

test.beforeEach(async ({page,context})=>{
  await page.request.post('/__test/reset');
  await context.route('**/*', route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('dialog',dialog=>dialog.accept());
});
async function enter(page,{group='U18',pin='2468',team='Test Marlins',athlete='Alex'}={}) {
  await page.goto('/');
  await page.getByRole('button',{name:group+' ›',exact:true}).click();
  await page.getByLabel('Four digit '+group+' code').fill(pin);
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:team+' ›',exact:true}).click();
  await page.getByRole('button',{name:athlete+' ›',exact:true}).click();
  await page.getByRole('button',{name:'Start session',exact:true}).click();
  await expect(page.locator('[data-set-row]')).toHaveCount(6);
}
async function admin(page) {
  await page.goto('/#coach/login');
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password',{exact:true}).fill('test-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
}
const database=async page=>(await (await page.request.get('/__test/db')).json());

test('athlete: measured submit, refresh, edit weights/reps/time/feedback and persistence',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await enter(page);
  await page.locator('[data-field="load_kg"]').first().fill('65');
  await page.locator('[data-field="duration_seconds"]').first().fill('4.2');
  await expect(page.locator('#save-status')).toHaveText('Saved ✓');
  const before=(await (await page.request.get('/__test/metrics')).json()).length;
  const start=performance.now();
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  await expect(page.getByRole('button',{name:'Complete session',exact:true})).toBeVisible();
  const modalMs=performance.now()-start;
  const submitStart=performance.now();
  const response=page.waitForResponse(r=>r.url().endsWith('/rpc/save_workout') && r.request().postDataJSON().p_complete);
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await response;
  const responseMs=performance.now()-submitStart;
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  const successMs=performance.now()-start,submitSuccessMs=performance.now()-submitStart;
  const metrics=(await (await page.request.get('/__test/metrics')).json()).slice(before);
  const writes=metrics.filter(r=>r.path.endsWith('/save_workout'));
  expect(writes).toHaveLength(1);
  const initial=await database(page);
  expect(initial.logs).toHaveLength(1);expect(initial.sets).toHaveLength(2);
  await page.reload();
  await expect(page.locator('[data-field="load_kg"]').first()).toHaveValue('65');
  await page.getByRole('button',{name:'Edit results',exact:true}).click();
  await page.locator('[data-field="load_kg"]').first().fill('72.5');
  await page.locator('[data-field="reps"]').first().fill('6');
  await page.locator('[data-field="duration_seconds"]').first().fill('4.1');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByLabel('Session RPE (optional)').fill('0');
  await page.getByLabel('Session notes (optional)').fill('Edited synthetic result');
  await page.getByRole('button',{name:'Save updated results',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  await page.reload();
  await expect(page.locator('[data-field="load_kg"]').first()).toHaveValue('72.5');
  await expect(page.locator('[data-field="reps"]').first()).toHaveValue('6');
  await expect(page.locator('[data-field="duration_seconds"]').first()).toHaveValue('4.1');
  const updated=await database(page);
  expect(updated.logs[0].id).toBe(initial.logs[0].id);expect(updated.logs[0].completed_at).toBe(initial.logs[0].completed_at);
  expect(Number(updated.logs[0].session_rpe)).toBe(0);expect(updated.logs[0].athlete_notes).toBe('Edited synthetic result');
  expect(updated.sets.map(s=>s.id).sort()).toEqual(initial.sets.map(s=>s.id).sort());
  expect(errors).toEqual([]);
  await mkdir('docs/test-evidence',{recursive:true});
  await page.screenshot({path:'docs/test-evidence/athlete-edited.png',fullPage:true});
  const performanceResult={environment:'Loopback Chrome + PostgreSQL (PGlite); Auth/REST adapter, NOT hosted staging',sets:6,enteredSets:2,exercises:2,injectedWriteLatencyMs:80,finishToModalMs:modalMs,finishToSuccessMs:successMs,submitToDatabaseResponseMs:responseMs,submitToSuccessMs:submitSuccessMs,writeRequests:writes.length,requests:metrics};
  await writeFile('docs/test-evidence/after-performance.json',JSON.stringify(performanceResult,null,2)+'\n');
  await info.attach('performance',{body:JSON.stringify(performanceResult),contentType:'application/json'});
});

test('saving feedback, duplicate submit protection, injected failure, retained inputs and retry',async({page})=>{
  await enter(page);
  await page.locator('[data-field="load_kg"]').first().fill('67.5');
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  await page.getByLabel('Session notes (optional)').fill('Keep this feedback');
  await page.request.post('/__test/control',{data:{failNext:true,latency:700}});
  const count=(await (await page.request.get('/__test/metrics')).json()).filter(r=>r.path.endsWith('/save_workout')).length;
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.locator('[data-submit-status]')).toContainText('Saving');
  await expect(page.getByRole('button',{name:'Complete session',exact:true})).toBeDisabled();
  await page.locator('[data-form="finish"]').evaluate(form=>{for(let i=0;i<5;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
  await expect(page.locator('[data-submit-status]')).toContainText('Could not confirm');
  expect((await database(page)).logs[0].status).toBe('in_progress');
  await expect(page.getByLabel('Session notes (optional)')).toHaveValue('Keep this feedback');
  await page.screenshot({path:'docs/test-evidence/submission-failure.png',fullPage:true});
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.locator('[data-submit-status]')).toContainText('Saving');
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  const writes=(await (await page.request.get('/__test/metrics')).json()).filter(r=>r.path.endsWith('/save_workout'));
  expect(writes.length-count).toBe(1); // failed request is not included in successful server metrics
  await page.reload();await expect(page.locator('[data-field="load_kg"]').first()).toHaveValue('67.5');
  expect((await database(page)).logs[0].athlete_notes).toBe('Keep this feedback');
});

test('Coaches: invalid and valid PIN, standard training, edit, refresh and no admin rights',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Coaches ›',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Enter Coaches code'})).toBeVisible();
  await page.getByLabel('Four digit Coaches code').fill('0000');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await expect(page.locator('.error-box')).toContainText('not correct');
  expect(page.url()).not.toContain('coach/login');
  await page.getByLabel('Four digit Coaches code').fill('1357');
  await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByRole('button',{name:'Coaches ›',exact:true}).click();
  await page.getByRole('button',{name:'Casey ›',exact:true}).click();
  await page.getByRole('button',{name:'Start session',exact:true}).click();
  await page.locator('[data-field="load_kg"]').first().fill('40');
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  await page.reload();await page.getByRole('button',{name:'Edit results',exact:true}).click();
  await page.locator('[data-field="load_kg"]').first().fill('45');
  await page.getByRole('button',{name:'Save changes',exact:true}).click();
  await page.getByRole('button',{name:'Save updated results',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  await page.reload();await expect(page.locator('[data-field="load_kg"]').first()).toHaveValue('45');
  await expect(page.getByRole('navigation',{name:'Coach navigation'})).toHaveCount(0);
  expect((await database(page)).logs[0].athlete_id).toMatch(/003$/);
  await page.screenshot({path:'docs/test-evidence/coaches-edited.png',fullPage:true});
  await page.goto('/#coach/dashboard');
  await expect(page.getByRole('heading',{name:'Coach login'})).toBeVisible();
  const result=await page.request.post('/rest/v1/teams',{headers:{Authorization:'Bearer fixture-athlete'},data:{name:'Escalation attempt',age_group:'Coaches'}});
  expect(result.ok()).toBe(false);
});

test('dashboard calendar: all teams, details, months, empty dates, refresh and desktop',async({page})=>{
  await admin(page);
  await expect(page.locator('.calendar-grid')).toBeVisible();
  await expect(page.locator('.calendar-session')).toHaveCount(2);
  await expect(page.locator('.calendar-grid')).toContainText('Test Marlins');
  await expect(page.locator('.calendar-grid')).toContainText('Coaches');
  await page.screenshot({path:'docs/test-evidence/calendar-mobile.png',fullPage:true});
  await page.locator('.calendar-session').filter({hasText:'Coaches Training'}).click();
  await expect(page.getByRole('heading',{name:'Coaches Training',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Programmed exercises'})).toBeVisible();
  await page.getByRole('link',{name:'Dashboard',exact:true}).click();
  await page.getByRole('button',{name:'Next month',exact:true}).click();
  await expect(page.locator('.calendar-grid')).toContainText('Next Month Session');
  await page.reload();await expect(page.locator('.calendar-grid')).toContainText('Next Month Session');
  await page.getByRole('button',{name:'Next month',exact:true}).click();
  await expect(page.locator('.calendar-session')).toHaveCount(0);
  await expect(page.locator('.calendar-empty')).toBeVisible();
  await page.getByRole('button',{name:'Previous month'}).click();await page.getByRole('button',{name:'Previous month'}).click();
  await page.setViewportSize({width:1280,height:900});
  await expect(page.locator('.calendar-grid')).toContainText('Coaches');
  await page.screenshot({path:'docs/test-evidence/calendar-desktop.png',fullPage:true});
});

test('different athletes, wrong-profile route and stored drafts after refresh',async({page})=>{
  await enter(page);
  await page.request.post('/__test/control',{data:{latency:600}});
  await page.locator('[data-field="load_kg"]').first().fill('80');
  await page.reload();
  await expect(page.locator('[data-field="load_kg"]').first()).toHaveValue('80');
  await expect(page.locator('#save-status')).toHaveText('Saved ✓');
  const alexUrl=page.url();
  await page.getByRole('button',{name:'Alex',exact:true}).click();
  await page.getByRole('button',{name:'Test Marlins ›',exact:true}).click();
  await page.getByRole('button',{name:'Blair ›',exact:true}).click();
  await page.getByRole('button',{name:'Start session',exact:true}).click();
  await page.locator('[data-field="load_kg"]').first().fill('35');
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  const data=await database(page);expect(data.logs).toHaveLength(2);expect(data.sets.map(s=>Number(s.load_kg)).sort()).toEqual([35,80]);
  await page.goto(alexUrl);
  await expect(page.getByText('We could not load this screen.')).toBeVisible();
  await expect(page.locator('[data-set-input]')).toHaveCount(0);
});

test('coach regression: exercise, team, athlete, template and session creation',async({page})=>{
  await admin(page);
  await page.getByRole('link',{name:'+ Exercise',exact:true}).click();
  await page.getByLabel('Name',{exact:true}).fill('Synthetic Jump');
  await page.getByLabel('Tracking type').selectOption('height');
  await page.getByRole('button',{name:'Save exercise',exact:true}).click();
  await expect(page.getByRole('button',{name:/Synthetic Jump/})).toBeVisible();
  await page.getByRole('link',{name:'Athletes',exact:true}).click();
  await page.getByRole('button',{name:'+ Team',exact:true}).first().click();
  await page.getByLabel('Team name').fill('Synthetic Staff');
  await page.getByRole('combobox',{name:'Age group',exact:true}).selectOption('Coaches');
  await page.getByRole('button',{name:'Create team',exact:true}).click();
  await expect(page.getByRole('button',{name:/Synthetic Staff/})).toBeVisible();
  await page.getByRole('link',{name:'+ Athlete',exact:true}).click();
  await page.getByLabel('First name').fill('Drew');await page.getByLabel('Last name').fill('Fixture');
  await page.getByRole('listbox',{name:'Teams',exact:true}).selectOption({label:'Coaches · Synthetic Staff'});
  await page.getByRole('button',{name:'Save athlete',exact:true}).click();
  await expect(page.getByRole('button',{name:/Drew Fixture/})).toBeVisible();
  await page.getByRole('link',{name:'Templates',exact:true}).click();await page.getByRole('link',{name:'+ Template'}).click();
  await page.getByLabel('Name',{exact:true}).fill('Synthetic Template');
  await page.getByRole('button',{name:'Save template',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Template'})).toBeVisible();
  await page.getByRole('link',{name:'Use template',exact:true}).click();
  await page.getByRole('combobox',{name:'Team',exact:true}).selectOption({label:'Coaches · Synthetic Staff'});
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Synthetic Template'})).toBeVisible();
  await expect(page.getByRole('button',{name:/Drew Fixture/})).toBeVisible();
});

test('two devices: stale completed edits are rejected, reviewed, then explicitly saved',async({page,browser})=>{
  await enter(page);
  await page.locator('[data-field="load_kg"]').first().fill('60');
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  const otherContext=await browser.newContext({storageState:await page.context().storageState(),serviceWorkers:'block'});
  await otherContext.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const other=await otherContext.newPage();other.on('dialog',dialog=>dialog.accept());
  try {
    await other.goto(page.url());
    await page.getByRole('button',{name:'Edit results',exact:true}).click();
    await other.getByRole('button',{name:'Edit results',exact:true}).click();
    await page.locator('[data-field="load_kg"]').first().fill('62.5');
    await other.locator('[data-field="load_kg"]').first().fill('70');
    await page.getByRole('button',{name:'Save changes',exact:true}).click();
    await page.getByRole('button',{name:'Save updated results',exact:true}).click();
    await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
    await other.getByRole('button',{name:'Save changes',exact:true}).click();
    await other.getByRole('button',{name:'Save updated results',exact:true}).click();
    await expect(other.locator('[data-submit-status]')).toContainText('another device');
    expect((await database(page)).sets[0].load_kg).toBe(62.5);
    await other.getByRole('button',{name:'Keep training',exact:true}).click();
    await other.getByRole('button',{name:'Review saved results',exact:true}).click();
    await expect(other.locator('.modal')).toContainText('62.5 kg');
    await expect(other.locator('.modal')).toContainText('70 kg');
    await other.screenshot({path:'docs/test-evidence/conflict-review.png',fullPage:true});
    await other.getByRole('button',{name:'Keep my edits for the next save',exact:true}).click();
    await other.getByRole('button',{name:'Save updated results',exact:true}).click();
    await expect(other.getByRole('heading',{name:'Great work.'})).toBeVisible();
    expect((await database(page)).sets[0].load_kg).toBe(70);
  } finally { await otherContext.close(); }
});

test('lost database response: retry confirms the same committed workout without duplicates',async({page})=>{
  await enter(page);
  await page.locator('[data-field="load_kg"]').first().fill('65');
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  let lost=false;
  await page.route('**/rpc/save_workout',async route=>{
    if(!lost && route.request().postDataJSON().p_complete){lost=true;await route.fetch();return route.abort('failed');}
    return route.continue();
  });
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.locator('[data-submit-status]')).toContainText('Could not confirm');
  const committed=await database(page);expect(committed.logs[0].status).toBe('completed');
  await expect(page.getByRole('heading',{name:'Great work.'})).toHaveCount(0);
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  const retried=await database(page);expect(retried.logs).toHaveLength(1);expect(retried.sets).toHaveLength(1);
  expect(retried.logs[0].completed_at).toBe(committed.logs[0].completed_at);
  expect(retried.sets[0].id).toBe(committed.sets[0].id);
});

test('hung request times out with retained drafts and permits retry',async({page})=>{
  await enter(page);
  await page.locator('[data-field="load_kg"]').first().fill('75');
  await page.getByRole('button',{name:'Finish session',exact:true}).click();
  let release,intercepted=false;
  await page.route('**/rpc/save_workout',async route=>{
    if(!intercepted && route.request().postDataJSON().p_complete){intercepted=true;await new Promise(resolve=>{release=resolve;});return route.abort().catch(()=>{});}
    return route.continue();
  });
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.locator('[data-submit-status]')).toContainText('Saving');
  await expect(page.locator('[data-submit-status]')).toContainText('Could not confirm',{timeout:18000});
  release();
  await expect(page.locator('[data-field="load_kg"]').first()).toHaveValue('75');
  await page.getByRole('button',{name:'Complete session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Great work.'})).toBeVisible();
  expect((await database(page)).sets[0].load_kg).toBe(75);
});
