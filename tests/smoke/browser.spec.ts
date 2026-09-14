import { test,expect } from '@playwright/test';
test('production forecast renders and public navigation works',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await expect(page.getByRole('button',{name:'Now',exact:true})).toBeVisible();
 await expect(page.locator('main')).toBeVisible();
 // A rendered forecast must include actual conditions, not just the static shell.
 await expect(page.getByText('mph',{exact:false}).first()).toBeVisible();
 await page.getByRole('button',{name:'Hourly',exact:true}).click();await expect(page.getByText('mph',{exact:false}).first()).toBeVisible();
 await page.getByRole('button',{name:'Log',exact:true}).click();await expect(page.getByText('The pilot is invitation-only.')).toBeVisible();expect(errors).toEqual([]);
});
