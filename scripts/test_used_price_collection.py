"""Fail-closed checks for manual used-offer HTML refreshes, without network."""
import json
import hashlib
import unittest

from refresh_used_prices import PublicHTMLReader, checked_url, parse_offer, refresh_offers

TITLE = '[중고] 캐논 EOS R5 정품 4,000컷 (S)'
URL = 'https://canon-store.com/product/detail.html?product_no=13540'


def page(price=1200000, visible='1,200,000원', title=TITLE, state='InStock', sold='F', option='F'):
    product = {'@type': 'Product', 'name': title, 'offers': {
        'price': price, 'priceCurrency': 'KRW', 'availability': f'https://schema.org/{state}'}}
    return (f'<script type="application/ld+json">{json.dumps(product)}</script>'
            f'<strong id="span_product_price_text">{visible}</strong>'
            f"<script>var has_option = '{option}'; var is_soldout_icon = '{sold}'; "
            "var stock_number = '0'; var single_option_stock_data = '{\"use_stock\":false}';</script>")


def quote(**changes):
    return {'id': 'one', 'productId': 'canon-r5', 'sourceUrl': URL, 'title': TITLE,
            'priceKrw': 1100000, 'checkedAt': '2026-10-20', 'availability': 'in-stock',
            'verified': True, 'kind': 'used-sale', **changes}


def dataset(offer=None, **changes):
    return {'schemaVersion': 1, 'currency': 'KRW', 'updatedAt': '2026-10-20',
            'offers': [offer or quote()], **changes}


def observed(on='2026-10-20', price=1100000, availability='in-stock', **changes):
    return {'offerId': 'one', 'productId': 'canon-r5', 'sourceUrl': URL,
            'priceKrw': price, 'availability': availability, 'observedOn': on, **changes}


