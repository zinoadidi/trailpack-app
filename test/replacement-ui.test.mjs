import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('replacement prompts are available in all supported interface languages', async () => {
  const keys = ['replacementDraftHelp', 'replacementFreezeHelp', 'replacementRetryHelp', 'createReplacement', 'replacementReady',
    'replacementChoiceHelp', 'keepBoth', 'checkOldDeletion', 'deleteOldPack', 'deleteOldWarning', 'replacementChecking',
    'replacementDeleteBlocked', 'replacementActionFailed'];
  for (const lang of ['en', 'es', 'fr', 'et', 'fi']) {
    const translations = JSON.parse(await readFile(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8'));
    for (const key of keys) assert.ok(translations[`library.${key}`], `${lang}: ${key}`);
    assert.match(translations['library.deleteOldWarning'], /\{title\}/);
    assert.match(translations['library.replacementChoiceHelp'], /\{title\}/);
  }
});
