import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import {
  createBuildResponsePayload,
  findBuildForRosterNumber,
  findSignupRosterNumber,
  loadLatestZvZBuildLayout,
} from '../src/discord/buildCommand.js';

const interaction = {
  member: {
    nick: 'Onslawht',
    user: { global_name: 'E2J', id: '264193431830528006', username: 'e2j-account' },
  },
};

function item(name, id) {
  return {
    annotation: '(Q1/W3/P2)',
    imageUrl: `https://render.albiononline.com/v1/item/${id}.png?size=160`,
    itemId: id,
    name,
  };
}

describe('/build helpers', () => {
  it('finds the invoking member roster number in signup embed fields', () => {
    const messages = [{
      embeds: [{
        fields: [
          { name: 'Build #7', value: '<@111111111111111111>' },
          { name: 'Build #12', value: '<@264193431830528006> - Onslawht' },
        ],
        title: 'CTA Signup Sheet',
      }],
      timestamp: '2026-08-08T12:00:00Z',
    }];

    assert.equal(findSignupRosterNumber(messages, interaction), '12');
  });

  it('finds a roster number from a numbered signup line using the server nickname', () => {
    const messages = [{
      content: '1. Another Player\n23) Onslawht - Engage\n24) Next Player',
      timestamp: '2026-08-08T12:00:00Z',
    }];

    assert.equal(findSignupRosterNumber(messages, interaction), '23');
  });

  it('infers the build number from the ordered MILI-BOT signup sheet', () => {
    const messages = [{
      embeds: [{
        fields: [{
          name: 'Roles 1',
          value: [
            '**Earthrune**,\n— <@111111111111111111>',
            '**Lifecurse**,\n— <@222222222222222222>',
            '**Rootbound**,\n— <@333333333333333333>',
            '**Oathkeepers**,\n— Empty',
            '**Enigmatic**,\n— <@264193431830528006>',
            '**Locus**,\n— <@444444444444444444>',
          ].join('\n\n'),
        }, {
          name: 'Roles 2',
          value: '**Shadowcaller**,\n— <@555555555555555555>',
        }, {
          name: 'Loot Loggers',
          value: 'Loot Logger 3\n— <@264193431830528006>',
        }],
        title: '02 HOLY MASS — Party 1',
      }],
      timestamp: '2026-08-08T19:11:00Z',
    }];

    assert.equal(findSignupRosterNumber(messages, interaction), '5');
  });

  it('applies the party and role-column offsets to ordered signup sheets', () => {
    const messages = [{
      embeds: [{
        fields: [{
          name: 'Roles 2',
          value: [
            '**Build 31**,\n— <@111111111111111111>',
            '**Build 32**,\n— <@264193431830528006>',
          ].join('\n\n'),
        }],
        title: '02 HOLY MASS — Party 2',
      }],
      timestamp: '2026-08-08T19:11:00Z',
    }];

    assert.equal(findSignupRosterNumber(messages, interaction), '32');
  });

  it('tracks the party number separately when one signup message contains multiple parties', () => {
    const r4mossInteraction = {
      member: {
        nick: 'r4moss',
        user: { id: '999999999999999999', username: 'r4moss-account' },
      },
    };
    const roleAssignments = Array.from({ length: 9 }, (_, index) => (
      `**Build ${31 + index}**,\nâ€” <@${index === 8 ? '999999999999999999' : `11111111111111111${index}`}>`
    ));
    const messages = [{
      embeds: [{
        fields: [{ name: 'Roles 2', value: '**Build 11**,\nâ€” <@222222222222222222>' }],
        title: 'CTA Signup â€” Party 1',
      }, {
        fields: [{ name: 'Roles 2', value: roleAssignments.join('\n\n') }],
        title: 'CTA Signup â€” Party 2',
      }],
      timestamp: '2026-08-08T19:11:00Z',
    }];

    assert.equal(findSignupRosterNumber(messages, r4mossInteraction), '39');
  });

  it('uses the newest signup sheet when a member appears more than once', () => {
    const messages = [
      { content: '4. <@264193431830528006>', timestamp: '2026-08-08T11:00:00Z' },
      { content: '9. <@264193431830528006>', timestamp: '2026-08-08T12:00:00Z' },
    ];

    assert.equal(findSignupRosterNumber(messages, interaction), '9');
  });

  it('uses the latest edit time when choosing the current signup sheet', () => {
    const messages = [
      { content: '19. <@264193431830528006>', timestamp: '2026-08-08T12:00:00Z' },
      {
        content: '39. <@264193431830528006>',
        edited_timestamp: '2026-08-08T13:00:00Z',
        timestamp: '2026-08-08T11:00:00Z',
      },
    ];

    assert.equal(findSignupRosterNumber(messages, interaction), '39');
  });

  it('matches the stored build by its roster number', () => {
    const expected = { number: '16', role: 'DPS' };
    const layout = { builds: [{ number: '15' }, expected, { buildNumbers: ['17', '18'], number: '17, 18' }] };

    assert.equal(findBuildForRosterNumber(layout, '16'), expected);
    assert.equal(findBuildForRosterNumber(layout, '18').number, '17, 18');
    assert.equal(findBuildForRosterNumber(layout, '99'), null);
  });

  it('loads only the most recently updated saved layout', async () => {
    const fetchImpl = mock.fn(async () => new Response(JSON.stringify([{
      builds: [{ number: '1' }],
      id: 'layout-1',
      title: 'Current CTA',
    }]), { status: 200 }));

    const layout = await loadLatestZvZBuildLayout({
      SUPABASE_SERVICE_ROLE_KEY: 'service-key',
      SUPABASE_URL: 'https://project.supabase.co',
    }, fetchImpl);

    assert.equal(layout.id, 'layout-1');
    const url = new URL(fetchImpl.mock.calls[0].arguments[0]);
    assert.equal(url.searchParams.get('limit'), '1');
    assert.equal(url.searchParams.get('order'), 'updated_at.desc');
  });

  it('formats the matched build as a Discord role card with item image rows', () => {
    const payload = createBuildResponsePayload({
      number: '2',
      notes: 'Hold defensives for the second engage.',
      role: 'Engage',
      slots: {
        armor: [item('Demon Armor', 'T8_ARMOR_PLATE_HELL')],
        boots: [item('Royal Shoes', 'T8_SHOES_CLOTH_ROYAL')],
        cape: [],
        foodPots: [],
        helm: [item('Assassin Hood', 'T8_HEAD_LEATHER_SET2')],
        mainHand: [item('Lifecurse', 'T8_MAIN_CURSEDSTAFF_UNDEAD')],
        offHand: [item('Aegis', 'T8_OFF_SHIELD_HELL')],
      },
    }, '2');

    assert.match(payload.components[0].components[0].content, /Build #2/);
    assert.match(payload.components[0].components[0].content, /Weapon:\*\* Choose/);
    assert.match(payload.components[0].components[0].content, /Role:\*\* Engage/);
    assert.equal(payload.components[0].components[1].type, 12);
    assert.equal(payload.components[0].components[1].items.length, 1);
    const stripUrl = new URL(payload.components[0].components[1].items[0].media.url);
    assert.equal(stripUrl.pathname, '/build-items');
    assert.match(stripUrl.searchParams.get('items'), /T8_MAIN_CURSEDSTAFF_UNDEAD/);
    assert.match(stripUrl.searchParams.get('items'), /T8_OFF_SHIELD_HELL/);
    assert.match(payload.components[0].components[2].content, /Lifecurse \| Aegis \(Q1\/W3\/P2\)/);
    assert.match(payload.components[0].components[2].content, /Assassin Hood \(Q1\/W3\/P2\)/);
    assert.match(payload.components[0].components.at(-1).content, /Notes/);
    assert.match(payload.components[0].components.at(-1).content, /Hold defensives for the second engage/);
  });

  it('prints shared cell notes once for multiple variants in the same slot', () => {
    const payload = createBuildResponsePayload({
      role: 'Defensive',
      slots: {
        boots: [
          { annotation: 'F3/P2 / F3/P2 / Can Be Flexible', imageUrl: 'https://render.albiononline.com/v1/item/T8_SHOES_CLOTH_ROYAL.png?size=160', itemId: 'T8_SHOES_CLOTH_ROYAL', name: 'Boots of Valor' },
          { annotation: 'F3/P2 / F3/P2 / Can Be Flexible', imageUrl: 'https://render.albiononline.com/v1/item/T8_SHOES_PLATE_SET1.png?size=160', itemId: 'T8_SHOES_PLATE_SET1', name: 'Graveguard Boots' },
          { annotation: 'F3/P2 / F3/P2 / Can Be Flexible', imageUrl: 'https://render.albiononline.com/v1/item/T8_SHOES_LEATHER_ROYAL.png?size=160', itemId: 'T8_SHOES_LEATHER_ROYAL', name: 'Royal Shoes' },
        ],
      },
    }, '6');

    const caption = payload.components[0].components[2].content;
    assert.match(caption, /Boots of Valor \| Graveguard Boots \| Royal Shoes F3\/P2 \/ F3\/P2 \/ Can Be Flexible/);
    assert.equal((caption.match(/Can Be Flexible/g) || []).length, 1);
  });

  it('uses one compact image strip instead of Discord gallery cells', () => {
    const payload = createBuildResponsePayload({
      role: 'DPS',
      slots: {
        mainHand: [{
          annotation: '(Q2/W1/P4)',
          imageUrl: 'https://images.weserv.nl/?url=render.albiononline.com%2Fv1%2Fitem%2FT8_MAIN_SPEAR_LANCE_AVALON.png%3Fsize%3D160',
          name: 'Daybreaker',
        }],
      },
    }, '14');

    const stripUrl = new URL(payload.components[0].components[1].items[0].media.url);
    assert.equal(stripUrl.hostname, 'militant-discord-interactions.ejjernigan.workers.dev');
    assert.equal(stripUrl.pathname, '/build-items');
    assert.equal(stripUrl.searchParams.get('items'), 'T8_MAIN_SPEAR_LANCE_AVALON');
  });

  it('resolves the crystal tower chariot image from its saved item name', () => {
    const payload = createBuildResponsePayload({
      role: 'Battle Mount',
      slots: {
        mainHand: [{ imageUrl: '', itemId: '', name: 'Chariot' }],
      },
    }, '21');

    const imageUrl = payload.components[0].components[1].items[0].media.url;
    assert.match(imageUrl, /UNIQUE_MOUNT_TOWER_CHARIOT_CRYSTAL/);
  });
});
