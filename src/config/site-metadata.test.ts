import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import { publicProfile } from '@/config/public-profile';
import { DEFAULT_TITLE, HOME_TITLE, SITE_DESCRIPTION, SITE_URL, homeMetadata, rootMetadata } from '@/config/site-metadata';

describe('public portfolio metadata and profile', () => {
  it('publishes complete canonical, Open Graph, and Twitter metadata without performance claims', () => {
    assert.equal(rootMetadata.metadataBase?.toString(), `${SITE_URL}/`);
    assert.equal((rootMetadata.title as { default: string }).default, DEFAULT_TITLE);
    assert.equal((homeMetadata.title as { absolute: string }).absolute, HOME_TITLE);
    assert.equal(homeMetadata.description, SITE_DESCRIPTION);
    assert.equal(rootMetadata.alternates?.canonical, '/');
    assert.equal((rootMetadata.openGraph as { type?: string })?.type, 'website');
    assert.equal(rootMetadata.openGraph?.siteName, 'InvestIQ');
    assert.equal((rootMetadata.twitter as { card?: string })?.card, 'summary_large_image');
    assert.ok(rootMetadata.openGraph?.images);
    assert.doesNotMatch(`${HOME_TITLE}\n${SITE_DESCRIPTION}`, /buy|sell|price target|return|outperform|undervalued|overvalued/i);
  });

  it('exposes only owner-approved contact fields', () => {
    assert.equal(publicProfile.github, 'https://github.com/changfanghan0324');
    assert.equal(publicProfile.linkedin, null);
    assert.equal(publicProfile.email, null);
    assert.equal(publicProfile.resumeUrl, null);
  });
});
