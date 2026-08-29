import assert from 'node:assert/strict';
import test from 'node:test';
import { publicTelegramParser } from '../src/index.js';

const page = `
<div class="tgme_widget_message" data-post="airAlarm_Kyiv/123">
  <div class="tgme_widget_message_text js-message_text" dir="auto">БпЛА курсом на <b>Бровари</b></div>
  <time datetime="2026-08-29T05:00:00+00:00"></time>
</div>
<div class="tgme_widget_message" data-post="airAlarm_Kyiv/124">
  <div class="tgme_widget_message_text js-message_text" dir="auto">Київ — відбій повітряної тривоги!</div>
  <time datetime="2026-08-29T05:01:00+00:00"></time>
</div>`;

test('extracts public Telegram post text, id and timestamp', () => {
  const messages = publicTelegramParser.parsePublicTelegramPage(page, 'airAlarm_Kyiv');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].messageId, '123');
  assert.equal(messages[0].text, 'БпЛА курсом на Бровари');
  assert.equal(messages[1].timestamp, '2026-08-29T05:01:00.000Z');
});

test('converts a public post to a safe normalized event', () => {
  const [message] = publicTelegramParser.parsePublicTelegramPage(page, 'airAlarm_Kyiv');
  const result = publicTelegramParser.publicThreatPayloads(message, null);
  assert.equal(result.payloads.length, 1);
  assert.equal(result.payloads[0].type, 'drone');
  assert.equal(result.payloads[0].location, 'Бровари');
  assert.equal(result.payloads[0].meta.sourceUrl, 'https://t.me/airAlarm_Kyiv/123');
});