class UsedPriceCollectionTests(unittest.TestCase):
    def test_matching_price_and_unmanaged_inventory(self):
        self.assertEqual(parse_offer(page(), TITLE), {'priceKrw': 1200000, 'availability': 'in-stock'})
        self.assertEqual(parse_offer(page(price='1200000.00'), TITLE)['priceKrw'], 1200000)

    def test_price_mismatch_missing_or_malformed_evidence(self):
        invalid = [page(visible='1,100,000원'), page().replace('span_product_price_text', 'other'),
                   '<script type="application/ld+json">{bad}</script>', '<html>No metadata</html>',
                   page().replace('"priceCurrency": "KRW"', '"priceCurrency": "USD"')]
        for html in invalid:
            with self.subTest(html=html), self.assertRaises((ValueError, KeyError)):
                parse_offer(html, TITLE)

    def test_soldout_overrides_structured_instock(self):
        self.assertEqual(parse_offer(page(sold='T'), TITLE)['availability'], 'sold-out')
        self.assertEqual(parse_offer(page(state='OutOfStock'), TITLE)['availability'], 'sold-out')
        self.assertEqual(parse_offer(page(sold='T'), TITLE)['completionStatus'], 'out-of-stock')
        self.assertEqual(parse_offer(page(state='OutOfStock'), TITLE)['completionStatus'], 'out-of-stock')

    def test_options_unknown_stock_and_changed_configuration_fail(self):
        for html in [page(option='T'), page(state='PreOrder'), page(title=TITLE.replace('R5', 'R5 Mark II')),
                     page(title=TITLE.replace('4,000컷', '20,000컷')),
                     page().replace("var has_option = 'F';", '')]:
            with self.subTest(html=html), self.assertRaises(ValueError):
                parse_offer(html, TITLE)
        self.assertEqual(parse_offer(page(title='[중고]  캐논 EOS R5 정품 4,000컷 (S)'), TITLE)['priceKrw'], 1200000)

    def test_zero_and_invalid_prices_never_become_valid_quotes(self):
        for price in [0, -1, True, None, 'nan', 'Infinity', '1.5', 1_000_000_001]:
            with self.subTest(price=price), self.assertRaises(ValueError):
                parse_offer(page(price=price), TITLE)
        for text in ['0원', '1,20,000원', '1,200,000원부터', '가격 문의']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_offer(page(visible=text), TITLE)

    def test_only_curated_public_product_addresses(self):
        self.assertEqual(checked_url(URL).hostname, 'canon-store.com')
        invalid = ['http://canon-store.com/product/detail.html?product_no=1',
                   'https://example.com/product/detail.html?product_no=1',
                   'https://canon-store.com/api?product_no=1',
                   'https://user@canon-store.com/product/detail.html?product_no=1',
                   URL + '&other=2', URL + '#fragment', URL.replace('13540', '13540&product_no=2')]
        for url in invalid:
            with self.subTest(url=url), self.assertRaises(ValueError):
                checked_url(url)

    def test_failed_refresh_preserves_old_quote_and_check_date(self):
        original = {'schemaVersion': 1, 'currency': 'KRW', 'updatedAt': '2026-10-20', 'offers': [
            {'id': 'one', 'productId': 'canon-r5', 'sourceUrl': URL, 'title': TITLE, 'priceKrw': 1100000,
             'checkedAt': '2026-10-20', 'verified': True, 'kind': 'used-sale'},
            {'id': 'two', 'productId': 'canon-r5', 'sourceUrl': URL.replace('13540', '13541'), 'title': TITLE, 'priceKrw': 1100000,
             'checkedAt': '2026-10-20', 'verified': True, 'kind': 'used-sale'}]}
        def fetch(url):
            if url == URL:
                raise OSError('network failed')
            return page()
        updated, results = refresh_offers(original, fetch, '2026-10-22')
        self.assertFalse(results[0]['ok'])
        self.assertEqual(updated['offers'][0], original['offers'][0])
        self.assertEqual(updated['offers'][1]['checkedAt'], '2026-10-22')
        self.assertEqual(updated['offers'][1]['priceKrw'], 1200000)
        self.assertEqual(updated['offers'][1]['evidence']['contentSha256'], hashlib.sha256(page().encode('utf-8')).hexdigest())
        self.assertEqual(original['offers'][1]['checkedAt'], '2026-10-20')
        self.assertEqual([item['offerId'] for item in updated['observations']], ['two'])

    def test_success_appends_actual_day_without_inventing_missing_days(self):
        original = dataset(observations=[observed()])
        first, results = refresh_offers(original, lambda _: page(), '2026-10-22')
        self.assertTrue(results[0]['ok'])
        self.assertEqual(first['observations'], [observed(), observed('2026-10-22', 1200000)])
        second, _ = refresh_offers(first, lambda _: page(price=1150000, visible='1,150,000원'), '2026-10-25')
        self.assertEqual(second['observations'], [observed(), observed('2026-10-22', 1200000), observed('2026-10-25', 1150000)])
        self.assertEqual(original['observations'], [observed()], 'Do not mutate the caller or earlier observations')

    def test_same_day_recheck_replaces_only_that_offer_day(self):
        original = dataset(observations=[observed(), observed('2026-10-22', 1190000),
                                         observed('2026-10-22', 1300000, offerId='another')])
        updated, _ = refresh_offers(original, lambda _: page(), '2026-10-22')
        target = [item for item in updated['observations'] if item['offerId'] == 'one']
        self.assertEqual(target, [observed(), observed('2026-10-22', 1200000)])
        self.assertEqual(updated['observations'][1], original['observations'][2], 'Another listing on the same day is unchanged')
        self.assertEqual(len(updated['observations']), 3)

    def test_missing_history_is_not_backfilled_from_old_quote(self):
        updated, _ = refresh_offers(dataset(), lambda _: page(), '2026-10-22')
        self.assertEqual(updated['observations'], [observed('2026-10-22', 1200000)])

    def test_parse_failure_keeps_old_date_price_and_history(self):
        original = dataset(observations=[observed()])
        updated, results = refresh_offers(original, lambda _: page(title='Different model'), '2026-10-22')
        self.assertFalse(results[0]['ok'])
        self.assertEqual(updated, original)

    def test_network_failure_does_not_create_empty_history_or_current_day(self):
        def failed(_):
            raise OSError('no connection')
        original = dataset()
        updated, results = refresh_offers(original, failed, '2026-10-22')
        self.assertFalse(results[0]['ok'])
        self.assertEqual(updated, original)
        self.assertNotIn('observations', updated)

    def test_status_change_preserves_history_and_clears_old_completion_fields(self):
        original = dataset(observations=[observed()])
        ended, _ = refresh_offers(original, lambda _: page(state='OutOfStock'), '2026-10-22')
        self.assertEqual(ended['offers'][0]['availability'], 'sold-out')
        self.assertEqual(ended['offers'][0]['completionStatus'], 'out-of-stock')
        self.assertEqual(ended['offers'][0]['completionCheckedAt'], '2026-10-22')
        ending_record = observed('2026-10-22', 1200000, 'sold-out', completionStatus='out-of-stock')
        self.assertEqual(ended['observations'], [observed(), ending_record])
        reopened, _ = refresh_offers(ended, lambda _: page(price=1250000, visible='1,250,000원'), '2026-10-23')
        self.assertNotIn('completionStatus', reopened['offers'][0])
        self.assertNotIn('completionCheckedAt', reopened['offers'][0])
        self.assertEqual(reopened['observations'], [observed(), ending_record, observed('2026-10-23', 1250000)])
        self.assertEqual(ended['observations'][1], ending_record)

    def test_missing_identity_cannot_generate_an_observation(self):
        original = dataset(quote(productId=None))
        calls = []
        updated, results = refresh_offers(original, lambda url: calls.append(url), '2026-10-22')
        self.assertFalse(results[0]['ok'])
        self.assertEqual(updated, original)
        self.assertEqual(calls, [])

    def test_invalid_observation_date_or_history_is_rejected(self):
        for on in ['2026-2-22', '2026-02-30', 'not-a-date', None]:
            with self.subTest(on=on), self.assertRaises((ValueError, TypeError)):
                refresh_offers(dataset(), lambda _: page(), on)
        for history in [None, {}, ['invalid']]:
            with self.subTest(history=history), self.assertRaises(ValueError):
                refresh_offers(dataset(observations=history), lambda _: page(), '2026-10-22')

    def test_robots_denial_stops_product_fetch_and_is_checked_once(self):
        reader = PublicHTMLReader()
        calls = []
        def get(url, delay=1):
            calls.append(url)
            return 'User-agent: *\nDisallow: /product/'
        reader.get = get
        for url in [URL, URL.replace('13540', '13541')]:
            with self.assertRaises(ValueError):
                reader(url)
        self.assertEqual(calls, ['https://canon-store.com/robots.txt'])

    def test_unreachable_robots_is_not_retried_per_offer(self):
        reader = PublicHTMLReader()
        calls = []
        def get(url, delay=1):
            calls.append(url)
            raise OSError('robots unavailable')
        reader.get = get
        with self.assertRaises(OSError):
            reader(URL)
        with self.assertRaises(ValueError):
            reader(URL.replace('13540', '13541'))
        self.assertEqual(calls, ['https://canon-store.com/robots.txt'])


if __name__ == '__main__':
    unittest.main()
