import assert from 'node:assert/strict';
import test from 'node:test';
import { siteMenuDriveConfig } from '../lib/site-menu-drive-config';

test('site Drive routing requires a complete pair and cannot route another OPLOC into that folder', () => {
  const email='GOOGLE_DRIVE_OWNER_EMAIL_OPLOC_TEST_MNK', root='GOOGLE_DRIVE_ROOT_FOLDER_ID_OPLOC_TEST_MNK';
  const keys=[email,root,'GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID','GOOGLE_DRIVE_ROOT_FOLDER_ID_APP_DELIVERED_IN'];
  const before=keys.map(k=>process.env[k]);
  try {
    keys.forEach(k=>delete process.env[k]);
    process.env[email]='site@example.test';
    assert.throws(()=>siteMenuDriveConfig('oploc:test-mnk'), /both its approved Drive owner/);
    process.env[root]='verified-menu-folder';
    assert.deepEqual(siteMenuDriveConfig('oploc:test-mnk'), {owner:{type:'oploc-workspace',oplocId:'oploc:test-mnk'},folderId:'verified-menu-folder'});
    assert.throws(()=>siteMenuDriveConfig('oploc:other'), /output folder is not configured/);
    process.env.GOOGLE_DELIVERED_IN_OUTPUT_FOLDER_ID='existing-app-folder';
    assert.equal(siteMenuDriveConfig('oploc:other').folderId,'existing-app-folder');
    assert.equal(siteMenuDriveConfig('oploc:test-mnk').folderId,'verified-menu-folder');
    delete process.env[email];
    assert.throws(()=>siteMenuDriveConfig('oploc:test-mnk'), /both its approved Drive owner/);
  } finally { keys.forEach((k,i)=>{if(before[i]===undefined)delete process.env[k];else process.env[k]=before[i];}); }
});
