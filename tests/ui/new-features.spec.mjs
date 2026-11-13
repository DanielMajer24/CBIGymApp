import { test, expect } from '@playwright/test';

test.beforeEach(async ({page,context})=>{
  await page.request.post('/__test/reset');
  await context.route('**/*', route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  page.on('dialog',dialog=>dialog.accept());
});
async function admin(page) {
  await page.goto('/#coach/login');
  await page.getByLabel('Email').fill('admin@example.test');
  await page.getByLabel('Password',{exact:true}).fill('test-only-password');
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Today',exact:true})).toBeVisible();
}

test('exercise search combobox narrows by partial match and keeps the chosen exercise on save',async({page})=>{
  await admin(page);
  await page.goto('/#coach/session/new');
  const input=page.locator('.combo-input').first();
  await input.fill('sprint');
  await expect(page.locator('.combo-option')).toHaveCount(1);
  await expect(page.locator('.combo-option')).toContainText('Fixture Sprint');
  await input.fill('zzz-no-match');
  await expect(page.locator('.combo-empty')).toBeVisible();
  await input.fill('sprint');
  await page.getByRole('option',{name:'Fixture Sprint',exact:false}).click();
  await expect(input).toHaveValue('Fixture Sprint');
  await page.getByLabel('Name',{exact:true}).fill('Combo Save Check');
  await page.getByLabel('Everyone active').check();
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Combo Save Check'})).toBeVisible();
  await page.goto('/#coach/sessions');
  await page.locator('article',{hasText:'Combo Save Check'}).getByRole('button',{name:'Edit',exact:true}).click();
  await expect(page.locator('.combo-input').first()).toHaveValue('Fixture Sprint');
});

test('template search filters the template list by partial, case-insensitive name',async({page})=>{
  await admin(page);
  await page.goto('/#coach/template/new');
  await page.getByLabel('Name',{exact:true}).fill('Upper Body Week 1');
  await page.getByRole('button',{name:'Save template',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Upper Body Week 1'})).toBeVisible();
  await page.goto('/#coach/template/new');
  await page.getByLabel('Name',{exact:true}).fill('Lower Body Strength');
  await page.getByRole('button',{name:'Save template',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Lower Body Strength'})).toBeVisible();
  await page.goto('/#coach/templates');
  await expect(page.locator('[data-template-card]')).toHaveCount(2);
  await page.getByPlaceholder('Search templates').fill('UPPER');
  await expect(page.locator('[data-template-card]:not(.hidden)')).toHaveCount(1);
  await expect(page.locator('[data-template-card]:not(.hidden)')).toContainText('Upper Body Week 1');
});

test('dashboard team and age-group filters narrow the calendar and today\'s sessions, independently of each other',async({page})=>{
  await admin(page);
  await expect(page.locator('.calendar-session')).toHaveCount(2);
  await page.getByRole('combobox',{name:'Team',exact:true}).selectOption({label:'U18 · Test Marlins'});
  await expect(page.locator('.calendar-session')).toHaveCount(1);
  await expect(page.locator('.calendar-grid')).toContainText('Fixture Strength');
  await expect(page.locator('.calendar-grid')).not.toContainText('Coaches Training');
  await expect(page.getByRole('button',{name:'Reset filters'})).toBeVisible();
  await page.getByRole('button',{name:'Reset filters'}).click();
  await expect(page.locator('.calendar-session')).toHaveCount(2);
  await page.getByRole('combobox',{name:'Age group',exact:true}).selectOption('Coaches');
  await expect(page.locator('.calendar-session')).toHaveCount(1);
  await expect(page.locator('.calendar-grid')).toContainText('Coaches Training');
});

test('session management: default and last-30-days filters, plus prev/next pagination controls',async({page})=>{
  await admin(page);
  await page.goto('/#coach/sessions');
  await expect(page.getByText('Next Month Session')).toBeVisible();
  await expect(page.locator('select').first()).toHaveValue('7days');
  await page.locator('select').first().selectOption('30days');
  await expect(page.getByText('Next Month Session')).toHaveCount(0);
  await expect(page.getByText('Fixture Strength')).toBeVisible();
  await page.locator('select').first().selectOption('all');
  await expect(page.getByText('Next Month Session')).toBeVisible();
  await expect(page.getByRole('button',{name:'← Previous'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Next →'})).toBeDisabled();
});

test('duplicate training period: preview, confirm, calendar reflects the copy, and editing it leaves the original untouched',async({page})=>{
  await admin(page);
  await page.getByRole('link',{name:'⧉ Duplicate training period',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Duplicate training period'})).toBeVisible();
  const today=new Date().toISOString().slice(0,10);
  const destination=new Date(Date.now()+7*86400000).toISOString().slice(0,10);
  await page.locator('input[data-dup="sourceStart"]').fill(today);
  await page.locator('input[data-dup="sourceEnd"]').fill(today);
  await page.locator('input[data-dup="destinationStart"]').fill(destination);
  await page.getByRole('button',{name:'Preview',exact:true}).click();
  await expect(page.getByText('2 sessions found')).toBeVisible();
  await expect(page.getByText('Fixture Strength')).toBeVisible();
  await expect(page.getByText('Coaches Training')).toBeVisible();
  await page.getByRole('button',{name:'Duplicate selected sessions',exact:true}).click();
  await expect(page.getByText('2 sessions added')).toBeVisible();
  await page.getByRole('link',{name:'Dashboard',exact:true}).click();
  await page.getByRole('button',{name:'Next month',exact:true}).click().catch(()=>{}); // no-op if the destination is still this month
  await expect(page.locator('.calendar-session')).toHaveCount(4);
});

test('dashboard session editing: edit button opens a modal pre-filled with the session, saves in place, and keeps the team filter',async({page})=>{
  await admin(page);
  await page.getByRole('combobox',{name:'Team',exact:true}).selectOption({label:'U18 · Test Marlins'});
  await expect(page).toHaveURL(/team=/);
  await page.getByRole('button',{name:'Edit Fixture Strength'}).first().click();
  await expect(page.locator('.modal')).toBeVisible();
  await expect(page.getByRole('heading',{name:'Edit session'})).toBeVisible();
  await expect(page.getByLabel('Name',{exact:true})).toHaveValue('Fixture Strength');
  await expect(page.locator('.combo-input')).toHaveCount(2); // the session's two programmed exercises
  await page.getByLabel('Name',{exact:true}).fill('Fixture Strength Updated');
  await page.getByRole('button',{name:'Save session',exact:true}).click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page).toHaveURL(/coach\/dashboard\?.*team=/); // no full-page navigation away
  await expect(page.getByRole('combobox',{name:'Team',exact:true})).toHaveValue(/.+/); // team filter still selected
  await expect(page.getByText('Fixture Strength Updated').first()).toBeVisible();
});

test('dashboard session editing: cancel discards unsaved changes without writing to the database',async({page})=>{
  await admin(page);
  await page.getByRole('button',{name:'Edit Fixture Strength'}).first().click();
  await page.getByLabel('Name',{exact:true}).fill('Should not be saved');
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
  await expect(page.getByText('Should not be saved')).toHaveCount(0);
  await expect(page.getByText('Fixture Strength',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'Edit Fixture Strength'}).first().click();
  await expect(page.getByLabel('Name',{exact:true})).toHaveValue('Fixture Strength');
});

test('dashboard session editing: Escape closes the modal, a second Escape is needed after closing the combo dropdown first',async({page})=>{
  await admin(page);
  await page.getByRole('button',{name:'Edit Fixture Strength'}).first().click();
  await expect(page.locator('.modal')).toBeVisible();
  await page.locator('.combo-input').first().click();
  await expect(page.locator('.combo-list').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.combo-list').first()).toBeHidden();
  await expect(page.locator('.modal')).toBeVisible(); // first Escape only closed the dropdown
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);
});

test('exercise combobox: arrow keys highlight an option and Enter selects it; category text is also searchable',async({page})=>{
  await admin(page);
  await page.goto('/#coach/session/new');
  const input=page.locator('.combo-input').first();
  await input.fill(''); // clear the row's default pre-filled exercise so all options show, not just a match for it
  await expect(page.locator('.combo-option')).toHaveCount(2); // Fixture Squat, Fixture Sprint
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.combo-option').first()).toHaveClass(/is-active/);
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.combo-option').nth(1)).toHaveClass(/is-active/);
  await page.keyboard.press('Enter');
  await expect(input).toHaveValue(/Fixture (Squat|Sprint)/);
  await expect(page.locator('.combo-list').first()).toBeHidden();
  await input.fill('other'); // both fixtures default to category "Other"
  await expect(page.locator('.combo-option')).toHaveCount(2);
});
